import pathlib,tempfile,unittest
from unittest.mock import patch
from cshell_wechat.remark import validate,attempt

class RemarkTest(unittest.TestCase):
    def request(self):return {'target':'wxid_test123','remark':'测试备注','expectedRemark':'原备注','idempotencyKey':'remark-key-001'}
    def test_validation_and_clear(self):
        request=self.request();self.assertEqual(validate(request),'wxid_test123')
        validate(dict(request,remark=''))
        for field,value in [('target','filehelper'),('target','123456@chatroom'),('remark','a\n'),('remark','测'*64),('expectedRemark',None),('idempotencyKey','short')]:
            with self.assertRaises(Exception):validate(dict(request,**{field:value}))
        with self.assertRaises(Exception):validate(dict(request,extra=True))
    def test_unknown_deduplication_survives_restart_and_conflicting_arguments(self):
        with tempfile.TemporaryDirectory() as d:
            with patch('cshell_wechat.remark.native_remark',return_value={'status':'unknown'}) as native:
                a=attempt(None,{'pid':1},None,0,self.request(),pathlib.Path(d),lambda:None)
                b=attempt(None,{'pid':2},None,0,self.request(),pathlib.Path(d),lambda:None)
                self.assertEqual(a['status'],'unknown');self.assertTrue(b['replayed']);self.assertFalse(b['newSubmission']);self.assertEqual(native.call_count,1)
                with self.assertRaises(Exception):attempt(None,{},None,0,dict(self.request(),remark='different'),pathlib.Path(d),lambda:None)
    def test_precondition_conflict_remains_not_submitted_on_replay(self):
        with tempfile.TemporaryDirectory() as d:
            with patch('cshell_wechat.remark.native_remark',return_value={'status':'conflict'}) as native:
                for _ in range(2):self.assertEqual(attempt(None,{},None,0,self.request(),pathlib.Path(d),lambda:None)['status'],'conflict')
                self.assertEqual(native.call_count,1)

if __name__=='__main__':unittest.main()
