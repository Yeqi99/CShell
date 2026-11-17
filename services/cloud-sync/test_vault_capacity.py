import tempfile,unittest,json
from server import Service,Failure,MEMBER_BYTES,MAX_STORAGE

class VaultCapacityTest(unittest.TestCase):
    def test_legacy_read_is_rejected_before_loading_oversized_envelope(self):
        with tempfile.TemporaryDirectory() as path:
            s=Service(path+'/db',b'x'*32,lambda *args:None)
            with s.db() as db:
                db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
                # Invalid JSON proves the early capacity gate precedes decoding.
                db.execute('INSERT INTO vaults VALUES(?,?,?,?,?)',('a',1,'not-loaded','m',MEMBER_BYTES+1))
            with self.assertRaises(Failure) as error:s.read('a')
            self.assertEqual(error.exception.status,413)
            with s.db() as db:self.assertEqual(db.execute('SELECT envelope FROM vaults').fetchone()[0],'not-loaded')
            for capacity in (0,-1,MAX_STORAGE+1,True):
                with self.assertRaises(Failure):s.read('a',max_bytes=capacity)
            with s.db() as db:db.execute('UPDATE vaults SET envelope=?,byte_size=?',(json.dumps({'format':1}),100))
            self.assertEqual(s.read('a',max_bytes=100)['revision'],1)
