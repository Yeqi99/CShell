import tempfile
import pathlib
import unittest
from unittest.mock import patch
from cshell_wechat import moments_publish as p

class PublishTests(unittest.TestCase):
    def test_validation(self):
        args={'text':'测试','visibility':'public','idempotencyKey':'test-key-123'}
        self.assertEqual(p.validate(args)[0],'测试')
        for update in ({'text':''},{'text':' '},{'text':'中'*171},{'text':'a\x00b'},
                       {'visibility':'private'},{'idempotencyKey':'x'},{'images':[]}):
            with self.assertRaises(Exception):p.validate(dict(args,**update))

    def test_confirmation_and_restart_deduplication(self):
        args={'text':'测试','visibility':'public','idempotencyKey':'test-key-123'}
        binding={'moduleSha256':p.MODULE}
        result={'status':'submitted','author':'self','payloadVerified':True,'publicationConfirmed':False}
        row={'postId':'42','author':'self','createdAt':100,'private':'0'}
        with tempfile.TemporaryDirectory() as d, patch.object(p,'profile'), patch.object(p.time,'time',return_value=100), patch.object(p,'matching',side_effect=[[],[row]]) as read, patch.object(p,'native_publish',return_value=result) as native:
            directory=pathlib.Path(d)
            first=p.attempt(None,binding,None,None,args,directory,lambda:None)
            self.assertEqual(first['status'],'confirmed');self.assertEqual(first['postId'],'42')
            replay=p.attempt(None,binding,None,None,args,directory,lambda:None)
            self.assertTrue(replay['replayed']);self.assertFalse(replay['newSubmission'])
            self.assertEqual(native.call_count,1);self.assertEqual(read.call_count,2)
            with self.assertRaises(Exception):p.attempt(None,binding,None,None,dict(args,text='changed'),directory,lambda:None)

    def test_unknown_never_retries(self):
        args={'text':'测试','visibility':'public','idempotencyKey':'test-key-456'}
        with tempfile.TemporaryDirectory() as d, patch.object(p,'profile'), patch.object(p,'matching',return_value=[]), patch.object(p,'native_publish',return_value={'status':'unknown','publicationConfirmed':False}) as native:
            for _ in range(2):
                result=p.attempt(None,{'moduleSha256':p.MODULE},None,None,args,pathlib.Path(d),lambda:None)
                self.assertFalse(result['publicationConfirmed'])
            self.assertEqual(native.call_count,1)

    def test_old_or_other_author_record_not_confirmed(self):
        args={'text':'test','visibility':'public','idempotencyKey':'test-key-789'}
        old={'postId':'42','author':'self','createdAt':100,'private':'0'}
        other=dict(old,postId='43',author='other')
        with tempfile.TemporaryDirectory() as d, patch.object(p,'profile'), patch.object(p.time,'time',return_value=100), patch.object(p.time,'sleep'), patch.object(p,'matching',side_effect=[[old]]+[[old,other]]*3), patch.object(p,'native_publish',return_value={'status':'submitted','author':'self','payloadVerified':True,'publicationConfirmed':False}):
            result=p.attempt(None,{'moduleSha256':p.MODULE},None,None,args,pathlib.Path(d),lambda:None)
            self.assertEqual(result['status'],'submitted');self.assertFalse(result['publicationConfirmed'])
