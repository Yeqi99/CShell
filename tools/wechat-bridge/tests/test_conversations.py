import sqlite3,tempfile,pathlib,unittest
from cshell_wechat.conversations import prepare,result_page
from cshell_wechat.contracts import BridgeError
class Conversations(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.addCleanup(self.db.close)
  self.db.execute('CREATE TABLE SessionTable(username TEXT,unread_count INTEGER,last_timestamp INTEGER,sort_timestamp INTEGER,last_msg_type INTEGER,last_msg_sender TEXT,is_hidden INTEGER,type INTEGER)')
  self.db.executemany('INSERT INTO SessionTable VALUES(?,?,?,?,?,?,?,?)',[('wxid_one',2,10,20,1,'wxid_sender',0,1),('123456@chatroom',1,10,20,1,'wxid_sender',0,2),('wxid_hidden',9,30,30,1,'wxid_sender',1,1),('filehelper',0,1,1,1,'wxid_sender',0,1)])
 def page(self,params,path='account/session.db'):
  rows=[[str(x) if x is not None else None for x in row] for row in self.db.execute(prepare(params)[3])]
  return result_page({'state':[0,2,0,101],'rows':rows,'databasePath':path,'cleanup':{'unloaded':True,'codeRestored':True}},params)
 def test_stable_tie_break_pagination_and_no_read_mutation(self):
  first=self.page({'limit':1});self.assertEqual(first['items'][0]['conversationId'],'123456@chatroom');self.assertTrue(first['hasMore'])
  second=self.page({'limit':1,'cursor':first['nextCursor']});self.assertEqual(second['items'][0]['conversationId'],'wxid_one')
  third=self.page({'limit':1,'cursor':second['nextCursor']});self.assertEqual(third['items'][0]['conversationId'],'filehelper');self.assertFalse(third['hasMore'])
  self.assertEqual(self.db.execute("SELECT unread_count FROM SessionTable WHERE username='wxid_one'").fetchone()[0],2)
 def test_hidden_filter_and_account_scope(self):
  first=self.page({'includeHidden':True,'limit':1});self.assertEqual(first['items'][0]['conversationId'],'wxid_hidden')
  with self.assertRaises(BridgeError):self.page({'cursor':first['nextCursor']})
  with self.assertRaises(BridgeError):self.page({'includeHidden':True,'cursor':first['nextCursor']},'other/session.db')
 def test_empty_and_bad_cursor(self):
  self.db.execute('DELETE FROM SessionTable');self.assertEqual(self.page({})['items'],[])
  for params in [{'limit':101},{'includeHidden':1},{'cursor':'bad'}]:
   with self.assertRaises(BridgeError):prepare(params)
if __name__=='__main__':unittest.main()
