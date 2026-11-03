import tempfile,time,unittest,base64,uuid
from server import Service,Failure,FREE_BYTES

class QuotaTest(unittest.TestCase):
    def test_grants_are_additive_audited_idempotent_and_expire(self):
        with tempfile.TemporaryDirectory() as d:
            s=Service(d+'/db',b'x'*32,lambda *a:None)
            with s.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            self.assertEqual(s.profile('a')['storage']['limitBytes'],FREE_BYTES)
            body={'id':'grant-001','account':'a','bytes':1024,'expiresAt':time.time()+1000,'reason':'test grant'}
            s.quotas.grant(body);s.quotas.grant(body)
            self.assertEqual(s.profile('a')['storage']['limitBytes'],FREE_BYTES+1024)
            self.assertEqual(s.admin_accounts()['accounts'][0]['storage']['limitBytes'],FREE_BYTES+1024)
            with self.assertRaises(Failure):s.quotas.grant(dict(body,bytes=2048))
            with s.db() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM admin_audit WHERE action='storage.grant'").fetchone()[0],1)
                db.execute('UPDATE storage_grants SET expires=0')
            self.assertEqual(s.profile('a')['storage']['limitBytes'],FREE_BYTES)

    def test_expired_grant_keeps_existing_vault_and_allows_shrinking(self):
        with tempfile.TemporaryDirectory() as d:
            s=Service(d+'/db',b'x'*32,lambda *a:None)
            with s.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            s.quotas.grant({'id':'grant-001','account':'a','bytes':4096,'expiresAt':time.time()+1000,'reason':'test grant'})
            def body(revision,size):
                return {'baseRevision':revision,'mutationId':str(uuid.uuid4()),'envelope':{'format':1,'nonce':base64.b64encode(bytes(12)).decode(),'ciphertext':base64.b64encode(bytes(size+16)).decode()}}
            s.write('a',body(0,FREE_BYTES+2048))
            with s.db() as db:db.execute('UPDATE storage_grants SET expires=0')
            self.assertEqual(s.read('a')['revision'],1)
            with self.assertRaises(Failure):s.write('a',body(1,FREE_BYTES+2049))
            s.write('a',body(1,FREE_BYTES+1024))
            self.assertEqual(s.read('a')['revision'],2)

if __name__=='__main__':unittest.main()
