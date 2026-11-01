import tempfile,unittest,secrets,time,uuid,os
from unittest.mock import patch
from server import Service,Failure
class LendingTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=Service(self.tmp.name+'/db',secrets.token_bytes(32),lambda *a:None);self.d=self.s.devices
  with self.s.db() as db:
   for name in ('owner','borrower','other'):db.execute('INSERT INTO accounts VALUES(?,?)',(name,name+'@test.com'))
   db.execute('INSERT INTO memberships VALUES(?,?)',('owner',time.time()+3600))
  self.env=patch.dict(os.environ,{'RELAY_HOST':'relay.test','RELAY_FINGERPRINT':'a'*64});self.env.start()
  self.device=str(uuid.uuid4());self.d.register('owner',{'deviceId':self.device,'name':'Test','certificate':'-----BEGIN CERTIFICATE-----'+'A'*100})
 def tearDown(self):self.env.stop();self.tmp.cleanup()
 def create(self,**kw):return self.d.lending.create('owner',dict(deviceIds=[self.device],expiresAt=time.time()+60,**kw))
 def test_share_limits_identity_revocation_and_no_password(self):
  loan=self.create();self.d.lending.redeem('borrower',{'shareCode':loan['shareCode']});self.d.lending.redeem('borrower',{'shareCode':loan['shareCode']})
  with self.assertRaises(Failure):self.d.lending.redeem('other',{'shareCode':loan['shareCode']})
  self.assertNotIn('shareCode',str(self.d.lending.list('owner')));device=self.d.list('borrower')['devices'][0];self.assertTrue(device['borrowed']);self.assertNotIn('password',str(device).lower())
  lease=self.d.lease('borrower',{'deviceId':self.device})['relay']['credential'];payload={'targetId':self.device,'credential':lease,'operation':'forward','continuation':True};self.assertTrue(self.d.authorize(payload)['allowed'])
  delegated=self.d.delegate('borrower',{'deviceId':self.device,'fingerprint':'a'*64});verify={'deviceId':self.device,'fingerprint':'a'*64,'credential':delegated['credential']}
  self.assertTrue(self.d.verify_delegation('owner',verify)['allowed']);self.assertFalse(self.d.verify_delegation('other',verify)['allowed']);self.assertFalse(self.d.verify_delegation('owner',dict(verify,fingerprint='b'*64))['allowed'])
  with self.assertRaises(Failure):self.d.lending.revoke('other',{'id':loan['id']})
  self.d.lending.revoke('owner',{'id':loan['id']});self.assertFalse(self.d.authorize(payload)['allowed']);self.assertFalse(self.d.verify_delegation('owner',verify)['allowed']);self.assertEqual(self.d.list('borrower')['devices'],[])
 def test_email_expiry_ownership_and_membership(self):
  loan=self.create(email='borrower@test.com')
  with self.assertRaises(Failure):self.d.lending.redeem('other',{'id':loan['id']})
  self.d.lending.redeem('borrower',{'id':loan['id']});self.assertEqual(len(self.d.list('borrower')['devices']),1)
  with self.s.db() as db:db.execute('UPDATE device_loans SET expires=?',(time.time()-1,))
  with self.assertRaises(Failure):self.d.lease('borrower',{'deviceId':self.device})
  with self.assertRaises(Failure):self.d.lending.create('borrower',{'deviceIds':[self.device],'expiresAt':time.time()+60})
 def test_share_cannot_redeem_without_code(self):
  loan=self.create()
  with self.assertRaises(Failure):self.d.lending.redeem('borrower',{'id':loan['id']})
  with self.assertRaises(Failure):self.d.lending.create('owner',{'deviceIds':[str(uuid.uuid4())],'expiresAt':time.time()+60})
 def test_expired_bootstrap_cannot_start_new_session_but_existing_session_still_checks_loan(self):
  loan=self.create();self.d.lending.redeem('borrower',{'shareCode':loan['shareCode']})
  token=self.d.delegate('borrower',{'deviceId':self.device,'fingerprint':'a'*64})['credential'];body={'deviceId':self.device,'fingerprint':'a'*64,'credential':token}
  with self.s.db() as db:db.execute('UPDATE delegated_sessions SET expires=?',(time.time()-1,))
  self.assertFalse(self.d.verify_delegation('owner',body)['allowed']);self.assertTrue(self.d.verify_delegation('owner',dict(body,continuation=True))['allowed'])
  self.d.lending.admin_revoke({'id':loan['id'],'reason':'test admin revocation'});self.assertFalse(self.d.verify_delegation('owner',dict(body,continuation=True))['allowed'])

if __name__=='__main__':unittest.main()
