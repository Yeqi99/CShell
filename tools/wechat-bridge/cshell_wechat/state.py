import contextlib
import json
import os
import pathlib
import sqlite3
import time
from .contracts import require, fingerprint

def state_dir():
    path = pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "CShell" / "wechat-bridge"
    path.mkdir(parents=True, exist_ok=True)
    return path

def load_policy(path):
    if not path.exists():
        return {"enabled": False, "readContacts": False, "receive": [], "send": []}
    return json.loads(path.read_text(encoding="utf8"))

def authorize(policy, binding, operation, target=None):
    require(policy.get("enabled") is True, "DISABLED", "Enable this adapter explicitly on the target host")
    require(policy.get("binding") == binding, "SESSION_CHANGED", "Process session or module changed; bind again locally")
    if operation == "contacts":
        require(policy.get("readContacts") is True, "NOT_AUTHORIZED", "Contact reading is disabled")
    else:
        require(target in policy.get(operation, []), "NOT_AUTHORIZED", "Target is outside the local allowlist")

@contextlib.contextmanager
def exclusive(path):
    import msvcrt
    with open(path, "a+b") as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b"0"); handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            require(False, "BUSY", "Another bridge operation is active")
        try:
            yield
        finally:
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

class SendJournal:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS sends (key TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL)")

    def reserve(self, scope, key, request):
        scoped = fingerprint([scope, key]); digest = fingerprint(request)
        row = self.db.execute("SELECT digest,status FROM sends WHERE key=?", (scoped,)).fetchone()
        if row:
            require(row[0] == digest, "IDEMPOTENCY_CONFLICT", "Key already used for different parameters")
            return scoped, row[1]
        # Keep all outcomes, including unknown, until explicit local reset. Refuse overflow.
        require(self.db.execute("SELECT COUNT(*) FROM sends").fetchone()[0] < 10000,
                "JOURNAL_FULL", "Archive the local journal before accepting more sends")
        self.db.execute("INSERT INTO sends VALUES (?,?,?,?)", (scoped, digest, "unknown", time.time()))
        self.db.commit()
        return scoped, None

    def finish(self, key, status):
        self.db.execute("UPDATE sends SET status=? WHERE key=?", (status, key)); self.db.commit()

    def close(self):
        self.db.close()
