import hashlib
import json
import re
from collections import OrderedDict

class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code

def require(condition, code, message):
    if not condition:
        raise BridgeError(code, message)

def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"(?:wxid_[A-Za-z0-9_]{3,64}|[0-9]{5,32}@chatroom)", value),
            "INVALID_TARGET", "Use an exact resolved internal contact or room ID")
    return value

def text_request(params):
    recipient = identifier(params.get("recipient"))
    text = params.get("text")
    require(isinstance(text, str) and 0 < len(text.encode("utf8")) <= 4096 and "\0" not in text,
            "INVALID_TEXT", "Text must contain 1..4096 UTF-8 bytes without NUL")
    key = params.get("idempotencyKey")
    require(isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key),
            "INVALID_KEY", "An 8..128 character idempotency key is required")
    return recipient, text, key

def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

class EventWindow:
    """Bounded retention with an explicit gap; never dedupe equal text alone."""
    def __init__(self, capacity=256):
        self.capacity = capacity
        self.sequence = 0
        self.items = []
        self.seen = OrderedDict()
        self.dropped = 0

    def push(self, event):
        mid = event.get("messageId")
        key = (event.get("conversationId"), mid) if mid and mid != "0" else None
        if key and key in self.seen:
            return False
        if key:
            self.seen[key] = True
            if len(self.seen) > self.capacity * 2:
                self.seen.popitem(last=False)
        self.sequence += 1
        self.items.append(dict(event, sequence=self.sequence))
        if len(self.items) > self.capacity:
            self.items.pop(0)
            self.dropped += 1
        return True

    def result(self):
        return {"events": self.items, "dropped": self.dropped, "gap": self.dropped > 0,
                "nextSequence": self.sequence + 1, "historyReplay": False}

def normalize(raw):
    """Preserve unverified fields; do not guess XML/media or group member identities."""
    source, destination, member = raw.get("from", ""), raw.get("to", ""), raw.get("member", "")
    group = next((x for x in (source, destination) if x.endswith("@chatroom")), None)
    sender = member if group and member.startswith("wxid_") else source if not group else None
    return {"conversationId": group or source, "conversationType": "group" if group else "private",
            "senderId": sender, "recipientId": destination, "messageId": raw.get("messageId"),
            "nativeType": raw.get("type"), "text": raw.get("text"),
            "rawIdentityFields": {"from": source, "to": destination, "member": member},
            "timestampRaw": raw.get("timestamp"), "direction": "observed", "deliveryConfirmed": False}
