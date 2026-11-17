import json
import unittest

from model_pool_inventory import summarize_inventory


class InventoryTest(unittest.TestCase):
    def test_newest_wallet_only_and_unknown_prices_stay_native(self):
        def row(provider, key, wallet, price, ts, **measure):
            return provider, key, wallet, price, ts, json.dumps([measure])

        rows = [
            row('a', 'old', 'wallet', None, 96000, unit='CNY', remaining=20),
            row('a', 'new', 'wallet', None, 99000, unit='CNY', remaining=10),
            row('b', '1', None, None, 99000, unit='credits', total=10000, remaining=8000),
            row('c', '1', None, '7.2', 99000, unit='USD', total=5, remaining=2),
            row('d', '1', None, None, 1, unit='CNY', remaining=90),
            row('e', '1', None, None, 99000, unit='percent', used=30),
        ]
        result = summarize_inventory(rows, 100000)
        self.assertEqual(result['knownRemainingYuan'], '24.4')
        self.assertEqual(result['knownTotalYuan'], '36.0')
        self.assertEqual(result['excluded'], dict(duplicateWallet=1, staleOrMissing=1,
                                                  unknownCost=1, windowOnly=1))
        self.assertEqual(result['units'][1]['remaining'], '8000')

    def test_unknown_wallets_are_not_double_counted(self):
        rows = [('a', key, None, None, 99, '[{"unit":"CNY","remaining":100}]')
                for key in ('1', '2')]
        result = summarize_inventory(rows, 100)
        self.assertIsNone(result['knownRemainingYuan'])
        self.assertEqual(result['excluded'], {'unknownWallet': 2})
