import pathlib,tempfile,unittest,time
from cshell_wechat.events import EventJournal
from cshell_wechat.subscription import account_id
from cshell_wechat.contracts import BridgeError
class Events(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'events.db'
  self.j=EventJournal(self.path,capacity=3);self.addCleanup(self.tmp.cleanup);self.addCleanup(lambda:self.j.close())
 def event(self,n):return {'kind':'message','conversationId':'wxid_test','messageId':str(n),'text':'same'}
 def test_dedupe_and_persistent_cursor(self):
  first=self.j.append(self.event(1));self.assertIsNone(self.j.append(self.event(1)))
  self.j.append(self.event(2));self.j.close();self.j=EventJournal(self.path,capacity=3)
  page=self.j.read(first);self.assertEqual([e['messageId'] for e in page['events']],['2']);self.assertFalse(page['gap'])
 def test_overflow_explicit_gap_and_pagination(self):
  first=self.j.append(self.event(1))
  for i in range(2,7):self.j.append(self.event(i))
  page=self.j.read(first,2);self.assertTrue(page['gap']);self.assertTrue(page['hasMore'])
  self.assertEqual([e['messageId'] for e in page['events']],['4','5'])
  self.assertEqual(self.j.read(page['nextCursor'])['events'][0]['messageId'],'6')
 def test_ttl_and_scope(self):
  old=self.j.append(self.event(1));self.j.db.execute('UPDATE events SET created=0');self.j.db.commit()
  self.assertTrue(self.j.read()['gap'])
  with self.assertRaises(BridgeError):self.j.read('0'*32+':0')
  with self.assertRaises(BridgeError):self.j.read(self.j.get('stream')+':999')
 def test_zero_ids_not_deduped_and_gap_preserved(self):
  self.j.append(self.event(0));self.j.append(self.event(0));self.j.append({'kind':'gap','reason':'restart'})
  self.assertEqual(len(self.j.read()['events']),3);self.assertTrue(self.j.read()['gap'])
 def test_account_directory_is_strict(self):
  self.assertEqual(account_id(r'C:\xwechat_files\wxid_testabc_5a91\db_storage\contact\contact.db'),'wxid_testabc')
  for path in ['other/contact.db',r'C:\other\db_storage\contact.db']:
   with self.assertRaises(BridgeError):account_id(path)
if __name__=='__main__':unittest.main()
