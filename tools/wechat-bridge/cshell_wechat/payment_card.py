"""Read-only transfer card metadata; never claims settlement or exposes payment tickets."""
import hashlib
import json
import re
from urllib.parse import parse_qs, urlsplit


def red_packet_reference(pay):
    """Match the verified read-only identity mapping, never expose the native URL."""
    url = (pay.findtext('nativeurl') or '').strip()
    if not 1 <= len(url) <= 8192:
        return None
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'wxpay' or parsed.netloc != 'c2cbizmessagehandler'
                or parsed.path != '/hongbao/receivehongbao' or parsed.fragment):
            return None
        params = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True,
                          max_num_fields=32)
        values = []
        for name in ('sendid', 'channelid', 'msgtype'):
            items = params.get(name, [])
            if len(items) != 1 or not re.fullmatch(r'[0-9]{1,128}', items[0]):
                return None
            values.append(items[0])
        return hashlib.sha256(json.dumps(['red_packet', *values],
                                        separators=(',', ':')).encode()).hexdigest()
    except (ValueError, TypeError):
        return None


def transfer_card(app):
    kind = app.findtext('type')
    if kind not in ('2000', '2001'):
        return None
    pay = app.find('wcpayinfo')
    if pay is None:
        return None
    if kind == '2001':
        reference = red_packet_reference(pay)
        subtype = pay.findtext('paysubtype') or ''
        return {'kind': 'red_packet', 'amount': None, 'amountMinor': None,
                'currency': None, 'amountSource': None,
                'amountAvailability': 'not_present_in_message',
                'paymentReference': reference,
                'messageState': 'red_packet_notice' if reference and subtype in ('', '1') else 'unknown',
                'settlementStatus': 'unverified',
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
