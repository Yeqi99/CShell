import pathlib,tempfile,unittest,subprocess,sys,os,json
from cshell_wechat.contracts import BridgeError,EventWindow,text_request
from cshell_wechat.state import SendJournal,authorize
from cshell_wechat.protocol import decode
from cshell_wechat.cli import execute

class Contracts(unittest.TestCase):
 def test_cli_bom_and_bad_json(self):
  env=dict(os.environ,PYTHONPATH=str(pathlib.Path(__file__).resolve().parents[1]))
  with tempfile.TemporaryDirectory() as d:
   command=[sys.executable,'-m','cshell_wechat.cli','capabilities','--state-dir',d]
   good=subprocess.run(command,input=b'\xef\xbb\xbf{}',capture_output=True,env=env)
   self.assertEqual(good.returncode,0,good.stdout);self.assertTrue(json.loads(good.stdout)['ok'])
   bad=subprocess.run(command,input=b'{',capture_output=True,env=env)
   self.assertEqual(bad.returncode,1);self.assertFalse(json.loads(bad.stdout)['ok'])
 def test_unknown_send_never_replayed(self):
  with tempfile.TemporaryDirectory() as d:
   j=SendJournal(pathlib.Path(d)/'journal');k,old=j.reserve('account','request01',['id','hello']);self.assertIsNone(old);j.close()
   j=SendJournal(pathlib.Path(d)/'journal');self.assertEqual(j.reserve('account','request01',['id','hello'])[1],'unknown')
   with self.assertRaises(BridgeError):j.reserve('account','request01',['id','different'])
   self.assertIsNone(j.reserve('other-account','request01',['id','hello'])[1]);j.close()
 def test_binding_and_revoke(self):
  p={'enabled':True,'binding':{'pid':1},'send':['wxid_abcdef']}
  authorize(p,{'pid':1},'send','wxid_abcdef')
  for binding,target in [({'pid':2},'wxid_abcdef'),({'pid':1},'wxid_other')]:
   with self.assertRaises(BridgeError):authorize(p,binding,'send',target)
  p['enabled']=False
  with self.assertRaises(BridgeError):authorize(p,{'pid':1},'send','wxid_abcdef')
 def test_event_gap_and_same_text(self):
  w=EventWindow(2)
  for i in range(3):w.push({'conversationId':'x','messageId':str(i+1),'text':'same'})
  self.assertTrue(w.result()['gap']);self.assertEqual(len(w.items),2)
  self.assertFalse(w.push({'conversationId':'x','messageId':'3'}))
  self.assertTrue(w.push({'conversationId':'other','messageId':'3'}))
 def test_text_validation(self):
  for body in ('','x\0y','中'*2000):
   with self.assertRaises(BridgeError):text_request({'recipient':'wxid_abcdef','text':body,'idempotencyKey':'request01'})
 def test_group_prefix(self):
  r=decode({'message':{'from':'123456@chatroom','to':'wxid_self00','text':'wxid_sender01:\n123'}})
  self.assertEqual(r['senderId'],'wxid_sender01');self.assertEqual(r['text'],'123');self.assertEqual(r['conversationType'],'group')
 def test_xml_no_entity(self):
  with self.assertRaises(BridgeError):decode({'message':{'text':'<!DOCTYPE x [<!ENTITY y "123">]><x>&y;</x>'}})
 def test_xml_structured_metadata(self):
  r=decode({'message':{'text':'<msg><appmsg><type>6</type><title>a.txt</title><appattach><fileext>txt</fileext></appattach></appmsg></msg>'}})
  self.assertEqual(r['attachmentMetadata']['fileext'],'txt');self.assertFalse(r['liveFormatVerified'])
 def test_media_secret_not_in_metadata(self):
  r=decode({'message':{'text':'<msg><img aeskey="secret" width="10" /></msg>'}})
  self.assertEqual(r['media'],[{'kind':'img','metadata':{'width':'10'}}])
 def test_quarantined_catalog(self):
  with tempfile.TemporaryDirectory() as d:
   r=execute('capabilities',{},pathlib.Path(d))
   self.assertNotIn('messages.send_text',r['methods']);self.assertFalse(r['profiles'][0]['liveEnabled'])
if __name__=='__main__':unittest.main()
