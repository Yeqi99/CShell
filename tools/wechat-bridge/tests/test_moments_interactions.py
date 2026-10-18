import unittest
from cshell_wechat.moments_interactions import post_id,prepare,result_page
from cshell_wechat.contracts import BridgeError

class InteractionTests(unittest.TestCase):
    def test_unsigned_id_preserved_and_sql_signed(self):
        self.assertEqual(post_id('15034368489356595812'),('15034368489356595812',-3412375584352955804))
        self.assertIn('feed_id=-3412375584352955804',prepare({'postId':'15034368489356595812'})[3])
        for value in ['0','-1','18446744073709551616',1,True,'1 OR 1=1']:
            with self.assertRaises(BridgeError):post_id(value)

    def test_kind_namespace_paging_and_account_binding(self):
        raw={'state':[0,2,0,101],'cleanup':{'unloaded':True,'codeRestored':True},'databasePath':'account-a',
             'rows':[['5','1','a','self','','3','0','0'],['6','2','a','self','hello','3','0','0']]}
        page=result_page(raw,{'postId':'123','limit':1})
        self.assertEqual(page['items'][0]['kind'],'like');self.assertTrue(page['hasMore'])
        self.assertIn('local_id>5',prepare({'postId':'123','cursor':page['nextCursor']})[3])
        with self.assertRaises(BridgeError):prepare({'postId':'124','cursor':page['nextCursor']})
        raw['databasePath']='account-b'
        with self.assertRaises(BridgeError):result_page(raw,{'postId':'123','cursor':page['nextCursor']})

    def test_failure_is_not_an_empty_success(self):
        raw={'state':[0,2,0,-10],'cleanup':{'unloaded':True,'codeRestored':True},'databasePath':'a','rows':[]}
        with self.assertRaises(BridgeError):result_page(raw,{'postId':'123'})
        raw['state'][3]=101;raw['cleanup']['unloaded']=False
        with self.assertRaises(BridgeError):result_page(raw,{'postId':'123'})

    def test_unknown_and_oversize_are_explicit(self):
        raw={'state':[0,2,0,101],'cleanup':{'unloaded':True,'codeRestored':True},'databasePath':'a',
             'rows':[['1','99','a','b',None,'0','0','1']]}
        item=result_page(raw,{'postId':'123'})['items'][0]
        self.assertEqual(item['kind'],'unknown');self.assertEqual(item['contentStatus'],'oversized-or-null')
        self.assertEqual(item['deletionState'],'1')

if __name__=='__main__':unittest.main()
