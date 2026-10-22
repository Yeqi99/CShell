"""Authenticated, bounded model gateway. Upstream credentials never leave this process."""
import json, os, threading, time, urllib.request

class Models:
    def __init__(self, service, failure):
        self.s, self.F = service, failure
        self.entries = {}
        self.slots = threading.BoundedSemaphore(2)
        self.active = set()
        self.lock = threading.Lock()
        path = os.environ.get('OFFICIAL_MODELS_FILE')
        if path:
            with open(path, encoding='utf-8') as source:
                for entry in json.load(source):
                    if entry['id'] in self.entries:
                        raise ValueError('Duplicate official model')
                    self.entries[entry['id']] = entry
        with service.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS model_usage(account TEXT,model TEXT,at REAL,input_tokens INTEGER,output_tokens INTEGER,success INTEGER)')

    def catalog(self):
        return {'models': [{'id': e['id'], 'name': e['name'], 'vision': bool(e.get('vision')), 'free': True} for e in self.entries.values()]}

    def complete(self, account, body):
        entry = self.entries.get(body.get('model'))
        if not entry:
            raise self.F(404, '模型暂不可用')
        messages = body.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 300:
            raise self.F(400, '消息格式不正确')
        if len(json.dumps(body).encode()) > 1024 * 1024:
            raise self.F(413, '本次模型输入过大')
        self.s.limit('model-minute:' + account, 12, 60)
        self.s.limit('model-day:' + account, 500, 86400)
        with self.lock:
            if account in self.active or not self.slots.acquire(False):
                raise self.F(429, '模型正在处理请求，请稍后重试')
            self.active.add(account)
        result = None
        try:
            # Whitelist inference fields; clients cannot choose URLs, credentials or routing.
            payload = {k: body[k] for k in ('messages', 'tools', 'tool_choice', 'temperature', 'top_p', 'response_format') if k in body}
            maximum = body.get('max_tokens', 2048)
            if type(maximum) is not int or maximum < 1:
                raise self.F(400, '输出长度不正确')
            payload.update(model=entry['model'], stream=False, max_tokens=min(maximum, 4096), chat_template_kwargs={'enable_thinking': False})
            request = urllib.request.Request(entry['url'], json.dumps(payload).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + entry['key']})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024:
                    raise self.F(502, '模型响应过大')
                result = json.loads(data)
                if not isinstance(result.get('choices'), list):
                    raise self.F(502, '模型响应不完整')
                result['model'] = entry['id']
                return result
        except self.F:
            raise
        except Exception:
            raise self.F(503, '模型服务暂时繁忙，请稍后重试')
        finally:
            with self.lock:
                self.active.discard(account)
                self.slots.release()
            usage = (result or {}).get('usage') or {}
            with self.s.db() as db:
                db.execute('INSERT INTO model_usage VALUES(?,?,?,?,?,?)', (account, entry['id'], time.time(), int(usage.get('prompt_tokens', 0)), int(usage.get('completion_tokens', 0)), int(result is not None)))

    def usage(self):
        with self.s.db() as db:
            rows = db.execute('SELECT account,model,count(*),sum(input_tokens),sum(output_tokens),sum(success) FROM model_usage WHERE at>? GROUP BY account,model', (time.time()-30*86400,)).fetchall()
            recent=db.execute('SELECT rowid,account,model,at,input_tokens,output_tokens,success FROM model_usage ORDER BY at DESC LIMIT 100').fetchall()
        return {'usage': [dict(zip(('account','model','requests','inputTokens','outputTokens','succeeded'), r)) for r in rows], 'recent':[dict(zip(('id','account','model','at','inputTokens','outputTokens','success'),r)) for r in recent]}
