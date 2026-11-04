import unittest,tempfile,base64,hashlib,uuid,tracemalloc,time
from server import Service,Failure
from vault_chunks import CHUNK
class ChunkTests(unittest.TestCase):
 def test_partial_tamper_account_isolation_cas_quota_and_expiry(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db',b'x'*32,lambda *a:None)
   with s.db() as db:
    db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'));db.execute('INSERT INTO accounts VALUES(?,?)',('b','b@example.com'))
   data=base64.b64encode(b'x'*40).decode();start=dict(action='begin',mutationId=str(uuid.uuid4()),baseRevision=0,nonce=base64.b64encode(b'x'*12).decode(),length=len(data),digest=hashlib.sha256(data.encode()).hexdigest())
   call=lambda body,account='a':s.vault_chunks.operate(account,body,4,256*1024**2)
   call(start)
   with self.assertRaises(Failure):call(dict(action='commit',mutationId=start['mutationId']))
   part=dict(action='put',mutationId=start['mutationId'],part=0,data=data,digest='0'*64)
   with self.assertRaises(Failure):call(part)
   with self.assertRaises(Failure):call(dict(part,digest=start['digest']),'b')
   call(dict(part,digest=start['digest']))
   # Competing legacy writer wins CAS; incomplete upload cannot overwrite it.
   s.write('a',dict(baseRevision=0,mutationId=str(uuid.uuid4()),envelope=dict(format=1,nonce=start['nonce'],ciphertext=data)),4)
   with self.assertRaises(Failure):call(dict(action='commit',mutationId=start['mutationId']))
   self.assertEqual(s.read('a',4)['revision'],1)
   with self.assertRaises(Failure):call(dict(start,mutationId=str(uuid.uuid4()),baseRevision=1,length=4*1024*1024))
   with s.db() as db:db.execute('UPDATE vault_uploads SET created=?',(time.time()-90000,))
   with self.assertRaises(Failure):call(dict(action='status',mutationId=start['mutationId']))
   with s.db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM vault_parts').fetchone()[0],0)
 def test_large_resume_atomic_commit_old_client_guard_and_bounded_memory(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db',b'x'*32,lambda *a:None)
   with s.db() as db:
    db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
    db.execute('INSERT INTO storage_grants VALUES(?,?,?,?)',('grant','a',128*1024**2,9999999999))
   length=((65*1024**2+16+2)//3)*4;count=(length+CHUNK-1)//CHUNK;full=hashlib.sha256()
   for n in range(count):full.update(('A'*min(CHUNK,length-n*CHUNK)).encode())
   begin=dict(action='begin',mutationId=str(uuid.uuid4()),baseRevision=0,nonce=base64.b64encode(b'x'*12).decode(),length=length,digest=full.hexdigest())
   self.assertEqual(s.vault_chunks.operate('a',begin,4,256*1024**2)['received'],[])
   tracemalloc.start()
   for n in range(count):
    data='A'*min(CHUNK,length-n*CHUNK);part=dict(action='put',mutationId=begin['mutationId'],part=n,data=data,digest=hashlib.sha256(data.encode()).hexdigest())
    s.vault_chunks.operate('a',part,4,256*1024**2)
    if n==0:
     s=Service(d+'/db',b'x'*32,lambda *a:None)
     self.assertEqual(s.vault_chunks.operate('a',begin,4,256*1024**2)['received'],[0])
     self.assertEqual(s.read('a',4)['revision'],0)
   s.vault_chunks.operate('a',dict(action='commit',mutationId=begin['mutationId']),4,256*1024**2)
   _,peak=tracemalloc.get_traced_memory();tracemalloc.stop();self.assertLess(peak,10*1024**2)
   self.assertEqual(s.vault_chunks.manifest('a',4,256*1024**2)['length'],length)
   with self.assertRaises(Failure) as caught:s.read('a',4,64*1024**2)
   self.assertEqual(caught.exception.status,413)
   self.assertTrue(s.vault_chunks.operate('a',begin,4,256*1024**2)['committed'])
   with self.assertRaises(Failure):s.vault_chunks.operate('a',dict(action='get',part=0,revision=0),4,256*1024**2)
