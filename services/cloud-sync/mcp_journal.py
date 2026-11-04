"""Durable at-most-once admission. Unknown operations are never redispatched."""
import hashlib,json,time,uuid,threading
class McpJournal:
 def __init__(self,service,Failure):
  self.s,self.F=service,Failure;self.lock=threading.RLock()
  with self.s.db() as db:
   db.execute('CREATE TABLE IF NOT EXISTS mcp_operations(id TEXT NOT NULL,account TEXT NOT NULL,client TEXT NOT NULL,bridge TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created REAL NOT NULL,updated REAL NOT NULL,PRIMARY KEY(client,id))')
   db.execute('CREATE INDEX IF NOT EXISTS mcp_operations_expiry ON mcp_operations(created)')
   db.execute('CREATE INDEX IF NOT EXISTS mcp_operations_caller ON mcp_operations(account,client,created)')
   db.execute("UPDATE mcp_operations SET state='unknown',updated=? WHERE state='running'",(time.time(),))
 def _prune(self,db):
  # Retain tombstones for 90 days, but discard sensitive/large results after 24h.
  db.execute("UPDATE mcp_operations SET result=NULL,state=CASE WHEN state='completed' THEN 'expired' ELSE state END WHERE updated<? AND result IS NOT NULL",(time.time()-86400,))
  # ID reuse is prevented after deletion by requiring creation timestamps in IDs.
  db.execute('DELETE FROM mcp_operations WHERE created<?',(time.time()-90*86400,))
 def query(self,grant,identity=None):
  with self.s.db() as db:
   self._prune(db)
   if identity:
    row=db.execute('SELECT id,state,result,created,updated FROM mcp_operations WHERE account=? AND client=? AND id=?',(grant['account'],grant['client'],identity)).fetchone()
    if not row:raise self.F(404,'操作记录不存在')
    return self._view(row)
   rows=db.execute('SELECT id,state,NULL,created,updated FROM mcp_operations WHERE account=? AND client=? ORDER BY created DESC LIMIT 100',(grant['account'],grant['client'])).fetchall()
   return {'operations':[self._view(r) for r in rows]}
 def _view(self,row):
  value={'operationId':row[0],'state':row[1],'createdAt':row[3],'updatedAt':row[4]}
  if row[2] is not None:value['result']=json.loads(row[2])
  return value
 def invoke(self,grant,body,execute):
  identity=body.get('operationId');now=time.time()
  try:
   stamp,suffix=identity.split(':');stamp=int(stamp);uuid.UUID(suffix)
  except (ValueError,TypeError,AttributeError):raise self.F(400,'操作编号无效')
  digest=hashlib.sha256(json.dumps({'bridge':grant['bridgeId'],'name':body.get('name'),'arguments':body.get('arguments',{})},sort_keys=True,separators=(',',':')).encode()).hexdigest()
  with self.lock,self.s.db() as db:
   db.execute('BEGIN IMMEDIATE');self._prune(db)
   old=db.execute('SELECT digest FROM mcp_operations WHERE client=? AND id=?',(grant['client'],identity)).fetchone()
   if old:
    if old[0]!=digest:raise self.F(409,'操作编号已用于其他参数')
   else:
    if not now-300<=stamp<=now+60:raise self.F(409,'操作编号已过期；请查询原操作结果，勿重放写入')
    # Each admitted result has an 8MiB maximum; reserve storage headroom.
    count,size=db.execute("SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(result AS BLOB))),0) FROM mcp_operations WHERE client=?",(grant['client'],)).fetchone()
    running=db.execute("SELECT COUNT(*) FROM mcp_operations WHERE state='running'").fetchone()[0]
    own_running=db.execute("SELECT COUNT(*) FROM mcp_operations WHERE state='running' AND client=?",(grant['client'],)).fetchone()[0]
    global_count=db.execute('SELECT COUNT(*) FROM mcp_operations').fetchone()[0]
    total=db.execute('SELECT COALESCE(SUM(LENGTH(CAST(result AS BLOB))),0) FROM mcp_operations').fetchone()[0]
    if count>=10000 or global_count>=100000 or size+(own_running+1)*8*1024**2>64*1024**2 or total+(running+1)*8*1024**2>256*1024**2:raise self.F(429,'操作记录存储已满，请等待保留期清理')
    db.execute('INSERT INTO mcp_operations VALUES(?,?,?,?,?,?,NULL,?,?)',(identity,grant['account'],grant['client'],grant['bridgeId'],digest,'running',now,now))
  if old:return self.query(grant,identity)
  try:result=execute()
  except Exception:
   with self.s.db() as db:db.execute("UPDATE mcp_operations SET state='unknown',updated=? WHERE client=? AND id=?",(time.time(),grant['client'],identity))
   raise
  encoded=json.dumps(result,ensure_ascii=False,separators=(',',':'))
  if len(encoded.encode())>8*1024**2:
   with self.s.db() as db:db.execute("UPDATE mcp_operations SET state='unknown',updated=? WHERE client=? AND id=?",(time.time(),grant['client'],identity))
   raise self.F(413,'操作结果过大')
  with self.s.db() as db:db.execute("UPDATE mcp_operations SET state='completed',result=?,updated=? WHERE client=? AND id=?",(encoded,time.time(),grant['client'],identity))
  return self.query(grant,identity)
