import tempfile,time,unittest,threading,http.client,json
from datetime import datetime,timezone
from server import Service,BoundedServer,handler

class AccountTrafficTest(unittest.TestCase):
 def test_owner_http_and_default_entitlements(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db',b'x'*32,lambda *a:None)
   with s.db() as db:
    for account,token in [('a','a'*43),('b','b'*43)]:
     db.execute('INSERT INTO accounts VALUES(?,?)',(account,account+'@example.com'))
     db.execute('INSERT INTO sessions VALUES(?,?,?)',(s.digest(token),account,time.time()+600))
   s.metering.record('a','private-stream','relay',12,34)
   s.metering.reserve('a','private-reservation','relay',20)
   server=BoundedServer(('127.0.0.1',0),handler(s));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   def get(token,path='/v1/account/traffic'):
    c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
    try:c.request('GET',path,headers={'Authorization':'Bearer '+token});r=c.getresponse();return r.status,json.loads(r.read())
    finally:c.close()
   try:
    self.assertEqual(get('bad')[0],401)
    status,a=get('a'*43);self.assertEqual(status,200);relay=a['channels'][0]
    self.assertEqual((relay['usedBytes'],relay['reservedBytes']),(46,20));self.assertIsNone(relay['limitBytes']);self.assertIsNone(relay['remainingBytes'])
    self.assertEqual(get('b'*43)[1]['channels'][0]['usedBytes'],0)
    self.assertNotIn('private',json.dumps(a));self.assertNotIn('account',a);self.assertNotIn('cost',json.dumps(a))
    self.assertNotEqual(get('a'*43,'/v1/account/traffic?account=b')[0],200)
    s.metering.configure_limit('a','relay',100,'test explicit cap');relay=get('a'*43)[1]['channels'][0];self.assertEqual(relay['remainingBytes'],34)
    s.metering.configure_limit('a','relay',None,'restore previous rights');self.assertIsNone(get('a'*43)[1]['channels'][0]['limitBytes'])
   finally:server.shutdown();server.server_close();thread.join()

 def test_utc_month_addon_reservation_and_settlement(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db',b'x'*32,lambda *a:None)
   with s.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
   s.metering.configure_limit('a','mcp',100,'base cap')
   def timestamp(text):return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()
   before=timestamp('2026-12-31T23:59:59');after=timestamp('2027-01-01T00:00:00')
   s.metering.record('a','past','mcp',25,5,now=before)
   s.metering.admin_change(dict(action='grant',account='a',category='mcp',period='2026-12',bytes=50,id='grant-december',reason='month addon'))
   with s.db() as db:db.execute('INSERT INTO traffic_reservations VALUES(?,?,?,?,?,0)',('held','a','2026-12','mcp',60))
   dec=s.metering.account_view('a',before);row=dec['channels'][1]
   self.assertEqual((row['limitBytes'],row['usedBytes'],row['reservedBytes'],row['remainingBytes']),(150,30,60,60))
   jan=s.metering.account_view('a',after);row=jan['channels'][1]
   self.assertEqual((row['addonBytes'],row['limitBytes'],row['usedBytes'],row['reservedBytes'],row['remainingBytes']),(0,100,0,0,100))
   self.assertEqual(dec['periodEndsAt'],jan['periodStartsAt']);self.assertEqual(jan['timezone'],'UTC')
   s.metering.settle('a','held',10,10)
   self.assertEqual(s.metering.account_view('a',before)['channels'][1]['remainingBytes'],100)
   self.assertEqual(s.metering.account_view('a',after)['channels'][1]['usedBytes'],0)
   s.metering.configure_limit('a','mcp',0,'pause at zero');self.assertEqual(s.metering.account_view('a',before)['channels'][1]['remainingBytes'],0)
