import base64
import unittest
from cshell_wechat.friend_detail import decode_detail
from cshell_wechat.contracts import BridgeError


def decode(data):
    return decode_detail({'detailBase64': base64.b64encode(data).decode('ascii')})


class FriendDetail(unittest.TestCase):
    def test_nested_fields_and_flags_do_not_infer_request_state(self):
        result = decode(bytes.fromhex('0a09080112036162631803100118002001'))
        self.assertEqual(result['messages'][0]['rawFields'],
                         {'1': '1', '2': {'base64': 'YWJj', 'utf8': 'abc'}, '3': 3})
        self.assertEqual(result['rawFlags'], {'2': 1, '3': 0, '4': 1})
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(result['actions'], [])

    def test_duplicates_use_last_scalar_and_preserve_repeated_messages(self):
        result = decode(bytes.fromhex('100010010a000a00'))
        self.assertEqual(result['rawFlags'], {'2': 1})
        self.assertEqual(len(result['messages']), 2)

    def test_unknown_wire_fields_are_reported(self):
        result = decode(bytes.fromhex('2a036162631500000000'))
        self.assertEqual([x['number'] for x in result['unknownFields']], [5, 2])
        self.assertFalse(result['completeInterpretation'])

    def test_binary_content_does_not_require_utf8(self):
        result = decode(bytes.fromhex('0a031201ff'))
        self.assertEqual(result['messages'][0]['rawFields']['2'], {'base64': '/w=='})

    def test_64_bit_integer_is_not_rounded(self):
        result = decode(bytes.fromhex('0a0b08ffffffffffffffffff01'))
        self.assertEqual(result['messages'][0]['rawFields']['1'], str(2**64-1))

    def test_malformed_and_oversized_inputs(self):
        for data in (b'\x00', b'\x80', b'\x0a\x02\x00', b'\x0b', b'\x10'+b'\xff'*10,
                     b'\x0a\x00'*257, b'\x10\x00'*4097, b'\x00'*65537):
            with self.subTest(data=data[:12]), self.assertRaises(BridgeError):
                decode(data)
        with self.assertRaises(BridgeError):
            decode_detail({'detailBase64': '***'})
