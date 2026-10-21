"""Synthetic live card decoding only; no WeChat process or financial operation."""
import hashlib
import json
import pathlib
import tempfile
import unittest
from xml.sax.saxutils import escape

from cshell_wechat.contracts import BridgeError
from cshell_wechat.events import EventJournal
from cshell_wechat.history import decode_body
from cshell_wechat.protocol import decode


URL = 'wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=123&channelid=1&msgtype=1'


def xml(kind='2000', subtype='1', amount='￥0.10', url=URL):
    return ('<msg><appmsg><type>' + kind + '</type><title>PRIVATE_TITLE</title>'
            '<url>PRIVATE_APP_URL</url><wcpayinfo><paysubtype>' + subtype + '</paysubtype>'
            '<feedesc>' + amount + '</feedesc><transferid>PRIVATE_TICKET</transferid>'
            '<transcationid>PRIVATE_TRANSACTION</transcationid><pay_memo>PRIVATE_MEMO</pay_memo>'
            '<nativeurl>' + escape(url) + '</nativeurl></wcpayinfo>'
            '<refermsg><content>PRIVATE_REFERENCE</content></refermsg></appmsg></msg>')


def event(body, native_type=49, message_id='123'):
    return dict(decode({'message': dict(type=native_type, text=body, messageId=message_id,
                                      timestamp=1234567890, **{'from': 'wxid_sender', 'to': 'wxid_owner'})}),
                kind='message')


class PaymentEvents(unittest.TestCase):
    def test_transfer_metadata_is_bounded_and_raw_card_is_removed(self):
        value = event(xml())
        self.assertEqual(value['format'], 'payment-card')
        self.assertIsNone(value['text'])
        self.assertEqual(value['payment']['amountMinor'], 10)
        self.assertEqual(value['payment']['currency'], 'CNY')
        self.assertEqual(value['payment']['messageState'], 'transfer_notice')
        self.assertEqual(value['payment']['settlementStatus'], 'unverified')
        self.assertEqual(value['messageId'], '123')
        self.assertEqual(value['senderId'], 'wxid_sender')
        self.assertNotIn('PRIVATE', json.dumps(value))
        self.assertNotIn('wxpay', json.dumps(value))
        self.assertNotIn('appMessage', value)
        self.assertNotIn('reference', value)
        # History consumers keep the same existing envelope and identity.
        body = xml().encode()
        text, status = decode_body(body.hex(), 0, (2000 << 32) | 49, len(body))
        self.assertEqual(status, 'payment-card')
        self.assertEqual(json.loads(text)['paymentReference'], value['payment']['paymentReference'])

    def test_native_type_and_xml_are_required_not_ordinary_text(self):
        self.assertNotIn('payment', event('转账 ￥0.10'))
        self.assertNotIn('payment', event(xml(), 1))
        self.assertNotIn('payment', event(xml(kind='5')))
        self.assertNotIn('payment', event('<msg><appmsg>'))
        self.assertIn('payment', event(xml(), (2000 << 32) | 49))
        with self.assertRaises(BridgeError):
            event('<!DOCTYPE msg [<!ENTITY x "private">]><msg>&x;</msg>')
        with self.assertRaises(BridgeError):
            event('<! ENTITY x "private"><msg/>')

    def test_receipt_and_unknown_subtype_do_not_become_incoming_transfer(self):
        notice = event(xml())['payment']
        receipt = event(xml(subtype='3'))['payment']
        self.assertEqual(receipt['messageState'], 'receipt_notice')
        self.assertEqual(receipt['paymentReference'], notice['paymentReference'])
        self.assertEqual(event(xml(subtype='999'))['payment']['messageState'], 'unknown')
        for amount in ('', '$0.10', '￥-1.00', '￥1.5', '￥9999999999999.00'):
            self.assertIsNone(event(xml(amount=amount))['payment']['amountMinor'])

    def test_red_packet_identity_matches_verified_mapping_without_amount(self):
        payment = event(xml(kind='2001'))['payment']
        expected = hashlib.sha256(json.dumps(['red_packet', '123', '1', '1'],
                                            separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(payment['paymentReference'], expected)
        self.assertEqual(payment['messageState'], 'red_packet_notice')
        self.assertIsNone(payment['amountMinor'])
        self.assertIsNone(payment['currency'])
        for subtype in ('3', '999'):
            self.assertEqual(event(xml(kind='2001', subtype=subtype))['payment']['messageState'], 'unknown')
        for url in ('', URL.replace('wxpay:', 'https:'), URL + '&sendid=456',
                    URL.replace('sendid=123', 'sendid=x'), URL + '#private',
                    URL.replace('/receivehongbao?', '/receipt?')):
            payment = event(xml(kind='2001', url=url))['payment']
            self.assertIsNone(payment['paymentReference'])
            self.assertEqual(payment['messageState'], 'unknown')

    def test_queue_deduplicates_message_identity_without_losing_equal_amounts(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = EventJournal(pathlib.Path(directory) / 'events.db')
            try:
                self.assertIsNotNone(journal.append(event(xml())))
                self.assertIsNone(journal.append(event(xml())))
                self.assertIsNotNone(journal.append(event(xml(), message_id='124')))
                values = journal.read()['events']
                self.assertEqual(len(values), 2)
                self.assertNotIn('PRIVATE', json.dumps(values))
                self.assertEqual([v['messageId'] for v in values], ['123', '124'])
            finally:
                journal.close()


if __name__ == '__main__':
    unittest.main()
