"""Account-scoped device discovery and relay leases. No machine passwords here."""
import hashlib,hmac,json,os,re,secrets,time,uuid
class Devices:
 def __init__(self,service,Failure):
  self.s,self.F=service,Failure
  with service.db() as db:
   db.executescript('CREATE TABLE IF NOT EXISTS cloud_devices(id TEXT PRIMARY KEY,account TEXT,certificate TEXT,name TEXT,registration TEXT,seen REAL);CREATE TABLE IF NOT EXISTS relay_leases(digest TEXT PRIMARY KEY,account TEXT,device TEXT,expires REAL);')
   db.execute('CREATE TABLE IF NOT EXISTS network_routes(source TEXT PRIMARY KEY,account TEXT,target TEXT)')
 def network(self,account,body=None):
  self.member(account)
  with self.s.db() as db:
   if body is not None:
    source,target=body.get('source'),body.get('target')
    if not db.execute('SELECT 1 FROM cloud_devices WHERE id=? AND account=?',(source,account)).fetchone():raise self.F(404,'来源机器不属于此账号')
    if target is not None:
     if not isinstance(target,str) or not db.execute('SELECT 1 FROM cloud_devices WHERE id=? AND account=?',(target,account)).fetchone():raise self.F(404,'出口机器不属于此账号')
     graph=dict(db.execute('SELECT source,target FROM network_routes WHERE account=?',(account,)).fetchall());graph[source]=target
     visited=set();node=source
     while node in graph:
      if node in visited:raise self.F(409,'网络出口不能形成循环')
      visited.add(node);node=graph[node]
     db.execute('INSERT OR REPLACE INTO network_routes VALUES(?,?,?)',(source,account,target))
    else:db.execute('DELETE FROM network_routes WHERE source=? AND account=?',(source,account))
   rows=db.execute('SELECT source,target FROM network_routes WHERE account=?',(account,)).fetchall()
  return {'mode':'applications','routes':[{'source':r[0],'target':r[1]} for r in rows]}
 def member(self,account):
  if not self.s.profile(account)['membership']['active']:raise self.F(403,'此功能需要有效 Pro 会员')
 def endpoint(self):
  host=os.environ.get('RELAY_HOST','');fp=os.environ.get('RELAY_FINGERPRINT','')
  if not host or not re.fullmatch('[a-f0-9]{64}',fp):raise self.F(503,'会员连接服务尚未就绪')
  return {'host':host,'port':int(os.environ.get('RELAY_PORT','22444')),'fingerprint':fp}
 def register(self,account,body):
  self.member(account);endpoint=self.endpoint();identity=body.get('deviceId');name=body.get('name');cert=body.get('certificate')
  try:uuid.UUID(identity)
  except (ValueError,TypeError,AttributeError):raise self.F(400,'设备标识不正确')
  if not isinstance(name,str) or not 1<=len(name)<=80 or not isinstance(cert,str) or not 100<=len(cert)<=8192 or 'BEGIN CERTIFICATE' not in cert:raise self.F(400,'设备信息不正确')
  with self.s.db() as db:
   row=db.execute('SELECT account,certificate,registration FROM cloud_devices WHERE id=?',(identity,)).fetchone()
   if row and (row[0]!=account or row[1]!=cert):raise self.F(409,'设备身份已绑定，禁止覆盖')
   if not row and db.execute('SELECT count(*) FROM cloud_devices WHERE account=?',(account,)).fetchone()[0]>=100:raise self.F(413,'账号最多关联 100 台机器')
   token=row[2] if row else secrets.token_hex(32)
   db.execute('INSERT OR REPLACE INTO cloud_devices VALUES(?,?,?,?,?,?)',(identity,account,cert,name,token,time.time()))
  return {'relay':dict(endpoint,targetId=identity,credential=token)}
 def list(self,account):
  self.member(account)
  with self.s.db() as db:rows=db.execute('SELECT id,name,certificate,seen FROM cloud_devices WHERE account=?',(account,)).fetchall()
  return {'devices':[{'deviceId':r[0],'name':r[1],'certificate':r[2],'online':r[3]>time.time()-90} for r in rows]}
 def lease(self,account,body):
  self.member(account);endpoint=self.endpoint();device=body.get('deviceId')
  with self.s.db() as db:
   row=db.execute('SELECT seen FROM cloud_devices WHERE id=? AND account=?',(device,account)).fetchone()
   if not row:raise self.F(404,'账号中没有此机器')
   if row[0]<time.time()-90:raise self.F(409,'机器当前离线')
   token=secrets.token_hex(32)
   db.execute('DELETE FROM relay_leases WHERE expires<?',(time.time()-86400,))
   db.execute('INSERT INTO relay_leases VALUES(?,?,?,?)',(self.s.digest(token),account,device,time.time()+3600))
  return {'relay':dict(endpoint,targetId=device,credential=token)}
 def remove(self,account,body):
  with self.s.db() as db:
   db.execute('DELETE FROM cloud_devices WHERE id=? AND account=?',(body.get('deviceId'),account));db.execute('DELETE FROM relay_leases WHERE device=? AND account=?',(body.get('deviceId'),account))
  return {'ok':True}
 def authorize(self,body):
  device,token,op=body.get('targetId'),body.get('credential'),body.get('operation')
  if not isinstance(token,str) or not re.fullmatch('[a-f0-9]{64}',token):return {'allowed':False}
  with self.s.db() as db:
   row=db.execute('SELECT account,registration,seen FROM cloud_devices WHERE id=?',(device,)).fetchone()
   if not row or row[2]<time.time()-90:return {'allowed':False}
   if op=='forward':
    lease=db.execute('SELECT account,device,expires FROM relay_leases WHERE digest=?',(self.s.digest(token),)).fetchone()
    valid=bool(lease and lease[0]==row[0] and lease[1]==device and (body.get('continuation') or lease[2]>time.time()))
   else:valid=op in ('register','channel') and hmac.compare_digest(row[1],token)
  return {'allowed':bool(valid and self.s.profile(row[0])['membership']['active'])}
