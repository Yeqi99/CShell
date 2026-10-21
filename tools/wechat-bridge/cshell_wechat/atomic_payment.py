"""Local adapter for the separately installed, verified atomic payment package.

No scanner, automatic policy, HTTP listener or native worker is copied here.
Every package call gets a fresh isolated Python interpreter. Native callbacks own
their cleanup: callers must not kill this process on a timeout or cancellation.
"""
import hashlib
from contextlib import closing
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile

METHODS = ('payment_parse', 'transfer_receive', 'red_packet_receive', 'payment_result')
CLAIMS = {'transfer_receive': 'receiveTransfers', 'red_packet_receive': 'receiveRedPackets'}
PACKAGE_NAME = 'Weixin-4.1.15.50-tool'
MANIFEST_SHA256 = 'e77f3168de85513d082f2aa34d95124e3bdf8495ad9eae61d6ec53bf6bc7d9aa'
MODULE_SHA256 = '0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b'


class AtomicPaymentError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, code):
    if not condition:
        raise AtomicPaymentError(code)


def control_root():
    return Path.home()/'.codex/skills/wechat-control'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def verified_package():
    root = (control_root()/'packages'/PACKAGE_NAME).resolve()
    try:
        raw = (root/'manifest.json').read_bytes()
        require(hashlib.sha256(raw).hexdigest() == MANIFEST_SHA256, 'PAYMENT_PACKAGE_CHANGED')
        manifest = json.loads(raw.decode('utf-8-sig'))
        require(manifest['name'] == PACKAGE_NAME and manifest['wechatVersion'] == '4.1.15.50'
                and manifest['moduleSha256'] == MODULE_SHA256
                and tuple(manifest['atomicPaymentTools']) == METHODS, 'PAYMENT_PACKAGE_UNSUPPORTED')
        for name, expected in manifest['files'].items():
            file = (root/name).resolve()
            require(file.is_relative_to(root) and file.is_file(), 'PAYMENT_PACKAGE_CHANGED')
            require(hashlib.sha256(file.read_bytes()).hexdigest() == expected, 'PAYMENT_PACKAGE_CHANGED')
        # Installation-specific state is deliberately not copied into this package.
        state = Path(read_json(root/'installation.json')['stateRoot'])
        require(state.is_absolute() and state.is_dir(), 'PAYMENT_STATE_UNAVAILABLE')
        return root, state.resolve()
    except AtomicPaymentError:
        raise
    except (OSError, ValueError, KeyError, TypeError):
        raise AtomicPaymentError('PAYMENT_PACKAGE_UNAVAILABLE') from None


def configuration(request, *, peer=None, binding=None):
    """Re-read application grants each time, including immediately before submit."""
    expected = (Path(os.environ['APPDATA'])/'CShell').resolve()
    require(isinstance(request.get('configDirectory'), str)
            and Path(request['configDirectory']).resolve() == expected, 'PAYMENT_LOCAL_ONLY')
    try:
        saved = read_json(expected/'wechat.json')
        cfg = saved['config']
        plugins = read_json(expected/'config.json').get('plugins', [])
        require(cfg.get('enabled') is True and cfg.get('experimental') is True
                and any(p.get('enabled') and p.get('manifest', {}).get('id') == 'cshell.wechat'
                        for p in plugins), 'PAYMENT_PLUGIN_DISABLED')
        if request['method'] in CLAIMS:
            require(cfg.get(CLAIMS[request['method']]) is True, 'PAYMENT_RECEIVE_NOT_AUTHORIZED')
            wanted = request.get('binding')
            require(isinstance(wanted, dict) and wanted.get('moduleSha256') == MODULE_SHA256
                    and saved.get('binding') == wanted
                    and read_json(control_root()/'binding.json') == wanted
                    and (binding is None or binding == wanted), 'PAYMENT_BINDING_CHANGED')
            require(isinstance(request.get('cancelFile'), str) and request['cancelFile'], 'PAYMENT_CANCEL_REQUIRED')
            require(not Path(request['cancelFile']).exists(), 'CANCELLED')
        require(not (control_root()/'cancel').exists(), 'CANCELLED')
        if peer is not None:
            require(isinstance(peer, str) and peer != '*'
                    and (peer in cfg.get('history', []) or '*' in cfg.get('history', [])),
                    'PAYMENT_HISTORY_NOT_AUTHORIZED')
        return cfg
    except AtomicPaymentError:
        raise
    except (OSError, ValueError, KeyError, TypeError):
        raise AtomicPaymentError('PAYMENT_CONFIG_UNAVAILABLE') from None


def spawn_isolated(request, worker=None):
    env = dict(os.environ)
    for key in ('PYTHONPATH', 'PYTHONHOME'):
        env.pop(key, None)
    envelope = dict(request=request, worker=worker)
    # No timeout or process-tree kill: a submitted native operation must drain.
    return subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).resolve())],
                          input=json.dumps(envelope).encode('utf-8'), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=env,
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=True)


