"""Read-only transfer card metadata; never claims settlement or exposes payment tickets."""
import hashlib
import json
import re


def transfer_card(app):
    kind = app.findtext('type')
    if kind not in ('2000', '2001'):
        return None
    pay = app.find('wcpayinfo')
    if pay is None:
        return None
    if kind == '2001':
        return {'kind': 'red_packet', 'amount': None, 'amountMinor': None,
                'currency': None, 'amountSource': None,
                'amountAvailability': 'not_present_in_message',
                'messageState': 'red_packet_notice', 'settlementStatus': 'unverified',
                'receiveSupported': False}
    display = (pay.findtext('feedesc') or '').strip()
    match = re.fullmatch(r'[￥¥]([0-9]{1,12})\.([0-9]{2})', display)
    subtype = pay.findtext('paysubtype') or ''
    identifiers = [pay.findtext(name) or '' for name in ('transferid', 'transcationid')]
    reference = hashlib.sha256(json.dumps(identifiers, separators=(',', ':')).encode()).hexdigest() if all(0 < len(x) <= 512 for x in identifiers) else None
    return {
        'kind': 'transfer',
        'amount': f'{int(match[1])}.{match[2]}' if match else None,
        'amountMinor': int(match[1]) * 100 + int(match[2]) if match else None,
        'currency': 'CNY' if match else None,
        'amountSource': 'message.wcpayinfo.feedesc' if match else None,
        'nativePaySubtype': subtype if re.fullmatch(r'[0-9]{1,6}', subtype) else None,
        'paymentReference': reference,
        'messageState': {'1': 'transfer_notice', '3': 'receipt_notice'}.get(subtype, 'unknown'),
        'settlementStatus': 'unverified',
        'receiveSupported': False,
    }
