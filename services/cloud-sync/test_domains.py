import tempfile, unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from domains import Domains
from test_bridges import Service, Failure

class DNS:
    def __init__(self):self.calls=[];self.records={}
    def put(self,record,identity,operation):
        self.calls.append(('put',operation));identity=identity or operation
        self.records[identity]=record
        return identity
    def delete(self,identity):self.calls.append(('delete',identity));self.records.pop(identity,None)

class DomainTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.s=Service(self.tmp.name+'/db');self.active=True
        self.s.profile=lambda a:{'membership':{'active':self.active}}
        self.now=datetime(2026,11,30,15,59,tzinfo=timezone.utc).timestamp()
        self.dns=DNS();self.d=Domains(self.s,Failure,self.dns,lambda:self.now)
    def tearDown(self):self.tmp.cleanup()
    def claim(self,account='alice',prefix='Alice',req='claim-0001'):return self.d.claim(account,dict(prefix=prefix,requestId=req))
    def record(self,**kw):return dict(prefix='alice',name='@',type='A',content='192.0.2.1',requestId='dns-create-01',**kw)
    def test_atomic_unique_and_case_normalization(self):
        def run(account):
            try:return self.claim(account)['domain']
            except Failure as e:return e.status
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(run,['a','b']))
        self.assertCountEqual(results,['alice.canp.site',409])
        for prefix in ('WWW','xn--domain','a.b','ab','-bad','bad-','x'*33):
            with self.assertRaises(Failure):self.claim('other',prefix)
    def test_idempotency_and_natural_month_rename(self):
        first=self.claim();self.assertEqual(first,self.claim())
        with self.assertRaises(Failure):self.claim(prefix='other')
        self.claim(prefix='second',req='rename-001')
        with self.assertRaises(Failure):self.claim(prefix='third',req='rename-002')
        state=self.d.list('alice');self.assertFalse(state['renameAvailable']);self.assertEqual(state['namespace'],'second.canp.site')
        self.now+=61
        self.claim(prefix='third',req='rename-002')
        with self.assertRaises(Failure):self.claim('bob','alice')
        self.assertEqual(len(self.d.list('alice')['domains']),3)
    def test_dns_scope_crud_and_no_provider_secret(self):
        self.claim();body=self.record();result=self.d.write('alice',body)
        self.assertEqual(result,self.d.write('alice',body));self.assertEqual(len(self.dns.calls),1)
        self.assertNotIn('provider',str(self.d.list('alice')))
        for name in ('canp.site','bob.canp.site','alice.canp.site.evil.test','x..alice.canp.site'):
            with self.assertRaises(Failure):self.d.write('alice',dict(body,name=name,requestId='bad-name-001'))
        with self.assertRaises(Failure):self.d.write('bob',dict(body,id=result['id'],requestId='evil-edit-001'))
        with self.assertRaises(Failure):self.d.delete('bob',dict(id=result['id'],requestId='evil-delete'))
        changed=self.d.write('alice',dict(body,id=result['id'],content='192.0.2.2',requestId='dns-update-01'))
        self.assertEqual(changed['content'],'192.0.2.2')
        delete=dict(id=result['id'],requestId='dns-delete-01');self.d.delete('alice',delete);self.d.delete('alice',delete)
        self.assertFalse(self.d.list('alice')['records'])
    def test_expired_and_retired_keep_dns_but_block_writes(self):
        self.claim();result=self.d.write('alice',self.record());self.claim(prefix='second',req='rename-001')
        with self.assertRaises(Failure):self.d.write('alice',dict(self.record(),requestId='new-old-record'))
        self.active=False;state=self.d.list('alice');self.assertEqual(len(state['records']),1)
        with self.assertRaises(Failure):self.claim(prefix='third',req='rename-002')
        with self.assertRaises(Failure):self.d.write('alice',dict(self.record(),id=result['id'],requestId='edit-expired'))
        self.d.delete('alice',dict(id=result['id'],requestId='delete-expired'));self.assertFalse(self.d.list('alice')['records'])
    def test_provider_failure_is_sanitized_and_retryable(self):
        self.claim();original=self.dns.put
        self.dns.put=lambda *a:(_ for _ in ()).throw(RuntimeError('secret-token-value'))
        with self.assertRaises(Failure) as error:self.d.write('alice',self.record())
        self.assertNotIn('secret',str(error.exception));self.assertEqual(error.exception.status,503)
        self.dns.put=original;self.d.write('alice',self.record())
    def test_concurrent_same_request_only_one_write(self):
        self.claim()
        with ThreadPoolExecutor(3) as pool:rows=list(pool.map(lambda _:self.d.write('alice',self.record()),range(3)))
        self.assertEqual(rows[0],rows[2]);self.assertEqual(len(self.dns.calls),1)
    def test_record_validation(self):
        self.claim()
        for change in (dict(type='NS'),dict(type=[]),dict(id=[]),dict(content='not-ip'),dict(ttl=True),dict(name='*.*.alice.canp.site'),dict(type='MX',content='mail.test',priority=-1)):
            with self.assertRaises(Failure):self.d.write('alice',dict(self.record(),**change))

if __name__=='__main__':unittest.main()
