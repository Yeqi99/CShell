"""Account-owned canp.site namespaces; credentials never leave this service."""
import hashlib, ipaddress, json, os, re, time, urllib.request, urllib.error, uuid
from datetime import datetime, timezone, timedelta

class CloudflareDNS:
    ZONE = 'ea6bf97000a0e2c3353f4f6d07cafeb4'
    def _request(self, method, suffix='', body=None):
        token = os.environ.get('CF_CANP_SITE_TOKEN', '')
        if not token: raise RuntimeError('DNS service unavailable')
        req = urllib.request.Request('https://api.cloudflare.com/client/v4/zones/'+self.ZONE+'/dns_records'+suffix,
            data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=15) as response: result=json.load(response)
        except urllib.error.HTTPError as error:
            if method=='DELETE' and error.code==404: return {}
            raise RuntimeError('DNS provider request failed') from None
        if not result.get('success'): raise RuntimeError('DNS provider request failed')
        return result.get('result')
    def put(self, record, provider_id, operation):
        # The marker reconciles a provider success followed by a local transaction failure.
        marker='cshell:'+operation
        if not provider_id:
            from urllib.parse import urlencode
            matches=self._request('GET','?'+urlencode({'name':record['name'],'per_page':100}))
            provider_id=next((x['id'] for x in matches if x.get('comment')==marker),None)
        return self._request('PUT' if provider_id else 'POST','/'+provider_id if provider_id else '',dict(record,comment=marker))['id']
    def move(self, patches):
        self._request('POST','/batch',{'patches':patches})
    def delete(self, provider_id): self._request('DELETE','/'+provider_id)

