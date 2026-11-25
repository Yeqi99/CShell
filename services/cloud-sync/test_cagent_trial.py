import concurrent.futures
import json
import tempfile
import unittest
from unittest.mock import patch
from server import Service, Failure

class TrialTest(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.s=Service(directory.name+'/db',b't'*32,lambda *args:None)
        self.trial=self.s.models.trial
        self.pool=self.s.models.pool
        self.pool.change(dict(action='key',provider='aiopen',label='test',key='synthetic-fixture',capacity=100))
        self.pool.change(dict(action='model',provider='aiopen',model='gpt-6.2-sol',weight=1))
        with self.s.db() as db:
            self.model=db.execute('SELECT id FROM pool_models').fetchone()[0]
        self.configure(10000000,1000000)
        self.body={'model':'client-cannot-select','messages':[{'role':'user','content':'hi'}]}

    def configure(self,g,d):
        self.trial.settings(dict(models=[self.model],globalLimit=g,deviceLimit=d))

    def test_receipt_and_no_membership_bypass(self):
        with self.assertRaises(Failure):
            self.pool.reserve('regular',self.model)
        with patch.object(self.s.models,'complete',return_value={'choices':[{'message':{'role':'assistant','content':'hello'}}],'model':'secret','usage':{'total_tokens':14}}) as call:
            result=self.trial.complete('a'*64,self.body)
        self.assertNotIn('secret',json.dumps(result))
        self.assertEqual(call.call_args.args[1]['model'],self.model)
        self.assertEqual(self.trial.settings()['used'],14)

    def test_exhaustion_is_a_reply(self):
        self.configure(0,1000000)
        with patch.object(self.s.models,'complete') as call:
            result=self.trial.complete('b'*64,self.body)
            self.assertIn('配置自己的大模型基座',result['choices'][0]['message']['content'])
            call.assert_not_called()

    def test_concurrent_pending_reservations(self):
        # An unknown receipt keeps the full reservation through this day.
        self.configure(11000,5400)
        def run(i):
            return self.trial.complete(('a' if i%2 else 'b')*64,self.body)
        with patch.object(self.s.models,'complete',return_value={'choices':[{'message':{'role':'assistant','content':'ok'}}]}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                answers=list(pool.map(run,range(12)))
        self.assertEqual(sum(r['choices'][0]['message']['content']=='ok' for r in answers),2)
        self.assertLessEqual(self.trial.settings()['used'],11000)
        with self.s.db() as db:
            self.assertTrue(all(n<=5400 for n, in db.execute('SELECT sum(tokens) FROM trial_calls GROUP BY device')))
