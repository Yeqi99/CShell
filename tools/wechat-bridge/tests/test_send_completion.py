import unittest
from unittest.mock import Mock, patch
from cshell_wechat.runtime import send

class SendCompletion(unittest.TestCase):
    def execute(self, final, unloaded=True):
        adapter=Mock()
        adapter.guard.return_value=[0]*16
        adapter.start.return_value.status.return_value=[1,0,0,0,0,5,0,0]
        adapter.close.return_value={'unloaded':unloaded,'codeRestored':unloaded}
        adapter.stopped_state={'active':final[7],'nativeState':final}
        memory=Mock();memory.read.return_value=b'\x01\x00\x00\x00'
        with patch('cshell_wechat.runtime.Instrument',return_value=adapter), patch('cshell_wechat.runtime.bounded',side_effect=lambda fn:fn()), patch('cshell_wechat.runtime.time.sleep'):
            return send(memory,{},'',0,'filehelper','test',lambda:None)

    def test_submission_between_last_poll_and_stop_is_preserved(self):
        result=self.execute([0,2,123,7,1,5,0,0])
        self.assertEqual(result['status'],'native_returned')
        self.assertFalse(result['deliveryConfirmed'])

    def test_no_eligible_thread_only_final_after_stop(self):
        result=self.execute([0,0,0,0,0,5,0,0])
        self.assertEqual(result['status'],'not_submitted')

    def test_active_or_failed_cleanup_stays_unknown(self):
        for final in ([0,1,123,6,0,0,0,1],[0,0,0,0,0,5,0,0]):
            self.assertEqual(self.execute(final,False)['status'],'unknown')