class Domains:
    RESERVED=frozenset(('www api admin mail smtp imap pop ftp ns ns1 ns2 dns root support status docs downloads cdn static assets auth login account accounts billing pay mcp relay cloud cshell cagent canp localhost test staging dev www2 '
                        'mc administrator admins console panel management dashboard webmail oauth sso nameserver sysadmin superadmin operator manage postmaster abuse security webmaster').split())
    def __init__(self, service, Failure, adapter=None, clock=time.time):
        self.s,self.F,self.dns,self.clock=service,Failure,adapter or CloudflareDNS(),clock
        with service.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS member_domains(prefix TEXT PRIMARY KEY, account TEXT NOT NULL, retired INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS member_domain_current ON member_domains(account) WHERE retired=0;
CREATE TABLE IF NOT EXISTS domain_addons(prefix TEXT PRIMARY KEY,account TEXT NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS member_domain_months(account TEXT PRIMARY KEY, month TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS member_dns(id TEXT PRIMARY KEY,account TEXT NOT NULL,prefix TEXT NOT NULL,provider TEXT NOT NULL,record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS member_domain_requests(account TEXT NOT NULL,request TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(account,request));''')
    def _member(self, account):
        if not self.s.profile(account)['membership']['active']: raise self.F(403,'此操作需要有效 Pro 会员；已有域名和 DNS 保留')
    def _prefix(self,value):
        if not isinstance(value,str): raise self.F(400,'域名前缀无效')
        value=value.strip().lower()
        if value in self.RESERVED: raise self.F(400,'此前缀为平台保留名称，请选择其他前缀')
        if not re.fullmatch(r'[a-z][a-z0-9-]{1,30}[a-z0-9]',value) or value.startswith('xn--'): raise self.F(400,'域名前缀需为 3–32 位字母、数字或连字符，且不能以 xn-- 开头')
        return value
    def _month(self): return datetime.fromtimestamp(self.clock(),timezone(timedelta(hours=8))).strftime('%Y-%m')
    def _request(self,db,account,body,operation):
        request=body.get('requestId')
        if not isinstance(request,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',request): raise self.F(400,'需要有效 requestId')
        digest=hashlib.sha256(json.dumps([operation,body],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        row=db.execute('SELECT digest,result FROM member_domain_requests WHERE account=? AND request=?',(account,request)).fetchone()
        if row and row[0]!=digest: raise self.F(409,'requestId 已用于不同操作')
        return request,digest,json.loads(row[1]) if row else None
    def _save(self,db,account,request,digest,result):
        db.execute('INSERT INTO member_domain_requests VALUES(?,?,?,?)',(account,request,digest,json.dumps(result)))
        return result
    def list(self,account):
        with self.s.db() as db:
            domains=[{'prefix':p,'domain':p+'.canp.site','retired':bool(r)} for p,r in db.execute('SELECT prefix,retired FROM member_domains WHERE account=? ORDER BY retired,created',(account,))]
            domains.extend(dict(prefix=p,domain=p+'.canp.site',retired=end<=self.clock(),expires=end,addon=True) for p,end in db.execute('SELECT prefix,expires FROM domain_addons WHERE account=? ORDER BY prefix',(account,)))
            records=[dict(json.loads(r),id=i,prefix=p) for i,p,r in db.execute('SELECT id,prefix,record FROM member_dns WHERE account=?',(account,))]
            month=db.execute('SELECT month FROM member_domain_months WHERE account=?',(account,)).fetchone()
        active=bool(self.s.profile(account)['membership']['active'])
        allowed=not month or month[0]!=self._month()
        now=datetime.fromtimestamp(self.clock(),timezone(timedelta(hours=8)))
        next_month=now.replace(year=now.year+(now.month==12),month=1 if now.month==12 else now.month+1,day=1,hour=0,minute=0,second=0,microsecond=0)
        current=next((d['domain'] for d in domains if not d['retired']),None)
        return dict(domains=domains,records=records,namespace=current,membershipActive=active,renameAvailable=active and allowed,nextRenameAt=None if allowed else next_month.timestamp(),timezone='Asia/Shanghai',capabilities=dict(read=True,claim=active and current is None,rename=active and allowed and current is not None,writeDns=active and current is not None,deleteDns=True),recordLimit=int(os.environ.get('MEMBER_DNS_RECORD_LIMIT','100')))
    def move_records(self, db, account, previous, prefix):
        old_suffix=previous+'.canp.site'
        new_suffix=prefix+'.canp.site'
        patches=[]
        for identity,provider,raw in db.execute('SELECT id,provider,record FROM member_dns WHERE account=? AND prefix=?',(account,previous)).fetchall():
            record=json.loads(raw)
            record['name']=record['name'][:-len(old_suffix)]+new_suffix
            patch={'id':provider,'name':record['name']}
            target=record['content'].lower().rstrip('.')
            if record['type'] in ('CNAME','MX') and (target==old_suffix or target.endswith('.'+old_suffix)):
                record['content']=target[:-len(old_suffix)]+new_suffix
                patch['content']=record['content']
            patches.append(patch)
            db.execute('UPDATE member_dns SET prefix=?,record=? WHERE id=?',(prefix,json.dumps(record),identity))
        if patches:
            try:self.dns.move(patches)
            except Exception:raise self.F(503,'解析迁移未确认，请使用相同请求重试') from None

    def claim(self,account,body):
        self._member(account);prefix=self._prefix(body.get('prefix'))
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE');request,digest,prior=self._request(db,account,body,'claim')
            if prior is not None:return prior
            current=db.execute('SELECT prefix FROM member_domains WHERE account=? AND retired=0',(account,)).fetchone()
            owner=db.execute('SELECT account,retired FROM member_domains WHERE prefix=?',(prefix,)).fetchone()
            if current and current[0]==prefix:return self._save(db,account,request,digest,dict(domain=prefix+'.canp.site',changed=False))
            if owner or db.execute('SELECT 1 FROM domain_addons WHERE prefix=?',(prefix,)).fetchone():raise self.F(409,'此前缀已被认领或保留')
            month=self._month();last=db.execute('SELECT month FROM member_domain_months WHERE account=?',(account,)).fetchone()
            if current and last and last[0]==month:raise self.F(429,'每个自然月最多修改一次域名前缀（北京时间）')
            if current:
                self.move_records(db, account, current[0], prefix)
                db.execute('UPDATE member_domains SET retired=1 WHERE account=? AND retired=0',(account,))
                db.execute('INSERT OR REPLACE INTO member_domain_months VALUES(?,?)',(account,month))
            db.execute('INSERT INTO member_domains VALUES(?,?,0,?)',(prefix,account,self.clock()))
            return self._save(db,account,request,digest,dict(domain=prefix+'.canp.site',changed=True,oldDomain=current[0]+'.canp.site' if current else None))
    def buy(self,account,body):
        self._member(account)
        prefix=self._prefix(body.get('prefix'))
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            request,digest,prior=self._request(db,account,body,'domain-addon')
            if prior:return prior
            if not db.execute('SELECT 1 FROM member_domains WHERE account=? AND retired=0',(account,)).fetchone():raise self.F(409,'请先领取会员域名')
            owner=db.execute('SELECT account,expires FROM domain_addons WHERE prefix=?',(prefix,)).fetchone()
            if (owner and owner[0]!=account) or db.execute('SELECT 1 FROM member_domains WHERE prefix=?',(prefix,)).fetchone():raise self.F(409,'域名已被使用')
            if self.s.rentals.balance(db,account)<1000:raise self.F(409,'点数不足，需要 1000 点')
            end=max(self.clock(),owner[1] if owner else 0)+30*86400
            db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'domain:'+request,-1000))
            db.execute('INSERT OR REPLACE INTO domain_addons VALUES(?,?,?)',(prefix,account,end))
            return self._save(db,account,request,digest,dict(expires=end,domain=prefix+'.canp.site'))
    def expire(self):
        while True:
            try:
                with self.s.db() as db:
                    db.execute('BEGIN IMMEDIATE')
                    expired=db.execute('SELECT id,provider FROM member_dns JOIN domain_addons USING(prefix,account) WHERE expires<=? LIMIT 1',(self.clock(),)).fetchone()
                    if expired:
                        self.dns.delete(expired[1])
                        db.execute('DELETE FROM member_dns WHERE id=?',(expired[0],))
            except Exception:
                time.sleep(60)
                continue
            time.sleep(1 if expired else 60)
    def _record(self,prefix,body):
        name=body.get('name','@');kind=body.get('type','');content=body.get('content');ttl=body.get('ttl',1)
        if not isinstance(kind,str):raise self.F(400,'DNS 类型无效')
        kind=kind.upper()
        apex=prefix+'.canp.site'
        if name=='@':name=apex
        elif isinstance(name,str) and name and '.' not in name:name=name+'.'+apex
        if not isinstance(name,str):raise self.F(400,'DNS 名称无效')
        name=name.lower().rstrip('.')
        if name!=apex and not name.endswith('.'+apex):raise self.F(403,'只能管理自己域名及下级域名')
        if len(name)>253 or any(not re.fullmatch(r'(?:\*|_?[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?)',p) for p in name.split('.')) or '*' in name[1:]:raise self.F(400,'DNS 名称无效')
        if kind not in ('A','AAAA','CNAME','TXT','MX'):raise self.F(400,'不支持该 DNS 类型')
        if not isinstance(content,str) or not 1<=len(content)<=2048 or '\x00' in content:raise self.F(400,'DNS 内容无效')
        if type(ttl)!=int or (ttl!=1 and not 60<=ttl<=86400):raise self.F(400,'TTL 无效')
        if kind in ('A','AAAA'):
            try:
                addr=ipaddress.ip_address(content)
                if addr.version!=(4 if kind=='A' else 6):raise ValueError()
            except ValueError:raise self.F(400,'IP 地址无效') from None
        if kind in ('CNAME','MX') and (len(content)>253 or not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?',content)):raise self.F(400,'目标域名无效')
        record=dict(name=name,type=kind,content=content,ttl=ttl,proxied=False)
        if kind=='MX':
            priority=body.get('priority',10)
            if type(priority)!=int or not 0<=priority<=65535:raise self.F(400,'MX 优先级无效')
            record['priority']=priority
        return record
    def write(self,account,body):
        self._member(account)
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE');request,digest,prior=self._request(db,account,body,'write')
            if prior is not None:return prior
            identity=body.get('id');old=None
            if identity is not None and (not isinstance(identity,str) or len(identity)>100):raise self.F(400,'DNS 记录标识无效')
            if identity:
                old=db.execute('SELECT prefix,provider FROM member_dns WHERE id=? AND account=?',(identity,account)).fetchone()
                if not old:raise self.F(404,'DNS 记录不存在')
            prefix=self._prefix(old[0] if old else body.get('prefix'))
            owned=db.execute('SELECT retired FROM member_domains WHERE prefix=? AND account=?',(prefix,account)).fetchone()
            if not owned:
                owned=db.execute('SELECT expires<=? FROM domain_addons WHERE prefix=? AND account=?',(self.clock(),prefix,account)).fetchone()
            if not owned:raise self.F(403,'域名不属于此账号')
            if owned[0]:raise self.F(409,'旧前缀仅保留现有 DNS，可查看或删除；请在新域名创建记录')
            if not old and db.execute('SELECT count(*) FROM member_dns WHERE account=?',(account,)).fetchone()[0]>=int(os.environ.get('MEMBER_DNS_RECORD_LIMIT','100')):raise self.F(429,'DNS 记录数量已达上限')
            record=self._record(prefix,body);identity=identity or str(uuid.uuid4())
            operation=hashlib.sha256((account+':'+request).encode()).hexdigest()
            try:provider=self.dns.put(record,old[1] if old else None,operation)
            except Exception:raise self.F(503,'DNS 服务暂不可用，请使用相同 requestId 重试') from None
            db.execute('INSERT OR REPLACE INTO member_dns VALUES(?,?,?,?,?)',(identity,account,prefix,provider,json.dumps(record)))
            return self._save(db,account,request,digest,dict(record,id=identity,prefix=prefix))
    def delete(self,account,body):
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE');request,digest,prior=self._request(db,account,body,'delete')
            if prior is not None:return prior
            identity=body.get('id')
            if not isinstance(identity,str) or not 1<=len(identity)<=100:raise self.F(400,'DNS 记录标识无效')
            row=db.execute('SELECT provider FROM member_dns WHERE id=? AND account=?',(identity,account)).fetchone()
            if not row:raise self.F(404,'DNS 记录不存在')
            try:self.dns.delete(row[0])
            except Exception:raise self.F(503,'DNS 服务暂不可用，请使用相同 requestId 重试') from None
            db.execute('DELETE FROM member_dns WHERE id=? AND account=?',(body['id'],account))
            return self._save(db,account,request,digest,{'ok':True})
