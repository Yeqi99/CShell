import {desktopTestTarget} from './desktop-test-target';
import {readFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ClientVault,fingerprint} from '../src/core/client/identity';
import {ClientProvider} from '../src/core/client/provider';
import {agentCodec} from '../src/agent/storage';
const receipt=JSON.parse(await readFile('test-results/desktop-server-receipt.json','utf8'));
const expected=desktopTestTarget();
if(receipt.host!==expected.host||receipt.port!==expected.port||fingerprint(receipt.certificate)!==receipt.fingerprint)throw Error('Receipt invalid');
const name=process.argv[3]??basename(process.argv[2]);if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Invalid deployment filename');
const content=await readFile(process.argv[2]);const compressed=gzipSync(content),hash=createHash('sha256').update(content).digest('hex');
const directory=resolve('test-results/desktop-test-controller'),vault=new ClientVault(directory,await agentCodec(directory));
const provider=new ClientProvider(vault,()=>{});await provider.load();
const target=`C:\\Users\\Administrator\\Desktop\\desktop-server-deploy\\${name}`;
try{
 const id=await provider.connect({deviceId:receipt.deviceId,shell:'powershell'},undefined,AbortSignal.timeout(1200000));
 const tool=provider.resolve(id).tools.find(t=>t.name==='execute_command');if(!tool)throw Error('Command capability unavailable');
 const execute=async(command:string)=>{const result=JSON.parse(await tool.invoke({command,timeoutMs:60000},AbortSignal.timeout(70000)) as string);if(result.exitCode!==0)throw Error(result.stderr||result.stdout||'Remote upload failed');return result.stdout;};
 for(let offset=0;offset<compressed.length;offset+=7000){
  const bytes=compressed.subarray(offset,offset+7000).toString('base64');
  await execute(`$ErrorActionPreference='Stop'; $f=[IO.File]::Open('${target}.upload.gz',[IO.FileMode]::${offset===0?'Create':'Append'}); try{$b=[Convert]::FromBase64String('${bytes}');$f.Write($b,0,$b.Length)}finally{$f.Dispose()}`);
  console.log(`Uploaded ${Math.min(offset+7000,compressed.length)}/${compressed.length} compressed bytes`);
 }
 const result=await execute(`$ErrorActionPreference='Stop';$f=[IO.File]::OpenRead('${target}.upload.gz');$g=New-Object IO.Compression.GZipStream($f,[IO.Compression.CompressionMode]::Decompress);$o=[IO.File]::Create('${target}.new');try{$g.CopyTo($o)}finally{$o.Dispose();$g.Dispose();$f.Dispose()};if((Get-FileHash -LiteralPath '${target}.new' -Algorithm SHA256).Hash -ne '${hash}'){throw 'Deployment digest mismatch'};Move-Item -LiteralPath '${target}.new' -Destination '${target}' -Force;Remove-Item -LiteralPath '${target}.upload.gz';Write-Output 'Verified ${name}: ${hash}'`);
 console.log(result.trim());
}finally{provider.dispose();}
