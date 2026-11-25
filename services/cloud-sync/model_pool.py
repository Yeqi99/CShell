"""Member inference pool. Integer hundredths of a weighted request; Monday 00:00 Beijing."""
import base64, datetime, hashlib, hmac, json, re, sqlite3, time, urllib.request, uuid
import os, shutil, subprocess
from pathlib import Path
from fractions import Fraction
from math import ceil
from decimal import Decimal, InvalidOperation
from model_pool_rates import effective_prices

URL = {k:v+'/chat/completions' for k,v in {
    'qwen':'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'mimo':'https://api.xiaomimimo.com/v1','deepseek':'https://api.deepseek.com/v1',
    'qwen-plan':'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    'mimo-plan':'https://token-plan-cn.xiaomimimo.com/v1',
    'opencode-go':'https://opencode.ai/inference/go/openai/v1','kimi':'https://api.moonshot.cn/v1','aiopen':'https://aiopen.one/v1'}.items()}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args): return None
def upstream(request, timeout=120):
    request.add_header("User-Agent","CShell-Model-Gateway/1.0")
    if not request.has_header("Accept"): request.add_header("Accept","application/json")
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
COST_LABELS = {'minimal':'极低消耗','low':'低消耗','medium':'中消耗','elevated':'较高消耗','high':'高消耗','extreme':'极高消耗'}


def cost_tier(prices, weight, unit):
    if prices is None and not unit:
        return 'low' if weight <= 100 else 'medium' if weight <= 300 else 'high'
    # Micro-yuan per million tokens, assuming four uncached input tokens per output token.
    cost = Fraction(4 * prices[0] + prices[2], 5) if prices is not None else Fraction(weight * 100_000_000, unit)
    for ceiling, tier in ((300_000,'minimal'), (1_000_000,'low'), (3_000_000,'medium'),
                          (8_000_000,'elevated'), (20_000_000,'high')):
        if cost <= ceiling:
            return tier
    return 'extreme'


def week():
    day=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    return (day-datetime.timedelta(days=day.weekday())).isoformat()

WEEKLY_VALUE=50000  # hundredths of a point; 100 points = CNY 1
REFILL_PRICE=588
def model_limits(provider,name):
    if provider=='deepseek' and name in ('deepseek-v4-flash','deepseek-v4-pro','deepseek-flash'):
        return dict(maxOutputTokens=393216,contextWindow=1048576,limitSource='provider')
    return dict(maxOutputTokens=8192,limitSource='gateway')

def token_cost(input_tokens, cached_tokens, output_tokens, prices, divisor=100000000):
    # Prices are micro-yuan per million tokens. The ledger uses 0.0001 yuan.
    value=(input_tokens-cached_tokens)*prices[0]+cached_tokens*prices[1]+output_tokens*prices[2]
    return (value+divisor-1)//divisor

from model_pool_inventory import summarize_inventory

