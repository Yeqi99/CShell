"""Account-scoped outbound CShell bridge. Commands/results stay in bounded memory.

This registry does not grant local capabilities. The desktop forwards each call
through a separately configured MCP caller and its existing authorization checks.
"""
import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid


class Bridges:
    METHODS = frozenset(('list_servers_page', 'connect', 'describe_connection', 'invoke_connection', 'disconnect'))

    def __init__(self, service, Failure):
        self.s, self.F = service, Failure
        self.lock = threading.RLock()
        # Leave HTTP worker slots available for polling, replies and account login.
        self.calls = threading.BoundedSemaphore(4)
        self.pending = {}
        with self.s.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS account_mcp_bridges(id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL, secret_digest TEXT NOT NULL, seen REAL NOT NULL)')

    def _owned(self, account, bridge):
        with self.s.db() as db:
            row = db.execute('SELECT secret_digest,seen FROM account_mcp_bridges WHERE id=? AND account=?', (bridge, account)).fetchone()
        if not row:
            raise self.F(404, '连接不存在')
        return row

    def _worker(self, account, body):
        bridge, secret = body.get('bridgeId'), body.get('secret')
        row = self._owned(account, bridge)
        if not isinstance(secret, str) or not hmac.compare_digest(row[0], self.s.digest(secret)):
            raise self.F(403, '连接身份不正确')
        return bridge

    def register(self, account, body):
        self.s.limit('bridge-register:' + account, 30, 60)
        bridge, secret, name = body.get('bridgeId'), body.get('secret'), body.get('name')
        try:
            uuid.UUID(bridge)
        except (ValueError, TypeError, AttributeError):
            raise self.F(400, '连接标识不正确')
        if not isinstance(secret, str) or not 43 <= len(secret) <= 128 or not isinstance(name, str) or not 1 <= len(name) <= 80:
            raise self.F(400, '连接信息不正确')
        digest = self.s.digest(secret)
        with self.s.db() as db:
            row = db.execute('SELECT account,secret_digest FROM account_mcp_bridges WHERE id=?', (bridge,)).fetchone()
            if row and (row[0] != account or not hmac.compare_digest(row[1], digest)):
                raise self.F(409, '连接身份已绑定，禁止覆盖')
            if not row and db.execute('SELECT COUNT(*) FROM account_mcp_bridges WHERE account=?', (account,)).fetchone()[0] >= 100:
                raise self.F(413, '账号连接数量已达上限')
            db.execute('INSERT OR REPLACE INTO account_mcp_bridges VALUES(?,?,?,?,?)', (bridge, account, name, digest, time.time()))
        return {'ok': True}

    def list(self, account):
        with self.s.db() as db:
            rows = db.execute('SELECT id,name,seen FROM account_mcp_bridges WHERE account=?', (account,)).fetchall()
        return {'bridges': [{'id': r[0], 'name': r[1], 'online': r[2] > time.time() - 15} for r in rows]}

    def _prune(self):
        for key, task in list(self.pending.items()):
            if task['expires'] <= time.time():
                task['event'].set()
                del self.pending[key]

    def poll(self, account, body):
        bridge = self._worker(account, body)
        capacity = body.get('capacity', 8)
        if type(capacity) is not int or not 0 <= capacity <= 8:
            raise self.F(400, '请求容量不正确')
        with self.s.db() as db:
            db.execute('UPDATE account_mcp_bridges SET seen=? WHERE id=? AND account=?', (time.time(), bridge, account))
        with self.lock:
            self._prune()
            tasks = []
            for task_id, task in self.pending.items():
                if len(tasks) >= capacity:
                    break
                if task['account'] == account and task['bridge'] == bridge and not task['delivered']:
                    # At most once delivery. Lost responses must not replay commands.
                    task['delivered'] = True
                    tasks.append({'id': task_id, 'consumer': task['consumer'], 'name': task['name'], 'arguments': task['arguments']})
        return {'requests': tasks}

    def reply(self, account, body):
        bridge = self._worker(account, body)
        result = body.get('result')
        if len(json.dumps(result).encode()) > 8 * 1024 * 1024:
            raise self.F(413, '结果过大，请缩小读取范围')
        with self.lock:
            self._prune()
            task = self.pending.get(body.get('id'))
            if not task or task['account'] != account or task['bridge'] != bridge:
                raise self.F(404, '请求不存在或已超时')
            if not task['delivered'] or task['event'].is_set():
                raise self.F(409, '请求状态已改变')
            task['result'] = result
            task['event'].set()
        return {'ok': True}

    def invoke(self, account, consumer, body, timeout=25):
        bridge, name, arguments = body.get('bridgeId'), body.get('name'), body.get('arguments', {})
        row = self._owned(account, bridge)
        if row[1] <= time.time() - 15:
            raise self.F(409, 'CShell 当前离线')
        if name not in self.METHODS or not isinstance(arguments, dict) or len(json.dumps(arguments).encode()) > 65536:
            raise self.F(400, '请求格式不正确')
        self.s.limit('bridge-invoke:' + account, 120, 60)
        if not self.calls.acquire(blocking=False):
            raise self.F(429, '连接服务正在处理其他操作，请稍后重试')
        try:
            return self._wait(account, consumer, bridge, name, arguments, timeout)
        finally:
            self.calls.release()

    def _wait(self, account, consumer, bridge, name, arguments, timeout):
        task_id = secrets.token_hex(24)
        task = dict(account=account, bridge=bridge, consumer=consumer, name=name, arguments=arguments,
                    expires=time.time() + timeout, delivered=False, event=threading.Event())
        with self.lock:
            self._prune()
            if len(self.pending) >= 256 or sum(t['account'] == account for t in self.pending.values()) >= 16:
                raise self.F(429, '待处理操作过多')
            self.pending[task_id] = task
        task['event'].wait(timeout)
        with self.lock:
            self.pending.pop(task_id, None)
            if 'result' not in task:
                raise self.F(504, '操作结果未确认，请检查 CShell；不要自动重试写入操作')
            return task['result']

    def remove(self, account, body):
        bridge = self._worker(account, body)
        with self.s.db() as db:
            db.execute('DELETE FROM account_mcp_bridges WHERE id=? AND account=?', (bridge, account))
        with self.lock:
            for task_id, task in list(self.pending.items()):
                if task['account'] == account and task['bridge'] == bridge:
                    task['event'].set()
                    del self.pending[task_id]
        return {'ok': True}
