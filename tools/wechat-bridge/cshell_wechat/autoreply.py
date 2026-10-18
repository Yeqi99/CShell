"""Budgeted private-message responder. Messages never get tools or credentials."""
import hashlib,json,os,pathlib,queue,re,sqlite3,subprocess,sys,threading,time

class Policy:
    def __init__(self,path):
        self.db=sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS attempts(k TEXT PRIMARY KEY,peer TEXT,t REAL,status TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS budget(k TEXT PRIMARY KEY,t REAL,tokens INTEGER)')
        self.db.commit()
    def reserve(self,event,own,config,started,now=None):
        now=time.time() if now is None else now
        peer=event.get('senderId','');mid=str(event.get('messageId',''))
        if (event.get('kind')!='message' or event.get('conversationType')!='private' or
            not re.fullmatch(r'wxid_[A-Za-z0-9_]{3,64}',peer) or peer==own or
            event.get('recipientId')!=own or event.get('nativeType')!=1 or
            event.get('format')!='text' or not mid.isdigit() or int(mid)==0):return None
        try:stamp=int(event.get('timestampRaw',0))
        except (ValueError,TypeError):return None
        if stamp<started or stamp>now+60 or now-stamp>120:return None
        text=event.get('text')
        if not isinstance(text,str) or not text.strip() or len(text)>500:return None
        if not config.get('enabled') or not config.get('experimental'):return None
        for operation in ('receive','send'):
            if '*' not in config.get(operation,[]) and peer not in config.get(operation,[]):return None
        if peer in config.get('sendBlocked',[]):return None
        key=hashlib.sha256((own+'|'+peer+'|'+mid).encode()).hexdigest()
        hashed=hashlib.sha256((own+'|'+peer).encode()).hexdigest()
        self.db.execute('DELETE FROM attempts WHERE t<?',(now-7*86400,))
        if self.db.execute('SELECT 1 FROM attempts WHERE k=?',(key,)).fetchone():return None
        times=[r[0] for r in self.db.execute('SELECT t FROM attempts WHERE peer=? AND t>?',(hashed,now-86400))]
        if len(times)>=6 or (times and now-max(times)<10):return None
        if self.db.execute('SELECT COUNT(*) FROM attempts WHERE t>?',(now-3600,)).fetchone()[0]>=20:return None
        if self.db.execute('SELECT COUNT(*) FROM attempts WHERE t>?',(now-86400,)).fetchone()[0]>=100:return None
        # Reserve before any effect; uncertain delivery is never retried.
        self.db.execute('INSERT INTO attempts VALUES(?,?,?,?)',(key,hashed,now,'reserved'));self.db.commit()
        return {'recipient':peer,'text':text,'idempotencyKey':'autoreply_'+key}
    def model_budget(self,key):
        now=time.time();self.db.execute('DELETE FROM budget WHERE t<?',(now-86400,))
        used=self.db.execute('SELECT COALESCE(SUM(tokens),0) FROM budget').fetchone()[0]
        if used+4096>32000:return False
        self.db.execute('INSERT INTO budget VALUES(?,?,?)',(key,now,4096));self.db.commit();return True
    def model_usage(self,key,used):
        if type(used) is int and 0<used<=4096:
            self.db.execute('UPDATE budget SET tokens=? WHERE k=?',(used,key));self.db.commit()
    def finish(self,key,status):
        self.db.execute('UPDATE attempts SET status=? WHERE k=?',(status,key.removeprefix('autoreply_')));self.db.commit()

def main():
    from .state import state_dir,exclusive
    from .desktop import execute
    root=state_dir()/'autoreply';root.mkdir(exist_ok=True)
    settings=pathlib.Path(os.environ['APPDATA'])/'CShell'/'wechat.json'
    stop=root/'stop';status=root/'status.json'
    def report(state,**extra):
        temp=status.with_suffix('.tmp');temp.write_text(json.dumps({'state':state,'pid':os.getpid(),'updated':time.time(),'mode':'model','dailyTokenBudget':32000,**extra}),encoding='utf8');temp.replace(status)
    def current():return json.loads(settings.read_text(encoding='utf8'))
    with exclusive(root/'bot.lock'):
        data=current();binding=data['binding'];config=data['config']
        if not config.get('enabled') or not config.get('experimental'):raise RuntimeError('Wechat disabled')
        if binding not in [p['binding'] for p in execute({'method':'discover'})['processes']]:raise RuntimeError('Rebind WeChat first')
        policy=Policy(root/'limits.sqlite3');started=int(time.time());own=None
        while not stop.exists():
            child=None;ended=threading.Event();messages=queue.Queue(maxsize=64)
            try:
                data=current()
                if data['binding']!=binding or not data['config'].get('enabled'):break
                cancel=root/'listener-cancel';cancel.unlink(missing_ok=True)
                child=subprocess.Popen([sys.executable,'-m','cshell_wechat.subscription'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf8',creationflags=0x08000000)
                targets=data['config'].get('receive',[])
                child.stdin.write(json.dumps({'binding':binding,'targets':targets,'leaseSeconds':86400,'directory':str(root/'events'),'cancelFile':str(cancel)})+'\n');child.stdin.flush()
                def heartbeat():
                    while not ended.wait(1):
                        try:child.stdin.write('ping\n');child.stdin.flush()
                        except Exception:return
                def reader():
                    for line in child.stdout:
                        try:messages.put(json.loads(line),timeout=1)
                        except Exception:cancel.write_text('stop');return
                threading.Thread(target=heartbeat,daemon=True).start();threading.Thread(target=reader,daemon=True).start()
                report('starting');ready=False;renew=False;deadline=time.monotonic()+45
                while not stop.exists():
                    data=current()
                    if data['binding']!=binding or not data['config'].get('enabled') or not data['config'].get('experimental') or data['config'].get('receive',[])!=targets:break
                    if not ready and time.monotonic()>deadline:raise RuntimeError('Listener startup timeout')
                    try:item=messages.get(timeout=1)
                    except queue.Empty:
                        if child.poll() is not None:break
                        continue
                    if item.get('type')=='ready':
                        if own is not None and own!=item['accountId']:raise RuntimeError('Account changed')
                        own=item['accountId'];ready=True;report('listening',perPeerDaily=6,cooldownSeconds=10,hourly=20,daily=100)
                    elif item.get('type')=='stopped':
                        renew=item.get('reason')=='LEASE_EXPIRED';break
                    elif ready and item.get('type')=='event':
                        params=policy.reserve(item.get('event',{}),own,data['config'],started)
                        if params:
                            if not policy.model_budget(params['idempotencyKey']):continue
                            command=json.loads((root/'model-command.json').read_text(encoding='utf-8-sig'))
                            try:
                                generated=subprocess.run(command,input=json.dumps({'text':params['text']}),capture_output=True,text=True,encoding='utf8',timeout=25,creationflags=0x08000000)
                                output=json.loads(generated.stdout.strip())
                                if generated.returncode or not isinstance(output.get('text'),str) or not output['text'].strip() or len(output['text'])>240:continue
                                params['text']=output['text'];policy.model_usage(params['idempotencyKey'],output.get('usage'))
                            except Exception:continue
                            # Fresh config and binding are checked immediately before the send.
                            latest=current()
                            if latest!=data or stop.exists():continue
                            request={'method':'send','params':params,'binding':binding,'experimental':True,'cancelFile':str(stop)}
                            try:
                                result=subprocess.run([sys.executable,'-m','cshell_wechat.desktop'],input=json.dumps(request),capture_output=True,text=True,encoding='utf8',creationflags=0x08000000)
                                reply=json.loads(result.stdout);outcome=reply.get('result',{}).get('status','failed')
                                policy.finish(params['idempotencyKey'],outcome)
                                cleanup=reply.get('result',{}).get('cleanup',{})
                                if not reply.get('ok') or outcome!='native_returned' or not cleanup.get('unloaded') or not cleanup.get('codeRestored'):raise RuntimeError('Send unconfirmed; paused')
                            except Exception:
                                policy.finish(params['idempotencyKey'],'unknown');raise
                if not renew:break
            finally:
                if child:
                    cancel.write_text('stop');ended.set()
                    try:child.stdin.close();child.wait(timeout=20)
                    except Exception:report('cleanup-unconfirmed');return 1
        report('stopped');return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        from .state import state_dir
        root=state_dir()/'autoreply';root.mkdir(exist_ok=True)
        (root/'status.json').write_text(json.dumps({'state':'failed','pid':os.getpid(),'updated':time.time(),'mode':'model'}),encoding='utf8')
        sys.exit(1)
