import unittest,tempfile,uuid
from test_bridges import Service,Failure
from bridges import Bridges
from mcp_clients import McpClients

class McpClientTests(unittest.TestCase):
 def test_token_scope_revocation_membership_and_old_bridge(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db');active=True;s.profile=lambda a:{'membership':{'active':active}}
   s.bridges=Bridges(s,Failure);bridge=str(uuid.uuid4());s.bridges.register('a',dict(bridgeId=bridge,secret='x'*43,name='desktop'))
   clients=McpClients(s,Failure);created=clients.manage('a',dict(name='test',bridgeId=bridge,scopes=['list_servers_page']))
   self.assertEqual(clients.authorize(created['token'])['account'],'a')
   self.assertNotIn(created['token'],str(clients.manage('a')))
   with self.assertRaises(Failure):clients.invoke(dict(token=created['token'],name='disconnect'))
   clients.manage('b',dict(action='revoke',id=created['id']));clients.authorize(created['token'])
   active=False
   with self.assertRaises(Failure):clients.authorize(created['token'])
   self.assertEqual(len(s.bridges.list('a')['bridges']),1)
   active=True;clients.manage('a',dict(action='revoke',id=created['id']))
   with self.assertRaises(Failure):clients.authorize(created['token'])
 def test_application_route_is_member_scoped_and_old_tokens_do_not_expand(self):
  with tempfile.TemporaryDirectory() as d:
   s=Service(d+'/db');s.profile=lambda a:{'membership':{'active':True}};s.bridges=Bridges(s,Failure)
   bridge=str(uuid.uuid4());s.bridges.register('a',dict(bridgeId=bridge,secret='x'*43,name='desktop'));clients=McpClients(s,Failure)
   old=clients.manage('a',dict(name='old',bridgeId=bridge,scopes=['list_servers_page']))
   with self.assertRaises(Failure):clients.invoke(dict(token=old['token'],name='invoke_application_tool',arguments={'name':'connection_list','arguments':{}}))
   with self.assertRaises(Failure):s.bridges.invoke('a','legacy',dict(bridgeId=bridge,name='invoke_application_tool',arguments={}),timeout=0)
   new=clients.manage('a',dict(name='new',bridgeId=bridge,scopes=['list_application_tools','describe_application_tool','invoke_application_tool']))
   calls=[]
   s.bridges.invoke=lambda account,consumer,body,**options:calls.append((account,consumer,body,options)) or {'ok':True}
   import time
   result=clients.invoke(dict(token=new['token'],name='invoke_application_tool',arguments={'name':'connection_list','arguments':{}},operationId=str(int(time.time()))+':'+str(uuid.uuid4())))
   self.assertEqual(calls[0][0],'a');self.assertEqual(calls[0][1],new['id']);self.assertTrue(calls[0][3]['member']);self.assertEqual(len(calls),1)
