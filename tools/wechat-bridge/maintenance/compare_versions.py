"""Read-only candidate matching. Never emits a production-ready profile."""
import argparse,bisect,hashlib,json,pathlib,re,struct
import pefile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64,CS_GRP_CALL,CS_GRP_JUMP
from capstone.x86 import X86_OP_MEM,X86_REG_RIP

def load(path):
 p=pefile.PE(path,fast_load=True)
 if p.FILE_HEADER.Machine!=0x8664:raise ValueError('Only x64 PE is supported')
 d=p.OPTIONAL_HEADER.DATA_DIRECTORY[3]
 functions=[(a,b) for a,b,c in struct.iter_unpack('<III',p.get_data(d.VirtualAddress,d.Size))]
 section=next(s for s in p.sections if s.Name.rstrip(b'\0')==b'.text')
 return p,functions,section.get_data(),section.VirtualAddress

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('old');parser.add_argument('new');parser.add_argument('profile');parser.add_argument('output')
 args=parser.parse_args();profile=json.loads(pathlib.Path(args.profile).read_text(encoding='utf8'))
 old_hash=hashlib.sha256(pathlib.Path(args.old).read_bytes()).hexdigest()
 if old_hash!=profile['moduleSha256']:raise ValueError('Old module does not match the profile')
 old,of,_,_=load(args.old);new,nf,code,base=load(args.new)
 starts=[f[0] for f in nf];md=Cs(CS_ARCH_X86,CS_MODE_64);md.detail=True;results=[]
 for name,value in profile['rvas'].items():
  rva=int(value,0);function=next((f for f in of if f[0]<=rva<f[1]),None)
  if function is None:
   end=next((i.address+i.size for i in md.disasm(old.get_data(rva,1024),rva) if i.mnemonic=='ret'),rva+128)
   function=(rva,end)
  pattern=[];size=0
  for instruction in md.disasm(old.get_data(rva,min(128,function[1]-rva)),rva):
   mask=set()
   if instruction.group(CS_GRP_CALL) or instruction.group(CS_GRP_JUMP):mask.update(range(instruction.imm_offset,instruction.imm_offset+instruction.imm_size))
   if any(o.type==X86_OP_MEM and o.mem.base==X86_REG_RIP for o in instruction.operands):mask.update(range(instruction.disp_offset,instruction.disp_offset+instruction.disp_size))
   pattern.extend(b'.' if i in mask else re.escape(bytes([b])) for i,b in enumerate(instruction.bytes));size+=instruction.size
  matches=[]
  if size>=24:
   for match in re.finditer(b''.join(pattern),code,re.DOTALL):
    address=base+match.start();index=bisect.bisect_right(starts,address)-1
    boundary=nf[index] if index>=0 and address<nf[index][1] else None
    matches.append({'rva':hex(address),'functionStart':hex(boundary[0]) if boundary else None})
    if len(matches)==32:break
  results.append({'name':name,'oldRva':value,'sampleBytes':size,'candidates':matches,'capped':len(matches)==32,'verified':False})
 report={'oldHash':old_hash,'newHash':hashlib.sha256(pathlib.Path(args.new).read_bytes()).hexdigest(),'executable':False,'candidates':results,'next':'Cross-check full call graph, layout and live validation; do not auto-enable'}
 pathlib.Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({'functions':len(results),'uniqueSamples':sum(len(x['candidates'])==1 for x in results),'executable':False}))
if __name__=='__main__':main()
