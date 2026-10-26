import tempfile
import unittest
import secrets
from server import Service, Failure


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.mail = {}
        self.service = Service(self.directory.name + '/test.sqlite', secrets.token_bytes(32), lambda email, code: self.mail.update({email: code}))

    def test_public_usage_is_deduplicated_and_consent_reversible(self):
        import time
        first=self.login('usage@example.com','usage-ip')
        self.service.authenticate(first['token'])
        self.service.authenticate(first['token'])
        self.assertEqual(self.service.usage()['activeAccounts'],1)
        token='a'*64
        self.service.usage_device({'token':token,'enabled':True})
        self.service.usage_device({'token':token,'enabled':True})
        self.assertEqual(self.service.usage()['activeDevices'],1)
        with self.service.db() as db:
            db.execute('UPDATE usage_devices SET seen=?',(time.time()-301,))
        self.assertEqual(self.service.usage()['activeDevices'],0)
        self.service.usage_device({'token':token,'enabled':False})
        self.assertEqual(self.service.usage()['participatingDevices30d'],0)
        self.assertNotIn('email',str(self.service.usage()))
        self.assertNotIn(token,str(self.service.usage()))
        with self.assertRaises(Failure):self.service.usage_device({'token':'invalid','enabled':True})

    def test_membership_is_real_and_audited(self):
        session = self.login('member@example.com', 'member-ip')
        account = session['accountId']
        self.assertFalse(self.service.profile(account)['membership']['active'])
        import time
        self.service.admin_membership({'account': account, 'expiresAt': time.time()+86400, 'reason': 'test grant'})
        self.assertTrue(self.service.profile(account)['membership']['active'])
        self.service.admin_membership({'account': account, 'expiresAt': 0, 'reason': 'test revoke'})
        self.assertFalse(self.service.profile(account)['membership']['active'])
        result = self.service.admin_accounts()
        self.assertEqual(len(result['audit']), 2)
        self.assertNotIn('token', str(result))
        with self.assertRaises(Failure):
            self.service.admin_membership({'account': account, 'expiresAt': float('nan'), 'reason': 'invalid'})

    def test_registration_creates_password_keybox_and_vault_atomically(self):
        import base64
        email = 'new@example.com'
        self.service.request_code(email, 'register-ip')
        encrypted = {'format': 1, 'nonce': base64.b64encode(bytes(12)).decode(), 'ciphertext': base64.b64encode(bytes(32)).decode()}
        body = {'email': email, 'code': self.mail[email], 'password': 'test-password-only', 'accountId': 'b'*32, 'keybox': {'salt': base64.b64encode(bytes(32)).decode(), 'envelope': encrypted}, 'envelope': encrypted}
        wrong = dict(body, code='wrong')
        with self.assertRaises(Failure):
            self.service.register(wrong, 'register-ip')
        self.assertEqual(len(self.service.admin_accounts()['accounts']), 0)
        session = self.service.register(body, 'register-ip')
        self.assertEqual(self.service.authenticate(session['token']), body['accountId'])
        self.assertEqual(self.service.read(body['accountId'])['revision'], 1)
        login = self.service.password_login(email, body['password'], 'password-ip')
        self.assertEqual(login['keybox'], body['keybox'])
        with self.assertRaises(Failure):
            self.service.register(body, 'register-ip')
        self.assertEqual(self.service.read(body['accountId'])['revision'], 1)

    def test_quotas_upgrade_and_downgrade_preserve_existing_cloud(self):
        import base64,time,uuid
        from unittest.mock import patch
        account=self.login('quota@example.com','quota')['accountId']
        def put(size,rev):
            return self.service.write(account,{'baseRevision':rev,'mutationId':str(uuid.uuid4()),'envelope':{'format':1,'nonce':base64.b64encode(bytes(12)).decode(),'ciphertext':base64.b64encode(bytes(size+16)).decode()}})
        with patch('server.FREE_BYTES',32),patch('server.MEMBER_BYTES',128):
            put(32,0)
            with self.assertRaises(Failure) as failure:put(33,1)
            self.assertEqual(failure.exception.status,413)
            self.assertEqual(self.service.read(account)['revision'],1)
            self.service.admin_membership({'account':account,'expiresAt':time.time()+3600,'reason':'test upgrade'})
            put(100,1)
            self.assertEqual(self.service.profile(account)['storage'],{'usedBytes':100,'limitBytes':128})
            self.service.admin_membership({'account':account,'expiresAt':0,'reason':'test downgrade'})
            self.assertEqual(self.service.read(account)['revision'],2)
            with self.assertRaises(Failure):put(110,2)
            put(90,2)
            self.assertEqual(self.service.profile(account)['storage']['usedBytes'],90)

    def test_account_relay_isolates_roles_tenants_and_revocation(self):
        import time,uuid
        from unittest.mock import patch
        a=self.login('relay-a@example.com','ra')['accountId'];b=self.login('relay-b@example.com','rb')['accountId']
        device=str(uuid.uuid4());body={'deviceId':device,'name':'Machine','certificate':'-----BEGIN CERTIFICATE-----'+'A'*100+'-----END CERTIFICATE-----'}
        d=self.service.devices
        with patch.dict('os.environ',{'RELAY_HOST':'relay.example.com','RELAY_FINGERPRINT':'a'*64}):
            self.assertIsNone(d.register(a,body)['relay'])
            self.assertEqual(len(d.list(a)['devices']),1)
            self.assertEqual(d.list(b)['devices'],[])
            with self.assertRaises(Failure):d.lease(a,{'deviceId':device})
            for account in [a,b]:self.service.admin_membership({'account':account,'expiresAt':time.time()+3600,'reason':'relay test'})
            registration=d.register(a,body)['relay']['credential']
            with self.assertRaises(Failure):d.register(b,body)
            with self.assertRaises(Failure):d.lease(b,{'deviceId':device})
            lease=d.lease(a,{'deviceId':device})['relay']['credential']
            other=str(uuid.uuid4());d.register(a,dict(body,deviceId=other))
            d.network(a,{'source':device,'target':other})
            with self.assertRaises(Failure):d.network(a,{'source':other,'target':device})
            with self.assertRaises(Failure):d.network(b,{'source':device,'target':other})
            self.assertEqual(len(d.network(a)['routes']),1)
            d.network(a,{'source':device,'target':None})
            self.assertEqual(d.network(a)['routes'],[])
            def allowed(token,operation):return d.authorize({'targetId':device,'credential':token,'operation':operation})['allowed']
            self.assertTrue(allowed(registration,'register'));self.assertFalse(allowed(registration,'forward'))
            self.assertTrue(allowed(lease,'forward'));self.assertFalse(allowed(lease,'register'))
            self.service.admin_membership({'account':a,'expiresAt':0,'reason':'revoke test'})
            self.assertFalse(allowed(lease,'forward'));self.assertFalse(allowed(registration,'channel'))

    def test_official_gateway_uses_private_endpoint_and_records_usage(self):
        import json,threading
        from http.server import HTTPServer,BaseHTTPRequestHandler
        seen=[]
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                seen.append((self.headers['Authorization'],body))
                data=json.dumps({'choices':[{'message':{'role':'assistant','content':'OK'}}],'usage':{'prompt_tokens':3,'completion_tokens':1}}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        upstream=HTTPServer(('127.0.0.1',0),Upstream);thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
        try:
            account=self.login('model@example.com','model')['accountId']
            self.service.models.entries={'fixture':{'id':'fixture','name':'Fixture','model':'private-model','key':'private-upstream-key','url':'http://127.0.0.1:'+str(upstream.server_port)}}
            self.assertNotIn('private-upstream-key',str(self.service.models.catalog()))
            result=self.service.models.complete(account,{'model':'fixture','messages':[{'role':'user','content':'hello'}],'url':'http://invalid.example','max_tokens':9999,'stream':True})
            self.assertEqual(result['model'],'fixture');self.assertEqual(seen[0][0],'Bearer private-upstream-key');self.assertEqual(seen[0][1]['max_tokens'],4096);self.assertFalse(seen[0][1]['stream'])
            usage=self.service.models.usage();self.assertEqual(usage['usage'][0]['succeeded'],1);self.assertEqual(usage['recent'][0]['inputTokens'],3)
            with self.assertRaises(Failure):self.service.models.complete(account,{'model':'unknown','messages':[{}]})
            self.assertNotIn('hello',str(usage))
        finally:upstream.shutdown();upstream.server_close();thread.join()

    def test_model_stream_is_incremental_and_releases_slot(self):
        import io, json
        from unittest.mock import patch
        account=self.login('stream@example.com','stream')['accountId']
        models=self.service.models
        models.entries={'fixture':{'id':'fixture','name':'Fixture','model':'private','key':'secret','url':'https://invalid.example'}}
        emitted=[]
        class Response(io.BytesIO):
            headers={'Content-Type':'text/event-stream'}
            def readline(self, limit=-1):
                if self.tell() > 0 and self.getvalue()[self.tell():].startswith(b'data: [DONE]'):
                    assert len(emitted)==1, 'first token must arrive before reading completion'
                return super().readline(limit)
        chunk={'model':'private','choices':[{'index':0,'delta':{'content':'你好'}}]}
        data=('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode()
        with patch('models.urllib.request.urlopen',return_value=Response(data)) as request:
            models.complete(account,{'model':'fixture','messages':[{'role':'user','content':'hi'}],'stream':True},emitted.append)
            self.assertTrue(json.loads(request.call_args.args[0].data)['stream'])
        self.assertEqual(json.loads(emitted[0])['model'],'fixture')
        self.assertEqual(emitted[-1],'[DONE]')
        self.assertNotIn(account,models.active)
        with patch('models.urllib.request.urlopen',return_value=Response(b'data: {}\n\n')):
            with self.assertRaises(Failure):
                models.complete(account,{'model':'fixture','messages':[{}],'stream':True},lambda _:None)
        self.assertNotIn(account,models.active)

    def tearDown(self):
        self.directory.cleanup()

    def login(self, email, ip):
        self.service.request_code(email, ip)
        return self.service.login(email, self.mail[email], ip)

    def test_code_single_use_attempt_limit_and_logout(self):
        session = self.login('one@example.com', '1')
        with self.assertRaises(Failure): self.service.login('one@example.com', self.mail['one@example.com'], '1')
        self.assertEqual(self.service.authenticate(session['token']), session['accountId'])
        self.service.logout(session['token'])
        with self.assertRaises(Failure): self.service.authenticate(session['token'])
        self.service.request_code('two@example.com', '2')
        for _ in range(5):
            with self.assertRaises(Failure): self.service.login('two@example.com', 'invalid', '2')
        with self.assertRaises(Failure): self.service.login('two@example.com', self.mail['two@example.com'], '2')

    def test_tenant_isolation_conflicts_and_idempotency(self):
        first, second = self.login('one@example.com','1'), self.login('two@example.com','2')
        body = {'baseRevision': 0, 'mutationId': 'a'*8+'-'+'a'*4+'-'+'a'*4+'-'+'a'*4+'-'+'a'*12,
                'envelope': {'format':1, 'nonce':'AAAAAAAAAAAAAAAA', 'ciphertext':'AAAAAAAAAAAAAAAAAAAAAA=='}}
        self.assertEqual(self.service.write(first['accountId'], body), {'revision':1})
        self.assertEqual(self.service.write(first['accountId'], body), {'revision':1})
        self.assertEqual(self.service.read(second['accountId'])['revision'],0)
        body['mutationId'] = body['mutationId'].replace('a','b')
        with self.assertRaises(Failure): self.service.write(first['accountId'], body)

    def test_mail_failure_does_not_leave_valid_code(self):
        def fail(*_): raise RuntimeError('provider unavailable')
        self.service.send_mail = fail
        with self.assertRaises(Failure): self.service.request_code('one@example.com','1')
        with self.service.db() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM codes').fetchone()[0],0)

    def test_password_login_and_no_overwrite(self):
        session = self.login('password@example.com', 'password-test')
        account = self.service.authenticate(session['token'])
        self.service.set_password(account, 'test-password-123')
        with self.assertRaises(Failure): self.service.set_password(account, 'another-password')
        with self.assertRaises(Failure): self.service.password_login('password@example.com', 'wrong-password', 'test')
        signed = self.service.password_login('password@example.com', 'test-password-123', 'test')
        self.assertEqual(self.service.authenticate(signed['token']), account)
        with self.service.db() as db:
            stored = db.execute('SELECT digest FROM passwords WHERE account=?', (account,)).fetchone()[0]
        self.assertNotEqual(stored, 'test-password-123')


if __name__ == '__main__': unittest.main()
