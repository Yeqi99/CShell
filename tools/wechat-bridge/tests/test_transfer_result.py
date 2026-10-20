import unittest
from cshell_wechat.transfer_result import receipt_observation


class TransferResultTest(unittest.TestCase):
    def setUp(self):
        self.native = dict(stage=2, transportCode=0, returnCode='0')
        self.incoming = dict(kind='transfer', messageState='transfer_notice',
                             paymentReference='a' * 64, amountMinor=10, currency='CNY')
        self.receipt = dict(self.incoming, messageState='receipt_notice')

    def test_successful_codes_need_matching_receipt(self):
        self.assertEqual(receipt_observation(self.native, self.incoming, {})['state'], 'unverified')
        result = receipt_observation(self.native, self.incoming, self.receipt)
        self.assertEqual(result['state'], 'receipt_observed')
        self.assertEqual(result['amount'], '0.10')
        self.assertFalse(result['settlementVerified'])

    def test_mismatches_do_not_confirm(self):
        for key, value in [('paymentReference', 'b' * 64), ('amountMinor', 11),
                           ('currency', 'USD'), ('messageState', 'transfer_notice'), ('kind', 'red_packet')]:
            with self.subTest(field=key):
                self.assertEqual(receipt_observation(self.native, self.incoming,
                                 dict(self.receipt, **{key: value}))['state'], 'unverified')

    def test_failures_and_missing_codes(self):
        for changes, expected in [({'stage': 1}, 'unverified'),
                                   ({'transportCode': 5}, 'transport_failed'),
                                   ({'transportCode': False}, 'unverified'),
                                   ({'returnCode': None}, 'unverified'),
                                   ({'returnCode': '-1'}, 'native_rejected')]:
            with self.subTest(changes=changes):
                self.assertEqual(receipt_observation(dict(self.native, **changes),
                                 self.incoming, self.receipt)['state'], expected)

    def test_bad_input_is_not_evidence(self):
        self.assertEqual(receipt_observation(None, self.incoming, self.receipt)['state'], 'unverified')
        self.assertEqual(receipt_observation(self.native, dict(self.incoming, amountMinor=True),
                         dict(self.receipt, amountMinor=True))['state'], 'unverified')
