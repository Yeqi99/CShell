"""Authenticated, bounded model gateway. Upstream credentials never leave this process."""
import json, os, threading, time, urllib.request, urllib.error

from model_pool import COST_LABELS, Pool, upstream

def inference_schema(value):
    """Small-model grammar hints only. The caller still validates full tool arguments."""
    if not isinstance(value, dict):
        return value
    omitted = {'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'default'}
    result = {}
    for key, item in value.items():
        if key in omitted:
            continue
        if key in ('properties', '$defs', 'definitions') and isinstance(item, dict):
            result[key] = {name: inference_schema(child) for name, child in item.items()}
        elif isinstance(item, list):
            result[key] = [inference_schema(child) for child in item]
        else:
            result[key] = inference_schema(item)
    return result

class Models:
    def __init__(self, service, failure):
        self.s, self.F = service, failure
        self.entries = {}
        self.pool = Pool(service,failure)
        self.slots = threading.BoundedSemaphore(2)
        self.member_slots = threading.BoundedSemaphore(24)
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

    def catalog(self, account=None):
        return {'models': [{'id': e['id'], 'name': e['name'], 'vision': bool(e.get('vision')), 'free': True} for e in self.entries.values()] + ([dict(id=m['id'],name=m['name']+(' · Kimi 直连' if p['provider']=='kimi' else '')+' · '+COST_LABELS[m['costTier']],providerId=m['id'][5:],vision=False,free=False) for p in self.pool.view(account)['pools'] if p['weekly']>0 for m in p['models']] if account else [])}

    def complete(self, account, body, emit=None):
        if not isinstance(body.get('model'),str):raise self.F(400,'模型 ID 无效')
        entry = self.entries.get(body['model'])
        pooled=isinstance(body.get('model'),str) and body['model'].startswith('pool-')
        if not entry and not pooled:
            raise self.F(404, '模型暂不可用')
        messages = body.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 300:
            raise self.F(400, '消息格式不正确')
        if len(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()) > (2 if pooled else 1) * 1024 * 1024:
            raise self.F(413, '本次模型输入过大')
        if not pooled:
            self.s.limit('model-minute:' + account, 12, 60)
            self.s.limit('model-day:' + account, 500, 86400)
        slots=self.member_slots if pooled else self.slots
        with self.lock:
            if account in self.active or not slots.acquire(False):
                raise self.F(429, '模型正在处理请求，请稍后重试')
            self.active.add(account)
        result = None
        lease,status=None,0
        usage={}
        try:
            # Whitelist inference fields; clients cannot choose URLs, credentials or routing.
            payload = {k: body[k] for k in ('messages', 'tools', 'tool_choice', 'temperature', 'top_p', 'response_format') if k in body}
            # Local chat templates require exactly one system message at the beginning.
            # Preserve system priority and order instead of downgrading runtime instructions.
            systems = [m.get('content', '') for m in messages if isinstance(m, dict) and m.get('role') == 'system']
            if systems and all(isinstance(s, str) for s in systems):
                payload['messages'] = [{'role': 'system', 'content': '\n\n'.join(systems)}] + [m for m in messages if not isinstance(m, dict) or m.get('role') != 'system']
            if not pooled and isinstance(payload.get('tools'), list):
                payload['tools'] = [{**tool, 'function': {**tool['function'], 'parameters': inference_schema(tool['function'].get('parameters', {}))}} for tool in payload['tools']]
            maximum = body.get('max_tokens', 65536 if pooled else 2048)
            if type(maximum) is not int or maximum < 1:
                raise self.F(400, '输出长度不正确')
            streaming = body.get('stream') is True and emit is not None
            if pooled:
                input_bound=len(json.dumps(payload, ensure_ascii=False).encode())+128+8*len(messages)
                entry,lease=self.pool.reserve(account,body['model'],input_bound+maximum,maximum,fit_output=True)
                maximum=entry['maxOutputTokens']
            else:
                maximum=min(maximum,4096)
            payload.update(model=entry['model'], stream=streaming, max_tokens=maximum, chat_template_kwargs={'enable_thinking': False})
            if pooled:payload.pop('chat_template_kwargs',None)
            if streaming:
                payload['stream_options'] = {'include_usage': True}
            request = urllib.request.Request(entry['url'], json.dumps(payload).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + entry['key']})
            if pooled and entry.get('provider')=='opencode-go':
                first=next((m.get('content') for m in messages if isinstance(m,dict) and m.get('role')=='user'),'')
                session=self.s.digest('go-chat:'+account+':'+json.dumps(first,ensure_ascii=False))
                request.add_header('x-opencode-session','ses_'+session[:32])
            with (upstream if pooled else urllib.request.urlopen)(request, timeout=120) as response:
                if streaming and 'text/event-stream' in response.headers.get('Content-Type', ''):
                    size, started, data_lines = 0, time.monotonic(), []
                    usage = {}
                    finished = False
                    while True:
                        line = response.readline(1024 * 1024 + 1)
                        size += len(line)
                        if size > 8 * 1024 * 1024 or len(line) > 1024 * 1024 or time.monotonic() - started > 120:
                            raise self.F(502, '模型流式响应超过限制')
                        if not line:
                            # Go MiniMax closes after the finish event and final usage receipt.
                            if (entry.get('provider') == 'opencode-go' and entry['model'] == 'minimax-m3'
                                    and finished and usage.get('opencode') and not data_lines):
                                result = {'usage': usage}
                                status = 200
                                emit('[DONE]')
                                return result
                            raise self.F(502, '模型响应中断，请重试')
                        line = line.decode('utf-8').rstrip('\r\n')
                        if line.startswith('data:'):
                            data_lines.append(line[5:].lstrip())
                        elif not line and data_lines:
                            data = '\n'.join(data_lines)
                            data_lines = []
                            if data.strip() == '[DONE]':
                                result = {'usage': usage}
                                status=200
                                emit('[DONE]')
                                return result
                            event = json.loads(data)
                            if not isinstance(event, dict) or event.get('error'):
                                raise self.F(502, '模型响应异常，请重试')
                            finished = finished or any(c.get('finish_reason') for c in event.get('choices', []) if isinstance(c, dict))
                            event['model'] = entry['id']
                            if isinstance(event.get('usage'), dict):
                                usage = event['usage']
                            emit(json.dumps(event, ensure_ascii=False))
                data = response.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024:
                    raise self.F(502, '模型响应过大')
                result = json.loads(data)
                if not isinstance(result.get('choices'), list):
                    raise self.F(502, '模型响应不完整')
                status=200
                result['model'] = entry['id']
                return result
        except self.F:
            raise
        except urllib.error.HTTPError as error:
            # Do not expose upstream bodies: they can include prompts or service details.
            status = error.code
            try:
                detail=error.read(16384).decode('utf-8','replace').lower() if status in (400,413,422) else ''
            finally:
                error.close()
            if any(term in detail for term in ('max_tokens','max_completion_tokens','context_length','context length','maximum context')):
                raise self.F(400,'模型服务拒绝了本次上下文或输出长度，请压缩会话或减小请求的输出上限')
            if status in (400, 413, 422):
                raise self.F(400, '模型无法处理本次输入，请缩短会话或切换模型')
            if status == 429:
                raise self.F(429, '模型请求较多，请稍后重试')
            raise self.F(503, '模型服务暂不可用，请稍后重试')
        except Exception:
            raise self.F(503, '模型服务暂时繁忙，请稍后重试')
        finally:
            with self.lock:
                self.active.discard(account)
                slots.release()
            if lease:self.pool.finish(lease,status,(result or {}).get('usage') or usage)
            usage = (result or {}).get('usage') or {}
            with self.s.db() as db:
                db.execute('INSERT INTO model_usage VALUES(?,?,?,?,?,?)', (account, body['model'], time.time(), int(usage.get('prompt_tokens', 0)), int(usage.get('completion_tokens', 0)), int(status==200)))

    def usage(self):
        with self.s.db() as db:
            rows = db.execute('SELECT account,model,count(*),sum(input_tokens),sum(output_tokens),sum(success) FROM model_usage WHERE at>? GROUP BY account,model', (time.time()-30*86400,)).fetchall()
            recent=db.execute('SELECT rowid,account,model,at,input_tokens,output_tokens,success FROM model_usage ORDER BY at DESC LIMIT 100').fetchall()
        return {'usage': [dict(zip(('account','model','requests','inputTokens','outputTokens','succeeded'), r)) for r in rows], 'recent':[dict(zip(('id','account','model','at','inputTokens','outputTokens','success'),r)) for r in recent]}