def execute(request):
    require(request.get('method') in METHODS, 'UNKNOWN_METHOD')
    verified_package()
    configuration(request)
    try:
        value = json.loads(spawn_isolated(request).stdout.decode('utf-8-sig'))
        require(value.get('ok') is True, value.get('error', 'PAYMENT_FAILED'))
        return value['result']
    except AtomicPaymentError:
        raise
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        raise AtomicPaymentError('PAYMENT_RESULT_UNKNOWN_DO_NOT_RETRY') from None


def submission_guard(request, state, worker_id, database, row_id, binding):
    require(verified_package()[1] == state, 'PAYMENT_STATE_CHANGED')
    require(Path(database).resolve() == state/'.local/payments.sqlite3'
            and row_id == worker_id, 'PAYMENT_STATE_CHANGED')
    with closing(sqlite3.connect('file:'+Path(database).as_posix()+'?mode=ro', uri=True)) as db:
        row = db.execute('SELECT identity FROM attempts WHERE id=?', (row_id,)).fetchone()
    require(row is not None, 'PAYMENT_IDENTITY_MISSING')
    identity = json.loads(row[0])
    require(identity['peer'] == request['params']['peer'], 'PAYMENT_IDENTITY_CHANGED')
    configuration(request, peer=identity['peer'], binding=binding)


def run_isolated(request, worker=None):
    root, state = verified_package()
    configuration(request)
    # The process was launched with -I, and no cshell_wechat or global wechat
    # module has been loaded. Package modules stay under this verified runtime.
    require(not any(n == 'wechat' or n == 'payment_tools' or n.startswith('cshell_wechat')
                    for n in sys.modules), 'PAYMENT_IMPORT_NOT_ISOLATED')
    sys.path[:0] = [str(root), str(root/'scripts'), str(root/'runtime')]
    import wechat
    import payment_tools
    payment_tools.validate(request['method'], request.get('params', {}))
    require(Path(payment_tools.DB).resolve() == state/'.local/payments.sqlite3', 'PAYMENT_STATE_CHANGED')

    def authorize(method, params, _cfg):
        require(method == 'history', 'PAYMENT_PERMISSION_UNSUPPORTED')
        cfg = configuration(request, peer=params.get('target'))
        wechat.authorize(method, params, cfg)

    if worker is not None:
        require(request['method'] in CLAIMS and isinstance(worker, dict)
                and set(worker) == {'id'} and re.fullmatch('[a-f0-9]{64}', worker['id']),
                'PAYMENT_WORKER_INVALID')
        import receipt_worker

        def before_submit(database, row_id, binding):
            submission_guard(request, state, worker['id'], database, row_id, binding)

        sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps(worker).encode()), encoding='utf-8')
        receipt_worker.main(before_submit=before_submit)
        return

    class WorkerProcess:
        def __getattr__(self, name):
            return getattr(subprocess, name)

        def run(self, args, **kwargs):
            require(args == [sys.executable, str(root/'receipt_worker.py')], 'PAYMENT_WORKER_INVALID')
            payload = json.loads(kwargs['input'].decode())
            completed = spawn_isolated(request, payload)
            outcome = json.loads(completed.stdout.decode('utf-8-sig'))
            if outcome.get('error'):
                # A bridge gate failed before entering the verified worker.
                # Never rewrite an already-submitting/unknown outcome.
                with closing(sqlite3.connect(payment_tools.DB, timeout=15)) as db, db:
                    db.execute("UPDATE attempts SET state='not_submitted',detail=? WHERE id=? AND state='validating'",
                               ('提交前校验失败：'+str(outcome['error'])[:100], payload['id']))
            return completed

    # Change only this module's fixed worker-launch dependency, never the
    # subprocess module shared by native libraries or the installed files.
    payment_tools.subprocess = WorkerProcess()
    params = request.get('params', {})
    if request['method'] in CLAIMS:
        # The package's legacy qq resolver is outside its manifest; do not load
        # that unverified global helper through this adapter.
        require(params['peer'].startswith('wxid_'), 'PAYMENT_PEER_UNSUPPORTED')
    result = payment_tools.call(request['method'], params, configuration(request), authorize)
    print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))


def main():
    # -I ignores PYTHONIOENCODING; keep the parent NDJSON contract explicitly UTF-8.
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        raw = sys.stdin.buffer.read(131073)
        require(len(raw) <= 131072, 'INPUT_LIMIT')
        envelope = json.loads(raw.decode('utf-8-sig'))
        with tempfile.TemporaryDirectory(prefix='cshell-atomic-import-') as cache:
            # Ignore unverified old .pyc files next to an otherwise valid package.
            sys.dont_write_bytecode = True
            sys.pycache_prefix = cache
            run_isolated(envelope['request'], envelope.get('worker'))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': getattr(error, 'code', 'PAYMENT_FAILED')}))


if __name__ == '__main__':
    main()
