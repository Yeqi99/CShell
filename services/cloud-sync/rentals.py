"""Account-scoped Pterodactyl leases. Provider secrets are service environment values."""
import base64
import hmac
import json
import math
import secrets
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid

IMAGE = 'ghcr.io/parkervcp/yolks@sha256:3ac7672afa1841a6ee73a4f797d0b7681d5a778579806b9d533894ef49470010'
START = ("/bin/bash -c 'cd /home/container && "
         "if [ -x .cagent-1.1.1/node ]; then exec .cagent-1.1.1/node .cagent-start.cjs; "
         "elif [ -x .cagent-1.1.0/node ]; then exec .cagent-1.1.0/node .cagent-start.cjs; "
         "else exec .cagent-1.0.10/node .cagent-start.cjs; fi'")


BUSINESS_PORTS = 3


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Rentals:
    def __init__(self, service, failure):
        self.service = service
        self.failure = failure
        self.work_lock = threading.Lock()
        with service.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS rental_provider(id INTEGER PRIMARY KEY CHECK(id=1), host TEXT, sealed TEXT);
                CREATE TABLE IF NOT EXISTS rental_plans(id TEXT PRIMARY KEY, details TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS rental_points(account TEXT, reference TEXT, delta INTEGER NOT NULL,
                    PRIMARY KEY(account,reference));
                CREATE TABLE IF NOT EXISTS rentals(id TEXT PRIMARY KEY, account TEXT NOT NULL, request TEXT NOT NULL,
                    plan TEXT NOT NULL, included INTEGER NOT NULL, state TEXT NOT NULL, expires REAL,
                    remote INTEGER, endpoint TEXT, identity TEXT, UNIQUE(account,request));
            """)

            db.executescript("""
              CREATE TABLE IF NOT EXISTS rental_port_conflicts(node INTEGER, allocation INTEGER, PRIMARY KEY(node,allocation));
              CREATE TABLE IF NOT EXISTS rental_changes(machine TEXT, request TEXT, kind TEXT, units INTEGER, points INTEGER,
                PRIMARY KEY(machine,request));
              CREATE TABLE IF NOT EXISTS rental_operators(id TEXT PRIMARY KEY, name TEXT, digest TEXT UNIQUE, plans TEXT);
            """)
            cols={r[1] for r in db.execute('PRAGMA table_info(rentals)')}
            if 'ports' not in cols:
                db.execute('ALTER TABLE rentals ADD COLUMN ports TEXT')
            if 'created' not in cols:
                db.execute('ALTER TABLE rentals ADD COLUMN created REAL')
                db.execute('UPDATE rentals SET created=? WHERE created IS NULL',(time.time(),))
            for col in ('port_extra','extra','applied','cpu_extra','cpu_applied','memory_extra','memory_applied'):
                if col not in cols:db.execute('ALTER TABLE rentals ADD COLUMN '+col+' INTEGER NOT NULL DEFAULT 0')

    def operators(self, body=None):
        with self.service.db() as db:
            if body is None:
                return {'operators':[dict(id=r[0],name=r[1],plans=json.loads(r[2])) for r in db.execute('SELECT id,name,plans FROM rental_operators')]}
            if body.get('revoke'):
                db.execute('DELETE FROM rental_operators WHERE id=?',(body['revoke'],))
                return {'ok':True}
            ids=body.get('plans')
            name=body.get('name')
            if not isinstance(name,str) or not 1<=len(name.strip())<=80 or not isinstance(ids,list) or not 1<=len(ids)<=32 or any(not isinstance(i,str) or not db.execute('SELECT 1 FROM rental_plans WHERE id=?',(i,)).fetchone() for i in ids):
                self.error(400,'请填写服务商名称并选择管理套餐')
            secret=secrets.token_urlsafe(32)
            db.execute('INSERT INTO rental_operators VALUES(?,?,?,?)',(str(uuid.uuid4()),name,self.service.digest('supplier/'+secret),json.dumps(ids)))
            return {'access':secret,'url':'https://shell.canp.ai/machines/'}

    def supplier(self, token, body=None):
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if token is None:
                allowed={r[0] for r in db.execute('SELECT id FROM rental_plans')}
            else:
                row=db.execute('SELECT plans FROM rental_operators WHERE digest=?',(self.service.digest('supplier/'+token),)).fetchone()
                if not row:self.error(403,'机器管理权限无效或已撤销')
                allowed=set(json.loads(row[0]))
            plans=[json.loads(r[0]) for r in db.execute('SELECT details FROM rental_plans') if json.loads(r[0])['id'] in allowed]
            if body and body.get('action') in ('pause','resume'):
                machine=db.execute('SELECT plan,state,remote,included,expires,account,(extra+cpu_extra+memory_extra+port_extra) FROM rentals WHERE id=?',(body.get('id'),)).fetchone()
                if not machine or json.loads(machine[0])['id'] not in allowed:self.error(403,'实例不在授权范围')
                pause=body['action']=='pause'
                if machine[1]!=('ready' if pause else 'paused'):self.error(409,'实例状态已变化')
                end=machine[4]
                if machine[3]:
                    member_end=(db.execute('SELECT expires FROM memberships WHERE account=?',(machine[5],)).fetchone() or [0])[0]
                    end=min(end,member_end) if machine[6] else member_end
                if not pause and end<=time.time():self.error(409,'实例已到期')
                self.panel('servers/%d/%s'%(machine[2],'suspend' if pause else 'unsuspend'),{})
                db.execute('UPDATE rentals SET state=? WHERE id=?',('paused' if pause else 'ready',body['id']))
            elif body:
                p=next((p for p in plans if p['id']==body.get('id')),None)
                if p is None:self.error(403,'套餐不在授权范围')
                for k,limit in [('cpu',12800),('memory',1048576),('disk',10485760)]:
                    if type(body.get(k)) is not int or not 1<=body[k]<=limit:self.error(400,'资源配置无效')
                    p[k]=body[k]
                if type(body.get('enabled')) is not bool:self.error(400,'请选择上架状态')
                p['enabled']=body['enabled']
                db.execute('UPDATE rental_plans SET details=? WHERE id=?',(json.dumps(p),p['id']))
            machines=[dict(id=r[0],plan=json.loads(r[1])['name'],state=r[2],disk=json.loads(r[1])['disk']+r[3]*10240) for r in db.execute('SELECT id,plan,state,extra FROM rentals') if json.loads(r[1])['id'] in allowed]
        return {'plans':[{k:p[k] for k in ('id','name','cpu','memory','disk','enabled')} for p in plans],'machines':machines}

    def change(self, account, body):
        if body.get('kind') == 'ports':
            machine = body.get('id')
            self.connection(account, machine)
            try:
                self.sync_ports(machine)
            except (OSError, KeyError, ValueError):
                self.error(409, '服务商尚未确认全部端口，请稍后重试')
            return {'ok': True}
        machine=body.get('id');kind=body.get('kind');request=body.get('request')
        units=body.get('units',1)
        if kind not in ('expand','cpu','memory','port','renew') or type(units) is not int or not 1<=units<=100 or not isinstance(request,str) or not re.fullmatch(r'[0-9a-f-]{36}',request):
            self.error(400,'变更请求无效')
        now=time.time()
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT plan,included,state,expires,extra,cpu_extra,memory_extra,port_extra FROM rentals WHERE id=? AND account=?',(machine,account)).fetchone()
            if not row:self.error(404,'机器不存在')
            old=db.execute('SELECT kind,units,points FROM rental_changes WHERE machine=? AND request=?',(machine,request)).fetchone()
            if old:
                if old[:2]!=(kind,units):self.error(409,'请求已用于其他变更')
                return {'points':old[2]}
            p=json.loads(row[0]);member,state,expires,extra,cpu_extra,memory_extra,port_extra=row[1:]
            expanded=extra+cpu_extra+memory_extra+port_extra
            if state not in ('ready','expired','paused') or not expires:self.error(409,'实例状态不允许变更')
            member_end=(db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone() or [0])[0]
            if member and member_end<=now:self.error(403,'会员已到期')
            if member and state=='expired' and db.execute("SELECT 1 FROM rentals WHERE account=? AND id<>? AND included=1 AND state NOT IN ('expired','failed')",(account,machine)).fetchone():
                self.error(409,'已有其他会员机器')
            if member and not expanded and state=='ready':expires=member_end
            period=p['days']*86400
            rates={'expand':p.get('expansionPoints',200),'cpu':p.get('cpuPoints',500),'memory':p.get('memoryPoints',500)}
            counts={'expand':extra,'cpu':cpu_extra,'memory':memory_extra}
            rate_period=p.get('expansionDays',p['days'])*86400
            new_end=expires
            if kind!='renew':
                if state!='ready' or expires<=now:self.error(409,'请先续费')
                if (port_extra if kind=='port' else counts[kind])+units>100 or (kind=='cpu' and p['cpu']+100*(cpu_extra+units)>12800):self.error(400,'扩容超过单机上限')
                if member and not expanded:new_end=member_end
                cost=math.ceil(units*200*max(0,new_end-now)/(30*86400)) if kind=='port' else math.ceil(units*rates[kind]*max(0,new_end-now)/rate_period)
            else:
                start=max(now,expires)
                new_end=start+period
                if member:new_end=min(member_end,new_end)
                if new_end<=start:self.error(409,'请先延长会员有效期')
                cost=math.ceil((0 if member else p['points'])*(new_end-start)/period + sum(counts[k]*rates[k] for k in rates)*(new_end-start)/rate_period + port_extra*200*(new_end-start)/(30*86400))
            if body.get('quote') is True:return {'points':cost,'expires':new_end}
            ceiling=body.get('maxPoints')
            if type(ceiling) is not int or cost>ceiling:self.error(409,'价格已变动，请重新确认')
            if self.balance(db,account)<cost:self.error(409,'可用点数不足')
            if kind=='port':db.execute('UPDATE rentals SET port_extra=port_extra+? WHERE id=?',(units,machine))
            db.execute('INSERT INTO rental_changes VALUES(?,?,?,?,?)',(machine,request,kind,units,cost))
            db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'change:'+machine+':'+request,-cost))
            db.execute("UPDATE rentals SET extra=?,cpu_extra=?,memory_extra=?,expires=?,state=? WHERE id=?",(extra+units if kind=='expand' else extra,cpu_extra+units if kind=='cpu' else cpu_extra,memory_extra+units if kind=='memory' else memory_extra,new_end,'resuming' if state=='expired' else state,machine))
        return {'points':cost}

    def error(self, status, message):
        raise self.failure(status, message)

    def cipher(self):
        from cryptography.fernet import Fernet
        return Fernet(base64.urlsafe_b64encode(hmac.digest(self.service.pepper,b'cshell/rental/panel/v1','sha256')))

    def settings(self):
        with self.service.db() as db:
            row=db.execute('SELECT host FROM rental_provider WHERE id=1').fetchone()
            plans=[json.loads(r[0]) for r in db.execute('SELECT details FROM rental_plans ORDER BY id')]
        return {'host':row[0] if row else os.getenv('RENTAL_PANEL_HOST','pl.deviy.cn'),'configured':bool(row or os.getenv('RENTAL_PANEL_KEY')),'plans':plans}

    def configure(self, body):
        host=body.get('host')
        key=body.get('key')
        if host!='pl.deviy.cn' or not isinstance(key,str) or not re.fullmatch(r'ptla_[A-Za-z0-9]{20,128}',key):
            self.error(400,'请填写合作方的 Application API 密钥')
        self.request(host,key,'nodes?per_page=1')
        with self.service.db() as db:
            db.execute('INSERT OR REPLACE INTO rental_provider VALUES(1,?,?)',(host,self.cipher().encrypt(key.encode()).decode()))
        return self.settings()

    def plan(self, body):
        fields = ('id','name','system','cpu','memory','disk','points','days','expansionPoints','egg','node','owner','included','enabled')
        p = {k:body.get(k) for k in fields}
        p['cpuPoints']=body.get('cpuPoints',500)
        p['memoryPoints']=body.get('memoryPoints',500)
        p['expansionDays']=body.get('expansionDays',p['days'])
        p['expansionPoints']=body.get('expansionPoints',200)
        if not isinstance(p['id'],str) or not re.fullmatch(r'[a-z0-9-]{1,40}',p['id']):
            self.error(400,'套餐标识无效')
        if any(not isinstance(p[k],str) or not 1<=len(p[k])<=80 for k in ('name','system')):
            self.error(400,'请填写套餐名称和系统环境')
        for k,maximum in dict(cpu=12800,memory=1048576,disk=10485760,points=100000000,expansionPoints=100000000,cpuPoints=100000000,memoryPoints=100000000,expansionDays=366,days=366,egg=2147483647,node=2147483647,owner=2147483647).items():
            if type(p[k]) is not int or not 1<=p[k]<=maximum:
                self.error(400,'套餐数值无效 '+k)
        if any(type(p[k]) is not bool for k in ('included','enabled')):
            self.error(400,'套餐状态无效')
        with self.service.db() as db:
            db.execute('INSERT OR REPLACE INTO rental_plans VALUES(?,?)',(p['id'],json.dumps(p)))
        return {'ok':True}

    def credit(self, body):
        account, ref, delta = body.get('account'),body.get('reference'),body.get('points')
        if not all(isinstance(x,str) and 1<=len(x)<=100 for x in (account,ref)) or type(delta) is not int or not 1<=delta<=100000000:
            self.error(400,'账号、入账流水号或点数无效')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone(): self.error(404,'账号不存在')
            key='credit:'+ref
            db.execute('INSERT OR IGNORE INTO rental_points VALUES(?,?,?)',(account,key,delta))
            if db.execute('SELECT delta FROM rental_points WHERE account=? AND reference=?',(account,key)).fetchone()[0]!=delta:
                self.error(409,'流水号已用于另一金额')
        return {'ok':True}

    def balance(self, db, account):
        return db.execute('SELECT COALESCE(SUM(delta),0) FROM rental_points WHERE account=?',(account,)).fetchone()[0]

    def catalog(self, account):
        with self.service.db() as db:
            plans=[json.loads(r[0]) for r in db.execute('SELECT details FROM rental_plans ORDER BY id')]
            entitlement=db.execute("SELECT machine FROM member_plans WHERE name=COALESCE((SELECT plan FROM member_assignments WHERE account=? AND expires>?),'Pro')",(account,time.time())).fetchone()
            for p in plans:
                if entitlement and entitlement[0] not in ("*",p["id"]):p["included"]=False
            rows=db.execute('SELECT id,plan,included,state,expires,extra,applied,identity,ports,cpu_extra,cpu_applied,memory_extra,memory_applied,port_extra FROM rentals WHERE account=? ORDER BY rowid DESC',(account,)).fetchall()
            return {'balance':self.balance(db,account),'plans':[dict({k:p[k] for k in ('id','name','system','cpu','memory','disk','points','days','included','expansionPoints')}, dedicatedIp=False, portCount=BUSINESS_PORTS) for p in plans if p['enabled'] and self.settings()['configured']],
                    'machines':[dict(id=r[0],name=json.loads(r[1])['name'],included=bool(r[2]),state=r[3],expires=r[4],deviceId=json.loads(r[7])['deviceId'] if r[7] else None,disk=json.loads(r[1])['disk']+r[5]*10240,appliedDisk=json.loads(r[1])['disk']+r[6]*10240,cores=json.loads(r[1])['cpu']/100+r[9],memory=json.loads(r[1])['memory']+1024*r[11],updating=r[5]!=r[6] or r[9]!=r[10] or r[11]!=r[12],ports=json.loads(r[8]) if r[8] else [],portCount=json.loads(r[1]).get('basePorts',10)+r[13]) for r in rows]}

    def order(self, account, body):
        request=body.get('request')
        included=body.get('included')
        if not isinstance(request,str) or not re.fullmatch(r'[a-f0-9-]{36}',request) or type(included) is not bool: self.error(400,'租赁请求无效')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT id,plan,included FROM rentals WHERE account=? AND request=?',(account,request)).fetchone()
            if prior:
                if json.loads(prior[1])['id']!=body.get('plan') or bool(prior[2])!=included:self.error(409,'订单参数已变化')
                return {'id':prior[0]}
            row=db.execute('SELECT details FROM rental_plans WHERE id=?',(body.get('plan'),)).fetchone()
            if not row or not self.settings()['configured']:self.error(503,'套餐尚未开放')
            p=json.loads(row[0])
            if not p['enabled']:self.error(409,'套餐已停用')
            machine=str(uuid.uuid4())
            if included:
                entitlement=db.execute("SELECT machine FROM member_plans WHERE name=COALESCE((SELECT plan FROM member_assignments WHERE account=? AND expires>?),'Pro')",(account,time.time())).fetchone()
                if entitlement and entitlement[0] not in ('*',p['id']):self.error(403,'会员套餐未分配该机器规格')
                member=db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone()
                if not p['included'] or not member or member[0]<=time.time():self.error(403,'需要有效的会员机器权益')
                if db.execute("SELECT 1 FROM rentals WHERE account=? AND included=1 AND state NOT IN ('expired','failed')",(account,)).fetchone():self.error(409,'已有会员机器')
            elif body.get('points')!=p['points'] or body.get('days')!=p['days']:self.error(409,'套餐已更新，请刷新后重试')
            elif self.balance(db,account)<p['points']:self.error(409,'可用点数不足')
            else:db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'rent:'+machine,-p['points']))
            db.execute("INSERT INTO rentals(id,account,request,plan,included,state,created) VALUES(?,?,?,?,?,'queued',?)",(machine,account,request,json.dumps(dict(p,basePorts=BUSINESS_PORTS)),included,time.time()))
        return {'id':machine}

    def secret(self, machine, purpose):
        return self.service.digest('cshell-rental/v1/'+purpose+'/'+machine)

    def request_build(self, remote, body):
        return self.panel('servers/%d/build'%remote,body,'PATCH')

    def panel(self, path, body=None, method=None):
        with self.service.db() as db:
            row=db.execute('SELECT host,sealed FROM rental_provider WHERE id=1').fetchone()
        if row:host,key=row[0],self.cipher().decrypt(row[1].encode()).decode()
        else:host,key=os.getenv('RENTAL_PANEL_HOST','pl.deviy.cn'),os.environ['RENTAL_PANEL_KEY']
        return self.request(host,key,path,body,method)

    def request(self, host, key, path, body=None, method=None):
        if not re.fullmatch(r'[A-Za-z0-9.-]+',host):raise ValueError('Invalid panel host')
        req=urllib.request.Request('https://'+host+'/api/application/'+path,method=method,data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','Accept':'application/json'})
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=12) as response:
            data=response.read(2000001)
            if len(data)>2000000:raise ValueError('Oversized panel response')
            return json.loads(data) if data else {}

    def free_ports(self, node, count, host=None):
        with self.service.db() as db:
            blocked = {row[0] for row in db.execute("SELECT allocation FROM rental_port_conflicts WHERE node=?", (node,))}
        groups = {}
        page = 1
        while True:
            rows = self.panel('nodes/%d/allocations?page=%d&per_page=100' % (node, page))
            for item in rows['data']:
                a = item['attributes']
                address = a.get('alias') or a['ip']
                if a['id'] in blocked or a['assigned'] or address == '0.0.0.0' or (host and address != host):
                    continue
                pool = groups.setdefault(address, [])
                pool.append(a['id'])
                if len(pool) == count:
                    return pool
            if page >= rows['meta']['pagination']['total_pages']:
                raise ValueError('No available allocation')
            page += 1

    def sync_ports(self, machine):
        with self.work_lock:
            with self.service.db() as db:
                row = db.execute("SELECT remote,plan,endpoint,port_extra FROM rentals WHERE id=? AND state='ready'", (machine,)).fetchone()
            if not row:
                self.error(409, '实例尚未就绪')
            remote, plan, endpoint = row[0], json.loads(row[1]), json.loads(row[2])
            target=plan.get('basePorts',10)+row[3]
            def fetch():
                obj = self.panel('servers/%d?include=allocations' % remote)['attributes']
                if obj['external_id'] != 'cshell-' + machine or obj['node'] != plan['node']:
                    raise ValueError('Provider identity mismatch')
                return obj, [item['attributes'] for item in obj['relationships']['allocations']['data']]
            def business(obj, rows):
                return sorted([dict(host=a.get('alias') or a['ip'], port=a['port']) for a in rows
                               if a['id'] != obj['allocation'] and (a.get('alias') or a['ip']) == endpoint['host']], key=lambda a:a['port'])
            obj, rows = fetch()
            ports = business(obj, rows)
            if len(ports) < target:
                ids = self.free_ports(plan['node'], target-len(ports), endpoint['host'])
                self.request_build(remote, {**obj['limits'], 'allocation':obj['allocation'],
                                            'feature_limits':obj['feature_limits'], 'add_allocations':ids})
                ports = business(*fetch())
            if len(ports) < target:
                raise ValueError('Provider omitted allocations')
            with self.service.db() as db:
                db.execute('UPDATE rentals SET ports=? WHERE id=?', (json.dumps(ports), machine))

    def provision(self, machine, p):
        external='cshell-'+machine
        try:
            obj=self.panel('servers/external/'+external)['attributes']
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
            # Explicit node selection and allocation; concurrent claims can be retried.
            pool=self.free_ports(p['node'], p.get('basePorts',10)+1)
            obj=self.panel('servers',{'external_id':external,'name':'CShell-'+machine[:8],'user':p['owner'],'egg':p['egg'],
                'docker_image':IMAGE,'startup':START,'environment':{'CAGENT_PASSWORD':self.secret(machine,'password'),
                'CSHELL_RENTAL_ID':machine,'CSHELL_ENROLL_TOKEN':self.secret(machine,'enroll')},
                'limits':{'memory':p['memory'],'swap':0,'disk':p['disk'],'io':500,'cpu':p['cpu']},
                'feature_limits':{'databases':0,'allocations':0,'backups':0},'allocation':{'default':pool[0],'additional':pool[1:]},'start_on_completion':True})['attributes']
        if obj.get('external_id')!=external or obj['node']!=p['node']:raise ValueError('Provider identity mismatch')
        page=1
        while True:
            rows=self.panel('nodes/%d/allocations?page=%d&per_page=100'%(p['node'],page))
            allocation=next((r['attributes'] for r in rows['data'] if r['attributes']['id']==obj['allocation']),None)
            if allocation:break
            if page>=rows['meta']['pagination']['total_pages']:raise ValueError('Missing allocation')
            page+=1
        endpoint={'host':allocation.get('alias') or allocation['ip'],'port':allocation['port']}
        with self.service.db() as db:
            db.execute("UPDATE rentals SET state='installing',remote=?,endpoint=? WHERE id=? AND state='queued'",(obj['id'],json.dumps(endpoint),machine))

    def enroll(self, body):
        import hmac
        machine=body.get('id')
        if not isinstance(machine,str) or not isinstance(body.get('token'),str) or not hmac.compare_digest(self.secret(machine,'enroll'),body['token']):self.error(403,'注册凭据无效')
        identity=body.get('identity')
        if not isinstance(identity,dict) or not re.fullmatch('[0-9a-f-]{36}',str(identity.get('deviceId'))) or not re.fullmatch('[a-fA-F0-9:]{64,95}',str(identity.get('fingerprint'))):self.error(400,'设备身份无效')
        data=json.dumps({k:identity[k] for k in ('deviceId','fingerprint')},sort_keys=True)
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT state,identity,plan,included,account FROM rentals WHERE id=?',(machine,)).fetchone()
            if not row or row[0] not in ('installing','ready') or row[1] not in (None,data):self.error(409,'实例尚未就绪或身份已变化')
            expires=time.time()+json.loads(row[2])['days']*86400
            if row[3]:expires=(db.execute('SELECT expires FROM memberships WHERE account=?',(row[4],)).fetchone() or [0])[0]
            db.execute("UPDATE rentals SET state='ready',identity=?,expires=COALESCE(expires,?) WHERE id=?",(data,expires,machine))
        return {'ok':True}

    def connection(self, account, machine):
        with self.service.db() as db:
            row=db.execute("SELECT endpoint,identity,included,expires,(extra+cpu_extra+memory_extra+port_extra) FROM rentals WHERE account=? AND id=? AND state='ready'",(account,machine)).fetchone()
            if not row:self.error(409,'机器尚未就绪')
            expires=row[3] if not row[2] or row[4] else (db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone() or [0])[0]
            if expires<=time.time():self.error(403,'租期已结束')
            return {**json.loads(row[0]),**json.loads(row[1]),'password':self.secret(machine,'password')}

    def fail(self, machine):
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT account,plan,included FROM rentals WHERE id=? AND state IN ('queued','installing')",(machine,)).fetchone()
            if row:
                db.execute("UPDATE rentals SET state='failed' WHERE id=?",(machine,))
                if not row[2]:
                    db.execute('INSERT OR IGNORE INTO rental_points VALUES(?,?,?)',(row[0],'refund:'+machine,json.loads(row[1])['points']))

    def tick(self):
        if not self.settings()['configured']:return
        with self.service.db() as db:
            rows=db.execute("SELECT r.id,r.plan,r.state,r.remote FROM rentals r LEFT JOIN memberships m ON m.account=r.account WHERE r.state='queued' OR (r.state IN ('ready','installing') AND ((r.included=1 AND COALESCE(m.expires,0)<=?) OR (r.included=0 AND r.expires<=?)))",(time.time(),time.time())).fetchall()
            changes=db.execute("SELECT id,plan,remote,extra,state,cpu_extra,memory_extra FROM rentals WHERE (state='ready' AND (applied<>extra OR cpu_extra<>cpu_applied OR memory_extra<>memory_applied)) OR state='resuming'").fetchall()
            rows+=db.execute("SELECT id,plan,state,remote FROM rentals WHERE included=1 AND (extra+cpu_extra+memory_extra+port_extra)>0 AND state='ready' AND expires<=? AND account IN (SELECT account FROM memberships WHERE expires>?)",(time.time(),time.time())).fetchall()
            db.execute("UPDATE rentals SET expires=(SELECT expires FROM memberships WHERE account=rentals.account) WHERE state='ready' AND included=1 AND (extra+cpu_extra+memory_extra+port_extra)=0 AND EXISTS(SELECT 1 FROM memberships WHERE account=rentals.account AND expires<>rentals.expires)")
            stale=db.execute("SELECT id,remote FROM rentals WHERE state='installing' AND created<?",(time.time()-3600,)).fetchall()
            unmapped=db.execute("SELECT id FROM rentals WHERE state='ready' AND (ports IS NULL OR json_array_length(ports)<coalesce(json_extract(plan,'$.basePorts'),10)+port_extra) AND remote IS NOT NULL").fetchall()
        for (machine,) in unmapped:
            try:
                self.sync_ports(machine)
            except (OSError, ValueError, KeyError, self.failure):
                continue
        for machine,remote in stale:
            try:
                obj=self.panel('servers/%d'%remote)['attributes']
                if obj.get('external_id')=='cshell-'+machine:
                    with self.service.db() as db:
                        db.execute('BEGIN IMMEDIATE')
                        if not db.execute("SELECT 1 FROM rentals WHERE id=? AND state='installing'",(machine,)).fetchone():continue
                        self.panel('servers/%d/suspend'%remote,{})
                        db.execute("UPDATE rentals SET state='failed' WHERE id=?",(machine,))
                        db.execute("INSERT OR IGNORE INTO rental_points SELECT account,'refund:'||id,json_extract(plan,'$.points') FROM rentals WHERE id=? AND included=0",(machine,))
            except (OSError,KeyError):continue
        for machine,plan,remote,extra,state,cpu_extra,memory_extra in changes:
            try:
                if state=='resuming':
                    self.panel('servers/%d/unsuspend'%remote,{})
                    with self.service.db() as db:db.execute("UPDATE rentals SET state='ready' WHERE id=? AND state='resuming'",(machine,))
                else:
                    obj=self.panel('servers/%d'%remote)['attributes']
                    base=json.loads(plan)
                    limits=dict(obj['limits'],disk=base['disk']+10240*extra,cpu=base['cpu']+100*cpu_extra,memory=base['memory']+1024*memory_extra)
                    self.request_build(remote,{**limits,'allocation':obj['allocation'],'feature_limits':obj['feature_limits']})
                    with self.service.db() as db:db.execute('UPDATE rentals SET applied=?,cpu_applied=?,memory_applied=? WHERE id=?',(extra,cpu_extra,memory_extra,machine))
            except (OSError,ValueError,KeyError):continue
        for machine,plan,state,remote in rows:
            try:
                if state=='queued':
                    try:self.provision(machine,json.loads(plan))
                    except ValueError as error:
                        if str(error)=='No available allocation':self.fail(machine)
                        else:raise
                else:
                    with self.service.db() as db:
                        db.execute('BEGIN IMMEDIATE')
                        record=db.execute("SELECT r.included,(r.extra+r.cpu_extra+r.memory_extra),r.expires,COALESCE(m.expires,0) FROM rentals r LEFT JOIN memberships m ON m.account=r.account WHERE r.id=? AND r.state IN ('ready','installing')",(machine,)).fetchone()
                        if not record:continue
                        included,extra,paid_until,member_until=record
                        due=member_until if included and not extra else min(member_until,paid_until or member_until) if included else paid_until
                        if due is None or due>time.time():continue
                        self.panel('servers/%d/suspend'%remote,{})
                        db.execute("UPDATE rentals SET state='expired' WHERE id=?",(machine,))
            except urllib.error.HTTPError as e:
                if state=='queued' and e.code==422:
                    try:
                        self.panel('servers/external/cshell-'+machine)
                    except urllib.error.HTTPError as missing:
                        if missing.code==404:
                            self.fail(machine)
                    except OSError:pass
            except (OSError,ValueError,KeyError):
                # Preserve the external ID after an ambiguous create and reconcile next pass.
                continue

    def run(self):
        def worker():
            while True:
                try:self.tick()
                except Exception:
                    import logging
                    logging.exception('Rental reconciliation interrupted')
                time.sleep(15)
        threading.Thread(target=worker,name='cshell-rentals',daemon=True).start()
