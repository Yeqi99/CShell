import secrets,time,uuid,json,os
from mcp_journal import McpJournal
class McpClients:
 def __init__(self,service,Failure):
  self.s,self.F=service,Failure
  self.journal=McpJournal(service,Failure)
  with service.db() as db:db.execute('CREATE TABLE IF NOT EXISTS cloud_mcp_clients(id TEXT PRIMARY KEY,account TEXT NOT NULL,bridge TEXT NOT NULL,name TEXT NOT NULL,digest TEXT UNIQUE NOT NULL,expires REAL NOT NULL,scopes TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)')
 def manage(self,account,body=None):
  if body is None:
   with self.s.db() as db:rows=db.execute('SELECT id,bridge,name,expires,scopes,revoked FROM cloud_mcp_clients WHERE account=?',(account,)).fetchall()
   return {'endpoint':os.environ.get('MCP_PUBLIC_URL',''),'bridges':self.s.bridges.list(account)['bridges'],'clients':[dict(id=i,bridgeId=b,name=n,expiresAt=e,scopes=json.loads(s),revoked=bool(r)) for i,b,n,e,s,r in rows]}
  if body.get('action')=='revoke':
   with self.s.db() as db:db.execute('UPDATE cloud_mcp_clients SET revoked=1 WHERE id=? AND account=?',(body.get('id'),account))
   return {'ok':True}
  if not self.s.profile(account)['membership']['active']:raise self.F(403,'此功能需要有效 Pro 会员')
  name,bridge,scopes=body.get('name'),body.get('bridgeId'),body.get('scopes')
  if not isinstance(name,str) or not 1<=len(name)<=80 or not isinstance(scopes,list) or not scopes or len(scopes)>8 or any(x not in self.s.bridges.MEMBER_METHODS for x in scopes):raise self.F(400,'MCP 客户端配置无效')
  self.s.bridges._owned(account,bridge)
  token='csmcp_'+secrets.token_urlsafe(32);identity=str(uuid.uuid4());expires=time.time()+90*86400
  with self.s.db() as db:
   db.execute('BEGIN IMMEDIATE')
   if db.execute('SELECT COUNT(*) FROM cloud_mcp_clients WHERE account=? AND revoked=0 AND expires>?',(account,time.time())).fetchone()[0]>=20:raise self.F(429,'MCP 客户端数量已达上限')
   db.execute('INSERT INTO cloud_mcp_clients VALUES(?,?,?,?,?,?,?,0)',(identity,account,bridge,name,self.s.digest(token),expires,json.dumps(scopes)))
  return {'id':identity,'token':token,'expiresAt':expires}
 def authorize(self,token):
  if not isinstance(token,str) or not token.startswith('csmcp_') or len(token)>128:raise self.F(401,'MCP 客户端认证失败')
  with self.s.db() as db:row=db.execute('SELECT id,account,bridge,expires,scopes FROM cloud_mcp_clients WHERE digest=? AND revoked=0',(self.s.digest(token),)).fetchone()
  if not row or row[3]<=time.time():raise self.F(401,'MCP 客户端认证失效')
  if not self.s.profile(row[1])['membership']['active']:raise self.F(403,'此功能需要有效 Pro 会员')
  self.s.bridges._owned(row[1],row[2])
  return {'client':row[0],'account':row[1],'bridgeId':row[2],'expiresAt':row[3],'scopes':json.loads(row[4])}
 def invoke(self,body):
  grant=self.authorize(body.get('token'));name=body.get('name')
  if name=='get_operation_status':return self.journal.query(grant,body.get('arguments',{}).get('operationId'))
  if name=='list_operations':return self.journal.query(grant)
  if name not in grant['scopes']:raise self.F(403,'MCP 操作未授权')
  return self.journal.invoke(grant,body,lambda:self.s.bridges.invoke(grant['account'],grant['client'],dict(bridgeId=grant['bridgeId'],name=name,arguments=body.get('arguments',{})),member=True))
