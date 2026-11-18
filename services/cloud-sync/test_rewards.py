import concurrent.futures
import tempfile
import unittest
import uuid
from server import Service, Failure


class RewardsTest(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.s=Service(tmp.name+'/test.db',b'x'*32,lambda *args:None)
        self.r=self.s.rewards
        with self.s.db() as db:
            db.executemany('INSERT INTO accounts VALUES(?,?)',[(x,x+'@example.com') for x in ('a','b','c')])
        code=self.r.account('a')['invite']
        with self.s.db() as db:self.r.attribute(db,'b',code)

    def test_settled_orders(self):
        def settle(order,points):return self.r.settle(dict(account='b',order=order,points=points))
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _:settle('one',19),range(8)))
        settle('two',1)
        with self.assertRaises(Failure):settle('one',18)
        self.assertEqual(self.r.account('a')['earned'],1)
        self.assertEqual(sum(l['points'] for l in self.r.account('b')['ledger']),20)

    def card(self,kind,n,plan=''):
        return self.r.issue(dict(request=str(uuid.uuid4()),kind=kind,quantity=n,plan=plan))

    def test_promotion_limit_and_replay(self):
        body=dict(request=str(uuid.uuid4()),kind='membership',plan='Pro',quantity=7,purpose='promotion',maxClaims=20)
        card=self.r.issue(body)
        def claim(i):
            try:self.r.redeem('guest'+str(i),card);return i
            except Failure:return None
        with concurrent.futures.ThreadPoolExecutor(6) as pool:results=list(pool.map(claim,range(24)))
        winners=[i for i in results if i is not None]
        self.assertEqual(len(winners),20)
        claim(winners[0])
        with self.s.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM gift_claims').fetchone()[0],20)
            self.assertEqual(db.execute("SELECT count(*) FROM benefit_terms WHERE category='promotion'").fetchone()[0],20)
        with self.assertRaises(Failure):self.r.issue(dict(body,maxClaims=21))

    def test_cost_receipt_replay_and_promotional_allocation(self):
        invoice=dict(reference='invoice-line-1',destination='hosting',amountFen=500,source='campaign-1',category='promotion')
        self.r.expenses(invoice)
        report=self.r.expenses(invoice)
        self.assertEqual(report['totalFen'],500)
        self.assertEqual(report['groups'],[dict(category='promotion',destination='hosting',amountFen=500)])
        with self.assertRaises(Failure):self.r.expenses(dict(invoice,category='sale'))

    def test_single_use(self):
        card=self.card('points',50)
        def redeem(who):
            try:self.r.redeem(who,card);return who
            except Failure:return None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            winners=[who for who in pool.map(redeem,('a','c')) if who]
        self.assertEqual(len(winners),1)
        self.r.redeem(winners[0],card)
        self.assertEqual(self.r.account(winners[0])['ledger'][0]['points'],50)

    def test_membership_and_reset(self):
        reset=self.card('reset',1)
        with self.assertRaises(Failure):self.r.redeem('c',reset)
        self.r.redeem('c',self.card('membership',15,'Pro'))
        self.assertTrue(self.s.profile('c')['membership']['active'])
        with self.assertRaises(Failure):self.r.redeem('c',reset)
        from model_pool import week
        with self.s.db() as db:
            db.execute("INSERT INTO pool_calls(week,account,keyid,provider,model,charge,state) VALUES(?,'c','key','aiopen','test',9,'ok')",(week(),))
        self.r.redeem('c',reset)
        with self.s.db() as db:self.assertEqual(self.s.models.pool.allowance(db,'c',week())[1],0)

    def test_sell_plan_and_domain(self):
        self.s.rentals.credit(dict(account='a',reference='opening',points=6500))
        self.r.offers(dict(plan='Pro',days=30,price=3990,enabled=True))
        purchase=dict(plan='Pro',days=30,price=3990,request=str(uuid.uuid4()))
        end=self.r.buy_plan('a',purchase)
        self.assertEqual(end,self.r.buy_plan('a',purchase))
        self.s.domains.claim('a',dict(prefix='mainname',requestId=str(uuid.uuid4())))
        addon=dict(prefix='othername',requestId=str(uuid.uuid4()))
        self.assertEqual(self.s.domains.buy('a',addon),self.s.domains.buy('a',addon))
        self.assertEqual(self.s.rentals.catalog('a')['balance'],1510)
        self.assertEqual(self.s.domains.list('a')['namespace'],'mainname.canp.site')
        with self.assertRaises(Failure):self.s.domains.claim('a',dict(prefix='othername',requestId=str(uuid.uuid4())))

    def test_fifo_sources_span_orders(self):
        for order,points in [('first',20),('second',80)]:self.r.settle(dict(account='b',order=order,points=points))
        with self.s.db() as db:
            db.executemany('INSERT INTO rental_points VALUES(?,?,?)',[('b','spend:one',-12),('b','spend:two',-40)])
        trace=self.r.trace('b','spend:two')
        self.assertEqual([(e['order']['id'],e['points']) for e in trace['entries']],[('first',8),('second',32)])
        self.assertEqual(trace['unmatched'],0)
        self.assertEqual(self.r.trace('a','invite:first')['entries'][0]['order']['paidPoints'],20)

    def test_xianyu_order(self):
        order=dict(saleOrder='XY-test',request=str(uuid.uuid4()),kind='points',quantity=50)
        card=self.r.issue(order)
        self.assertEqual(card,self.r.issue(dict(order,request=str(uuid.uuid4()))))
        with self.assertRaises(Failure):self.r.issue(dict(order,quantity=51))
        self.assertFalse(self.r.account('b')['ledger'])
        self.r.redeem('b',card)
        credit=self.r.account('b')['ledger'][0]
        self.assertEqual(credit['points'],50)
        self.assertEqual(self.r.trace('b',credit['reference'])['entries'][0]['saleOrder'],'XY-test')
