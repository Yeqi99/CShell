"""Internal traffic accounting. Counters are cumulative per authenticated stream.

Never accept these measurements from an end-user request. A stream has exactly
one category so MCP carried over relay is not also billed as relay traffic.
"""
from datetime import datetime, timezone

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
            ''')

    def record(self, account, stream, category, ingress, egress, now=None):
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
            db.execute('INSERT OR REPLACE INTO traffic_streams VALUES(?,?,?,?,?,?)', (account,period,stream,category,*current))
            db.execute('INSERT INTO traffic_totals VALUES(?,?,?,?,?) ON CONFLICT(account,period,category) DO UPDATE SET ingress=ingress+excluded.ingress,egress=egress+excluded.egress', (account,period,category,*delta))
        return {'period':period, 'addedIngressBytes':delta[0], 'addedEgressBytes':delta[1]}

    def summary(self, account):
        with self.service.db() as db:
            rows=db.execute('SELECT period,category,ingress,egress FROM traffic_totals WHERE account=? ORDER BY period DESC,category LIMIT 48',(account,)).fetchall()
        return [{'period':p,'category':c,'ingressBytes':i,'egressBytes':e} for p,c,i,e in rows]
