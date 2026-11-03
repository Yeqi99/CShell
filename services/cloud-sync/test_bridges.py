import hashlib
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from bridges import Bridges


class Failure(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class Service:
    def __init__(self, path):
        self.path, self.lock = path, threading.RLock()

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path)
            try:
                with db:
                    yield db
            finally:
                db.close()

    def digest(self, value):
        return hashlib.sha256(value.encode()).hexdigest()

    def limit(self, *args):
        pass


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bridge = Bridges(Service(str(Path(self.directory.name) / 'test.db')), Failure)
        self.registration = dict(bridgeId=str(uuid.uuid4()), secret='a' * 43, name='Test CShell')
        self.bridge.register('alice', self.registration)

    def expect_status(self, status, function):
        with self.assertRaises(Failure) as caught:
            function()
        self.assertEqual(caught.exception.status, status)

    def test_account_and_worker_isolation(self):
        self.assertEqual(self.bridge.list('bob'), {'bridges': []})
        self.expect_status(404, lambda: self.bridge.poll('bob', self.registration))
        self.expect_status(403, lambda: self.bridge.poll('alice', dict(self.registration, secret='wrong')))
        self.expect_status(409, lambda: self.bridge.register('bob', self.registration))
        self.expect_status(409, lambda: self.bridge.register('alice', dict(self.registration, secret='b' * 43)))
        self.assertNotIn('secret', str(self.bridge.list('alice')))

    def wait_for_job(self):
        for _ in range(100):
            jobs = self.bridge.poll('alice', self.registration)['requests']
            if jobs:
                return jobs[0]
            time.sleep(.01)
        self.fail('No queued request')

    def test_delivery_is_once_and_response_is_bound(self):
        body = dict(bridgeId=self.registration['bridgeId'], name='connect', arguments={'profileId': 'machine'})
        with ThreadPoolExecutor() as pool:
            result = pool.submit(self.bridge.invoke, 'alice', 'consumer', body, 2)
            job = self.wait_for_job()
            self.assertEqual(job['consumer'], 'consumer')
            self.assertEqual(self.bridge.poll('alice', self.registration)['requests'], [])
            other = dict(bridgeId=str(uuid.uuid4()), secret='b' * 43, name='Other')
            self.bridge.register('alice', other)
            self.expect_status(404, lambda: self.bridge.reply('alice', dict(other, id=job['id'], result={'ok': True})))
            expected = {'ok': True, 'result': {'sessionId': 'session'}}
            self.bridge.reply('alice', dict(self.registration, id=job['id'], result=expected))
            self.assertEqual(result.result(), expected)
        self.assertEqual(len(self.bridge.pending), 0)

    def test_unknown_result_is_not_replayed(self):
        body = dict(bridgeId=self.registration['bridgeId'], name='invoke_connection', arguments={})
        with ThreadPoolExecutor() as pool:
            result = pool.submit(self.bridge.invoke, 'alice', 'consumer', body, .1)
            self.wait_for_job()
            self.expect_status(504, result.result)
        self.assertEqual(self.bridge.poll('alice', self.registration)['requests'], [])

    def test_no_arbitrary_methods_and_remove_revokes(self):
        body = dict(bridgeId=self.registration['bridgeId'], name='configure', arguments={})
        self.expect_status(400, lambda: self.bridge.invoke('alice', 'consumer', body))
        self.bridge.remove('alice', self.registration)
        self.assertEqual(self.bridge.list('alice'), {'bridges': []})
        self.expect_status(404, lambda: self.bridge.poll('alice', self.registration))


if __name__ == '__main__':
    unittest.main()
