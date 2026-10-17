import sqlite3,unittest
from cshell_wechat.contacts import prepare,result_page

class ContactsTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE contact(id INTEGER,username TEXT,alias TEXT,remark TEXT,nick_name TEXT,flag INTEGER,delete_flag INTEGER,local_type INTEGER)')
        for i in range(1,6):self.db.execute('INSERT INTO contact VALUES(?,?,?,?,?,1,0,0)',(i,'wxid_test'+str(i),'','same','same'))
    def tearDown(self):self.db.close()
    def page(self,params,path='account/contact.db'):
        rows=[[None if v is None else str(v) for v in r] for r in self.db.execute(prepare(params)[2])]
        return result_page({'state':[0,2,0,101],'rows':rows,'databasePath':path,'cleanup':{'unloaded':True,'codeRestored':True}},params)
    def test_pages_preserve_duplicate_names_and_do_not_claim_friends(self):
        first=self.page({'limit':2});second=self.page({'limit':2,'cursor':first['nextCursor']});last=self.page({'limit':2,'cursor':second['nextCursor']})
        self.assertEqual([x['recordId'] for p in (first,second,last) for x in p['items']],['1','2','3','4','5'])
        self.assertTrue(first['hasMore']);self.assertFalse(last['hasMore']);self.assertFalse(last['complete']);self.assertFalse(last['snapshot'])
    def test_scope_change_and_injection_rejected(self):
        cursor=self.page({'limit':2})['nextCursor']
        with self.assertRaises(Exception):self.page({'cursor':cursor},'other/contact.db')
        for params in ({'limit':True},{'limit':101},{'limit':0},{'cursor':'1 OR 1=1'},{'sql':'SELECT 1'}):
            with self.assertRaises(Exception):prepare(params)
    def test_partial_query_and_failed_cleanup_rejected(self):
        for raw in ({'state':[0,2,0,100]}, {'state':[0,2,0,101],'cleanup':{'unloaded':False,'codeRestored':True}}):
            with self.assertRaises(Exception):result_page(raw,{})

if __name__=='__main__':unittest.main()
