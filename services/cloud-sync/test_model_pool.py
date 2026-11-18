import concurrent.futures,io,json,tempfile,time,unittest
from unittest.mock import patch
from server import Service,Failure

class ModelPoolTest(unittest.TestCase):
 def setUp(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
  self.s=Service(tmp.name+'/db',b'x'*32,lambda *a:None);self.pool=self.s.models.pool
  with self.s.db() as db:
   db.executemany('INSERT INTO memberships VALUES(?,?)',[(str(i),time.time()+10000) for i in range(100)])
  for i in range(10):self.edit('key',label=str(i),key='sample-key-'+str(i),capacity=100)
  self.edit('model',model='deepseek-chat',weight=2)
  self.model=self.s.models.catalog('0')['models'][-1]['id']
 def edit(self,action,**fields):return self.pool.change(dict(action=action,provider='deepseek',**fields))
 def test_small_requests_carry_rounding_once_per_member(self):
  self.edit('model',model='deepseek-chat',weight=1,inputPrice=1,cachePrice=1,outputPrice=2)
  for account in ('0','0','1'):
   _,lease=self.pool.reserve(account,self.model,1,0)
   self.pool.finish(lease,200,dict(prompt_tokens=1,completion_tokens=0))
   self.pool.finish(lease,200,dict(prompt_tokens=1,completion_tokens=0))
  with self.s.db() as db:
   self.assertEqual(list(db.execute('SELECT account,charge FROM pool_calls ORDER BY id')),[('0',1),('0',0),('1',1)])
   self.assertEqual(list(db.execute('SELECT exact_units FROM pool_receipts')),[('1/100',)]*3)

 def test_procurement_price_is_frozen_per_request(self):
  self.edit('model',model='deepseek-chat',weight=2,inputPrice=2,cachePrice=1,outputPrice=4)
  _,lease=self.pool.reserve('0',self.model,1500,500)
  self.edit('model',model='deepseek-chat',weight=2,inputPrice=20,cachePrice=10,outputPrice=40)
  usage=dict(prompt_tokens=1000,completion_tokens=500,prompt_cache_hit_tokens=500)
  self.pool.finish(lease,200,usage)
  self.pool.finish(lease,200,usage)
  with self.s.db() as db:
   self.assertEqual(db.execute('SELECT charge,state FROM pool_calls WHERE id=?',(lease,)).fetchone(),(35,'ok'))
 
 @patch("model_pool.WEEKLY_VALUE",1000)
 def test_fair_parallel(self):
  def run(i):
   try:_,lease=self.pool.reserve('0',self.model);self.pool.finish(lease,200);return 1
   except Failure:return 0
  with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:self.assertEqual(sum(ex.map(run,range(12))),5)
  self.assertEqual(self.pool.view('0')['pools'][0]['remaining'],0)
  self.assertEqual(self.pool.view('1')['pools'][0]['remaining'],10)
  self.assertNotIn('sample-key',json.dumps(self.pool.view()))
  self.assertNotIn('keys',json.dumps(self.pool.view('0')))
  with self.assertRaises(Failure):self.pool.reserve('expired',self.model)
 def test_refund_cooldown_and_rollover(self):
  key,l=self.pool.reserve('0',self.model);self.pool.finish(l,429)
  other,l=self.pool.reserve('0',self.model);self.assertNotEqual(other['key'],key['key']);self.pool.finish(l,0)
  self.assertEqual(self.pool.view('0')['pools'][0]['used'],2)
  self.edit('limit',ceiling=2)
  self.pool.reserve('0',self.model)
  self.assertEqual(self.pool.view('0')['pools'][0]['remaining'],496)
  with patch('model_pool.week',return_value='2099-11-02'):self.assertLess(self.pool.view('0')['pools'][0]['remaining'],500)
 def test_aiopen_key_quota_and_routing(self):
  pool=self.pool
  def edit(action,**fields):return pool.change(dict(action=action,provider='aiopen',**fields))
  edit('key',label='test key',key='sk-aiopen-sample',capacity=100)
  edit('model',model='configured-model',weight=1)
  group=next(p for p in pool.view()['pools'] if p['provider']=='aiopen')
  key=group['keys'][0]['id']
  target,lease=pool.reserve('0',group['models'][0]['id'])
  self.assertEqual(target['url'],'https://aiopen.one/v1/chat/completions')
  pool.finish(lease,200)
  def query(data):
   with patch('model_pool.upstream',return_value=io.BytesIO(json.dumps(data).encode())) as call:
    result=pool.balance(key)
    request=call.call_args.args[0]
    self.assertEqual(request.full_url,'https://aiopen.one/api/usage/token/')
    self.assertEqual(request.get_header('Authorization'),'Bearer sk-aiopen-sample')
    return result
  result=query(dict(success=True,data=dict(unlimited_quota=False,total_available=0,total_granted=1200)))
  self.assertEqual(result['balances'][0]['amount'],'0 / 1,200')
  self.assertEqual(query(dict(code=True,data=dict(unlimited_quota=True)))['balances'][0]['amount'],'不限额')
  with self.assertRaises(Failure):query(dict(success=False))
 def test_gateway(self):
  with patch('models.upstream',return_value=io.BytesIO(b'{"choices":[],"usage":{"completion_tokens":5}}')) as call:
   result=self.s.models.complete('0',dict(model=self.model,messages=[dict(role='user',content='test')],url='https://invalid.example'))
   self.assertEqual(result['model'],self.model);self.assertEqual(call.call_args.args[0].full_url,'https://api.deepseek.com/v1/chat/completions')
   self.assertEqual(self.pool.view('0')['pools'][0]['used'],2)
 def test_plan_inventory_not_granted(self):
  self.pool.change(dict(action='plan',provider='qwen',label='inventory',unit='次',remaining=45,total=100))
  p=self.pool.view()['pools'][0];self.assertEqual(p['capacity'],0);self.assertEqual(p['plans'][0]['remaining'],45)
 def test_plan_keys_stay_on_subscription_endpoints(self):
  for provider,key,host in [('qwen-plan','sk-sp-test-only','token-plan.cn-beijing.maas.aliyuncs.com'),('mimo-plan','tp-test-only','token-plan-cn.xiaomimimo.com'),('opencode-go','oc_sk_test_only','opencode.ai')]:
   with self.assertRaises(Failure):self.edit('key',label='wrong tier',key=key,capacity=100)
   self.pool.change(dict(action='key',provider=provider,label='test',key=key,capacity=100,monthlyYuan=70))
   self.pool.change(dict(action='model',provider=provider,model='test',weight=1,monthlyLimitUSD=60,inputPrice=1,cachePrice=1,outputPrice=5))
   group=next(p for p in self.pool.view('0')['pools'] if p['provider']==provider)
   target,lease=self.pool.reserve('0',group['models'][0]['id'])
   self.assertEqual(target['url'].split('/')[2],host)
   self.pool.finish(lease,200)
 def test_actual_token_settlement(self):
  self.edit('limit',tokens=1000)
  _,lease=self.pool.reserve('0',self.model,3000)
  self.assertEqual(self.pool.view('0')['pools'][0]['used'],6)
  self.pool.finish(lease,200,dict(prompt_tokens=100,completion_tokens=300))
  self.pool.finish(lease,429)
  self.assertEqual(self.pool.view('0')['pools'][0]['used'],0.8)
  self.assertEqual(self.pool.view('1')['pools'][0]['used'],0)
  _,lease=self.pool.reserve('0',self.model,1000);self.pool.finish(lease,429)
  _,lease=self.pool.reserve('0',self.model,1000);self.pool.finish(lease,200)
  self.assertEqual(self.pool.view('0')['pools'][0]['used'],2.8)
  self.assertEqual(self.pool.view()['pools'][2]['meter'][0]['state'],'unknown')

 def test_wallet_refill_is_atomic_and_leaves_upstream_spend(self):
  p=self.pool
  self.assertEqual(p.view('0')['percent'],100)
  with self.s.db() as db:db.execute('INSERT INTO rental_points VALUES(?,?,?)',('0','credit:test',1000))
  _,lease=p.reserve('0',self.model)
  self.assertIsNone(p.view('0')['quote'])
  p.finish(lease,200)
  before=p.view('0')
  request=dict(request='refill-test-123456789',quote=before['quote'])
  with self.assertRaises(Failure):p.refill('1',request)
  self.assertNotIn('multiplier',json.dumps(before))
  self.assertEqual(before['pools'][0]['models'][0]['tier'],'medium')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:list(ex.map(lambda _:p.refill('0',request),range(2)))
  after=p.view('0')
  self.assertEqual((after['balance'],after['percent'],after['quote']),(412,100,None))
  self.assertEqual(sum(k['used'] for k in p.view()['pools'][2]['keys']),2)
  _,lease=p.reserve('0',self.model);p.finish(lease,200)
  with self.assertRaises(Failure):p.refill('0',dict(request,request='different-request-12345'))
  with self.assertRaises(Failure):p.refill('0',dict(request='another-request-12345',quote=p.view('0')['quote']))
  self.assertEqual(p.view('0')['balance'],412)
  with patch('model_pool.week',return_value='2099-11-02'):
   self.assertLess(p.view('0')['percent'],100)
  with self.s.db() as db:db.execute("UPDATE account_quota_windows SET started=started-604801 WHERE account='0'")
  self.assertEqual((p.view('0')['percent'],p.view('0')['balance'],p.view('0')['resetAt']),(100,412,0))

 def test_member_output_fits_shared_balance_and_inventory(self):
  self.edit('model',model='deepseek-v4-flash',weight=1,inputPrice=1,cachePrice=1,outputPrice=100)
  model=next(m['id'] for p in self.pool.view('0')['pools'] for m in p['models'] if m['name']=='deepseek-v4-flash')
  with patch('model_pool.WEEKLY_VALUE',9000):
   entry,lease=self.pool.reserve('0',model,80100,80000,fit_output=True)
   self.assertEqual(entry['maxOutputTokens'],8999)
   self.pool.finish(lease,200,dict(prompt_tokens=100,completion_tokens=1000))
   entry,lease=self.pool.reserve('0',model,80100,80000,fit_output=True)
   self.assertEqual(entry['maxOutputTokens'],7998)
   self.pool.finish(lease,429)
  with self.s.db() as db:db.execute('UPDATE pool_keys SET capacity=7500')
  entry,lease=self.pool.reserve('0',model,80100,80000,fit_output=True)
  self.assertEqual(entry['maxOutputTokens'],7499)

 def test_gateway_preserves_large_requested_output_and_reports_upstream_limit(self):
  from urllib.error import HTTPError
  body=dict(model=self.model,max_tokens=7200,messages=[dict(role='user',content='test')])
  with patch('models.upstream',return_value=io.BytesIO(b'{"choices":[{"finish_reason":"length"}]}')) as call:
   self.assertEqual(self.s.models.complete('0',body)['choices'][0]['finish_reason'],'length')
   self.assertEqual(json.loads(call.call_args.args[0].data)['max_tokens'],7200)
  error=HTTPError('https://invalid.example',400,'Bad Request',{},io.BytesIO(b'{"error":{"param":"max_tokens"}}'))
  with patch('models.upstream',side_effect=error), self.assertRaisesRegex(Failure,'上下文或输出长度'):
   self.s.models.complete('0',body)

 def test_deepseek_context_and_output_limits(self):
  self.edit('model',model='deepseek-v4-flash',weight=1)
  models=self.pool.view('0')['pools'][0]['models']
  flash=next(m for m in models if m['name']=='deepseek-v4-flash')
  self.assertEqual(flash['contextWindow'],1048576)
  self.assertEqual(next(m for m in models if m['id']==self.model)['limitSource'],'gateway')
  for input_size,requested,expected in [(100,200000,200000),(100,500000,393216),(1000000,200000,48576)]:
   entry,lease=self.pool.reserve('0',flash['id'],input_size+requested,requested,fit_output=True)
   self.assertEqual(entry['maxOutputTokens'],expected)
   self.pool.finish(lease,400)
  with self.assertRaisesRegex(Failure,'上下文'):
   self.pool.reserve('0',flash['id'],1048577,1,fit_output=True)
  with patch('models.upstream',return_value=io.BytesIO(b'{"choices":[]}')) as call:
   self.s.models.complete('0',dict(model=flash['id'],messages=[dict(role='user',content='test')]))
   self.assertEqual(json.loads(call.call_args.args[0].data)['max_tokens'],65536)

 def test_minimax_stream_eof_requires_finish_and_receipt(self):
  pool=self.s.models.pool
  pool.change(dict(action='key',provider='opencode-go',label='test',key='oc_sk_sample123',capacity=100,monthlyYuan=70))
  pool.change(dict(action='model',provider='opencode-go',model='minimax-m3',weight=1,monthlyLimitUSD=60,inputPrice=1,cachePrice=1,outputPrice=2))
  ident=next(m['id'] for p in pool.view('0')['pools'] for m in p['models'] if m['name']=='minimax-m3')
  body=dict(model=ident,max_tokens=8,messages=[dict(role='user',content='test')],stream=True)
  finish=dict(choices=[dict(delta={},finish_reason='stop')])
  receipt=dict(choices=[],usage=dict(prompt_tokens=1,completion_tokens=1,opencode=dict(billing_source='go',list_cost='0.001')))
  for events,ok in (([finish,receipt],True),([finish],False),([receipt],False)):
   stream=io.BytesIO(''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode())
   stream.headers={'Content-Type':'text/event-stream'}
   chunks=[]
   with patch('models.upstream',return_value=stream):
    if ok:
     self.s.models.complete('0',body,chunks.append)
     self.assertEqual(chunks[-1],'[DONE]')
    else:
     with self.assertRaisesRegex(Failure,'中断'):self.s.models.complete('0',body,chunks.append)
