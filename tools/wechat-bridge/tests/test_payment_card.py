import json
import unittest
from cshell_wechat.history import decode_body


class PaymentCardTest(unittest.TestCase):
    def decode(self, amount='￥0.10', subtype='1', kind='2000'):
        xml = f'<msg><appmsg><type>{kind}</type><wcpayinfo><paysubtype>{subtype}</paysubtype><feedesc>{amount}</feedesc><transferid>PRIVATE_TICKET</transferid><transcationid>PRIVATE_TRANSACTION</transcationid><pay_memo>PRIVATE_MEMO</pay_memo></wcpayinfo></appmsg></msg>'
        raw = xml.encode()
        return decode_body(raw.hex(), 0, (int(kind) << 32) | 49, len(raw))

    def test_observed_transfer_and_redaction(self):
        text, status = self.decode()
        self.assertEqual(status, 'payment-card')
        card = json.loads(text)
        self.assertEqual((card['amount'], card['amountMinor'], card['currency']), ('0.10', 10, 'CNY'))
        self.assertEqual(card['settlementStatus'], 'unverified')
        self.assertFalse(card['receiveSupported'])
        self.assertNotIn('PRIVATE', text)

    def test_unknown_amount_not_guessed(self):
        for value in ('', '$0.10', '￥0.1', '￥-1.00', '￥1,000.00', '已收款0.10', '￥1.999'):
            card = json.loads(self.decode(value)[0])
            self.assertIsNone(card['amount'])
            self.assertIsNone(card['amountMinor'])

    def test_red_packet_never_infers_amount_from_transfer_field(self):
        text, status = self.decode(kind='2001')
        self.assertEqual(status, 'payment-card')
        card = json.loads(text)
        self.assertEqual(card['kind'], 'red_packet')
        self.assertIsNone(card['amount'])
        self.assertEqual(card['amountAvailability'], 'not_present_in_message')

    def test_unknown_subtype(self):
        card = json.loads(self.decode(subtype='999')[0])
        self.assertEqual(card['nativePaySubtype'], '999')
        self.assertEqual(card['settlementStatus'], 'unverified')

    def test_receipt_is_linked_without_exposing_ticket(self):
        notice = json.loads(self.decode()[0])
        receipt = json.loads(self.decode(subtype='3')[0])
        self.assertEqual(notice['paymentReference'], receipt['paymentReference'])
        self.assertEqual(len(receipt['paymentReference']), 64)
        self.assertEqual(receipt['messageState'], 'receipt_notice')
        self.assertEqual(notice['messageState'], 'transfer_notice')
        self.assertEqual(receipt['settlementStatus'], 'unverified')


if __name__ == '__main__':
    unittest.main()
