import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from cshell_wechat.contracts import BridgeError
from cshell_wechat.transfer_flow import TransferFlow


class TransferFlowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'flow.db'
        self.flow = TransferFlow(self.path)
        self.account, self.sender = 'wxid_receiver', 'wxid_sender'
        self.card = dict(kind='transfer', messageState='transfer_notice', currency='CNY',
                         amountMinor=10, paymentReference='a' * 64)
        self.evidence = dict(source='native_receipt_response', status='received',
                             accountId=self.account, senderId=self.sender, currency='CNY',
                             amountMinor=10, paymentReference='a' * 64)

    def tearDown(self):
        self.flow.close()
        self.temp.cleanup()

    def test_no_notification_before_confirmed_receipt(self):
        self.assertIsNone(self.flow.notification(self.account, self.sender, self.card))
        with self.assertRaises(BridgeError):
            self.flow.confirm(self.account, self.sender, self.card, self.card)

    def test_success_notification_and_restart_deduplication(self):
        self.assertTrue(self.flow.claim_submission(self.account, self.sender, self.card)['newSubmission'])
        key = self.flow.confirm(self.account, self.sender, self.card, self.evidence)
        notice = self.flow.notification(self.account, self.sender, self.card)
        self.assertEqual(notice['text'], '已自动领取0.10元')
        self.assertEqual(notice['recipient'], self.sender)
        self.flow.close()
        self.flow = TransferFlow(self.path)
        self.flow.confirm(self.account, self.sender, self.card, self.evidence)
        self.assertIsNone(self.flow.notification(self.account, self.sender, self.card))
        self.flow.notification_delivered(key)
        self.assertIsNone(self.flow.notification(self.account, self.sender, self.card))

    def test_reject_mismatched_or_ambiguous_evidence(self):
        for field, value in [('amountMinor', 11), ('senderId', 'wxid_other'),
                             ('accountId', 'wxid_other'), ('paymentReference', 'b' * 64),
                             ('currency', 'USD'), ('status', 'unknown'), ('source', 'local_message')]:
            with self.subTest(field=field), self.assertRaises(BridgeError):
                self.flow.confirm(self.account, self.sender, self.card, dict(self.evidence, **{field: value}))
        self.assertIsNone(self.flow.notification(self.account, self.sender, self.card))

    def test_same_reference_cannot_change_sender_or_amount(self):
        self.flow.reserve(self.account, self.sender, self.card)
        with self.assertRaises(BridgeError):
            self.flow.reserve(self.account, 'wxid_other', self.card)
        with self.assertRaises(BridgeError):
            self.flow.reserve(self.account, self.sender, dict(self.card, amountMinor=100))

    def test_red_packet_excluded(self):
        with self.assertRaises(BridgeError):
            self.flow.reserve(self.account, self.sender, dict(self.card, kind='red_packet'))

    def test_lookup_and_notification_do_not_reserve(self):
        self.assertEqual(self.flow.lookup(self.account, self.sender, self.card)['status'], 'not_submitted')
        self.assertIsNone(self.flow.notification(self.account, self.sender, self.card))
        with self.assertRaises(BridgeError):
            self.flow.confirm(self.account, self.sender, self.card, self.evidence)
        self.assertTrue(self.flow.claim_submission(self.account, self.sender, self.card)['newSubmission'])

    def test_only_one_concurrent_caller_can_submit(self):
        def claim(_):
            flow = TransferFlow(self.path)
            try:
                return flow.claim_submission(self.account, self.sender, self.card)['newSubmission']
            finally:
                flow.close()
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(claim, range(24))), 1)
        self.flow.close()
        self.flow = TransferFlow(self.path)
        state = self.flow.claim_submission(self.account, self.sender, self.card)
        self.assertFalse(state['newSubmission'])
        self.assertEqual(state['status'], 'receipt_unknown')

    def test_invalid_confirmation_does_not_reserve(self):
        with self.assertRaises(BridgeError):
            self.flow.confirm(self.account, self.sender, self.card, dict(self.evidence, amountMinor=11))
        self.assertEqual(self.flow.lookup(self.account, self.sender, self.card)['status'], 'not_submitted')
