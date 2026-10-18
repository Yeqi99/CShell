import sqlite3, unittest
import zstandard
from cshell_wechat.history import prepare,result_page,decode_body

class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.table='Msg_'+__import__('hashlib').md5(b'filehelper').hexdigest()
        self.db.execute('CREATE TABLE Name2Id(user_name TEXT)')
        self.db.execute("INSERT INTO Name2Id VALUES ('wxid_test')")
        self.db.execute(f'CREATE TABLE {self.table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,create_time INTEGER,real_sender_id INTEGER,message_content TEXT,WCDB_CT_message_content INTEGER)')
        for i in range(1,6):self.db.execute(f'INSERT INTO {self.table} VALUES (?,?,1,100,1,?,0)',(i,100+i,'text'+str(i)))
    def tearDown(self):self.db.close()
    def page(self,**params):
        params={'target':'filehelper','limit':2,**params}
        rows=[[None if v is None else str(v) for v in row] for row in self.db.execute(prepare(params)[4])]
        return result_page({'state':[0,2,0,101],'rows':rows,'databasePath':'account/message_0.db','cleanup':{'unloaded':True,'codeRestored':True}},params)
    def test_pagination_same_timestamp_and_resume(self):
        latest=self.page();self.assertEqual([e['localId'] for e in latest['events']],['4','5'])
        older=self.page(direction='before',cursor=latest['olderCursor'])
        self.assertEqual([e['localId'] for e in older['events']],['2','3'])
        newer=self.page(direction='after',cursor=older['newerCursor'])
        self.assertEqual([e['deduplicationKey'] for e in newer['events']],[e['deduplicationKey'] for e in latest['events']])
        self.assertFalse(latest['complete']);self.assertTrue(latest['hasMore'])
    def test_missing_anchor_does_not_advance(self):
        cursor=self.page()['newerCursor'];self.db.execute(f'DELETE FROM {self.table} WHERE local_id=5')
        result=self.page(direction='after',cursor=cursor)
        self.assertTrue(result['restartRequired']);self.assertEqual(result['events'],[])
    def test_target_scope(self):
        cursor=self.page()['newerCursor']
        with self.assertRaises(Exception):prepare({'target':'wxid_other','direction':'after','cursor':cursor})
    def test_compression_and_bounds(self):
        blob=zstandard.ZstdCompressor().compress('历史'.encode())
        self.assertEqual(decode_body(blob.hex(),'4','1',len(blob)),('历史','text'))
        bomb=zstandard.ZstdCompressor().compress(b'a'*70000)
        self.assertEqual(decode_body(bomb.hex(),'4','1',len(bomb))[1],'oversized')
        self.assertEqual(decode_body('ff','0','1',1)[1],'decode-failed')
        self.assertEqual(decode_body('','0','3',0)[1],'non-text')

if __name__=='__main__':unittest.main()
