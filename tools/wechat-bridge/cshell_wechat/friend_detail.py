"""Bounded offline FMessageDetail wire decoder; no status or action inference."""
import base64
import binascii
from .contracts import require


def _varint(data, at):
    value = 0
    for shift in range(0, 70, 7):
        require(at < len(data), 'INVALID_PROTOBUF', 'Truncated varint')
        byte = data[at]
        at += 1
        require(shift < 63 or byte <= 1, 'INVALID_PROTOBUF', 'Varint overflow')
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, at
    require(False, 'INVALID_PROTOBUF', 'Varint overflow')


def _fields(data):
    at = 0
    count = 0
    while at < len(data):
        count += 1
        require(count <= 4096, 'PAYLOAD_LIMIT', 'Too many wire fields')
        tag, at = _varint(data, at)
        number, wire = tag >> 3, tag & 7
        require(0 < number < 2**29, 'INVALID_PROTOBUF', 'Invalid field number')
        if wire == 0:
            value, at = _varint(data, at)
        else:
            require(wire in (1, 2, 5), 'UNSUPPORTED_WIRE', 'Unsupported wire type')
            if wire == 2:
                length, at = _varint(data, at)
            else:
                length = 8 if wire == 1 else 4
            require(length <= len(data) - at, 'INVALID_PROTOBUF', 'Truncated field')
            value = data[at:at + length]
            at += length
        yield number, wire, value


def _unknown(number, wire, value):
    return {'number': number, 'wireType': wire,
            'byteLength': len(value) if isinstance(value, bytes) else None}


def decode_detail(params):
    encoded = params.get('detailBase64')
    require(isinstance(encoded, str), 'INVALID_FIELD', 'detailBase64 must be a string')
    require(len(encoded) <= 87384, 'PAYLOAD_LIMIT', 'Detail exceeds 64 KiB')
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        require(False, 'INVALID_BASE64', 'Invalid base64 detail')
    require(len(data) <= 65536, 'PAYLOAD_LIMIT', 'Detail exceeds 64 KiB')
    result = {'schema': 'micromsg.FMessageDetail', 'schemaVersion': '4.1.15.50',
              'verification': 'wire-layout-observed-12-records', 'status': 'unknown',
              'rawFlags': {}, 'messages': [], 'unknownFields': [],
              'actions': [], 'completeInterpretation': False}
    for number, wire, value in _fields(data):
        if number in (2, 3, 4) and wire == 0:
            result['rawFlags'][str(number)] = value
        elif number == 1 and wire == 2:
            require(len(result['messages']) < 256, 'PAYLOAD_LIMIT', 'Too many detail messages')
            message = {'rawFields': {}, 'unknownFields': []}
            for child, kind, payload in _fields(value):
                if child in (1, 3, 4) and kind == 0:
                    # Preserve integer precision through JSON clients.
                    message['rawFields'][str(child)] = str(payload) if child == 1 else payload
                elif child == 2 and kind == 2:
                    message['rawFields']['2'] = {'base64': base64.b64encode(payload).decode('ascii')}
                    try:
                        message['rawFields']['2']['utf8'] = payload.decode('utf8')
                    except UnicodeDecodeError:
                        pass
                else:
                    message['unknownFields'].append(_unknown(child, kind, payload))
            result['messages'].append(message)
        else:
            result['unknownFields'].append(_unknown(number, wire, value))
    return result
