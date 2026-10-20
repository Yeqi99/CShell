import hashlib
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from cshell_wechat.file_send import prepare,stage,attempt
from cshell_wechat.contracts import BridgeError

class FileSendTests(unittest.TestCase):
    def test_reject_nonlocal_paths_and_wildcard(self):
        for path in ['relative.txt','\\\\host\\share\\file.txt','//host/share/file','bad\0name']:
            with self.assertRaises(BridgeError):prepare({'recipient':'filehelper','path':path,'idempotencyKey':'test-file-01'})
        with self.assertRaises(BridgeError):prepare({'recipient':'*','path':str(pathlib.Path.cwd()/'x'),'idempotencyKey':'test-file-01'})

    def test_snapshot_is_immutable_and_cancelled_copy_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);source=root/'测试.txt';source.write_bytes(b'original')
            result=stage(source,root/'stage',lambda:None);source.write_bytes(b'changed')
            self.assertEqual(pathlib.Path(result['path']).read_bytes(),b'original')
            self.assertEqual(result['sha256'],hashlib.sha256(b'original').hexdigest())
            def cancel():raise RuntimeError('cancelled')
            with self.assertRaisesRegex(RuntimeError,'cancelled'):stage(source,root/'cancelled',cancel)
            self.assertEqual(list((root/'cancelled').iterdir()),[])

    def test_unknown_replay_never_submits_twice_and_changed_content_conflicts(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);source=root/'test.txt';source.write_bytes(b'test')
            params={'recipient':'filehelper','path':str(source),'idempotencyKey':'test-file-01'}
            args=(None,{'pid':1},'module',0,params,root,lambda:None)
            with patch('cshell_wechat.file_send.send',return_value={'status':'unknown','deliveryConfirmed':False}) as send:
                first=attempt(*args);self.assertTrue(first['stagingRetained'])
                second=attempt(*args);self.assertTrue(second['replayed']);self.assertFalse(second['newSend'])
                self.assertEqual(send.call_count,1)
                source.write_bytes(b'changed')
                with self.assertRaises(BridgeError):attempt(*args)
                self.assertEqual(len(list((root/'attachments').glob('*/*'))),1)

    def test_not_submitted_removes_staged_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);source=root/'test.txt';source.write_bytes(b'test')
            with patch('cshell_wechat.file_send.send',return_value={'status':'not_submitted'}):
                result=attempt(None,{'pid':1},'module',0,{'recipient':'filehelper','path':str(source),'idempotencyKey':'test-file-01'},root,lambda:None)
                self.assertFalse(result['stagingRetained'])
                self.assertFalse(result['newSend'])
                self.assertEqual(list((root/'attachments').iterdir()),[])

    def test_journal_open_failure_cleans_snapshot_without_sending(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);source=root/'test.txt';source.write_bytes(b'test')
            with patch('cshell_wechat.file_send.SendJournal',side_effect=OSError('disk unavailable')),patch('cshell_wechat.file_send.send') as send:
                with self.assertRaisesRegex(OSError,'disk unavailable'):
                    attempt(None,{'pid':1},'module',0,{'recipient':'filehelper','path':str(source),'idempotencyKey':'test-file-01'},root,lambda:None)
                send.assert_not_called()
                self.assertEqual(list((root/'attachments').iterdir()),[])

    def test_budget_and_empty_files_leave_no_partial_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);source=root/'test.txt';source.write_bytes(b'')
            with self.assertRaises(BridgeError):stage(source,root/'stage',lambda:None)
            source.write_bytes(b'1234')
            with patch('cshell_wechat.file_send.MAX_FILE_BYTES',3):
                with self.assertRaises(BridgeError):stage(source,root/'stage',lambda:None)
            self.assertEqual(list((root/'stage').iterdir()),[])

if __name__=='__main__':unittest.main()
