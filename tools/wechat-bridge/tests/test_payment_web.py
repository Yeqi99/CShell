import http.client
import json
import threading
import unittest
from cshell_wechat.payment_web import Server, cards


class PaymentWebTest(unittest.TestCase):
    def test_only_incoming_transfers_and_no_raw_content(self):
        target = 'wxid_sender'
        def event(sender, state, kind='transfer'):
            return dict(conversationId=target, senderId=sender, contentStatus='payment-card',
                        text=json.dumps(dict(kind=kind, paymentReference='a'*64,
                                             messageState=state, amountMinor=10, currency='CNY',
                                             rawSecret='not-for-browser')))
        self.assertEqual(cards([event('wxid_self', 'transfer_notice')], target), [])
        result = cards([event(target, 'transfer_notice'), event('wxid_self', 'receipt_notice')], target)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['amount'], '0.10')
        self.assertTrue(result[0]['receiptObserved'])
        self.assertFalse(result[0]['canReceive'])
        self.assertNotIn('not-for-browser', json.dumps(result))
        self.assertEqual(cards([event(target, 'transfer_notice', 'red_packet')], target), [])

    def test_loopback_api_requires_session_and_origin(self):
        class Backend:
            calls = 0
            def snapshot(self):
                self.calls += 1
                return {'cards': []}
        backend = Backend()
        server = Server(backend)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def post(path, headers):
            connection = http.client.HTTPConnection(server.host, timeout=3)
            try:
                connection.request('POST', path, headers=headers)
                response = connection.getresponse()
                response.read()
                return response.status
            finally:
                connection.close()
        headers = {'Origin': 'http://' + server.host, 'X-Session': server.token}
        try:
            self.assertEqual(post('/api/transfers', {}), 403)
            self.assertEqual(post('/api/transfers', dict(headers, Origin='https://example.com')), 403)
            self.assertEqual(post('/api/transfers', dict(headers, Host='evil.example')), 403)
            self.assertEqual(post('/api/transfers', headers), 200)
            self.assertEqual(post('/api/receive', headers), 404)
            self.assertEqual(backend.calls, 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
