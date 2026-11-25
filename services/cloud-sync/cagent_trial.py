"""Daily sponsored inference. A pending call stays charged if its outcome is unknown."""
import datetime
import json
import re
import secrets

ZONE = datetime.timezone(datetime.timedelta(hours=8))
PUBLIC = 'cagent-default'

def reply(text):
    return {'model':PUBLIC,'choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':'stop'}]}

class Trial:
    def __init__(self, models):
        self.models = models
        self.s, self.F = models.s, models.F
        with self.s.db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS trial_settings(singleton INTEGER PRIMARY KEY,global_limit INTEGER,device_limit INTEGER,models TEXT);
              INSERT OR IGNORE INTO trial_settings VALUES(1,10000000,1000000,'[]');
              CREATE TABLE IF NOT EXISTS trial_calls(id TEXT PRIMARY KEY,day TEXT,device TEXT,tokens INTEGER);
              CREATE INDEX IF NOT EXISTS trial_daily ON trial_calls(day,device);
            """)

    def settings(self, body=None):
        with self.s.db() as db:
            if body is not None:
                limits=[body.get(k) for k in ('globalLimit','deviceLimit')]
                ids=body.get('models')
                if any(type(v) is not int or not 0<=v<=10**10 for v in limits) or not isinstance(ids,list) or len(ids)>24 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):
                    raise self.F(400,'请检查每日限额和模型列表')
                db.execute('BEGIN IMMEDIATE')
                if any(not db.execute('SELECT 1 FROM pool_models WHERE id=? AND enabled=1',(i,)).fetchone() for i in ids):
                    raise self.F(400,'请选择已启用的号池模型')
                db.execute('UPDATE trial_settings SET global_limit=?,device_limit=?,models=? WHERE singleton=1',(*limits,json.dumps(ids)))
            g,d,ids=db.execute('SELECT global_limit,device_limit,models FROM trial_settings WHERE singleton=1').fetchone()
            today=datetime.datetime.now(ZONE).date().isoformat()
            used=db.execute('SELECT coalesce(sum(tokens),0) FROM trial_calls WHERE day=?',(today,)).fetchone()[0]
            return dict(globalLimit=g,deviceLimit=d,models=json.loads(ids),used=used)

    def complete(self, device, body):
        if not isinstance(device,str) or not re.fullmatch('[0-9a-f]{64}',device):
            raise self.F(400,'设备标识无效')
        device=self.s.digest('cagent-trial:'+device)
        messages=body.get('messages')
        if not isinstance(messages,list) or not 1<=len(messages)<=300 or any(not isinstance(m,dict) or not isinstance(m.get('content','') or '',str) for m in messages):
            raise self.F(400,'体验基座支持文本与工具消息')
        payload={k:body[k] for k in ('messages','tools','tool_choice') if k in body}
        bound=len(json.dumps(payload,ensure_ascii=False).encode())+1024+16*len(messages)
        if bound>384000:return reply('本次内容较长，请缩短对话，或在模型与权限中配置自己的大模型基座。')
        today=datetime.datetime.now(ZONE).date().isoformat()
        self.s.limit('trial-minute:'+device,40,60)
        with self.s.db() as db:
            db.execute('BEGIN IMMEDIATE')
            g,d,ids=db.execute('SELECT global_limit,device_limit,models FROM trial_settings WHERE singleton=1').fetchone()
            used,personal=db.execute('SELECT coalesce(sum(tokens),0),coalesce(sum(CASE WHEN device=? THEN tokens ELSE 0 END),0) FROM trial_calls WHERE day=?',(device,today)).fetchone()
            maximum=min(4096,min(g-used,d-personal)-bound)
            if maximum<1:return reply('今日体验额度已用完或不足以完成本次提问。请在「模型与权限」配置自己的大模型基座，或明天再试。')
            candidates=json.loads(ids)
            if not candidates:return reply('体验基座暂未开放。请在「模型与权限」配置自己的大模型基座。')
            lease=secrets.token_hex(16)
            db.execute('INSERT INTO trial_calls VALUES(?,?,?,?)',(lease,today,device,bound+maximum))
        # Try another configured model only for a known pre-inference rejection.
        for model in candidates:
            try:
                result=self.models.complete('trial:'+device,dict(payload,model=model,max_tokens=maximum),sponsored=True)
            except self.F as error:
                if error.message in ('当前号池暂无可用账号','会员模型未开放','模型请求较多，请稍后重试'):continue
                return reply('体验基座暂时繁忙，请稍后再试，或在「模型与权限」配置自己的大模型基座。')
            usage=result.get('usage') or {}
            total=usage.get('total_tokens')
            if type(total) is int and total>0:
                with self.s.db() as db:db.execute('UPDATE trial_calls SET tokens=? WHERE id=?',(total,lease))
            choice=result['choices'][0]
            msg=choice['message']
            return {'model':PUBLIC,'choices':[{'index':0,'finish_reason':choice.get('finish_reason'),'message':{k:msg[k] for k in ('role','content','tool_calls') if k in msg}}]}
        with self.s.db() as db:db.execute('DELETE FROM trial_calls WHERE id=?',(lease,))
        return reply('体验基座当前没有可用线路，请稍后再试，或配置自己的大模型基座。')
