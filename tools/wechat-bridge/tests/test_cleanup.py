import unittest
from unittest.mock import Mock,patch
from cshell_wechat.runtime import Instrument

class Cleanup(unittest.TestCase):
    def adapter(self):
        a=Instrument(Mock(),{},'',0)
        a.script=Mock();a.session=Mock()
        a.script.exports_sync.stop.return_value={'active':0}
        self.addCleanup(Instrument.retained.clear)
        return a

    @patch('cshell_wechat.runtime.bounded',side_effect=lambda fn:fn())
    def test_stop_failure_does_not_unload_or_detach(self,_):
        a=self.adapter();a.script.exports_sync.stop.side_effect=RuntimeError('RPC failure')
        result=a.close()
        self.assertTrue(result['retained']);self.assertFalse(result['unloaded'])
        a.script.unload.assert_not_called();a.session.detach.assert_not_called()

    @patch('cshell_wechat.runtime.bounded',side_effect=lambda fn:fn())
    def test_drain_before_unload(self,_):
        a=self.adapter();a.script.exports_sync.stop.side_effect=[{'active':1},{'active':0}]
        with patch('cshell_wechat.runtime.time.sleep'):result=a.close()
        self.assertEqual(a.script.exports_sync.stop.call_count,2)
        self.assertTrue(result['unloaded']);a.script.unload.assert_called_once();a.session.detach.assert_called_once()

    @patch('cshell_wechat.runtime.bounded',side_effect=lambda fn:fn())
    def test_unload_failure_does_not_force_detach(self,_):
        a=self.adapter();a.script.unload.side_effect=RuntimeError('timeout')
        self.assertTrue(a.close()['retained']);a.session.detach.assert_not_called()

    @patch('cshell_wechat.runtime.bounded',side_effect=lambda fn:fn())
    def test_busy_deadline_retains_session(self,_):
        a=self.adapter();a.script.exports_sync.stop.return_value={'active':1}
        with patch('cshell_wechat.runtime.time.monotonic',side_effect=[0,6]):result=a.close()
        self.assertTrue(result['retained']);a.script.unload.assert_not_called();a.session.detach.assert_not_called()
