"""Classify bounded native observations and correlate local receipt evidence.

Never treats a default native retcode of zero as proof of settlement. This is a
read-only decoder, not a payment adapter or authorization to submit a receipt.
"""
import re


def receipt_observation(native, incoming, receipt):
    unknown = {'state': 'unverified', 'amount': None, 'amountMinor': None,
               'currency': None, 'settlementVerified': False}
    if not all(isinstance(value, dict) for value in (native, incoming, receipt)):
        return unknown
    if native.get('stage') != 2 or type(native.get('transportCode')) is not int:
        return unknown
    if native['transportCode'] != 0:
        return dict(unknown, state='transport_failed')
    code = native.get('returnCode')
    if not isinstance(code, str) or not re.fullmatch(r'-?[0-9]{1,15}', code):
        return unknown
    if int(code) != 0:
        return dict(unknown, state='native_rejected')
    ref = incoming.get('paymentReference')
    amount = incoming.get('amountMinor')
    if (incoming.get('kind') != 'transfer' or receipt.get('kind') != 'transfer'
            or incoming.get('messageState') != 'transfer_notice'
            or receipt.get('messageState') != 'receipt_notice'
            or not isinstance(ref, str) or not re.fullmatch('[0-9a-f]{64}', ref)
            or receipt.get('paymentReference') != ref
            or incoming.get('currency') != 'CNY' or receipt.get('currency') != 'CNY'
            or type(amount) is not int or amount <= 0
            or type(receipt.get('amountMinor')) is not int
            or receipt['amountMinor'] != amount):
        return unknown
    return {'state': 'receipt_observed', 'amount': f'{amount // 100}.{amount % 100:02d}',
            'amountMinor': amount, 'currency': 'CNY', 'settlementVerified': False}
