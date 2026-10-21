import tempfile
import unittest
import secrets
from server import Service, Failure


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.mail = {}
        self.service = Service(self.directory.name + '/test.sqlite', secrets.token_bytes(32), lambda email, code: self.mail.update({email: code}))

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


if __name__ == '__main__': unittest.main()
