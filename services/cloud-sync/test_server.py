import tempfile
import unittest
import secrets
from server import Service, Failure


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.mail = {}
        self.service = Service(self.directory.name + '/test.sqlite', secrets.token_bytes(32), lambda email, code: self.mail.update({email: code}))

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
