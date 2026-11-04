import os
import tempfile
import unittest
from server import Service
from metering import Metering,TrafficLimitExceeded
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone


class MeteringTests(unittest.TestCase):
    def test_restart_keeps_held_budget_and_late_settlement_uses_original_month(self):
        with tempfile.TemporaryDirectory() as d:
            path=os.path.join(d,'test.db');service=Service(path,b'x'*32,lambda *a:None)
            with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            service.metering.configure_limit('a','mcp',100,'restart test')
            service.metering.reserve('a','pending','mcp',100)
            restarted=Service(path,b'x'*32,lambda *a:None)
            with self.assertRaises(TrafficLimitExceeded):restarted.metering.reserve('a','second','mcp',1)
            with restarted.db() as db:db.execute("UPDATE traffic_reservations SET period='2026-10' WHERE id='pending'")
            restarted.metering.settle('a','pending',30,40)
            self.assertEqual(restarted.metering.summary('a')[0]['period'],'2026-10')
            restarted.metering.reserve('a','new-month','mcp',100)
    def test_grants_rates_and_recovery_are_audited(self):
        with tempfile.TemporaryDirectory() as d:
            service=Service(os.path.join(d,'test.db'),b'x'*32,lambda *a:None)
            with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            meter=service.metering;period=datetime.now(timezone.utc).strftime('%Y-%m')
            meter.configure_limit('a','relay',1,'test base')
            grant=dict(action='grant',id='grant-test-1',account='a',category='relay',period=period,bytes=1024,reason='test expansion')
            meter.admin_change(grant);meter.admin_change(grant)
            meter.reserve('a','recover','relay',1025)
            self.assertEqual(len(Metering(service).admin_view()['reservations']),1)
            meter.admin_change(dict(action='reconcile',account='a',id='recover',category='relay',ingressBytes=512,egressBytes=512,reason='verified recovered counters'))
            meter.admin_change(dict(action='rate',category='relay',period=period,ingress='1',egress='2',currency='CNY',reason='provider invoice rate'))
            view=meter.admin_view();self.assertEqual(view['reservations'],[]);self.assertIsNotNone(view['usage'][0]['cost'])
            with self.assertRaises(ValueError):meter.admin_change(dict(grant,bytes=2048))
    def test_reservation_blocks_parallel_budget_and_releases_unused_result(self):
        with tempfile.TemporaryDirectory() as d:
            service=Service(os.path.join(d,'test.db'),b'x'*32,lambda *a:None)
            with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            meter=service.metering
            meter.configure_limit('a','mcp',100,'test reservation')
            meter.reserve('a','one','mcp',80)
            with self.assertRaises(TrafficLimitExceeded):meter.reserve('a','two','mcp',30)
            meter.settle('a','one',10,10);meter.settle('a','one',10,10)
            meter.reserve('a','two','mcp',80)
            with self.assertRaises(ValueError):meter.settle('a','two',81,0)
            meter.settle('a','two',0,0)
            self.assertEqual(meter.summary('a')[0]['ingressBytes'],10)

    def test_atomic_admission_and_default_unlimited(self):
        with tempfile.TemporaryDirectory() as d:
            service=Service(os.path.join(d,'test.db'),b'x'*32,lambda *a:None)
            with service.db() as db:db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            meter=service.metering
            meter.configure_limit('a','mcp',100,'test configurable limit')
            def admit(i):
                try:meter.record('a',str(i),'mcp',60,0,enforce=True);return True
                except TrafficLimitExceeded:return False
            with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sum(pool.map(admit,[1,2])),1)
            meter.configure_limit('a','mcp',None,'restore existing unlimited entitlement')
            meter.record('a','large','mcp',1000,0,enforce=True)
            self.assertEqual(meter.summary('a')[0]['ingressBytes'],1060)

    def test_retries_out_of_order_and_restart_do_not_double_count(self):
        with tempfile.TemporaryDirectory() as d:
            service=Service(os.path.join(d,'test.db'),b'x'*32,lambda *a:None)
            with service.db() as db:
                db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            meter=Metering(service)
            meter.record('a','s','mcp',100,200,0)
            meter.record('a','s','mcp',100,200,0)
            meter.record('a','s','mcp',50,150,0)
            Metering(service).record('a','s','mcp',120,240,0)
            self.assertEqual(meter.summary('a')[0]['egressBytes'],240)
            self.assertEqual(meter.summary('a')[0]['ingressBytes'],120)
            with self.assertRaises(ValueError):meter.record('a','s','relay',120,240,0)
            with self.assertRaises(ValueError):meter.record('unknown','s','relay',1,1,0)
            with self.assertRaises(ValueError):meter.record('a','s','mcp',True,1,0)
            meter.record('a','s','mcp',3,4,2678400)
            self.assertEqual(len(meter.summary('a')),2)

if __name__=='__main__':unittest.main()
