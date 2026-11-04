"""Internal traffic accounting. Counters are cumulative per authenticated stream.

Never accept these measurements from an end-user request. A stream has exactly
one category so MCP carried over relay is not also billed as relay traffic.
"""
from datetime import datetime, timezone
import time,json,re
from decimal import Decimal,InvalidOperation

CATEGORIES = ('relay', 'mcp')


class Metering:
    def __init__(self, service):
        self.service = service
        with service.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS traffic_streams(
              account TEXT NOT NULL, period TEXT NOT NULL, stream TEXT NOT NULL,
              category TEXT NOT NULL, ingress INTEGER NOT NULL, egress INTEGER NOT NULL,
              PRIMARY KEY(account,period,stream));
            CREATE TABLE IF NOT EXISTS traffic_totals(
              account TEXT NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL,
              ingress INTEGER NOT NULL, egress INTEGER NOT NULL,
              PRIMARY KEY(account,period,category));
            CREATE TABLE IF NOT EXISTS traffic_limits(account TEXT NOT NULL,category TEXT NOT NULL,bytes INTEGER,
              PRIMARY KEY(account,category));
            CREATE TABLE IF NOT EXISTS traffic_reservations(id TEXT PRIMARY KEY,account TEXT NOT NULL,period TEXT NOT NULL,category TEXT NOT NULL,budget INTEGER NOT NULL,settled INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS traffic_grants(id TEXT PRIMARY KEY,account TEXT NOT NULL,period TEXT NOT NULL,category TEXT NOT NULL,bytes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS traffic_rates(period TEXT NOT NULL,category TEXT NOT NULL,ingress TEXT NOT NULL,egress TEXT NOT NULL,currency TEXT NOT NULL,PRIMARY KEY(period,category));
            ''')

    def record(self, account, stream, category, ingress, egress, now=None, enforce=False):
        if category not in CATEGORIES:
            raise ValueError('Unknown traffic category')
        if not isinstance(stream, str) or not 1 <= len(stream) <= 128:
            raise ValueError('Invalid stream identity')
        if any(type(v) is not int or not 0 <= v <= 2**53-1 for v in (ingress, egress)):
            raise ValueError('Invalid byte counter')
        period = datetime.fromtimestamp(now, timezone.utc).strftime('%Y-%m') if now is not None else datetime.now(timezone.utc).strftime('%Y-%m')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?', (account,)).fetchone():
                raise ValueError('Unknown account')
            old = db.execute('SELECT category,ingress,egress FROM traffic_streams WHERE account=? AND period=? AND stream=?', (account,period,stream)).fetchone()
            if old and old[0] != category:
                raise ValueError('Stream category cannot change')
            before = old[1:] if old else (0,0)
            current = (max(before[0], ingress), max(before[1], egress))
            delta = (current[0]-before[0], current[1]-before[1])
            if enforce:
                cap=db.execute('SELECT bytes FROM traffic_limits WHERE account=? AND category=?',(account,category)).fetchone()
                used=db.execute('SELECT ingress+egress FROM traffic_totals WHERE account=? AND period=? AND category=?',(account,period,category)).fetchone()
                if cap and cap[0] is not None and (used[0] if used else 0)+sum(delta)>cap[0]:
                    raise TrafficLimitExceeded('Monthly traffic allowance exhausted')
            db.execute('INSERT OR REPLACE INTO traffic_streams VALUES(?,?,?,?,?,?)', (account,period,stream,category,*current))
            db.execute('INSERT INTO traffic_totals VALUES(?,?,?,?,?) ON CONFLICT(account,period,category) DO UPDATE SET ingress=ingress+excluded.ingress,egress=egress+excluded.egress', (account,period,category,*delta))
        return {'period':period, 'addedIngressBytes':delta[0], 'addedEgressBytes':delta[1]}

    def configure_limit(self, account, category, amount, reason):
        """Internal/admin only. Missing or null limit preserves unlimited existing entitlement."""
        if category not in CATEGORIES or (amount is not None and (type(amount) is not int or not 0<=amount<=2**53-1)):
            raise ValueError('Invalid traffic limit')
        if not isinstance(reason,str) or not 2<=len(reason.strip())<=300:raise ValueError('Reason required')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():raise ValueError('Unknown account')
            db.execute('INSERT OR REPLACE INTO traffic_limits VALUES(?,?,?)',(account,category,amount))
            db.execute("INSERT INTO admin_audit(at,account,action,detail) VALUES(strftime('%s','now'),?,'traffic.limit',?)",(account,category+': '+str(amount)+'; '+reason))

    def reserve(self, account, identity, category, budget):
        if category not in CATEGORIES or type(budget) is not int or not 0<=budget<=2**53-1 or not isinstance(identity,str) or not 1<=len(identity)<=128:raise ValueError('Invalid reservation')
        period=datetime.now(timezone.utc).strftime('%Y-%m')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():raise ValueError('Unknown account')
            old=db.execute('SELECT account,category,budget,settled FROM traffic_reservations WHERE id=?',(identity,)).fetchone()
            if old:
                if old[:3]!=(account,category,budget) or old[3]:raise ValueError('Reservation identity already used')
                return
            cap=db.execute('SELECT bytes FROM traffic_limits WHERE account=? AND category=?',(account,category)).fetchone()
            extra=db.execute('SELECT COALESCE(SUM(bytes),0) FROM traffic_grants WHERE account=? AND period=? AND category=?',(account,period,category)).fetchone()[0]
            used=db.execute('SELECT ingress+egress FROM traffic_totals WHERE account=? AND period=? AND category=?',(account,period,category)).fetchone()
            held=db.execute('SELECT COALESCE(SUM(budget),0) FROM traffic_reservations WHERE account=? AND period=? AND category=? AND settled=0',(account,period,category)).fetchone()[0]
            if cap and cap[0] is not None and (used[0] if used else 0)+held+budget>cap[0]+extra:raise TrafficLimitExceeded('Monthly traffic allowance exhausted')
            db.execute('INSERT INTO traffic_reservations VALUES(?,?,?,?,?,0)',(identity,account,period,category,budget))

    def settle(self, account, identity, ingress, egress, audit=None):
        if any(type(v) is not int or v<0 for v in (ingress,egress)):raise ValueError('Invalid counters')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT period,category,budget,settled FROM traffic_reservations WHERE id=? AND account=?',(identity,account)).fetchone()
            if not row or ingress+egress>row[2]:raise ValueError('Reservation exceeded or missing')
            old=db.execute('SELECT ingress,egress FROM traffic_streams WHERE account=? AND period=? AND stream=?',(account,row[0],identity)).fetchone()
            if row[3]:
                if old!=(ingress,egress):raise ValueError('Settlement differs')
                return
            # A bounded operation settles in the UTC month in which its budget
            # was granted, even when its response arrives just after midnight.
            db.execute('INSERT INTO traffic_streams VALUES(?,?,?,?,?,?)',(account,row[0],identity,row[1],ingress,egress))
            db.execute('INSERT INTO traffic_totals VALUES(?,?,?,?,?) ON CONFLICT(account,period,category) DO UPDATE SET ingress=ingress+excluded.ingress,egress=egress+excluded.egress',(account,row[0],row[1],ingress,egress))
            db.execute('UPDATE traffic_reservations SET settled=1 WHERE id=?',(identity,))
            if audit:db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),account,'traffic.reconcile',json.dumps(audit,ensure_ascii=False)))

    def summary(self, account):
        with self.service.db() as db:
            rows=db.execute('SELECT period,category,ingress,egress FROM traffic_totals WHERE account=? ORDER BY period DESC,category LIMIT 48',(account,)).fetchall()
        return [{'period':p,'category':c,'ingressBytes':i,'egressBytes':e} for p,c,i,e in rows]

    def account_view(self, account, now=None):
        """Authenticated owner-only view; never exposes stream IDs or internal costs."""
        instant=datetime.fromtimestamp(time.time() if now is None else now,timezone.utc)
        period=instant.strftime('%Y-%m')
        start=instant.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
        end=start.replace(year=start.year+1,month=1) if start.month==12 else start.replace(month=start.month+1)
        channels=[]
        with self.service.db() as db:
            db.execute('BEGIN')
            if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():raise ValueError('Unknown account')
            for category in CATEGORIES:
                cap=db.execute('SELECT bytes FROM traffic_limits WHERE account=? AND category=?',(account,category)).fetchone()
                extra=db.execute('SELECT COALESCE(SUM(bytes),0) FROM traffic_grants WHERE account=? AND period=? AND category=?',(account,period,category)).fetchone()[0]
                totals=db.execute('SELECT ingress,egress FROM traffic_totals WHERE account=? AND period=? AND category=?',(account,period,category)).fetchone() or (0,0)
                held=db.execute('SELECT COALESCE(SUM(budget),0) FROM traffic_reservations WHERE account=? AND period=? AND category=? AND settled=0',(account,period,category)).fetchone()[0]
                base=cap[0] if cap else None
                limit=None if base is None else base+extra
                used=sum(totals)
                channels.append(dict(category=category,ingressBytes=totals[0],egressBytes=totals[1],usedBytes=used,reservedBytes=held,baseLimitBytes=base,addonBytes=extra,limitBytes=limit,remainingBytes=None if limit is None else max(0,limit-used-held)))
        return dict(period=period,timezone='UTC',periodStartsAt=int(start.timestamp()),periodEndsAt=int(end.timestamp()),updatedAt=int(instant.timestamp()),channels=channels)

    def admin_change(self, body):
        action=body.get('action');reason=body.get('reason');category=body.get('category');period=body.get('period')
        if not isinstance(reason,str) or not 2<=len(reason.strip())<=300 or category not in CATEGORIES:raise ValueError('Invalid change')
        if action=='limit':
            self.configure_limit(body.get('account'),category,body.get('bytes'),reason);return {'ok':True}
        if action=='reconcile':
            self.settle(body.get('account'),body.get('id'),body.get('ingressBytes'),body.get('egressBytes'),audit=body)
            return {'ok':True}
        if not isinstance(period,str) or not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])',period):raise ValueError('Invalid UTC month')
        with self.service.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if action=='grant':
                account=body.get('account');identity=body.get('id');amount=body.get('bytes')
                if not isinstance(identity,str) or not 8<=len(identity)<=128 or type(amount) is not int or not 0<amount<=2**40:raise ValueError('Invalid grant')
                if not db.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():raise ValueError('Unknown account')
                value=(account,period,category,amount)
                old=db.execute('SELECT account,period,category,bytes FROM traffic_grants WHERE id=?',(identity,)).fetchone()
                if old:
                    if old!=value:raise ValueError('Grant ID conflict')
                    return {'ok':True}
                db.execute('INSERT INTO traffic_grants VALUES(?,?,?,?,?)',(identity,*value))
            elif action=='rate':
                rates=[]
                for key in ('ingress','egress'):
                    try:rate=Decimal(str(body.get(key)))
                    except InvalidOperation:raise ValueError('Invalid rate')
                    if not rate.is_finite() or not 0<=rate<=1000000:raise ValueError('Invalid rate')
                    rates.append(str(rate))
                currency=body.get('currency')
                if currency not in ('CNY','USD'):raise ValueError('Invalid currency')
                db.execute('INSERT OR REPLACE INTO traffic_rates VALUES(?,?,?,?,?)',(period,category,*rates,currency))
            else:raise ValueError('Invalid action')
            db.execute('INSERT INTO admin_audit(at,account,action,detail) VALUES(?,?,?,?)',(time.time(),body.get('account'),'traffic.'+action,json.dumps(body,ensure_ascii=False)))
        return {'ok':True}

    def admin_view(self):
        with self.service.db() as db:
            rows=db.execute('SELECT t.account,a.email,t.period,t.category,t.ingress,t.egress,r.ingress,r.egress,r.currency FROM traffic_totals t JOIN accounts a ON a.id=t.account LEFT JOIN traffic_rates r ON r.period=t.period AND r.category=t.category ORDER BY t.period DESC LIMIT 1000').fetchall()
            held=db.execute('SELECT id,account,period,category,budget FROM traffic_reservations WHERE settled=0 LIMIT 1000').fetchall()
            limits=db.execute('SELECT account,category,bytes FROM traffic_limits').fetchall()
        return {'usage':[{'account':a,'email':mail,'period':p,'category':c,'ingressBytes':i,'egressBytes':e,'cost':str((Decimal(i)*Decimal(ri)+Decimal(e)*Decimal(re_))/Decimal(1024**3)) if ri is not None else None,'currency':currency} for a,mail,p,c,i,e,ri,re_,currency in rows], 'reservations':[dict(zip(('id','account','period','category','budget'),r)) for r in held],'limits':[dict(zip(('account','category','bytes'),r)) for r in limits]}


class TrafficLimitExceeded(Exception):
    pass
