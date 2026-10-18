import pathlib,tempfile,unittest
from cshell_wechat.autoreply import Policy

class AutoReplyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'state.db';self.p=Policy(self.path)
        self.now=1800000000;self.own='wxid_owner';self.config={'enabled':True,'experimental':True,'receive':['*'],'send':['*'],'sendBlocked':[]}
    def tearDown(self):self.p.db.close();self.tmp.cleanup()
    def event(self,n=1,peer='wxid_peer'):
        return dict(kind='message',conversationType='private',senderId=peer,recipientId=self.own,nativeType=1,format='text',messageId=str(n),timestampRaw=str(self.now),text='在吗')
    def reserve(self,e):return self.p.reserve(e,self.own,self.config,self.now-10,self.now)
    def test_identity_and_scope(self):
        for field,value in [('senderId',self.own),('conversationType','group'),('recipientId','wxid_other'),('nativeType',3),('format','xml'),('messageId','0'),('timestampRaw',self.now-1000)]:
            with self.subTest(field=field):self.assertIsNone(self.reserve(dict(self.event(),**{field:value})))
        self.config['sendBlocked']=['wxid_peer'];self.assertIsNone(self.reserve(self.event()))
    def test_durable_dedupe_and_cooldown(self):
        self.assertIsNotNone(self.reserve(self.event()));self.assertIsNone(self.reserve(self.event(2)))
        self.p.db.close();self.p=Policy(self.path);self.assertIsNone(self.reserve(self.event()))
    def test_limits(self):
        for n in range(6):
            self.assertIsNotNone(self.reserve(self.event(n+1)));self.now+=1801
        self.assertIsNone(self.reserve(self.event(7)))
    def test_global_limit(self):
        for n in range(20):self.assertIsNotNone(self.reserve(self.event(n+1,'wxid_peer'+str(n))))
        self.assertIsNone(self.reserve(self.event(30,'wxid_another')))
    def test_budget_reserved_before_request(self):
        for n in range(7):self.assertTrue(self.p.model_budget(str(n)))
        self.assertFalse(self.p.model_budget('overflow'))
        self.p.model_usage('0',200)
        self.assertTrue(self.p.model_budget('after-settle'))

if __name__=='__main__':unittest.main()
