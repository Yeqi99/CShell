"""Offline transfer workflow; no native receipt or message execution is registered.

An adapter must provide authoritative receipt evidence before a notification is
prepared. A local payment card or native function return alone is insufficient.
"""
import re
import sqlite3
from .contracts import require, fingerprint, identifier


class TransferFlow:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('''CREATE TABLE IF NOT EXISTS transfer_flow (
            key TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL)''')
        self.db.commit()

    def close(self):
        self.db.close()

    @staticmethod
    def identity(account, sender, card):
        identifier(account)
        identifier(sender)
        require(account != sender and sender.startswith('wxid_') and account.startswith('wxid_'),
                'INVALID_TARGET', 'Require a private incoming transfer')
        ref = card.get('paymentReference')
        amount = card.get('amountMinor')
        require(card.get('kind') == 'transfer' and card.get('messageState') == 'transfer_notice'
                and card.get('currency') == 'CNY' and type(amount) is int and amount > 0
                and isinstance(ref, str) and re.fullmatch('[0-9a-f]{64}', ref),
                'INVALID_TRANSFER', 'Require a recognized transfer with amount and reference')
        key = fingerprint([account, ref])
        digest = fingerprint([account, sender, ref, amount, 'CNY'])
        return key, digest

    def claim_submission(self, account, sender, card):
        """Atomically claim one explicit submission; unknown is never retryable.

        Call only after validation/authorization and immediately before native
        dispatch. This method does not send money, accept it, or send messages.
        """
        key, digest = self.identity(account, sender, card)
        # Reserve durably before a future adapter submits anything. An interrupted
        # submission remains unknown and must be reconciled, never blindly retried.
        with self.db:
            inserted = self.db.execute('INSERT OR IGNORE INTO transfer_flow VALUES (?,?,?)',
                                       (key, digest, 'receipt_unknown')).rowcount == 1
            row = self.db.execute('SELECT digest,status FROM transfer_flow WHERE key=?', (key,)).fetchone()
            require(row[0] == digest, 'IDEMPOTENCY_CONFLICT', 'Transfer identity or amount changed')
        return {'key': key, 'status': row[1], 'newSubmission': inserted}

    def reserve(self, account, sender, card):
        return self.claim_submission(account, sender, card)

    def lookup(self, account, sender, card):
        """Read status without reserving a transfer or authorizing dispatch."""
        key, digest = self.identity(account, sender, card)
        row = self.db.execute('SELECT digest,status FROM transfer_flow WHERE key=?', (key,)).fetchone()
        if row is None:
            return {'key': key, 'status': 'not_submitted', 'newSubmission': False}
        require(row[0] == digest, 'IDEMPOTENCY_CONFLICT', 'Transfer identity or amount changed')
        return {'key': key, 'status': row[1], 'newSubmission': False}

    def confirm(self, account, sender, card, evidence):
        state = self.lookup(account, sender, card)
        require(evidence.get('source') == 'native_receipt_response'
                and evidence.get('status') == 'received'
                and evidence.get('accountId') == account
                and evidence.get('senderId') == sender
                and evidence.get('paymentReference') == card['paymentReference']
                and type(evidence.get('amountMinor')) is int
                and evidence.get('amountMinor') == card['amountMinor']
                and evidence.get('currency') == 'CNY',
                'RECEIPT_UNVERIFIED', 'Receipt response must match account, sender, reference and amount')
        require(state['status'] != 'not_submitted', 'NOT_SUBMITTED', 'No submission exists to reconcile')
        with self.db:
            self.db.execute("UPDATE transfer_flow SET status='received' WHERE key=? AND status='receipt_unknown'",
                            (state['key'],))
        return state['key']

    def notification(self, account, sender, card):
        state = self.lookup(account, sender, card)
        # A compare-and-set prevents duplicate notifications across callers/restarts.
        with self.db:
            changed = self.db.execute("UPDATE transfer_flow SET status='notification_unknown' WHERE key=? AND status='received'",
                                      (state['key'],)).rowcount
        if not changed:
            return None
        amount = card['amountMinor']
        return {'recipient': sender, 'text': f'已自动领取{amount // 100}.{amount % 100:02d}元',
                'idempotencyKey': 'transfer_' + state['key']}

    def notification_delivered(self, key):
        with self.db:
            self.db.execute("UPDATE transfer_flow SET status='notified' WHERE key=? AND status='notification_unknown'", (key,))
