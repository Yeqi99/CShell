import os,json,tempfile,threading,http.client,unittest,uuid
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from server import Service,BoundedServer,handler

class TrafficHttpTest(unittest.TestCase):
 def test_mcp_http_dispatch_result_budget_and_old_rights(self):
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'MCP_AUTH_TOKEN':'gateway-test'}):
   service=Service(d+'/db',b'x'*32,lambda *a:None)
   with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
   service.profile=lambda a:{'membership':{'active':True}}
   worker=dict(bridgeId=str(uuid.uuid4()),secret='s'*43,name='desktop');service.bridges.register('a',worker)
   token=service.mcp_clients.manage('a',dict(name='SDK',bridgeId=worker['bridgeId'],scopes=['list_servers_page']))['token']
   server=BoundedServer(('127.0.0.1',0),handler(service));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   def invoke(name='list_servers_page',arguments=None,operationId=None):
    c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=4)
    try:
     c.request('POST','/v1/admin/mcp/invoke',json.dumps(dict(token=token,name=name,arguments=arguments or {},operationId=operationId or str(int(time.time()))+':'+str(uuid.uuid4()))),{'X-Mcp-Token':'gateway-test'});r=c.getresponse();return r.status,r.read()
    finally:c.close()
   try:
    with ThreadPoolExecutor() as pool:
     future=pool.submit(invoke)
     for _ in range(100):
      jobs=service.bridges.poll('a',worker)['requests']
      if jobs:break
      time.sleep(.01)
     self.assertTrue(jobs);service.bridges.reply('a',dict(worker,id=jobs[0]['id'],result={'servers':[]}))
     status,payload=future.result();self.assertEqual(status,200);saved=json.loads(payload)
    self.assertEqual(service.metering.admin_view()['reservations'],[])
    server.shutdown();server.server_close();thread.join()
    service=Service(d+'/db',b'x'*32,lambda *a:None);service.profile=lambda a:{'membership':{'active':True}}
    server=BoundedServer(('127.0.0.1',0),handler(service));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    status,payload=invoke('get_operation_status',{'operationId':saved['operationId']})
    self.assertEqual(status,200);self.assertEqual(json.loads(payload)['result'],{'servers':[]})
    status,payload=invoke(operationId=saved['operationId']);self.assertEqual(status,200)
    self.assertEqual(service.bridges.poll('a',worker)['requests'],[])
    service.metering.configure_limit('a','mcp',1,'integration cap')
    self.assertEqual(invoke()[0],429)
    self.assertEqual(service.bridges.poll('a',worker)['requests'],[])
   finally:server.shutdown();server.server_close();thread.join()
 def test_relay_window_auth_hard_limit_and_settlement(self):
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'RELAY_AUTH_TOKEN':'relay-test','ADMIN_API_TOKEN':'admin-test'}):
   service=Service(d+'/db',b'x'*32,lambda *a:None)
   with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
   service.metering.configure_limit('a','relay',100,'test cap')
   service.devices.authorize=lambda body:{'allowed':body.get('credential')=='lease','account':'a'}
   server=BoundedServer(('127.0.0.1',0),handler(service));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   def post(body,token='relay-test'):
    c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
    try:c.request('POST','/v1/admin/relay/traffic',json.dumps(body),{'X-Relay-Token':token});r=c.getresponse();r.read();return r.status
    finally:c.close()
   try:
    ident=str(uuid.uuid4());body=dict(action='reserve',id=ident,budget=80,credential='lease')
    self.assertEqual(post(body,'bad'),403);self.assertEqual(post(dict(body,credential='bad')),403)
    self.assertEqual(post(body),200);self.assertEqual(post(body),200)
    self.assertEqual(post(dict(body,id=str(uuid.uuid4()),budget=30)),429)
    self.assertEqual(post(dict(action='settle',id=ident,ingress=40,egress=20)),200)
    self.assertEqual(post(dict(body,id=str(uuid.uuid4()),budget=40)),200)
   finally:server.shutdown();server.server_close();thread.join()
