"""Audited additive storage grants; existing plan allowances are never reduced."""
import json
import time

MAX_STORAGE = 256 * 1024 * 1024


class Quotas:
    def __init__(self, service, failure):
        self.s, self.F = service, failure
        with service.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS storage_grants(id TEXT PRIMARY KEY,account TEXT NOT NULL,bytes INTEGER NOT NULL,expires REAL NOT NULL)')

    def allowance(self, db, account, base):
        extra = db.execute('SELECT COALESCE(SUM(bytes),0) FROM storage_grants WHERE account=? AND expires>?', (account,time.time())).fetchone()[0]
        return min(MAX_STORAGE, base + extra)

    def grant(self, body):
        identity, account = body.get('id'), body.get('account')
        amount, expires, reason = body.get('bytes'), body.get('expiresAt'), body.get('reason')
        if (not isinstance(identity,str) or not 8 <= len(identity) <= 128 or
            not isinstance(account,str) or type(amount) is not int or not 0 < amount <= MAX_STORAGE or
            type(expires) not in (int,float) or not time.time() < expires <= time.time()+3660*86400 or
            not isinstance(reason,str) or not 2 <= len(reason.strip()) <= 300):
            raise self.F(400,'扩容参数不正确')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():
                raise self.F(404,'账号不存在')
            old=db.execute('SELECT account,bytes,expires FROM storage_grants WHERE id=?',(identity,)).fetchone()
            if old:
                if old != (account,amount,expires):raise self.F(409,'扩容请求标识已使用')
                return {'ok':True,'replayed':True}
            member=db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone()
            base=64*1024*1024 if member and member[0]>time.time() else 2*1024*1024
            if self.allowance(db,account,base)+amount > MAX_STORAGE:
                raise self.F(400,'超出当前服务可支持的存储容量')
            db.execute('INSERT INTO storage_grants VALUES(?,?,?,?)',(identity,account,amount,expires))
            db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),account,'storage.grant',json.dumps({'id':identity,'bytes':amount,'expiresAt':expires,'reason':reason.strip()},ensure_ascii=False)))
        return {'ok':True,'replayed':False}
