"""CShell encrypted sync service. Python stdlib; isolated DB, no desktop secrets.

Run behind HTTPS reverse proxy on loopback. CF token is scoped to Email Sending.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 12 * 1024 * 1024


class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Service:
    def __init__(self, path, pepper, send_mail):
        self.path, self.pepper, self.send_mail = path, pepper, send_mail
        self.lock = threading.RLock()
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA max_page_count=32768;
            CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS codes(email TEXT PRIMARY KEY,digest TEXT,expires REAL,attempts INTEGER);
            CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,account TEXT,expires REAL);
            CREATE TABLE IF NOT EXISTS vaults(account TEXT PRIMARY KEY,revision INTEGER,envelope TEXT,mutation TEXT);
            CREATE TABLE IF NOT EXISTS limits(bucket TEXT PRIMARY KEY,start REAL,count INTEGER);
            ''')

    @contextmanager
    def db(self):
        with self.lock:
            connection = sqlite3.connect(self.path, timeout=10)
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

    def digest(self, value):
        return hmac.new(self.pepper, value.encode(), hashlib.sha256).hexdigest()

    def limit(self, bucket, count, window):
        now = time.time()
        with self.db() as db:
            db.execute('DELETE FROM limits WHERE start < ?', (now - 86400,))
            row = db.execute('SELECT start,count FROM limits WHERE bucket=?', (bucket,)).fetchone()
            start, used = row if row and now - row[0] < window else (now, 0)
            if used >= count:
                raise Failure(429, '请求过于频繁，请稍后再试')
            db.execute('INSERT OR REPLACE INTO limits VALUES(?,?,?)', (bucket, start, used + 1))

    def email(self, value):
        if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}', value):
            raise Failure(400, '邮箱地址不正确')
        return value.lower()

    def request_code(self, value, ip):
        email = self.email(value)
        allowed = os.environ.get('ALLOWED_EMAILS', '')
        if allowed and email not in [item.strip().lower() for item in allowed.split(',')]:
            raise Failure(403, '云同步当前仅向已邀请的测试账号开放')
        self.limit('mail-ip:' + self.digest(ip), 10, 3600)
        self.limit('mail-minute:' + self.digest(email), 1, 60)
        self.limit('mail-day:' + self.digest(email), 10, 86400)
        self.limit('mail-global', 200, 86400)
        code = str(secrets.randbelow(1000000)).zfill(6)
        digest = self.digest(email + ':' + code)
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO codes VALUES(?,?,?,0)', (email, digest, time.time() + 600))
        try:
            self.send_mail(email, code)
        except Exception:
            with self.db() as db:
                db.execute('DELETE FROM codes WHERE email=? AND digest=?', (email, digest))
            raise Failure(503, '验证码暂时无法投递，请稍后重试')
        return {'sent': True}

    def login(self, value, code, ip):
        email = self.email(value)
        self.limit('login-ip:' + self.digest(ip), 30, 600)
        valid = False
        with self.db() as db:
            row = db.execute('SELECT digest,expires,attempts FROM codes WHERE email=?', (email,)).fetchone()
            if row and row[1] > time.time() and row[2] < 5:
                db.execute('UPDATE codes SET attempts=attempts+1 WHERE email=?', (email,))
                valid = isinstance(code, str) and bool(re.fullmatch(r'\d{6}', code)) and hmac.compare_digest(row[0], self.digest(email + ':' + code))
                if valid:
                    db.execute('DELETE FROM codes WHERE email=?', (email,))
                    db.execute('INSERT OR IGNORE INTO accounts VALUES(?,?)', (secrets.token_hex(16), email))
                    account = db.execute('SELECT id FROM accounts WHERE email=?', (email,)).fetchone()[0]
                    token = secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)', (self.digest(token), account, time.time() + 30 * 86400))
        if not valid:
            raise Failure(401, '验证码无效、过期或尝试次数已用尽')
        return {'accountId': account, 'email': email, 'token': token}

    def authenticate(self, token):
        if not isinstance(token, str) or len(token) != 43:
            raise Failure(401, '请重新登录')
        with self.db() as db:
            row = db.execute('SELECT account FROM sessions WHERE digest=? AND expires>?', (self.digest(token), time.time())).fetchone()
        if not row:
            raise Failure(401, '请重新登录')
        return row[0]

    def read(self, account):
        with self.db() as db:
            row = db.execute('SELECT revision,envelope FROM vaults WHERE account=?', (account,)).fetchone()
        return {'revision': row[0], 'envelope': json.loads(row[1])} if row else {'revision': 0, 'envelope': None}

    def write(self, account, body):
        revision, mutation, envelope = body.get('baseRevision'), body.get('mutationId'), body.get('envelope')
        if type(revision) is not int or revision < 0 or not isinstance(mutation, str) or not re.fullmatch(r'[a-f0-9-]{36}', mutation):
            raise Failure(400, '同步版本不正确')
        if not isinstance(envelope, dict) or set(envelope) != {'format', 'nonce', 'ciphertext'} or envelope['format'] != 1:
            raise Failure(400, '不支持的密文格式')
        try:
            nonce, ciphertext = base64.b64decode(envelope['nonce'], validate=True), base64.b64decode(envelope['ciphertext'], validate=True)
            if len(nonce) != 12 or not 16 <= len(ciphertext) <= 8 * 1024 * 1024 + 16:
                raise ValueError()
        except (ValueError, TypeError):
            raise Failure(400, '密文大小或编码不正确')
        encoded = json.dumps(envelope, separators=(',', ':'))
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision,mutation,envelope FROM vaults WHERE account=?', (account,)).fetchone()
            if row and row[1] == mutation:
                if row[2] != encoded:
                    raise Failure(409, '重复请求内容不一致')
                return {'revision': row[0]}
            if revision != (row[0] if row else 0):
                raise Failure(409, '另一台设备已更新云端，请检查同步冲突')
            db.execute('INSERT OR REPLACE INTO vaults VALUES(?,?,?,?)', (account, revision + 1, encoded, mutation))
        return {'revision': revision + 1}

    def logout(self, token):
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE digest=?', (self.digest(token),))
        return {'ok': True}


def cloudflare_mail(email, code):
    payload = {'from': os.environ['MAIL_FROM'], 'to': email, 'subject': 'CShell 登录验证码',
               'text': f'您的 CShell 验证码为 {code}，10 分钟内有效。请勿向他人透露。如非本人操作，请忽略此邮件。'}
    url = 'https://api.cloudflare.com/client/v4/accounts/' + os.environ['CF_ACCOUNT_ID'] + '/email/sending/send'
    request = urllib.request.Request(url, json.dumps(payload).encode(),
        {'Authorization': 'Bearer ' + os.environ['CF_EMAIL_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
        if not result.get('success') or email not in result.get('result', {}).get('delivered', []) + result.get('result', {}).get('queued', []):
            raise RuntimeError('Mail rejected')


def handler(service):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log bodies, email, codes, tokens or ciphertext.

        def setup(self):
            super().setup()
            self.connection.settimeout(25)

        def dispatch(self):
            try:
                if self.headers.get('Origin'):
                    raise Failure(403, '仅允许原生客户端')
                ip = self.headers.get('X-Real-IP', self.client_address[0])
                service.limit('api:' + service.digest(ip), 120, 60)
                body = {}
                if self.command == 'POST':
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= MAX_BODY or self.headers.get('Transfer-Encoding'):
                        raise Failure(413, '请求大小不正确')
                    body = json.loads(self.rfile.read(size))
                    if not isinstance(body, dict):
                        raise Failure(400, '请求格式不正确')
                if self.command == 'GET' and self.path == '/v1/health':
                    value = {'ok': True, 'protocol': 1, 'mailConfigured': bool(os.environ.get('CF_EMAIL_TOKEN'))}
                elif self.command == 'POST' and self.path == '/v1/auth/code':
                    value = service.request_code(body.get('email'), ip)
                elif self.command == 'POST' and self.path == '/v1/auth/login':
                    value = service.login(body.get('email'), body.get('code'), ip)
                else:
                    token = self.headers.get('Authorization', '').removeprefix('Bearer ')
                    account = service.authenticate(token)
                    if self.path == '/v1/vault' and self.command == 'GET':
                        value = service.read(account)
                    elif self.path == '/v1/vault' and self.command == 'POST':
                        value = service.write(account, body)
                    elif self.path == '/v1/auth/logout' and self.command == 'POST':
                        value = service.logout(token)
                    else:
                        raise Failure(404, '接口不存在')
                self.respond(200, value)
            except Failure as error:
                self.respond(error.status, {'error': error.message})
            except (ValueError, TypeError, KeyError):
                self.respond(400, {'error': '请求格式不正确'})
            except Exception:
                self.respond(503, {'error': '服务暂时不可用'})

        def respond(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        do_GET = dispatch
        do_POST = dispatch
    return Handler


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(16)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


if __name__ == '__main__':
    os.umask(0o077)
    pepper = bytes.fromhex(os.environ['AUTH_PEPPER'])
    if len(pepper) != 32:
        raise RuntimeError('AUTH_PEPPER must contain 32 random bytes')
    service = Service(os.environ.get('SYNC_DB', '/var/lib/cshell-sync/sync.sqlite'), pepper, cloudflare_mail)
    BoundedServer(('127.0.0.1', int(os.environ.get('SYNC_PORT', '8789'))), handler(service)).serve_forever()
