"""Loopback-only transfer viewer using the existing authorized Codex adapter.

The receipt adapter is not implemented; no endpoint submits a financial action.
"""
import argparse
import hashlib
import json
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


def cards(events, target):
    """Expose only payment metadata, never ordinary messages or raw tickets."""
    found = {}
    for event in events:
        if event.get('conversationId') != target or event.get('contentStatus') != 'payment-card':
            continue
        try:
            card = json.loads(event['text'])
        except (ValueError, TypeError, KeyError):
            continue
        if not isinstance(card, dict) or card.get('kind') != 'transfer':
            continue
        ref = card.get('paymentReference')
        if not isinstance(ref, str) or len(ref) != 64 or any(c not in '0123456789abcdef' for c in ref):
            continue
        state = card.get('messageState')
        if state not in ('transfer_notice', 'receipt_notice'):
            continue
        row = found.setdefault(ref, {'id': hashlib.sha256((target + ':' + ref).encode()).hexdigest(),
                                    'target': target, 'incomingObserved': False,
                                    'receiptObserved': False, 'amount': None, 'currency': None,
                                    'timestamp': None, 'canReceive': False})
        # A notice sent by the conversation's peer is incoming; do not infer
        # direction from the payment subtype alone.
        if state == 'transfer_notice' and event.get('senderId') == target:
            row['incomingObserved'] = True
            amount = card.get('amountMinor')
            if type(amount) is int and amount > 0 and card.get('currency') == 'CNY':
                row['amount'] = f'{amount // 100}.{amount % 100:02d}'
                row['currency'] = 'CNY'
            row['timestamp'] = event.get('timestamp')
        if state == 'receipt_notice':
            row['receiptObserved'] = True
    return [row for row in found.values() if row['incomingObserved']]


class Backend:
    def __init__(self, adapter, target):
        self.adapter = adapter
        self.target = target
        self.lock = threading.Lock()

    def call(self, method, params=None):
        process = subprocess.run(
            [sys.executable, str(self.adapter)],
            input=json.dumps({'method': method, 'params': params or {}}).encode(),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        result = json.loads(process.stdout.decode('utf-8-sig'))
        if not result.get('ok'):
            raise RuntimeError('微信读取失败，请检查插件授权和进程绑定。')
        return result['result']

    def snapshot(self):
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('正在读取，请稍后刷新。')
        try:
            # Bounded pagination, explicitly disclose that this is not all history.
            events, cursor, more = [], None, False
            for _ in range(4):
                params = {'target': self.target, 'limit': 30,
                          'direction': 'before' if cursor else 'latest'}
                if cursor:
                    params['cursor'] = cursor
                page = self.call('history', params)
                events.extend(page.get('events', []))
                more = bool(page.get('hasMore'))
                next_cursor = page.get('olderCursor')
                if page.get('gap') or not more or not next_cursor or next_cursor == cursor:
                    break
                cursor = next_cursor
            return {'cards': cards(events, self.target), 'target': self.target,
                    'scannedMessages': len(events), 'hasMore': more,
                    'coverage': '当前联系人最近最多 120 条本地消息，不代表全部历史。',
                    'receiptAvailable': False}
        finally:
            self.lock.release()


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, backend, port=0):
        self.backend = backend
        self.token = secrets.token_urlsafe(32)
        super().__init__(('127.0.0.1', port), Handler)
        self.host = f'127.0.0.1:{self.server_port}'

    @property
    def url(self):
        # Keep the token out of requests, referrers and access logs.
        return f'http://{self.host}/#{self.token}'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, value, html=False):
        body = value if html else json.dumps(value, ensure_ascii=False)
        body = body.encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if html else 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get('Host') == self.server.host

    def do_GET(self):
        if not self.valid_host():
            return self.reply(403, {'error': '请求地址不匹配。'})
        if urlsplit(self.path).path == '/':
            return self.reply(200, HTML, html=True)
        return self.reply(404, {'error': '入口不存在。'})

    def do_POST(self):
        if (not self.valid_host()
                or self.headers.get('Origin') != f'http://{self.server.host}'
                or not secrets.compare_digest(self.headers.get('X-Session', ''), self.server.token)):
            return self.reply(403, {'error': '请从本机启动链接打开页面。'})
        if self.path != '/api/transfers':
            return self.reply(404, {'error': '收款接口尚未接通；没有提交任何操作。'})
        try:
            self.reply(200, self.server.backend.snapshot())
        except subprocess.TimeoutExpired:
            self.reply(504, {'error': '微信读取超时，请稍后重试。'})
        except Exception:
            self.reply(503, {'error': '暂时无法读取，请检查微信是否运行、插件授权及绑定是否有效。'})


