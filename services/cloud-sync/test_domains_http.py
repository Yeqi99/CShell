import tempfile,time,unittest,threading,http.client,json
from server import Service,BoundedServer,handler
from test_domains import DNS
class DomainHttpTest(unittest.TestCase):
 def test_authenticated_owner_member_and_month_boundary(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db',b'x'*32,lambda *a:None);s.domains.dns=DNS();now=[1793491200.0];s.domains.clock=lambda:now[0]
   with s.db() as db:
    for account,token in [('a','a'*43),('b','b'*43)]:
     db.execute('INSERT INTO accounts VALUES(?,?)',(account,account+'@example.com'))
     db.execute('INSERT INTO sessions VALUES(?,?,?)',(s.digest(token),account,time.time()+600))
    db.execute('INSERT INTO memberships VALUES(?,?)',('a',time.time()+600))
   server=BoundedServer(('127.0.0.1',0),handler(s));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   def request(path='/v1/domains',body=None,token='a'*43,origin=None):
    c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3);headers={'Authorization':'Bearer '+token}
    if origin:headers['Origin']=origin
    try:c.request('POST' if body is not None else 'GET',path,None if body is None else json.dumps(body),headers);r=c.getresponse();return r.status,json.loads(r.read())
    finally:c.close()
   try:
    self.assertEqual(request(token='invalid')[0],401);self.assertEqual(request(origin='https://evil.invalid')[0],403)
    self.assertEqual(request('/v1/domains/claim',{'prefix':'alice','requestId':'claim-001'},'b'*43)[0],403)
    self.assertEqual(request('/v1/domains/claim',{'prefix':'alice','requestId':'claim-001','account':'b'})[0],200)
    self.assertEqual(request(token='b'*43)[1]['domains'],[])
    status,record=request('/v1/domains/records',{'prefix':'alice','name':'@','type':'A','content':'192.0.2.1','requestId':'record-001'});self.assertEqual(status,200)
    self.assertEqual(request('/v1/domains/records/delete',{'id':record['id'],'requestId':'delete-001'},'b'*43)[0],404)
    self.assertNotIn('provider',str(request()[1]));self.assertNotIn('secret',str(request()[1]))
    self.assertEqual(request('/v1/domains/rename',{'prefix':'second','requestId':'rename-001'})[0],200)
    self.assertEqual(request('/v1/domains/rename',{'prefix':'third','requestId':'rename-002'})[0],429)
    now[0]+=32*86400
    self.assertEqual(request('/v1/domains/rename',{'prefix':'third','requestId':'rename-002'})[0],200)
   finally:server.shutdown();server.server_close();thread.join()
