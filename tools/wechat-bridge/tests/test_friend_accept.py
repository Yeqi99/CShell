import base64,copy,pathlib,tempfile,time,unittest
from unittest.mock import Mock,patch
from cshell_wechat.contracts import BridgeError
from cshell_wechat.friend_accept import MODULE,validate,attempt,native_accept
from cshell_wechat.cli import execute

class FriendAccept(unittest.TestCase):
    def setUp(self):
        self.binding={'pid':123,'created':'456','moduleSha256':MODULE}
        self.request={'binding':self.binding,'target':'wxid_test123',
          'encryptedIdentity':'v3_'+'a'*40,'ticket':'v4_'+'b'*40,'scene':30,
          'detailBase64':base64.b64encode(b'\x10\x01').decode(),'observedAt':time.time()}

    def test_request_validation(self):
        self.assertEqual(validate(self.request,self.binding),'wxid_test123')
        for field,value,code in [('scene',15,'UNVERIFIED_SOURCE'),('observedAt',0,'STALE_REQUEST'),
          ('ticket','v4_bad\x00','INVALID_TICKET'),('target','123456@chatroom','INVALID_TARGET'),
          ('detailBase64',base64.b64encode(b'\x10\x00').decode(),'NOT_PENDING')]:
            request=copy.deepcopy(self.request);request[field]=value
            with self.assertRaises(BridgeError) as ctx:validate(request,self.binding)
            self.assertEqual(ctx.exception.code,code)
        with self.assertRaises(BridgeError):validate(dict(self.request,privacy=0),self.binding)
        with self.assertRaises(BridgeError):validate(self.request,dict(self.binding,created='new'))

    def test_default_cli_stays_blocked_before_process_access(self):
        with tempfile.TemporaryDirectory() as folder, patch('cshell_wechat.windows.Memory') as memory:
            with self.assertRaises(BridgeError) as ctx:execute('friend_requests.accept',{},pathlib.Path(folder))
            self.assertEqual(ctx.exception.code,'ADAPTER_QUARANTINED');memory.assert_not_called()

    def test_duplicate_does_not_resubmit_even_after_process_change(self):
        with tempfile.TemporaryDirectory() as folder,patch('cshell_wechat.friend_accept.native_accept',return_value={'status':'unknown'}) as native:
            directory=pathlib.Path(folder)
            attempt(None,self.binding,'',0,self.request,directory,lambda:None)
            binding=dict(self.binding,pid=124,created='new')
            request=dict(self.request,binding=binding,observedAt=time.time())
            result=attempt(None,binding,'',0,request,directory,lambda:None)
            self.assertTrue(result['replayed']);self.assertFalse(result['newSubmission'])
            self.assertEqual(native.call_count,1)
            data=(directory/'accept-journal.sqlite3').read_bytes()
            self.assertNotIn(self.request['ticket'].encode(),data)

    def test_exception_reservation_remains_unknown(self):
        with tempfile.TemporaryDirectory() as folder,patch('cshell_wechat.friend_accept.native_accept',side_effect=RuntimeError('lost connection')) as native:
            directory=pathlib.Path(folder)
            with self.assertRaises(RuntimeError):attempt(None,self.binding,'',0,self.request,directory,lambda:None)
            result=attempt(None,self.binding,'',0,self.request,directory,lambda:None)
            self.assertEqual(result['status'],'unknown');self.assertEqual(native.call_count,1)

    def test_final_cleanup_state_wins_over_last_poll(self):
        for clean,expected in [(True,'native_returned'),(False,'unknown')]:
            adapter=Mock();adapter.guard.return_value=[0]*16
            adapter.start.return_value.status.return_value=[0,2,0,3,0,0]
            adapter.close.return_value={'unloaded':clean,'codeRestored':clean}
            adapter.stopped_state={'active':0,'state':[0,2,0,6,1,0]}
            with patch('cshell_wechat.friend_accept.Instrument',return_value=adapter),patch('cshell_wechat.friend_accept.bounded',side_effect=lambda fn:fn()):
                result=native_accept(None,self.binding,'',0,self.request,lambda:None)
            self.assertEqual(result['status'],expected);self.assertFalse(result['acceptanceConfirmed'])

if __name__=='__main__':unittest.main()
