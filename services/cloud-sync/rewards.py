"""Invitation attribution, settled recharge orders and single-use gift cards."""
import json
import re
import secrets
import time
from model_pool import week


class Rewards:
    def __init__(self, service, failure):
        self.s,self.fail=service,failure
        with service.db() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS invitation_codes(code TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS invitations(member TEXT PRIMARY KEY, inviter TEXT NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS invitation_owner ON invitations(inviter);
            CREATE TABLE IF NOT EXISTS recharge_orders(id TEXT PRIMARY KEY, account TEXT NOT NULL, points INTEGER NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS plan_offers(plan TEXT PRIMARY KEY,days INTEGER NOT NULL,price INTEGER NOT NULL,enabled INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS plan_orders(account TEXT,request TEXT,plan TEXT,days INTEGER,price INTEGER,expires REAL,PRIMARY KEY(account,request));
            CREATE TABLE IF NOT EXISTS gift_sale_orders(id TEXT PRIMARY KEY,card TEXT UNIQUE NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS gift_campaigns(card TEXT PRIMARY KEY,limit_count INTEGER NOT NULL,purpose TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS gift_claims(card TEXT,account TEXT,claimed REAL,PRIMARY KEY(card,account));
            CREATE TABLE IF NOT EXISTS monthly_machine_rates(resource TEXT PRIMARY KEY,amount_fen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS expense_lines(reference TEXT PRIMARY KEY,category TEXT,destination TEXT,amount_fen INTEGER,source TEXT,created REAL);
            CREATE TABLE IF NOT EXISTS benefit_terms(account TEXT,start REAL,end REAL,category TEXT,source TEXT,PRIMARY KEY(account,source));
            CREATE TABLE IF NOT EXISTS gift_cards(id TEXT PRIMARY KEY, kind TEXT NOT NULL, quantity INTEGER NOT NULL, plan TEXT NOT NULL, created REAL NOT NULL, recipient TEXT, redeemed REAL);
            """)

    def account(self, account):
        with self.s.db() as db:
            db.execute('INSERT OR IGNORE INTO invitation_codes VALUES(?,?)',(secrets.token_hex(12),account))
            code=db.execute('SELECT code FROM invitation_codes WHERE owner=?',(account,)).fetchone()[0]
            count=db.execute('SELECT count(*) FROM invitations WHERE inviter=?',(account,)).fetchone()[0]
            earned=db.execute("SELECT coalesce(sum(delta),0) FROM rental_points WHERE account=? AND reference LIKE 'invite:%'",(account,)).fetchone()[0]
            ledger=[dict(reference=r,points=n) for r,n in db.execute('SELECT reference,delta FROM rental_points WHERE account=? ORDER BY rowid DESC LIMIT 100',(account,))]
            return dict(invite=code,invited=count,earned=earned,ledger=ledger)

    def trace(self, account, reference):
        if not isinstance(account,str) or not isinstance(reference,str) or not 1<=len(reference)<=200:
            raise self.fail(400,'账号或流水编号无效')
        with self.s.db() as db:
            row=db.execute('SELECT rowid,delta FROM rental_points WHERE account=? AND reference=?',(account,reference)).fetchone()
            if not row:raise self.fail(404,'点数流水不存在')
            def source(ref,amount):
                result=dict(reference=ref,points=amount)
                prefix,_,order=ref.partition(':')
                if prefix in ('recharge','invite'):
                    receipt=db.execute('SELECT id,points,created FROM recharge_orders WHERE id=?',(order,)).fetchone()
                    if receipt:result['order']=dict(id=receipt[0],paidPoints=receipt[1],created=receipt[2])
                if prefix=='gift':
                    sale=db.execute('SELECT id FROM gift_sale_orders WHERE card=?',(order,)).fetchone()
                    if sale:result['saleOrder']=sale[0]
                return result
            if row[1]>=0:return dict(entries=[source(reference,row[1])])
            # Credit and debit totals define intervals on the same FIFO point sequence.
            spent=-db.execute('SELECT coalesce(sum(delta),0) FROM rental_points WHERE account=? AND delta<0 AND rowid<?',(account,row[0])).fetchone()[0]
            end=spent-row[1]
            rows=db.execute("""WITH income AS (
                SELECT reference,delta,sum(delta) OVER (ORDER BY rowid) AS finish FROM rental_points
                WHERE account=? AND delta>0 AND rowid<?)
                SELECT reference,min(finish,?)-max(finish-delta,?) FROM income
                WHERE finish>? AND finish-delta<? ORDER BY finish""",(account,row[0],end,spent,spent,end)).fetchall()
            return dict(entries=[source(ref,n) for ref,n in rows],unmatched=-row[1]-sum(n for _,n in rows))

    def attribute(self, db, account, code):
        if not code:return
        owner=db.execute('SELECT owner FROM invitation_codes WHERE code=?',(code,)).fetchone() if isinstance(code,str) else None
        if not owner or owner[0]==account:raise self.fail(400,'邀请码无效')
        db.execute('INSERT INTO invitations VALUES(?,?,?)',(account,owner[0],time.time()))

    def settle(self, body):
        account,order,points=(body.get(k) for k in ('account','order','points'))
        if not isinstance(order,str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}',order) or type(points) is not int or not 1<=points<=100000000:
            raise self.fail(400,'已支付订单编号或点数无效')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT account,points FROM recharge_orders WHERE id=?',(order,)).fetchone()
            if prior:
                if prior!=(account,points):raise self.fail(409,'该订单已按其他内容入账')
                return dict(ok=True)
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():raise self.fail(404,'账号不存在')
            db.execute('INSERT INTO recharge_orders VALUES(?,?,?,?)',(order,account,points,time.time()))
            db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'recharge:'+order,points))
            inviter=db.execute('SELECT inviter FROM invitations WHERE member=?',(account,)).fetchone()
            if inviter:
                # Carry fractions across orders, including several small recharges.
                total=db.execute('SELECT sum(points) FROM recharge_orders JOIN invitations ON member=account WHERE inviter=?',inviter).fetchone()[0]
                reward=total//20-(total-points)//20
                if reward:db.execute('INSERT INTO rental_points VALUES(?,?,?)',(inviter[0],'invite:'+order,reward))
        return dict(ok=True)

    def offers(self, body=None):
        with self.s.db() as db:
            if body is not None:
                plan,days,price,enabled=(body.get(k) for k in ('plan','days','price','enabled'))
                if type(days) is not int or not 1<=days<=3660 or type(price) is not int or not 1<=price<=100000000 or type(enabled) is not bool or not db.execute('SELECT 1 FROM member_plans WHERE name=?',(plan,)).fetchone():raise self.fail(400,'请核对套餐、天数和点数')
                db.execute('INSERT OR REPLACE INTO plan_offers VALUES(?,?,?,?)',(plan,days,price,enabled))
            return dict(offers=[dict(plan=p,days=d,price=n,enabled=bool(e)) for p,d,n,e in db.execute('SELECT * FROM plan_offers ORDER BY price')])
    def catalog(self):
        with self.s.db() as db:
            baseline=(db.execute("SELECT weekly_cents FROM member_plans WHERE name='Pro'").fetchone() or (500,))[0] or 500
            machines=[json.loads(r[0]) for r in db.execute('SELECT details FROM rental_plans')]
            plans=[]
            for name,weekly,storage,spec in db.execute('SELECT * FROM member_plans'):
                m=next((p for p in machines if p['id']==spec or (spec=='*' and p.get('specOnly') and p['included'])),None)
                sale=db.execute('SELECT days,price FROM plan_offers WHERE plan=? AND enabled=1',(name,)).fetchone()
                plans.append(dict(plan=name,relativeQuota=(weekly or 500)/baseline,storageMiB=storage if storage is not None else 64,machine=m['name'] if m else None,price=sale[1] if sale else None,days=sale[0] if sale else None))
            return dict(plans=plans,offers=[dict(plan=p['plan'],days=p['days'],price=p['price'],enabled=True) for p in plans if p['price'] is not None])

    def expenses(self,body=None):
        from fractions import Fraction
        with self.s.db() as db:
            if body is not None and body.get('action')=='monthly-rate':
                resource,amount=body.get('resource'),body.get('amountFen')
                if not isinstance(resource,str) or not 1<=len(resource.strip())<=120 or type(amount) is not int or not 0<=amount<=10000000000:raise self.fail(400,'请核对机器名称和月租')
                db.execute('INSERT INTO monthly_machine_rates VALUES(?,?) ON CONFLICT(resource) DO UPDATE SET amount_fen=excluded.amount_fen',(resource.strip(),amount))
            elif body is not None:
                ref,category,destination,fen,source=(body.get(k) for k in ('reference','category','destination','amountFen','source'))
                if category not in ('sale','promotion','shared') or not all(isinstance(s,str) and 1<=len(s.strip())<=120 for s in (ref,destination,source)) or type(fen) is not int or not 1<=fen<=10000000000:raise self.fail(400,'请核对单据、金额、用途、关联来源和收款方')
                row=(ref,category,destination,fen,source)
                db.execute('INSERT OR IGNORE INTO expense_lines VALUES(?,?,?,?,?,?)',(*row,time.time()))
                if db.execute('SELECT reference,category,destination,amount_fen,source FROM expense_lines WHERE reference=?',(ref,)).fetchone()!=row:raise self.fail(409,'单据号已登记不同费用')
            groups=[dict(category=c,destination=d,amountFen=f) for c,d,f in db.execute('SELECT category,destination,sum(amount_fen) FROM expense_lines GROUP BY category,destination')]
            meters={}
            for c,p,each,state in db.execute("""SELECT coalesce(a.category,'unclassified'),c.provider,r.exact_units,c.state FROM pool_calls c LEFT JOIN call_attributions a ON a.id=c.id LEFT JOIN pool_receipts r ON r.id=c.id WHERE c.state IN ('ok','unknown')"""):
                value=meters.setdefault((c,p),[Fraction(0),0])
                if each is None:value[1]+=1
                else:value[0]+=Fraction(each)
            rates=[dict(resource=r,amountFen=n) for r,n in db.execute('SELECT resource,amount_fen FROM monthly_machine_rates ORDER BY resource')]
            return dict(monthlyRates=rates,monthlyMachineFen=sum(r['amountFen'] for r in rates),totalFen=sum(g['amountFen'] for g in groups),groups=groups,models=[dict(category=c,provider=p,estimatedYuan=round(float(v[0]/10000),6),unpriced=v[1]) for (c,p),v in meters.items()],entries=[dict(reference=r,category=c,destination=d,amountFen=f,source=s) for r,c,d,f,s in db.execute('SELECT reference,category,destination,amount_fen,source FROM expense_lines ORDER BY created DESC LIMIT 100')])

    def buy_plan(self, account, body):
        plan,days,price,request=(body.get(k) for k in ('plan','days','price','request'))
        if not isinstance(request,str) or not re.fullmatch(r'[a-f0-9-]{36}',request):raise self.fail(400,'订单编号无效')
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT plan,days,price,expires FROM plan_orders WHERE account=? AND request=?',(account,request)).fetchone()
            if prior:
                if prior[:3]!=(plan,days,price):raise self.fail(409,'订单内容已变化')
                return dict(expires=prior[3])
            if not db.execute('SELECT 1 FROM plan_offers WHERE plan=? AND days=? AND price=? AND enabled=1',(plan,days,price)).fetchone() or type(price) is not int or type(days) is not int:raise self.fail(409,'售价已变化，请刷新')
            now=time.time()
            expiry=(db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone() or (0,))[0]
            current=db.execute('SELECT plan FROM member_assignments WHERE account=? AND expires>?',(account,now)).fetchone()
            if expiry>now and (current or ('Pro',))[0]!=plan:raise self.fail(409,'当前会员有效期内可续费同一套餐')
            if self.s.rentals.balance(db,account)<price:raise self.fail(409,'可用点数不足')
            end=max(now,expiry)+days*86400
            db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'member-plan:'+request,-price))
            db.execute('INSERT INTO plan_orders VALUES(?,?,?,?,?,?)',(account,request,plan,days,price,end))
            db.execute('INSERT OR REPLACE INTO memberships VALUES(?,?)',(account,end))
            db.execute('INSERT OR REPLACE INTO member_assignments VALUES(?,?,?)',(account,plan,end))
            db.execute('INSERT INTO benefit_terms VALUES(?,?,?,?,?)',(account,max(now,expiry),end,'sale','plan:'+request))
            return dict(expires=end)
    def issue(self, body):
        request,kind,quantity,plan=(body.get(k) for k in ('request','kind','quantity','plan'))
        if not isinstance(request,str) or not re.fullmatch(r'[a-f0-9-]{36}',request) or kind not in ('points','membership','reset') or type(quantity) is not int or not 1<=quantity<={'points':100000000,'membership':3660,'reset':1}[kind]:
            raise self.fail(400,'礼品卡参数无效')
        plan=plan if kind=='membership' else ''
        limit=body.get('maxClaims',1)
        purpose=body.get('purpose','sale')
        if type(limit) is not int or not 1<=limit<=100000 or purpose not in ('sale','promotion'):raise self.fail(400,'领取人数或用途无效')
        order=body.get('saleOrder','')
        if not isinstance(order,str) or (order and not re.fullmatch(r'[A-Za-z0-9._-]{1,100}',order)):
            raise self.fail(400,'销售单号可填写字母、数字、点、横线或下划线')
        code=self.s.digest('gift-sale:'+order if order else 'gift-card:'+request)[:32].upper()
        ident=self.s.digest('gift-redeem:'+code)
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if kind=='membership' and not db.execute('SELECT 1 FROM member_plans WHERE name=?',(plan,)).fetchone():raise self.fail(400,'会员套餐无效')
            if order:
                db.execute('INSERT OR IGNORE INTO gift_sale_orders VALUES(?,?,?)',(order,ident,time.time()))
            existing=db.execute('SELECT 1 FROM gift_cards WHERE id=?',(ident,)).fetchone()
            meta=db.execute('SELECT limit_count,purpose FROM gift_campaigns WHERE card=?',(ident,)).fetchone()
            if existing and (meta or (1,'sale'))!=(limit,purpose):raise self.fail(409,'发卡编号已用于其他活动')
            db.execute('INSERT OR IGNORE INTO gift_campaigns VALUES(?,?,?)',(ident,limit,purpose))
            db.execute('INSERT OR IGNORE INTO gift_cards VALUES(?,?,?,?,?,NULL,NULL)',(ident,kind,quantity,plan,time.time()))
            if db.execute('SELECT kind,quantity,plan FROM gift_cards WHERE id=?',(ident,)).fetchone()!=(kind,quantity,plan):raise self.fail(409,'发卡编号已使用')
        return dict(code=code,kind=kind,quantity=quantity,plan=plan,saleOrder=order,maxClaims=limit,purpose=purpose)

    def redeem(self,account,body):
        code=body.get('code')
        if not isinstance(code,str) or not re.fullmatch(r'[a-fA-F0-9]{32}',code.strip()):raise self.fail(400,'请输入完整兑换码')
        ident=self.s.digest('gift-redeem:'+code.strip().upper())
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            card=db.execute('SELECT kind,quantity,plan,recipient FROM gift_cards WHERE id=?',(ident,)).fetchone()
            if not card:raise self.fail(404,'兑换码无效')
            kind,quantity,plan,recipient=card
            limit,purpose=db.execute('SELECT limit_count,purpose FROM gift_campaigns WHERE card=?',(ident,)).fetchone() or (1,'sale')
            already=recipient==account or db.execute('SELECT 1 FROM gift_claims WHERE card=? AND account=?',(ident,account)).fetchone()
            if not already:
                claimed=db.execute('SELECT count(*) FROM gift_claims WHERE card=?',(ident,)).fetchone()[0]
                if (limit==1 and recipient) or claimed>=limit:raise self.fail(409,'礼品卡已领完')
                now=time.time()
                expiry=(db.execute('SELECT expires FROM memberships WHERE account=?',(account,)).fetchone() or (0,))[0]
                if kind=='points':
                    db.execute('INSERT INTO rental_points VALUES(?,?,?)',(account,'gift:'+ident,quantity))
                elif kind=='membership':
                    current=db.execute('SELECT plan FROM member_assignments WHERE account=? AND expires>?',(account,now)).fetchone()
                    if expiry>now and (current or ('Pro',))[0]!=plan:raise self.fail(409,'请在当前会员到期后兑换其他套餐')
                    expires=max(expiry,now)+quantity*86400
                    db.execute('INSERT OR REPLACE INTO memberships VALUES(?,?)',(account,expires))
                    db.execute('INSERT OR REPLACE INTO member_assignments VALUES(?,?,?)',(account,plan,expires))
                    db.execute('INSERT INTO benefit_terms VALUES(?,?,?,?,?)',(account,max(now,expiry),expires,purpose,'gift:'+ident))
                else:
                    if expiry<=now:raise self.fail(403,'请先开通会员')
                    period=week()
                    _,used,last,pending=self.s.models.pool.allowance(db,account,period)
                    if pending or used<=0:raise self.fail(409,'当前无需重置或有请求进行中，礼品卡仍可使用')
                    db.execute('INSERT INTO pool_refills VALUES(?,?,?,?,?)',(account,'gift:'+ident,period,last,now))
                    db.execute('INSERT OR REPLACE INTO account_quota_windows VALUES(?,NULL,?)',(account,last))
                db.execute('INSERT INTO gift_claims VALUES(?,?,?)',(ident,account,now))
                if limit==1:db.execute('UPDATE gift_cards SET recipient=?,redeemed=? WHERE id=?',(account,now,ident))
        return dict(ok=True,kind=kind,quantity=quantity,plan=plan)
