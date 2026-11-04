import tempfile,time,uuid,unittest,json
from test_bridges import Service,Failure
from mcp_journal import McpJournal

class JournalTests(unittest.TestCase):
 def test_migrate_restart_query_and_never_redispatch_unknown(self):
  with tempfile.TemporaryDirectory() as d:
   service=Service(d+'/db');journal=McpJournal(service,Failure)
   grant=dict(account='a',client='c',bridgeId='b');calls=[]
   def body():return dict(operationId=str(int(time.time()))+':'+str(uuid.uuid4()),name='invoke_connection',arguments={'op':'write'})
   completed=body();result=journal.invoke(grant,completed,lambda:calls.append('done') or {'ok':True})
   self.assertEqual(result['state'],'completed')
   pending=body()
   def fail():calls.append('unknown');raise RuntimeError('connection lost')
   with self.assertRaises(RuntimeError):journal.invoke(grant,pending,fail)
   with service.db() as db:db.execute("UPDATE mcp_operations SET state='running' WHERE id=?",(pending['operationId'],))
   restarted=McpJournal(Service(d+'/db'),Failure)
   self.assertEqual(restarted.invoke(grant,completed,lambda:calls.append('REPLAY'))['result'],{'ok':True})
   self.assertEqual(restarted.invoke(grant,pending,lambda:calls.append('REPLAY'))['state'],'unknown')
   self.assertEqual(calls,['done','unknown'])
   self.assertEqual(len(restarted.query(grant)['operations']),2)
   with self.assertRaises(Failure):restarted.query(dict(grant,client='other'),completed['operationId'])
   with self.assertRaises(Failure):restarted.invoke(grant,dict(completed,arguments={}),lambda:None)
   with service.db() as db:db.execute('UPDATE mcp_operations SET updated=?',(time.time()-90000,))
   self.assertEqual(restarted.query(grant,completed['operationId'])['state'],'expired')
   self.assertNotIn('result',restarted.query(grant,completed['operationId']))
   expired=dict(completed,operationId=str(int(time.time()-91*86400))+':'+str(uuid.uuid4()))
   with self.assertRaises(Failure):restarted.invoke(grant,expired,lambda:calls.append('REPLAY'))
   self.assertEqual(calls,['done','unknown'])
