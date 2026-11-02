"""Revocable device lending. Share codes are hashed; passwords never enter this service."""
import json,secrets,time,uuid,math

class Lending:
 def __init__(self,devices):
  self.d,self.s,self.F=devices,devices.s,devices.F
  with self.s.db() as db:
   db.executescript('''CREATE TABLE IF NOT EXISTS device_loans(id TEXT PRIMARY KEY,owner TEXT NOT NULL,devices TEXT NOT NULL,email TEXT,code TEXT UNIQUE,expires REAL NOT NULL,max_uses INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created REAL NOT NULL);
   CREATE TABLE IF NOT EXISTS loan_recipients(loan TEXT NOT NULL,account TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(loan,account));''')
 def create(self,account,body):
  self.d.member(account)
  devices=body.get('deviceIds');expires=body.get('expiresAt');email=body.get('email');uses=body.get('maxUses',1)
  if not isinstance(devices,list) or not 1<=len(devices)<=100 or any(not isinstance(x,str) for x in devices) or len(set(devices))!=len(devices):raise self.F(400,'请选择 1 至 100 台不同机器')
  if isinstance(expires,bool) or not isinstance(expires,(int,float)) or not math.isfinite(expires) or not time.time()<expires<=time.time()+366*86400:raise self.F(400,'请设置一年以内的有效期')
  if isinstance(uses,bool) or not isinstance(uses,int) or not 1<=uses<=100:raise self.F(400,'分享次数需为 1 至 100')
  if email is not None:
   if not isinstance(email,str) or len(email)>254 or '@' not in email:raise self.F(400,'邮箱格式不正确')
   email=email.strip().lower();uses=1
  code=secrets.token_urlsafe(32) if email is None else None;identity=str(uuid.uuid4())
  with self.s.db() as db:
   if db.execute('SELECT count(*) FROM device_loans WHERE owner=? AND revoked=0 AND expires>?',(account,time.time())).fetchone()[0]>=100:raise self.F(413,'最多创建 100 个有效借用授权')
   for device in devices:
    if not db.execute('SELECT 1 FROM cloud_devices WHERE id=? AND account=?',(device,account)).fetchone():raise self.F(404,'只能出借自己账号的机器')
   db.execute('INSERT INTO device_loans VALUES(?,?,?,?,?,?,?,0,?)',(identity,account,json.dumps(devices),email,self.s.digest(code) if code else None,expires,uses,time.time()))
  return {'id':identity,'shareCode':code,'expiresAt':expires,'maxUses':uses,'deviceIds':devices,'email':email}
 def redeem(self,account,body):
  code=body.get('shareCode');identity=body.get('id')
  if code is not None and (not isinstance(code,str) or not 20<=len(code)<=128):raise self.F(400,'分享码格式不正确')
  if code is None and not isinstance(identity,str):raise self.F(400,'需要分享码或邮箱邀请标识')
  self.s.limit('loan-redeem:'+account,30,60)
  with self.s.db() as db:
   row=db.execute('SELECT id,owner,email,expires,max_uses,revoked FROM device_loans WHERE '+('code=?' if code else 'id=?'),(self.s.digest(code) if code else identity,)).fetchone()
   email=db.execute('SELECT email FROM accounts WHERE id=?',(account,)).fetchone()
   if not row or row[5] or row[3]<=time.time() or row[1]==account or (not code and row[2] is None and not db.execute('SELECT 1 FROM loan_recipients WHERE loan=? AND account=?',(row[0],account)).fetchone()) or (row[2] and (not email or email[0].lower()!=row[2])):raise self.F(404,'借用授权不存在、已失效或不属于此账号')
   self.d.member(row[1])
   if not db.execute('SELECT 1 FROM loan_recipients WHERE loan=? AND account=?',(row[0],account)).fetchone():
    if db.execute('SELECT count(*) FROM loan_recipients WHERE loan=?',(row[0],)).fetchone()[0]>=row[4]:raise self.F(409,'分享次数已用完')
    db.execute('INSERT INTO loan_recipients VALUES(?,?,?)',(row[0],account,time.time()))
  return {'id':row[0],'expiresAt':row[3]}
 def valid(self,db,account,device,loan=None):
  rows=db.execute('SELECT l.id,l.owner,l.devices,l.expires FROM device_loans l JOIN loan_recipients r ON r.loan=l.id WHERE r.account=? AND l.revoked=0 AND l.expires>?',(account,time.time())).fetchall()
  for identity,owner,devices,expires in rows:
   if (loan is None or identity==loan) and device in json.loads(devices) and db.execute('SELECT 1 FROM cloud_devices WHERE id=? AND account=?',(device,owner)).fetchone() and self.s.profile(owner)['membership']['active']:return (identity,owner,expires)
  return None
 def revoke(self,account,body):
  with self.s.db() as db:
   if not db.execute('SELECT 1 FROM device_loans WHERE id=? AND owner=?',(body.get('id'),account)).fetchone():raise self.F(404,'没有此借用授权')
   db.execute('UPDATE device_loans SET revoked=1 WHERE id=?',(body['id'],))
   db.execute('DELETE FROM relay_leases WHERE loan=?',(body['id'],))
  return {'ok':True}
 def list(self,account):
  email=self.s.profile(account)['email'].lower()
  with self.s.db() as db:
   rows=db.execute('SELECT id,owner,devices,email,expires,max_uses,revoked FROM device_loans WHERE owner=? OR email=? OR id IN(SELECT loan FROM loan_recipients WHERE account=?) ORDER BY created DESC LIMIT 300',(account,email,account)).fetchall()
   return {'devices':[{'id':r[0],'name':r[1]} for r in db.execute('SELECT id,name FROM cloud_devices WHERE account=?',(account,)).fetchall()],'loans':[{'id':r[0],'owned':r[1]==account,'accepted':bool(db.execute('SELECT 1 FROM loan_recipients WHERE loan=? AND account=?',(r[0],account)).fetchone()),'deviceIds':json.loads(r[2]),'email':r[3] if r[1]==account else None,'expiresAt':r[4],'maxUses':r[5],'revoked':bool(r[6]),'uses':db.execute('SELECT count(*) FROM loan_recipients WHERE loan=?',(r[0],)).fetchone()[0]} for r in rows]}

 def admin_list(self):
  with self.s.db() as db:
   rows=db.execute('SELECT id,owner,devices,email,expires,max_uses,revoked FROM device_loans ORDER BY created DESC LIMIT 500').fetchall()
  return {'loans':[{'id':r[0],'owner':r[1],'deviceIds':json.loads(r[2]),'email':r[3],'expiresAt':r[4],'maxUses':r[5],'revoked':bool(r[6])} for r in rows]}
 def admin_revoke(self,body):
  reason=body.get('reason')
  if not isinstance(reason,str) or not 2<=len(reason.strip())<=300:raise self.F(400,'请填写撤销原因')
  with self.s.db() as db:
   row=db.execute('SELECT owner FROM device_loans WHERE id=?',(body.get('id'),)).fetchone()
   if not row:raise self.F(404,'没有此借用授权')
  result=self.revoke(row[0],body)
  with self.s.db() as db:db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),row[0],'lending.revoke',json.dumps({'id':body['id'],'reason':reason.strip()},ensure_ascii=False)))
  return result
