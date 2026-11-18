import os
import secrets
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from server import Service, Failure


class RentalTest(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        env=patch.dict(os.environ,RENTAL_PANEL_KEY='test')
        env.start()
        self.addCleanup(env.stop)
        self.s=Service(temp.name+'/db',secrets.token_bytes(32),lambda *_:None)
        self.r=self.s.rentals
        with self.s.db() as db:
            db.execute("INSERT INTO accounts VALUES('a','a@example.com')")
        self.r.plan(dict(id='test',name='test',system='Linux',cpu=25,memory=256,disk=512,points=5,days=2,egg=42,node=2,owner=1,included=True,enabled=True))
        self.order=dict(plan='test',included=False,request=str(uuid.uuid4()),points=5,days=2)

    def test_points_identity_and_retry(self):
        credit=dict(account='a',reference='receipt',points=5)
        self.r.credit(credit)
        self.r.credit(credit)
        with self.assertRaises(Failure):self.r.order('a',{**self.order,'points':4})
        lease=self.r.order('a',self.order)
        self.assertEqual(self.r.order('a',self.order),lease)
        self.assertEqual(self.r.catalog('a')['balance'],0)
        with self.assertRaises(Failure):self.r.order('a',{**self.order,'request':str(uuid.uuid4())})
        identity=dict(deviceId=str(uuid.uuid4()),fingerprint='AA:'*31+'AA')
        with self.s.db() as db:
            db.execute("UPDATE rentals SET state='installing',remote=1,endpoint=? WHERE id=?",('{"host":"example.com","port":24443}',lease['id']))
        body={**lease,'identity':identity,'token':self.r.secret(lease['id'],'enroll')}
        with self.assertRaises(Failure):self.r.enroll({**body,'token':'wrong'})
        self.r.enroll(body)
        self.r.enroll(body)
        with self.assertRaises(Failure):self.r.enroll({**body,'identity':{**identity,'deviceId':str(uuid.uuid4())}})
        self.assertEqual(self.r.connection('a',lease['id'])['deviceId'],identity['deviceId'])
        with self.assertRaises(Failure):self.r.connection('b',lease['id'])

    def test_prorated_expansion_and_mandatory_renewal(self):
        self.r.credit(dict(account='a',reference='credit',points=1000))
        lease=self.r.order('a',self.order)['id']
        now=1700000000
        with self.s.db() as db:db.execute("UPDATE rentals SET state='ready',expires=? WHERE id=?",(now+86400,lease))
        with patch('rentals.time.time',return_value=now):
            expand=dict(id=lease,request=str(uuid.uuid4()),kind='expand',units=1)
            quote=self.r.change('a',{**expand,'quote':True})
            self.assertEqual(quote['points'],100)
            self.r.change('a',{**expand,'maxPoints':100})
            self.r.change('a',{**expand,'maxPoints':100})
            renew=dict(id=lease,request=str(uuid.uuid4()),kind='renew',units=1)
            self.assertEqual(self.r.change('a',{**renew,'quote':True})['points'],205)
            with self.assertRaises(Failure):self.r.change('a',{**renew,'maxPoints':5})
            self.r.change('a',{**renew,'maxPoints':205})
        self.assertEqual(self.r.catalog('a')['balance'],690)

    def test_supplier_scope_and_revocation(self):
        grant=self.r.operators(dict(name='test supplier',plans=['test']))
        secret=grant['access']
        self.assertEqual(self.r.supplier(secret)['plans'][0]['id'],'test')
        body=dict(id='other',cpu=100,memory=2048,disk=30720,enabled=True)
        with self.assertRaises(Failure):self.r.supplier(secret,body)
        self.r.supplier(secret,{**body,'id':'test'})
        self.assertEqual(self.r.catalog('a')['plans'][0]['cpu'],100)
        self.r.operators({'revoke':self.r.operators()['operators'][0]['id']})
        with self.assertRaises(Failure):self.r.supplier(secret)

    def test_shared_ports_are_real_scoped_and_retryable(self):
        self.r.credit(dict(account='a',reference='port-test',points=5))
        machine=self.r.order('a',self.order)['id']
        with self.s.db() as db:
            db.execute("UPDATE rentals SET state='ready',remote=4,endpoint=?,identity=?,expires=? WHERE id=?",
                       ('{"host":"node.test","port":30000}','{"deviceId":"test"}',time.time()+3600,machine))
        assigned={1}
        def allocation(i):
            return {'attributes':{'id':i,'ip':'0.0.0.0','alias':'node.test','port':29999+i,'assigned':i in assigned}}
        def panel(path):
            if path.startswith('servers/'):
                return {'attributes':{'node':2,'external_id':'cshell-'+machine,'allocation':1,'limits':{},'feature_limits':{},
                        'relationships':{'allocations':{'data':[allocation(i) for i in assigned]}}}}
            return {'data':[allocation(i) for i in range(1,13)],'meta':{'pagination':{'total_pages':1}}}
        def build(remote,body):
            self.assertEqual(remote,4)
            self.assertEqual(body['allocation'],1)
            assigned.update(body['add_allocations'])
        with patch.object(self.r,'panel',side_effect=panel),patch.object(self.r,'request_build',side_effect=build) as update:
            with self.assertRaises(Failure):self.r.change('b',{'id':machine,'kind':'ports'})
            for _ in range(2):self.r.change('a',{'id':machine,'kind':'ports'})
            self.assertEqual(update.call_count,1)
        catalog=self.r.catalog('a')
        self.assertFalse(catalog['plans'][0]['dedicatedIp'])
        self.assertEqual(catalog['machines'][0]['portCount'],3)
        self.r.credit(dict(account='a',reference='extra-port',points=200))
        purchase=dict(id=machine,kind='port',units=1,request='12345678-1234-1234-1234-123456789012')
        quote=self.r.change('a',dict(purchase,quote=True))
        self.assertEqual(quote['points'],1)
        self.r.change('a',dict(purchase,maxPoints=1))
        self.r.change('a',dict(purchase,maxPoints=1))
        self.assertEqual(self.r.catalog('a')['machines'][0]['portCount'],4)
        self.assertEqual([p['port'] for p in catalog['machines'][0]['ports']],list(range(30001,30004)))

    def test_seven_day_gift_claimed_late_uses_membership_expiry(self):
        start=int(time.time())
        self.r.plan(dict(id='monthly',name='Monthly',system='Linux',cpu=25,memory=256,disk=512,points=5,days=30,egg=42,node=2,owner=1,included=True,enabled=True))
        with patch('time.time',return_value=start):
            gift=self.s.rewards.issue(dict(request=str(uuid.uuid4()),kind='membership',plan='Pro',quantity=7))
            self.s.rewards.redeem('a',gift)
        with patch('time.time',return_value=start+6*86400):
            lease=self.r.order('a',dict(plan='monthly',included=True,request=str(uuid.uuid4())))['id']
            with self.s.db() as db:
                db.execute("UPDATE rentals SET state='installing' WHERE id=?",(lease,))
            self.r.enroll(dict(id=lease,token=self.r.secret(lease,'enroll'),identity=dict(deviceId=str(uuid.uuid4()),fingerprint='AA:'*31+'AA')))
            self.assertEqual(self.r.catalog('a')['machines'][0]['expires'],start+7*86400)

    def test_spec_can_be_assigned_before_listing_daily_and_monthly_prices(self):
        spec=dict(kind='spec',id='two-four',name='2 核 4 GiB',system='Linux',cpu=200,memory=4096,disk=30720,node=2,egg=42,owner=1)
        self.r.plan(spec)
        self.s.admin_membership(dict(action='savePlan',plan='Pro',weeklyCents=500,storageMiB=8,machine='two-four'))
        with self.s.db() as db:db.execute('INSERT INTO memberships VALUES(?,?)',('a',time.time()+86400))
        self.assertEqual(self.r.catalog('a')['memberPlans'][0]['id'],'two-four')
        self.assertNotIn('two-four',[p['id'] for p in self.r.catalog('a')['plans']])
        self.r.order('a',dict(request=str(uuid.uuid4()),plan='two-four',included=True))
        for period,price in [(1,300),(30,2888)]:
            self.r.plan(dict(kind='rate',id='rate-'+str(period),specId='two-four',days=period,points=price,expansionDays=30,cpuPoints=500,memoryPoints=500,expansionPoints=200,enabled=True))
        self.r.plan(dict(spec,memory=8192))
        rates=[p for p in self.r.catalog('a')['plans'] if p['id'].startswith('rate-')]
        self.assertEqual([(r['days'],r['points'],r['memory']) for r in rates],[(1,300,8192),(30,2888,8192)])
        self.assertEqual(self.r.catalog('a')['machines'][0]['memory'],4096)

    def test_retention_releases_only_expired_owned_suspended_server(self):
        self.order['included']=True
        with self.s.db() as db:db.execute('INSERT INTO memberships VALUES(?,?)',('a',time.time()+120))
        lease=self.r.order('a',self.order)['id']
        with self.s.db() as db:
            db.execute("UPDATE rentals SET state='expired',remote=4,retain_until=? WHERE id=?",(time.time()-1,lease))
            db.execute("UPDATE memberships SET expires=0")
        calls=[]
        def panel(path,body=None,method=None):
            calls.append(method)
            return {'attributes':{'external_id':'cshell-'+lease,'suspended':True}}
        with patch.object(self.r,'panel',side_effect=panel):self.r.retained_machines()
        self.assertEqual(calls,[None,'DELETE'])
        self.assertEqual(self.r.catalog('a')['machines'][0]['state'],'released')

    def test_renewal_in_retention_recovers_original_instance(self):
        now=time.time()
        with self.s.db() as db:db.execute('INSERT INTO memberships VALUES(?,?)',('a',now+7*86400))
        lease=self.r.order('a',dict(self.order,included=True))['id']
        with self.s.db() as db:db.execute("UPDATE rentals SET state='expired',remote=4,retain_until=? WHERE id=?",(now+1000,lease))
        self.r.retained_machines()
        with self.s.db() as db:
            self.assertEqual(db.execute('SELECT state,remote,retain_until FROM rentals WHERE id=?',(lease,)).fetchone(),('resuming',4,None))

    def test_member_slot(self):
        self.order['included']=True
        with self.assertRaises(Failure):self.r.order('a',self.order)
        with self.s.db() as db:db.execute('INSERT INTO memberships VALUES(?,?)',('a',time.time()+3600))
        self.r.order('a',self.order)
        with self.assertRaises(Failure):self.r.order('a',{**self.order,'request':str(uuid.uuid4())})
        self.assertEqual(self.r.catalog('a')['balance'],0)

    def test_monthly_resource_addons_and_same_request(self):
        self.r.plan(dict(id='month',name='2C4G',system='Linux',cpu=200,memory=4096,disk=30720,points=2888,days=30,egg=42,node=2,owner=1,included=False,enabled=True))
        self.r.credit(dict(account='a',reference='points',points=10000))
        machine=self.r.order('a',dict(plan='month',included=False,request=str(uuid.uuid4()),points=2888,days=30))['id']
        now=1700000000
        with self.s.db() as db:db.execute("UPDATE rentals SET state='ready',expires=? WHERE id=?",(now+30*86400,machine))
        with patch('rentals.time.time',return_value=now):
            for kind,cost in [('cpu',500),('memory',500),('expand',200)]:
                cmd=dict(id=machine,request=str(uuid.uuid4()),kind=kind,units=1)
                self.assertEqual(self.r.change('a',{**cmd,'quote':True})['points'],cost)
                for _ in range(2):self.r.change('a',{**cmd,'maxPoints':cost})
            self.assertEqual(self.r.change('a',dict(id=machine,request=str(uuid.uuid4()),kind='renew',quote=True))['points'],4088)
        row=self.r.catalog('a')['machines'][0]
        self.assertEqual((row['cores'],row['memory'],row['disk']),(3,5120,40960))
        self.assertEqual(self.r.catalog('a')['balance'],5912)

    def test_conversation_account_scope_and_revision(self):
        chat=str(uuid.uuid4())
        cmd=dict(id=chat,revision=0,envelope=dict(format=1,nonce='a'*16,ciphertext='b'*24))
        self.assertEqual(self.s.conversations('a',cmd)['revision'],1)
        self.assertFalse(self.s.conversations('b')['records'])
        with self.assertRaises(Failure):self.s.conversations('a',cmd)
        self.s.conversations('a',dict(id=chat,revision=1,remove=True))
        self.assertFalse(self.s.conversations('a')['records'])

    def test_agent_spend_needs_opt_in_and_reuses_receipt(self):
        agent=self.s.agent_spending
        q=dict(action='quote',kind='rent',plan='test',request=str(uuid.uuid4()))
        activate=dict(action='activate',request=q['request'])
        self.assertFalse(agent.policy('a')['enabled'])
        with self.assertRaises(Failure):agent.run('a',q)
        self.r.credit(dict(account='a',reference='balance',points=10))
        agent.policy('a',{'enabled':True})
        self.assertEqual(agent.run('a',q)['points'],5)
        agent.policy('a',{'enabled':False})
        with self.assertRaises(Failure):agent.run('a',activate)
        agent.policy('a',{'enabled':True})
        with self.assertRaises(Failure):agent.run('a',activate)
        q['request']=str(uuid.uuid4());activate['request']=q['request']
        agent.run('a',q)
        result=agent.run('a',activate)
        self.assertEqual(agent.run('a',activate),result)
        self.assertEqual(self.r.catalog('a')['balance'],5)
        with self.assertRaises(Failure):agent.run('b',activate)