class Pool:
    def __init__(self,s,F):
        self.s,self.F=s,F
        with s.db() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS pool_keys(id TEXT PRIMARY KEY,provider TEXT,label TEXT,secret BLOB,digest TEXT UNIQUE,capacity INTEGER,enabled INTEGER,cooldown REAL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS pool_models(id TEXT PRIMARY KEY,provider TEXT,model TEXT,weight INTEGER,enabled INTEGER,UNIQUE(provider,model));
            CREATE TABLE IF NOT EXISTS pool_calls(id INTEGER PRIMARY KEY,week TEXT,account TEXT,keyid TEXT,provider TEXT,model TEXT,charge INTEGER,state TEXT);
            CREATE TABLE IF NOT EXISTS account_quota_windows(account TEXT PRIMARY KEY,started REAL,cutoff INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS call_attributions(id INTEGER PRIMARY KEY,at REAL,category TEXT,source TEXT);
            CREATE INDEX IF NOT EXISTS pool_calls_account ON pool_calls(account,id);
            CREATE INDEX IF NOT EXISTS pool_week ON pool_calls(week,provider,account);
            CREATE INDEX IF NOT EXISTS pool_key ON pool_calls(week,keyid);
            CREATE TABLE IF NOT EXISTS pool_plans(id TEXT PRIMARY KEY,provider TEXT,label TEXT,total TEXT,remaining TEXT,unit TEXT,checked REAL,UNIQUE(provider,label));
            CREATE TABLE IF NOT EXISTS pool_refills(account TEXT, request TEXT, week TEXT, cutoff INTEGER, created REAL, PRIMARY KEY(account,request));
            CREATE TABLE IF NOT EXISTS pool_inventory_bindings(keyid TEXT PRIMARY KEY,wallet TEXT,rate TEXT);
            CREATE TABLE IF NOT EXISTS pool_inventory_samples(keyid TEXT PRIMARY KEY,checked REAL,metrics TEXT);
            CREATE TABLE IF NOT EXISTS pool_limits(provider TEXT PRIMARY KEY,ceiling INTEGER);
            CREATE TABLE IF NOT EXISTS pool_units(provider TEXT PRIMARY KEY,tokens INTEGER);
            CREATE TABLE IF NOT EXISTS pool_go_limits(model TEXT PRIMARY KEY,monthly INTEGER);
            CREATE TABLE IF NOT EXISTS pool_go_calls(id INTEGER PRIMARY KEY,monthly INTEGER,yuan TEXT);
            CREATE TABLE IF NOT EXISTS pool_subscription_costs(keyid TEXT PRIMARY KEY,monthly TEXT);
            CREATE TABLE IF NOT EXISTS pool_price_divisors(id INTEGER PRIMARY KEY,divisor INTEGER);
            CREATE TABLE IF NOT EXISTS pool_speed_samples(model TEXT PRIMARY KEY, first_seconds REAL NOT NULL, chars_per_second REAL NOT NULL, seconds_per_100 REAL NOT NULL, samples INTEGER NOT NULL, measured INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS pool_prices(model TEXT PRIMARY KEY,input INTEGER,cached INTEGER,output INTEGER);
            CREATE TABLE IF NOT EXISTS pool_call_prices(id INTEGER PRIMARY KEY,input INTEGER,cached INTEGER,output INTEGER,hit INTEGER);
            CREATE TABLE IF NOT EXISTS pool_receipts(id INTEGER PRIMARY KEY,exact_units TEXT NOT NULL,list_usd TEXT);
            CREATE TABLE IF NOT EXISTS pool_rounding(account TEXT,week TEXT,cutoff INTEGER,remainder TEXT,PRIMARY KEY(account,week,cutoff));
            CREATE TABLE IF NOT EXISTS pool_meter(id INTEGER PRIMARY KEY,unit INTEGER,rate INTEGER,held INTEGER,input INTEGER,output INTEGER,total INTEGER);
            """)
    def cipher(self):
        try: from cryptography.fernet import Fernet
        except ImportError: raise self.F(503,'服务端缺少 python3-cryptography')
        return Fernet(base64.urlsafe_b64encode(hmac.digest(self.s.pepper,b'cshell/model-pool/credentials/v1','sha256')))
    def change(self,b):
        if b.get('action')=='balance':return self.balance(b.get('id'))
        provider=b.get('provider')
        if not isinstance(provider,str) or provider not in URL: raise self.F(400,'供应商不正确')
        def points(k,minimum):
            try:
                n=Decimal(str(b.get(k)))*100
                if not n.is_finite() or not minimum<=n<=10**14 or int(n)!=n:raise ValueError()
                return int(n)
            except (ValueError,InvalidOperation):raise self.F(400,'点数须为非负数，最多两位小数')
        if type(b.get('enabled',True))!=bool:raise self.F(400,'状态不正确')
        enabled=int(b.get('enabled',True))
        action=b.get('action')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if action=='key':
                label=b.get('label'); key=b.get('key',''); ident=b.get('id')
                if not isinstance(label,str) or not 1<=len(label.strip())<=80:raise self.F(400,'请填写账号备注')
                cap=points('capacity',0)
                row=db.execute('SELECT secret,digest FROM pool_keys WHERE id=? AND provider=?',(ident,provider)).fetchone() if isinstance(ident,str) else None
                if ident and not row:raise self.F(404,'账号不存在')
                prefixes={'sk-sp-':'qwen-plan','tp-':'mimo-plan','oc_sk_':'opencode-go'}
                if not isinstance(key,str) or (key and (not re.fullmatch(r'[!-~]{8,1024}',key) or any(key.startswith(pre)!=(provider==owner) for pre,owner in prefixes.items()))):raise self.F(400,'请核对供应商与密钥类型')
                if not row and not key:raise self.F(400,'新账号需要密钥')
                secret,digest=(self.cipher().encrypt(key.encode()),self.s.digest('pool:'+key)) if key else row
                ident=ident or uuid.uuid4().hex
                if row and row[1]!=digest:
                    db.execute('DELETE FROM pool_inventory_samples WHERE keyid=?',(ident,))
                    db.execute('DELETE FROM pool_inventory_bindings WHERE keyid=?',(ident,))
                if b.get('monthlyYuan') not in ('',None):
                    try:
                        monthly=Decimal(str(b['monthlyYuan']))
                        if not monthly.is_finite() or not 0<monthly<=1000000:raise ValueError()
                    except (ValueError,InvalidOperation):raise self.F(400,'月套餐金额无效')
                    db.execute('INSERT OR REPLACE INTO pool_subscription_costs VALUES(?,?)',(ident,str(monthly)))
                if 'wallet' in b or 'unitYuan' in b:
                    wallet=b.get('wallet',''); rate=b.get('unitYuan','')
                    if not isinstance(wallet,str) or len(wallet)>80:raise self.F(400,'余额账户标识过长')
                    if rate not in (None,''):
                        try:
                            rate=Decimal(str(rate))
                            if not rate.is_finite() or not Decimal('.000000000001')<=rate<=10**9:raise ValueError()
                        except (ValueError,InvalidOperation):raise self.F(400,'请输入有效人民币单位成本')
                    db.execute('INSERT OR REPLACE INTO pool_inventory_bindings VALUES(?,?,?)',(ident,wallet.strip(),str(rate) if rate else None))
                try:
                    db.execute('INSERT INTO pool_keys(id,provider,label,secret,digest,capacity,enabled) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,secret=excluded.secret,digest=excluded.digest,capacity=excluded.capacity,enabled=excluded.enabled,cooldown=0',(ident,provider,label.strip(),secret,digest,cap,enabled))
                except sqlite3.IntegrityError:raise self.F(409,'该密钥已经在池中')
            elif action=='model':
                model=b.get('model')
                if not isinstance(model,str) or not re.fullmatch('[A-Za-z0-9_.-]{1,90}',model):raise self.F(400,'模型 ID 无效')
                db.execute('INSERT INTO pool_models VALUES(?,?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET weight=excluded.weight,enabled=excluded.enabled',('pool-'+str(uuid.uuid4()),provider,model,points('weight',1),enabled))
                values=[b.get(k) for k in ('inputPrice','cachePrice','outputPrice')]
                if any(v not in (None,'') for v in values):
                    try:
                        rates=[Decimal(str(v))*1000000 for v in values]
                        if any(not r.is_finite() or r<0 or r>10**12 or r!=int(r) for r in rates) or not any(rates):raise ValueError()
                    except (InvalidOperation,ValueError):
                        raise self.F(400,'请填写三项每百万 Token 人民币成本，最多六位小数')
                    ident=db.execute('SELECT id FROM pool_models WHERE provider=? AND model=?',(provider,model)).fetchone()[0]
                    db.execute('INSERT OR REPLACE INTO pool_prices VALUES(?,?,?,?)',(ident,*map(int,rates)))
                if provider=='opencode-go' and b.get('monthlyLimitUSD') not in ('',None):
                    monthly=b['monthlyLimitUSD']
                    if isinstance(monthly,str) and monthly.isdigit():monthly=int(monthly)
                    if type(monthly) is not int or not 0<monthly<=100000:raise self.F(400,'模型月限额无效')
                    db.execute('INSERT OR REPLACE INTO pool_go_limits SELECT id,? FROM pool_models WHERE provider=? AND model=?',(monthly,provider,model))
            elif action=='plan':
                label,unit=b.get('label'),b.get('unit')
                if not all(isinstance(x,str) and 0<len(x.strip())<=80 for x in (label,unit)):raise self.F(400,'请填写套餐备注和计量单位')
                total,remaining=points('total',0),points('remaining',0)
                if remaining>total:raise self.F(400,'剩余额度不能大于总额度')
                db.execute('INSERT INTO pool_plans VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,label) DO UPDATE SET total=excluded.total,remaining=excluded.remaining,unit=excluded.unit,checked=excluded.checked',(uuid.uuid4().hex,provider,label.strip(),total,remaining,unit.strip(),time.time()))
            elif action=='limit':
                if 'tokens' in b:
                    n=str(b['tokens'])
                    if not re.fullmatch(r'[0-9]{1,8}',n):raise self.F(400,'每点 Token 数须为非负整数')
                    db.execute('INSERT OR REPLACE INTO pool_units VALUES(?,?)',(provider,int(n)))
                if 'ceiling' in b:db.execute('INSERT OR REPLACE INTO pool_limits VALUES(?,?)',(provider,None if b.get('ceiling') is None else points('ceiling',0)))
            else:raise self.F(400,'未知操作')
            db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),provider,'model-pool:'+action,'配置已更新'))
        return {'ok':True}
    def allowance(self,db,account,period):
        window=db.execute('SELECT started,cutoff FROM account_quota_windows WHERE account=?',(account,)).fetchone()
        if window:
            started,cutoff=window
            if started is None or started+604800<=time.time():
                last=db.execute('SELECT coalesce(max(id),0) FROM pool_calls WHERE account=?',(account,)).fetchone()[0]
                return last,0,last,0
            used,last,pending=db.execute("SELECT coalesce(sum(charge),0),coalesce(max(id),0),sum(CASE WHEN state='pending' THEN 1 ELSE 0 END) FROM pool_calls WHERE account=? AND id>?",(account,cutoff)).fetchone()
            return cutoff,used,last,pending or 0
        cutoff=db.execute('SELECT coalesce(max(cutoff),0) FROM pool_refills WHERE account=? AND week=?',(account,period)).fetchone()[0]
        used,last,pending=db.execute("SELECT coalesce(sum(charge),0),coalesce(max(id),0),count(CASE WHEN state='pending' THEN 1 END) FROM pool_calls WHERE account=? AND week=? AND id>?",(account,period,cutoff)).fetchone()
        return cutoff,used,last,pending

    def refill(self,account,body):
        request=body.get('request')
        if not isinstance(request,str) or not re.fullmatch(r'[A-Za-z0-9-]{16,64}',request):raise self.F(400,'请求编号无效')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM pool_refills WHERE account=? AND request=?',(account,request)).fetchone():return {'ok':True}
            period=week()
            if not db.execute('SELECT 1 FROM memberships WHERE account=? AND expires>?',(account,time.time())).fetchone():raise self.F(403,'需要有效 Pro 会员')
            cutoff,used,last,pending=self.allowance(db,account,period)
            if pending or used<=0 or body.get('quote')!=f'{period}:{cutoff}:{last}:{used}':raise self.F(409,'额度已变动或正在使用，请刷新后再试')
            if not any(p['weekly']>0 and any(k['enabled'] and k['weekly']>k['used'] and k['cooldown']<=time.time() for k in p['keys']) and any(m['enabled'] for m in p['models']) for p in self.snapshot(db)['pools']):raise self.F(409,'模型号池暂不可用')
            if self.s.rentals.balance(db,account)<REFILL_PRICE:raise self.F(409,'可用点数不足')
            db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'model-refill:'+request,-REFILL_PRICE))
            db.execute('INSERT INTO pool_refills VALUES(?,?,?,?,?)',(account,request,period,last,time.time()))
            db.execute('INSERT OR REPLACE INTO account_quota_windows VALUES(?,NULL,?)',(account,last))
        return {'ok':True}

    def inventory(self,db):
        inventory=db.execute('SELECT k.provider,k.id,b.wallet,b.rate,s.checked,s.metrics FROM pool_keys k LEFT JOIN pool_inventory_bindings b ON b.keyid=k.id LEFT JOIN pool_inventory_samples s ON s.keyid=k.id WHERE k.enabled=1').fetchall()
        costs=dict(db.execute('SELECT keyid,monthly FROM pool_subscription_costs'))
        result=summarize_inventory(inventory,time.time(),costs)
        result['subscriptionYuan']={p:str(sum(Decimal(costs[k]) for provider,k,*_ in inventory if provider==p and k in costs)) for p in URL if any(provider==p and k in costs for provider,k,*_ in inventory)}
        return result

    def weekly_value(self,db,account):
        row=db.execute("SELECT weekly_cents FROM member_plans WHERE name=COALESCE((SELECT plan FROM member_assignments WHERE account=? AND expires>?),'Pro')",(account,time.time())).fetchone()
        return row[0]*100 if row and row[0] is not None else WEEKLY_VALUE

    def snapshot(self,db,account=None):
        period=week()
        count=db.execute('SELECT count(*) FROM memberships WHERE expires>?',(time.time(),)).fetchone()[0]
        active=account is None or bool(db.execute('SELECT 1 FROM memberships WHERE account=? AND expires>?',(account,time.time())).fetchone())
        budget=self.weekly_value(db,account)
        result={'week':period,'pools':[], 'weeklyYuan':budget/10000}
        bindings={}
        monthly_costs={}
        if account is None:
            result['members']=count
            result['inventory']=self.inventory(db)
            monthly_costs=dict(db.execute('SELECT keyid,monthly FROM pool_subscription_costs'))
            bindings={i:dict(wallet=w or '',unitYuan=r or '') for i,w,r in db.execute('SELECT keyid,wallet,rate FROM pool_inventory_bindings')}

        if account is not None:result['balance']=self.s.rentals.balance(db,account)
        if not active:return result
        if account is not None:
            cutoff,spent,last,pending=self.allowance(db,account,period)
            end=datetime.datetime.fromisoformat(period+'T00:00:00+08:00')+datetime.timedelta(days=7)
            window=db.execute('SELECT started FROM account_quota_windows WHERE account=?',(account,)).fetchone()
            result.update(remainingYuan=max(0,budget-spent)/10000,occupiedYuan=spent/10000,percent=max(0,budget-spent)*100/budget,resetAt=int(window[0]+604800) if window and window[0] and window[0]+604800>time.time() else int(end.timestamp()) if not window and spent else 0,price=REFILL_PRICE,quote=f'{period}:{cutoff}:{last}:{spent}' if spent and not pending else None)
        for p in URL:
            keys=db.execute("""SELECT id,label,capacity,enabled,cooldown,coalesce((SELECT sum(charge) FROM pool_calls WHERE week=? AND keyid=k.id),0) FROM pool_keys k WHERE provider=?""",(period,p)).fetchall()
            capacity=sum(k[2] for k in keys if k[3])
            models=[]
            unit=db.execute('SELECT tokens FROM pool_units WHERE provider=?',(p,)).fetchone()
            rows=db.execute('SELECT m.id,m.model,m.weight,m.enabled,r.input,r.cached,r.output,s.first_seconds,s.chars_per_second,s.seconds_per_100,s.samples,s.measured FROM pool_models m LEFT JOIN pool_prices r ON r.model=m.id LEFT JOIN pool_speed_samples s ON s.model=m.id WHERE m.provider=?',(p,))
            for ident,name,weight,enabled,inp,cached,out,first,cps,seconds,samples,measured in rows:
                if account is not None and not enabled:continue
                prices=(inp,cached,out) if inp is not None else None
                effective=effective_prices(p,name,prices,time.time()) if prices is not None else None
                tier=cost_tier(effective,weight,unit[0] if unit else 0)
                model=dict(id=ident,name=name,enabled=bool(enabled),costTier=tier,**model_limits(p,name))
                if samples and samples >= 2:
                    level='fast' if seconds <= 3 else 'normal' if seconds <= 6 else 'slow' if seconds <= 12 else 'verySlow'
                    model['speed']=dict(level=level,first=first,cps=cps,samples=samples,measured=measured)
                if account is None:
                    model.update(multiplier=weight/100,costLabel=COST_LABELS[tier])
                    if prices:model['costPerMillion']=[v/1000000 for v in prices]
                else:
                    # Older clients accept only these three values in the traffic schema.
                    model['tier']={'minimal':'low','elevated':'high','extreme':'high'}.get(tier,tier)
                models.append(model)
            item=dict(provider=p,weekly=budget/100,models=models)
            if account is None:item['tokensPerPoint']=unit[0] if unit else 0
            if account is None:
                item['meter']=[dict(id=i,account=a,model=m,state=s,held=h/100,occupied=c/100,input=n,output=o,total=t) for i,a,m,s,h,c,n,o,t in db.execute('SELECT c.id,c.account,c.model,c.state,u.held,c.charge,u.input,u.output,u.total FROM pool_calls c JOIN pool_meter u ON c.id=u.id WHERE c.week=? AND c.provider=? ORDER BY c.id DESC LIMIT 50',(period,p))]
                for call in item['meter']:
                    detail=db.execute('SELECT r.exact_units,r.list_usd,p.hit FROM pool_call_prices p LEFT JOIN pool_receipts r USING(id) WHERE p.id=?',(call['id'],)).fetchone()
                    if detail:
                        call.update(cached=detail[2],listUSD=detail[1],exactYuan=float(Fraction(detail[0])/10000) if detail[0] is not None else None)
                if p=='opencode-go':
                    item['windows']=[]
                    factors={'滚动窗口':0.2,'本周':0.5,'本月':1}
                    for label,checked,metrics,monthly in db.execute("SELECT k.label,s.checked,s.metrics,c.monthly FROM pool_inventory_samples s JOIN pool_keys k ON k.id=s.keyid JOIN pool_subscription_costs c ON c.keyid=k.id WHERE k.provider=? AND k.enabled=1",(p,)):
                        for m in json.loads(metrics):
                            if m.get('unit') in factors:
                                remaining=float(monthly)*factors[m['unit']]*(1-float(m['percent'])/100)
                                item['windows'].append(dict(label=label,window=m['unit'],remainingYuan=round(remaining,4),checkedAt=checked,resetAt=m.get('resetAt')))
                item['plans']=[dict(label=l,total=int(t)/100,remaining=int(r)/100,unit=u,checked=c) for l,t,r,u,c in db.execute('SELECT label,total,remaining,unit,checked FROM pool_plans WHERE provider=? ORDER BY label',(p,))]
                item['calls']={state:n for state,n in db.execute('SELECT state,count(*) FROM pool_calls WHERE week=? AND provider=? GROUP BY state',(period,p))}
                item.update(capacity=capacity/100,keys=[dict(id=i,label=l,weekly=c/100,monthlyYuan=monthly_costs.get(i),enabled=bool(e),cooldown=t,used=u/100,**bindings.get(i,{})) for i,l,c,e,t,u in keys])
            else:
                if not models or not any(k[3] and k[2]>k[5] and k[4]<=time.time() for k in keys):continue
                item.update(used=spent/100,remaining=max(0,budget-spent)/100)
            result['pools'].append(item)
        return result
    def view(self,account=None):
        with self.s.db() as db:return self.snapshot(db,account)
    def reserve(self,account,model,estimate=1,max_output=0,fit_output=False,*,sponsored=False):
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not sponsored and not db.execute('SELECT 1 FROM memberships WHERE account=? AND expires>?',(account,time.time())).fetchone():raise self.F(403,'会员模型需要有效 Pro 会员')
            row=db.execute('SELECT provider,model,weight FROM pool_models WHERE id=? AND enabled=1',(model,)).fetchone()
            if not row:raise self.F(404,'会员模型未开放')
            p,name,weight=row
            rate=weight
            unit=(db.execute('SELECT tokens FROM pool_units WHERE provider=?',(p,)).fetchone() or (0,))[0]
            prices=db.execute('SELECT input,cached,output FROM pool_prices WHERE model=?',(model,)).fetchone()
            if prices:prices=effective_prices(p,name,prices,time.time())
            divisor=100000000
            # Lite list price: 39 yuan per 4.1 billion credits. Store the exact
            # fraction at reservation so a call crossing 08:00 keeps its tariff.
            mimo_rates={'mimo-v2.6-pro':(600,5,1200),'mimo-v2.6-flash':(200,4,400)}
            if p=='mimo-plan' and name in mimo_rates and prices:
                half_credits=mimo_rates[name]
                list_prices=tuple(round(n*39000000000000/8200000000) for n in half_credits)
                if tuple(prices)==list_prices:
                    night=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).hour<8
                    prices=tuple(n*390000*(4 if night else 5) for n in half_credits)
                    divisor=41000000000
            input_estimate=estimate-max_output
            limits=model_limits(p,name)
            cap=limits['maxOutputTokens']
            if fit_output and 'contextWindow' in limits:
                cap=min(cap,limits['contextWindow']-input_estimate)
                if cap<1:raise self.F(400,'输入超过模型上下文保守估算，请缩短输入')
            def reservation(output):
                if prices:
                    return token_cost(input_estimate,0,output,(max(prices[:2]),prices[1],prices[2]),divisor)
                if unit:return ((input_estimate+output)*rate+unit-1)//unit
                return rate
            period=week()
            cutoff,spent,_,_=self.allowance(db,account,period)
            minimum=reservation(1 if fit_output else max_output)
            balance=10**18 if sponsored else self.weekly_value(db,account)-spent
            if minimum>balance:raise self.F(429,"本周 Pro 额度不足")
            key=db.execute("""SELECT id,secret,capacity-coalesce((SELECT sum(charge) FROM pool_calls WHERE week=? AND keyid=k.id),0) AS available FROM pool_keys k WHERE enabled=1 AND provider=? AND cooldown<=? AND available>=? ORDER BY available DESC,id LIMIT 1""",(period,p,time.time(),minimum)).fetchone()
            if not key:raise self.F(503,'当前号池暂无可用账号')
            if fit_output:
                # Bound output by the gateway's tested model policy and both budgets.
                low,high=1,min(max_output,cap)
                available=min(balance,key[2])
                while low<high:
                    mid=(low+high+1)//2
                    if reservation(mid)<=available:low=mid
                    else:high=mid-1
                max_output=low
            weight=reservation(max_output)
            credential=self.cipher().decrypt(key[1]).decode()
            current=db.execute('SELECT started FROM account_quota_windows WHERE account=?',(account,)).fetchone()
            if not current or current[0] is None or current[0]+604800<=time.time():
                now=time.time()
                if not current and spent:
                    # Legacy calls have no timestamps. Preserve their existing reset date.
                    now=datetime.datetime.fromisoformat(period+'T00:00:00+08:00').timestamp()
                    cutoff=max(cutoff,db.execute('SELECT coalesce(max(id),0) FROM pool_calls WHERE account=? AND week<?',(account,period)).fetchone()[0])
                elif not current:cutoff=db.execute('SELECT coalesce(max(id),0) FROM pool_calls WHERE account=?',(account,)).fetchone()[0]
                db.execute('INSERT OR REPLACE INTO account_quota_windows VALUES(?,?,?)',(account,now,cutoff))
            lease=db.execute('INSERT INTO pool_calls(week,account,keyid,provider,model,charge,state) VALUES(?,?,?,?,?,?,?)',(period,account,key[0],p,model,weight,'pending')).lastrowid
            term=db.execute('SELECT category,source FROM benefit_terms WHERE account=? AND start<=? AND end>? ORDER BY start DESC LIMIT 1',(account,time.time(),time.time())).fetchone()
            db.execute('INSERT INTO call_attributions VALUES(?,?,?,?)',(lease,time.time(),*(term or ('unclassified',''))))
            db.execute('INSERT INTO pool_meter(id,unit,rate,held) VALUES(?,?,?,?)',(lease,unit,rate,weight))
            if divisor!=100000000:db.execute('INSERT INTO pool_price_divisors VALUES(?,?)',(lease,divisor))
            if p=='opencode-go':
                setting=db.execute('SELECT monthly,(SELECT monthly FROM pool_subscription_costs WHERE keyid=?) FROM pool_go_limits WHERE model=?',(key[0],model)).fetchone()
                if not setting or not setting[1] or not prices:raise self.F(409,'OpenCode 模型缺少套餐成本或官方限额')
                db.execute('INSERT INTO pool_go_calls VALUES(?,?,?)',(lease,*setting))
            if prices:db.execute('INSERT INTO pool_call_prices VALUES(?,?,?,?,NULL)',(lease,*prices))
            return dict(id=model,model=name,url=URL[p],provider=p,key=credential,maxOutputTokens=max_output),lease
    def finish(self,lease,status,usage=None):
        rejected=status in (400,401,402,403,404,413,422,429)
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT unit,rate,held FROM pool_meter JOIN pool_calls USING(id) WHERE id=? AND state='pending'",(lease,)).fetchone()
            if not row:return
            unit,rate,held=row
            def count(k):
                n=usage.get(k) if isinstance(usage,dict) else None
                return n if type(n) is int and 0<=n<=1000000000 else None
            inp,out,total=map(count,('prompt_tokens','completion_tokens','total_tokens'))
            if total is None and None not in (inp,out):total=inp+out
            charge=0 if rejected else ((total*rate+unit-1)//unit if unit and total is not None else held)
            state='rejected' if rejected else 'ok' if status==200 and (not unit or total is not None) else 'unknown'
            prices=db.execute('SELECT input,cached,output FROM pool_call_prices WHERE id=?',(lease,)).fetchone()
            exact=list_usd=None
            if prices and not rejected:
                hits=count('prompt_cache_hit_tokens')
                details=usage.get('prompt_tokens_details') if isinstance(usage,dict) else None
                if hits is None and isinstance(details,dict):hits=details.get('cached_tokens')
                if hits is None:hits=count('cached_tokens') or 0
                if inp is not None and out is not None and type(hits) is int and 0<=hits<=inp:
                    divisor=db.execute('SELECT divisor FROM pool_price_divisors WHERE id=?',(lease,)).fetchone()
                    exact=Fraction((inp-hits)*prices[0]+hits*prices[1]+out*prices[2],divisor[0] if divisor else 100000000)
                    charge=ceil(exact)
                    db.execute('UPDATE pool_call_prices SET hit=? WHERE id=?',(hits,lease))
                else:charge,state=0,'unknown'
                go=db.execute('SELECT monthly,yuan FROM pool_go_calls WHERE id=?',(lease,)).fetchone()
                if go:
                    receipt=usage.get('opencode',{}) if isinstance(usage,dict) else {}
                    try:
                        source=receipt.get('billing_source')
                        if source not in ('balance','go') or receipt.get('estimated'):raise ValueError()
                        consumed=Decimal(str(usage.get('cost') if source=='balance' else receipt.get('list_cost')))
                        if not consumed.is_finite() or consumed<0:raise ValueError()
                        # Go Basic costs USD 10. Balance charges are already in paid dollars.
                        divisor=10 if source=='balance' else go[0]
                        exact=Fraction(consumed)*Fraction(go[1])*10000/divisor
                        list_usd=str(consumed)
                        charge=ceil(exact)
                    except (ValueError,InvalidOperation,AttributeError):charge,state,exact=0,'unknown',None
            account,period,provider=db.execute('SELECT account,week,provider FROM pool_calls WHERE id=?',(lease,)).fetchone()
            if exact is not None and provider in ('deepseek','opencode-go','kimi','aiopen'):
                cutoff=db.execute('SELECT coalesce(max(cutoff),0) FROM pool_refills WHERE account=? AND week=? AND cutoff<?',(account,period,lease)).fetchone()[0]
                key=(account,period,cutoff)
                row=db.execute('SELECT remainder FROM pool_rounding WHERE account=? AND week=? AND cutoff=?',key).fetchone()
                amount=exact+(Fraction(row[0]) if row else 0)
                charge=ceil(amount)
                db.execute('INSERT OR REPLACE INTO pool_rounding VALUES(?,?,?,?)',(*key,str(amount-charge)))
                db.execute('INSERT INTO pool_receipts VALUES(?,?,?)',(lease,str(exact),list_usd))
            db.execute('UPDATE pool_meter SET input=?,output=?,total=? WHERE id=?',(inp,out,total,lease))
            if status in (401,402,403,429):
                db.execute('UPDATE pool_keys SET cooldown=? WHERE id=(SELECT keyid FROM pool_calls WHERE id=?)',(time.time()+(60 if status==429 else 3600),lease))
            db.execute('UPDATE pool_calls SET state=?,charge=? WHERE id=?',(state,charge,lease))
            if charge==0 and not db.execute("SELECT 1 FROM pool_calls c JOIN account_quota_windows w ON w.account=c.account WHERE c.account=? AND c.id>w.cutoff AND (c.charge>0 OR c.state='pending') LIMIT 1",(account,)).fetchone():
                db.execute('UPDATE account_quota_windows SET started=NULL WHERE account=?',(account,))
    def refresh_balances(self):
        while True:
            try:
                with self.s.db() as db:
                    keys=db.execute("""SELECT k.id FROM pool_keys k LEFT JOIN pool_inventory_samples s ON s.keyid=k.id
                        WHERE k.provider IN ('deepseek','opencode-go','kimi','aiopen','qwen-plan') AND k.enabled=1 AND coalesce(s.checked,0)<?""",(time.time()-540,)).fetchall()
                for (key,) in keys:
                    try:
                        self.balance(key)
                    except self.F:
                        continue
            except sqlite3.Error:
                pass
            time.sleep(600)

    def balance(self,ident):
        with self.s.db() as db:
            row=db.execute("SELECT secret,provider,digest FROM pool_keys WHERE id=?",(ident,)).fetchone()
        if not row:raise self.F(404,'未找到支持余额查询的账号')
        def record(balances,metrics):
            if not metrics:raise ValueError()
            for metric in metrics:
                for k in ('remaining','total','percent'):
                    if k in metric and not Decimal(str(metric[k])).is_finite():raise ValueError()
            checked=time.time()
            with self.s.db() as db:
                db.execute('INSERT OR REPLACE INTO pool_inventory_samples SELECT id,?,? FROM pool_keys WHERE id=? AND digest=?',(checked,json.dumps(metrics),ident,row[2]))
                inventory=self.inventory(db)
            return dict(balances=balances,checkedAt=checked,inventory=inventory)
        if row[1] in ('qwen','qwen-plan'):
            home=Path(os.environ.get('CSHELL_BAILIAN_QUOTA_HOME','/var/lib/cshell-bailian'))/ident
            cli=shutil.which('bl') or '/opt/cshell-sync/bailian/.local/bin/bl'
            if not os.access(cli,os.X_OK) or not (home/'.bailian/config.json').is_file():raise self.F(409,'需为此号池账号绑定独立的百炼控制台登录')
            try:
                plan=row[1]=='qwen-plan'
                run=subprocess.run([cli,'usage','token-plan' if plan else 'free','--output','json'],env={'HOME':str(home),'PATH':os.environ['PATH'],'LANG':'C.UTF-8'},cwd=home,stdin=subprocess.DEVNULL,capture_output=True,timeout=18,check=True)
                obj=json.loads(run.stdout)
                if isinstance(obj,dict):obj=obj.get('data',obj)
                if plan:
                    balances=[dict(currency=k[:-10],amount=f'{Decimal(str(v))*100:g}% 已用') for k,v in obj.items() if re.fullmatch(r'per[0-9]+(?:Hour|Day|Week|Month)Percentage',k)]
                else:
                    balances=[dict(currency=str(r['model']),amount=f"{r['remaining']} / {r['total']} 免费额度") for r in obj if r.get('remaining') is not None]
                if not balances:raise ValueError()
                return record(balances,[dict(unit=r['currency'],percent=r['amount'].split('%')[0]) for r in balances] if plan else [dict(unit=str(r['model'])+' 免费额度',remaining=str(r['remaining']),total=str(r['total'])) for r in obj if r.get('remaining') is not None])
            except Exception as error:
                print('Bailian quota lookup failed:', type(error).__name__, getattr(error,'returncode',None), flush=True)
                raise self.F(502,'百炼未返回可核对的额度，请检查此账号的控制台登录')
        try:
            token=self.cipher().decrypt(row[0]).decode()
            endpoint={'aiopen':'https://aiopen.one/api/usage/token/','kimi':'https://api.moonshot.cn/v1/users/me/balance','mimo':'https://api.xiaomimimo.com/v1/platform/balance','mimo-plan':'https://token-plan-cn.xiaomimimo.com/v1/platform/token_plan','opencode-go':'https://opencode.ai/inference/go/v1/usage','deepseek':'https://api.deepseek.com/user/balance'}[row[1]]
            with upstream(urllib.request.Request(endpoint,headers={'Authorization':'Bearer '+token}),timeout=8) as resp:
                obj=json.loads(resp.read(65536))
            if row[1]=='aiopen':
                if obj.get('code',obj.get('success')) is not True:
                    raise ValueError()
                quota=obj['data']
                if quota['unlimited_quota'] is True:
                    return record([dict(currency='Key 额度',amount='不限额')],[dict(unit='Key 额度',unlimited=True)])
                remaining,total=quota['total_available'],quota['total_granted']
                if quota['unlimited_quota'] is not False or any(type(n) is not int or n<0 for n in (remaining,total)) or remaining>total:
                    raise ValueError()
                return record([dict(currency='Key 剩余 / 总额度',amount=f'{remaining:,} / {total:,}')],
                              [dict(unit='Key 配额单位',remaining=str(remaining),total=str(total))])
            if row[1]=='kimi':
                value=str(Decimal(str(obj['data']['available_balance'])))
                return record([dict(currency='CNY',amount=value)],[dict(unit='CNY',remaining=value)])
            if row[1]=='mimo-plan':
                q=obj['quota']
                return record([dict(currency='剩余积分 / 总积分',amount=f"{q['remaining_credits']} / {q['total_credits']}")],[dict(unit='credits',remaining=str(q['remaining_credits']),total=str(q['total_credits']))])
            if row[1]=='opencode-go':
                usage=obj['usage']
                windows=[{'currency':label,'amount':f"{float(usage[k]['percent']):g}% 已用"} for k,label in [('rolling','滚动窗口'),('weekly','本周'),('monthly','本月')] if k in usage]
                if not windows:raise ValueError()
                return record(windows,[dict(unit=label,percent=usage[k]['percent'],resetAt=usage[k].get('resetsAt')) for k,label in [('rolling','滚动窗口'),('weekly','本周'),('monthly','本月')] if k in usage])
            balances=[{'currency':r['currency'],'amount':str(Decimal(r['total_available'])-Decimal(r['frozen_balance']) if row[1]=='mimo' else Decimal(r['total_balance']))} for r in obj['balance_infos'] if r['currency'] in ('USD','CNY')]
            return record(balances,[dict(unit=r['currency'],remaining=r['amount']) for r in balances])
        except Exception:raise self.F(502,'暂时无法向供应商核对额度')
