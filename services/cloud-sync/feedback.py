"""User-submitted reports only. No automatic telemetry or credential collection."""
import json
import re
import time
import uuid


def redact(value):
    value=re.sub(r'(?i)("(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"',r'\1"[redacted]"',value)
    value=re.sub(r'(?i)(https?://)[^\s/@:]+:[^\s/@]+@',r'\1[redacted]@',value)
    value=re.sub(r'(?i)(bearer\s+)[^\s"<>]+',r'\1[redacted]',value)
    value=re.sub(r'\bsk-[A-Za-z0-9_-]{12,}', '[redacted]', value)
    value=re.sub(r'(?i)((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\s*[=:]\s*)(?:"[^"]*"|\x27[^\x27]*\x27|[^\s,;&]+)',r'\1[redacted]',value)
    value=re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----','[redacted private key]',value)
    return value


class Feedback:
    def __init__(self, service, failure):
        self.s,self.F=service,failure
        with service.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,created REAL NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL)')

    def submit(self, body):
        if set(body)-{'id','message','version','platform','diagnostic','contact'}:
            raise self.F(400,'反馈字段不正确')
        try:
            identity=str(uuid.UUID(body.get('id')))
        except (ValueError,TypeError,AttributeError):raise self.F(400,'反馈编号不正确')
        clean={'id':identity}
        for key,limit in [('message',6000),('version',40),('platform',40),('diagnostic',12000),('contact',254)]:
            value=body.get(key,'')
            if not isinstance(value,str) or len(value)>limit or (key in ('message','version','platform') and not value.strip()):
                raise self.F(400,'请填写有效的反馈内容、版本和平台')
            clean[key]=redact(value.strip())
        payload=json.dumps(clean,ensure_ascii=False,sort_keys=True)
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            existing=db.execute('SELECT payload FROM feedback WHERE id=?',(identity,)).fetchone()
            if existing:
                if existing[0]!=payload:raise self.F(409,'反馈编号已使用，请新建反馈')
            else:
                if db.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]>=100000:
                    raise self.F(503,'反馈服务暂时繁忙，请稍后重试')
                db.execute('INSERT INTO feedback VALUES(?,?,?,?)',(identity,time.time(),payload,'new'))
        return {'id':identity,'received':True}

    def list(self):
        with self.s.db() as db:
            rows=db.execute('SELECT created,payload,status FROM feedback ORDER BY created DESC LIMIT 200').fetchall()
        return {'reports':[dict(json.loads(p),createdAt=t,status=s) for t,p,s in rows]}

    def update_status(self, body):
        identity, previous, status, reason = (body.get(k) for k in ('id','previousStatus','status','reason'))
        states=('new','investigating','resolved','closed')
        if set(body)!={'id','previousStatus','status','reason'} or not isinstance(identity,str) or previous not in states or status not in states or not isinstance(reason,str) or not 2<=len(reason.strip())<=300:
            raise self.F(400,'请填写有效状态与处理说明')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT status FROM feedback WHERE id=?',(identity,)).fetchone()
            if not row:raise self.F(404,'反馈不存在')
            if row[0]!=previous:raise self.F(409,'反馈状态已变化，请刷新后重试')
            if previous!=status:
                db.execute('UPDATE feedback SET status=? WHERE id=?',(status,identity))
                db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),'', 'feedback.status',json.dumps({'id':identity,'before':previous,'after':status,'reason':redact(reason.strip())},ensure_ascii=False)))
        return {'id':identity,'status':status}
