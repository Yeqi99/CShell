import tempfile,unittest,secrets,time,uuid
from server import Service,Failure
class NetworkTests(unittest.TestCase):
 def test_routes_are_account_scoped_multi_rule_and_cycle_safe(self):
  with tempfile.TemporaryDirectory() as temp:
   s=Service(temp+'/db',secrets.token_bytes(32),lambda *a:None)
   ids=[str(uuid.uuid4()) for _ in range(3)]
   with s.db() as db:
    db.execute('INSERT INTO accounts VALUES(?,?)',('owner','owner@test.com'));db.execute('INSERT INTO memberships VALUES(?,?)',('owner',time.time()+3600))
    for id in ids:db.execute('INSERT INTO cloud_devices VALUES(?,?,?,?,?,?)',(id,'owner','cert','name','key',time.time()))
   a,b,c=ids
   s.devices.network('owner',{'source':a,'target':b});s.devices.network('owner',{'source':b,'target':c})
   self.assertEqual(len(s.devices.network('owner')['routes']),2)
   with self.assertRaises(Failure):s.devices.network('owner',{'source':c,'target':a})
   with self.assertRaises(Failure):s.devices.network('owner',{'source':a,'target':a})
   with self.assertRaises(Failure):s.devices.network('owner',{'source':a,'target':str(uuid.uuid4())})
   s.devices.network('owner',{'source':a,'target':None});self.assertEqual(len(s.devices.network('owner')['routes']),1)