HTML = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>微信转账 · CShell</title>
<style>
:root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172b3b;background:#f3f6fa}
*{box-sizing:border-box}body{margin:0}main{max-width:850px;margin:56px auto;padding:0 24px}
header{display:flex;align-items:center;justify-content:space-between;gap:20px}
h1{font-size:26px;margin:0 0 8px}p{color:#627488;font-size:14px;line-height:1.6}
button{border:1px solid #cdd9e5;border-radius:10px;background:white;color:#254860;padding:10px 18px;font:inherit;cursor:pointer}
button:focus-visible{outline:3px solid #a0c9ff;outline-offset:3px}button:disabled{opacity:.55;cursor:wait}
.notice{padding:15px 18px;border:1px solid #d8e2ec;border-radius:12px;background:#eaf1f7;margin:24px 0}
article{background:white;border:1px solid #dce4ed;border-radius:16px;padding:22px;margin:12px 0;display:flex;align-items:center;justify-content:space-between;gap:20px}
.amount{font-size:30px;font-weight:600;margin:8px 0}.muted{font-size:13px;color:#6b7c8c;overflow-wrap:anywhere}
.badge{border-radius:20px;background:#edf3f8;padding:8px 12px;font-size:13px;white-space:nowrap}
#status{min-height:24px}footer{font-size:12px;color:#738397;margin-top:24px}
@media(max-width:550px){main{margin:28px auto;padding:0 16px}article{align-items:flex-start;flex-direction:column}}
</style><main>
<header><div><h1>微信转账</h1><p>查看转账信息，收款由你手动决定。</p></div><button id="refresh">刷新</button></header>
<div class="notice">当前为信息查看页。网页收款接口尚未接通，请暂时在微信里收款。</div>
<p id="status" role="status" aria-live="polite">准备读取…</p><section id="list"></section>
<footer id="coverage"></footer></main>
<script>
const token=location.hash.slice(1)||sessionStorage.getItem('paymentSession')||'';
sessionStorage.setItem('paymentSession',token);history.replaceState(null,'',location.pathname);
const button=document.querySelector('#refresh'),status=document.querySelector('#status');
function el(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n}
async function refresh(){
 button.disabled=true;status.textContent='正在读取微信转账…';
 try{
  const response=await fetch('/api/transfers',{method:'POST',headers:{'X-Session':token}});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  const list=document.querySelector('#list');list.replaceChildren();
  for(const card of data.cards){
   const row=el('article',''),left=el('div','');
   left.append(el('div',card.target,'muted'),el('div',card.amount===null?'金额未识别':'¥ '+card.amount,'amount'));
   const time=Number(card.timestamp);if(time>0)left.append(el('div',new Date(time*1000).toLocaleString(),'muted'));
   row.append(left,el('span',card.receiptObserved?'已观察到收款回执':'收款状态待核实','badge'));list.append(row);
  }
  status.textContent=data.cards.length?'已读取 '+data.cards.length+' 笔转账':'本次读取范围内没有收到的转账。';
  document.querySelector('#coverage').textContent=data.coverage+' 已扫描 '+data.scannedMessages+' 条。回执不代表余额核验。';
 }catch(error){status.textContent=error.message}finally{button.disabled=false}
}
button.addEventListener('click',refresh);refresh();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--adapter', type=Path, required=True)
    parser.add_argument('--ready-file', type=Path, required=True)
    args = parser.parse_args()
    from .contracts import identifier
    identifier(args.target)
    backend = Backend(args.adapter.resolve(strict=True), args.target)
    backend.call('status')
    server = Server(backend)
    args.ready_file.write_text(json.dumps({'url': server.url, 'receiptAvailable': False}), encoding='utf8')
    try:
        server.serve_forever()
    finally:
        server.server_close()
        args.ready_file.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
