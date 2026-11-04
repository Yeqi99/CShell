"""Version 1 bounded ciphertext transport; original AES-GCM envelope is unchanged."""
import base64,hashlib,json,math,re,time
from quotas import MAX_STORAGE
CHUNK=1024*1024 # base64 characters, divisible by four
class VaultChunks:
 def __init__(self,s,F):
  self.s,self.F=s,F
  with s.db() as db:
   db.executescript('''CREATE TABLE IF NOT EXISTS vault_uploads(account TEXT PRIMARY KEY,id TEXT UNIQUE,base INTEGER,nonce TEXT,length INTEGER,digest TEXT,schema INTEGER,created REAL);
CREATE TABLE IF NOT EXISTS vault_parts(id TEXT,part INTEGER,data TEXT,PRIMARY KEY(id,part));
CREATE TABLE IF NOT EXISTS vault_chunk_meta(account TEXT PRIMARY KEY,revision INTEGER,nonce TEXT,length INTEGER,digest TEXT);
CREATE TABLE IF NOT EXISTS vault_chunks(account TEXT,part INTEGER,data TEXT,PRIMARY KEY(account,part));''')
   self.prune(db)
 def prune(self,db):
  db.execute('DELETE FROM vault_parts WHERE id IN (SELECT id FROM vault_uploads WHERE created<?)',(time.time()-86400,))
  db.execute('DELETE FROM vault_uploads WHERE created<?',(time.time()-86400,))
 def manifest(self,account,schema,max_bytes):
  with self.s.db() as db:
   self.s.check_vault_schema(db,account,schema)
   row=db.execute('SELECT revision,byte_size FROM vaults WHERE account=?',(account,)).fetchone()
   if row and row[1]>max_bytes:raise self.F(413,'云端数据超过本设备安全内存容量，请使用更大内存设备；原数据保留')
   meta=db.execute('SELECT revision,nonce,length,digest FROM vault_chunk_meta WHERE account=?',(account,)).fetchone()
   if not row:return {'transport':1,'revision':0,'envelope':None,'chunkSize':CHUNK,'maxBytes':MAX_STORAGE}
   if meta:return dict(transport=1,revision=meta[0],nonce=meta[1],length=meta[2],digest=meta[3],chunkSize=CHUNK,maxBytes=MAX_STORAGE)
   legacy=db.execute("SELECT json_extract(envelope,'$.nonce'),length(json_extract(envelope,'$.ciphertext')) FROM vaults WHERE account=?",(account,)).fetchone()
   return dict(transport=1,revision=row[0],nonce=legacy[0],length=legacy[1],digest=None,chunkSize=CHUNK,maxBytes=MAX_STORAGE)
 def operate(self,account,body,schema,max_bytes):
  with self.s.db() as cleanup:self.prune(cleanup)
  action=body.get('action')
  if action=='get':
   part=body.get('part');revision=body.get('revision')
   if type(part)is not int or not 0<=part<=math.ceil((MAX_STORAGE+16)*4/3/CHUNK):raise self.F(400,'分块编号错误')
   with self.s.db() as db:
    self.s.check_vault_schema(db,account,schema)
    row=db.execute('SELECT revision,byte_size FROM vaults WHERE account=?',(account,)).fetchone()
    if not row or row[0]!=revision:raise self.F(409,'云端版本已变化，请重新读取')
    if row[1]>max_bytes:raise self.F(413,'本设备安全内存容量不足')
    chunked=db.execute('SELECT 1 FROM vault_chunk_meta WHERE account=?',(account,)).fetchone()
    data=db.execute('SELECT data FROM vault_chunks WHERE account=? AND part=?',(account,part)).fetchone() if chunked else db.execute("SELECT substr(json_extract(envelope,'$.ciphertext'),?,?) FROM vaults WHERE account=?",(part*CHUNK+1,CHUNK,account)).fetchone()
    if not data or not data[0]:raise self.F(404,'分块不存在')
    return {'data':data[0],'digest':hashlib.sha256(data[0].encode()).hexdigest()}
  identity=body.get('mutationId')
  if not isinstance(identity,str) or not re.fullmatch(r'[a-f0-9-]{36}',identity):raise self.F(400,'上传编号错误')
  with self.s.db() as db:
   db.execute('BEGIN IMMEDIATE');self.s.check_vault_schema(db,account,schema)
   if action=='begin':
    base,nonce,length,digest=body.get('baseRevision'),body.get('nonce'),body.get('length'),body.get('digest')
    try:validnonce=len(base64.b64decode(nonce,validate=True))==12
    except Exception:validnonce=False
    if type(base)is not int or base<0 or not validnonce or type(length)is not int or length%4 or not 24<=length<=math.ceil((MAX_STORAGE+16)/3)*4 or not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest):raise self.F(400,'上传参数错误')
    current=db.execute('SELECT revision,mutation,byte_size FROM vaults WHERE account=?',(account,)).fetchone()
    if current and current[1]==identity:
     meta=db.execute('SELECT nonce,length,digest FROM vault_chunk_meta WHERE account=?',(account,)).fetchone()
     if meta!=(nonce,length,digest) or current[0]!=base+1:raise self.F(409,'已提交编号内容不一致')
     return {'committed':True,'revision':current[0]}
    if base!=(current[0] if current else 0):raise self.F(409,'云端版本已变化')
    member=db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone()
    allowance=self.s.quotas.allowance(db,account,64*1024**2 if member and member[0]>time.time() else 2*1024**2)
    if length//4*3-18>max(allowance,current[2] if current else 0):raise self.F(413,'云空间已满，请扩容后重试')
    old=db.execute('SELECT id,base,nonce,length,digest,schema FROM vault_uploads WHERE account=?',(account,)).fetchone()
    owner=db.execute('SELECT account FROM vault_uploads WHERE id=?',(identity,)).fetchone()
    if owner and owner[0]!=account:raise self.F(409,'上传编号不可用')
    value=(identity,base,nonce,length,digest,schema)
    held=db.execute('SELECT COALESCE(SUM(length),0) FROM vault_uploads WHERE account<>?',(account,)).fetchone()[0]
    if held+length>1024*1024*1024:raise self.F(429,'同步暂存空间繁忙，请稍后重试')
    if old and old!=value:
     if old[0]==identity:raise self.F(409,'上传编号对应内容不一致')
     db.execute('DELETE FROM vault_parts WHERE id=?',(old[0],));db.execute('DELETE FROM vault_uploads WHERE account=?',(account,))
    if not old or old!=value:db.execute('INSERT INTO vault_uploads VALUES(?,?,?,?,?,?,?,?)',(account,*value,time.time()))
   upload=db.execute('SELECT id,base,nonce,length,digest,schema FROM vault_uploads WHERE account=? AND id=?',(account,identity)).fetchone()
   if not upload:raise self.F(404,'上传已过期，请重新开始')
   if action=='put':
    part,data=body.get('part'),body.get('data')
    if type(part)is not int or not 0<=part<math.ceil(upload[3]/CHUNK) or not isinstance(data,str) or len(data)!=min(CHUNK,upload[3]-part*CHUNK):raise self.F(400,'分块大小或编号错误')
    try:base64.b64decode(data,validate=True)
    except Exception:raise self.F(400,'分块编码错误')
    if part<math.ceil(upload[3]/CHUNK)-1 and '=' in data:raise self.F(400,'非末尾分块包含填充')
    if hashlib.sha256(data.encode()).hexdigest()!=body.get('digest'):raise self.F(400,'分块摘要不匹配')
    old=db.execute('SELECT data FROM vault_parts WHERE id=? AND part=?',(identity,part)).fetchone()
    if old and old[0]!=data:raise self.F(409,'分块内容冲突')
    db.execute('INSERT OR IGNORE INTO vault_parts VALUES(?,?,?)',(identity,part,data));return {'ok':True}
   if action in ('begin','status'):return {'received':[r[0] for r in db.execute('SELECT part FROM vault_parts WHERE id=? ORDER BY part',(identity,))]}
   if action!='commit':raise self.F(400,'未知分块操作')
   digest=hashlib.sha256();count=0;last=''
   for part,data in db.execute('SELECT part,data FROM vault_parts WHERE id=? ORDER BY part',(identity,)):
    if part!=count:raise self.F(409,'上传尚未完成')
    digest.update(data.encode());count+=1;last=data
   if count!=math.ceil(upload[3]/CHUNK) or digest.hexdigest()!=upload[4]:raise self.F(409,'上传尚未完成或摘要不一致')
   size=upload[3]//4*3-(len(last)-len(last.rstrip('=')))-16
   current=db.execute('SELECT revision,byte_size FROM vaults WHERE account=?',(account,)).fetchone()
   if upload[1]!=(current[0] if current else 0):raise self.F(409,'云端版本已变化')
   member=db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone()
   allowance=self.s.quotas.allowance(db,account,64*1024**2 if member and member[0]>time.time() else 2*1024**2)
   if size>allowance and size>=(current[1] if current else 0):raise self.F(413,'云空间已满，请扩容')
   revision=upload[1]+1
   db.execute('DELETE FROM vault_chunks WHERE account=?',(account,));db.execute('INSERT INTO vault_chunks SELECT ?,part,data FROM vault_parts WHERE id=?',(account,identity))
   db.execute('INSERT OR REPLACE INTO vault_chunk_meta VALUES(?,?,?,?,?)',(account,revision,upload[2],upload[3],upload[4]))
   db.execute('INSERT OR REPLACE INTO vaults VALUES(?,?,?,?,?)',(account,revision,json.dumps({'format':1,'nonce':upload[2],'ciphertext':''}),identity,size))
   db.execute('INSERT INTO vault_versions VALUES(?,?) ON CONFLICT(account) DO UPDATE SET schema=max(schema,excluded.schema)',(account,upload[5]))
   db.execute('DELETE FROM vault_parts WHERE id=?',(identity,));db.execute('DELETE FROM vault_uploads WHERE account=?',(account,));return {'revision':revision}
 def legacy(self,db,account):
  meta=db.execute('SELECT nonce FROM vault_chunk_meta WHERE account=?',(account,)).fetchone()
  if not meta:return None
  return {'format':1,'nonce':meta[0],'ciphertext':''.join(r[0] for r in db.execute('SELECT data FROM vault_chunks WHERE account=? ORDER BY part',(account,)))}
