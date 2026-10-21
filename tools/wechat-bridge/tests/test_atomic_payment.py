"""Synthetic adapter gates; never load a live WeChat process or submit money."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from cshell_wechat import atomic_payment as bridge


class AtomicPaymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.control = self.root/'control'
        self.control.mkdir()
        self.saved = self.root/'CShell'
        self.saved.mkdir()
        self.state = self.root/'state'
        (self.state/'.local').mkdir(parents=True)
        self.binding = dict(pid=123, created='synthetic', moduleSha256=bridge.MODULE_SHA256)
        self.cfg = dict(enabled=True, experimental=True, receiveTransfers=True,
                        receiveRedPackets=True, history=['wxid_sender'])
        self.write_config()
        (self.control/'binding.json').write_text(json.dumps(self.binding))
        (self.saved/'config.json').write_text(json.dumps({'plugins': [
            {'enabled': True, 'manifest': {'id': 'cshell.wechat'}}]}))
        self.request = dict(method='transfer_receive', params={'peer': 'wxid_sender'},
                            configDirectory=str(self.saved), binding=self.binding,
                            cancelFile=str(self.root/'cancel'))
        self.patch_env = patch.dict(os.environ, {'APPDATA': str(self.root)})
        self.patch_root = patch.object(bridge, 'control_root', return_value=self.control)
        self.patch_env.start()
        self.patch_root.start()
        self.addCleanup(self.patch_env.stop)
        self.addCleanup(self.patch_root.stop)

    def write_config(self, binding=None):
        (self.saved/'wechat.json').write_text(json.dumps({'config': self.cfg,
                                                         'binding': binding or self.binding}))

    def test_independent_receive_flags_and_local_scope(self):
        bridge.configuration(self.request, peer='wxid_sender')
        self.cfg['receiveTransfers'] = False
        self.write_config()
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'NOT_AUTHORIZED'):
            bridge.configuration(self.request)
        bridge.configuration(dict(self.request, method='red_packet_receive'))
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'LOCAL_ONLY'):
            bridge.configuration(dict(self.request, configDirectory=str(self.root/'agent')))
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'HISTORY_NOT_AUTHORIZED'):
            bridge.configuration(dict(self.request, method='payment_result'), peer='wxid_other')
        (self.saved/'config.json').write_text('{"plugins":[]}')
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'PLUGIN_DISABLED'):
            bridge.configuration(dict(self.request, method='payment_parse'))

    def test_binding_and_cancellation_rechecked(self):
        bridge.configuration(self.request, binding=self.binding)
        (self.control/'binding.json').write_text(json.dumps(dict(self.binding, pid=456)))
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'BINDING_CHANGED'):
            bridge.configuration(self.request)
        # Offline parsing and result authorization do not need a live binding.
        bridge.configuration(dict(self.request, method='payment_parse', binding=None))
        (self.control/'binding.json').write_text(json.dumps(self.binding))
        Path(self.request['cancelFile']).touch()
        with self.assertRaisesRegex(bridge.AtomicPaymentError, 'CANCELLED'):
            bridge.configuration(self.request)

    def test_submit_gate_observes_revocation_and_journal_identity(self):
        database = self.state/'.local/payments.sqlite3'
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('CREATE TABLE attempts(id TEXT, identity TEXT)')
            db.execute('INSERT INTO attempts VALUES(?,?)', ('a'*64, json.dumps({'peer': 'wxid_sender'})))
        with patch.object(bridge, 'verified_package', return_value=(self.root, self.state)):
            gate = lambda: bridge.submission_guard(self.request, self.state, 'a'*64,
                                                   database, 'a'*64, self.binding)
            gate()
            self.cfg['receiveTransfers'] = False
            self.write_config()
            with self.assertRaisesRegex(bridge.AtomicPaymentError, 'NOT_AUTHORIZED'):
                gate()
            self.cfg['receiveTransfers'] = True
            self.write_config()
            Path(self.request['cancelFile']).touch()
            with self.assertRaisesRegex(bridge.AtomicPaymentError, 'CANCELLED'):
                gate()

    def package(self, extra=None):
        package = self.control/'packages'/bridge.PACKAGE_NAME
        (package/'scripts').mkdir(parents=True)
        (package/'runtime').mkdir()
        (package/'installation.json').write_text(json.dumps({'stateRoot': str(self.state)}))
        sources = {
            'scripts/wechat.py': 'def authorize(method, params, cfg): pass\n',
            'payment_tools.py': 'import json\nfrom pathlib import Path\nROOT=Path(__file__).parent\nDB=Path(json.loads((ROOT/"installation.json").read_text())["stateRoot"])/".local/payments.sqlite3"\ndef validate(method,params):\n assert method=="payment_parse"\ndef call(method,params,cfg,authorize):\n return {"isolated":True}\n',
        }
        sources.update(extra or {})
        hashes = {}
        for name, source in sources.items():
            (package/name).write_text(source)
            hashes[name] = hashlib.sha256((package/name).read_bytes()).hexdigest()
        manifest = dict(name=bridge.PACKAGE_NAME, wechatVersion='4.1.15.50',
                        moduleSha256=bridge.MODULE_SHA256, atomicPaymentTools=list(bridge.METHODS), files=hashes)
        (package/'manifest.json').write_text(json.dumps(manifest))
        digest = hashlib.sha256((package/'manifest.json').read_bytes()).hexdigest()
        return package, digest

    def test_manifest_and_every_file_are_verified(self):
        package, digest = self.package()
        with patch.object(bridge, 'MANIFEST_SHA256', digest):
            self.assertEqual(bridge.verified_package(), (package.resolve(), self.state.resolve()))
            (package/'payment_tools.py').write_text('changed')
            with self.assertRaisesRegex(bridge.AtomicPaymentError, 'PACKAGE_CHANGED'):
                bridge.verified_package()

    def test_fresh_interpreter_imports_only_fixed_package(self):
        _, digest = self.package()
        runner = self.root/'runner.py'
        runner.write_text('''import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location("atomic_bridge",sys.argv[1]);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
bridge.control_root=lambda:pathlib.Path(sys.argv[2]);bridge.MANIFEST_SHA256=sys.argv[3]
bridge.run_isolated(json.loads(sys.stdin.read()))
''')
        request = dict(self.request, method='payment_parse', params={'xml': '<msg/>'})
        result = subprocess.run([sys.executable, '-I', '-B', str(runner), bridge.__file__, str(self.control), digest],
                                input=json.dumps(request).encode(), capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)['result'], {'isolated': True})

    def test_parent_rejects_unknown_method_before_any_package_call(self):
        with patch.object(bridge, 'spawn_isolated') as child:
            with self.assertRaisesRegex(bridge.AtomicPaymentError, 'UNKNOWN_METHOD'):
                bridge.execute(dict(self.request, method='payment_automatic'))
            child.assert_not_called()

    def test_worker_entry_injects_submit_guard_after_initial_authorization(self):
        database = self.state/'.local/payments.sqlite3'
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('CREATE TABLE attempts(id TEXT, identity TEXT)')
            db.execute('INSERT INTO attempts VALUES(?,?)', ('a'*64, json.dumps({'peer': 'wxid_sender'})))
        stub = '''import json,os,pathlib,sys
def main(before_submit=None):
 request=json.loads(sys.stdin.read())
 saved=pathlib.Path(os.environ["APPDATA"])/"CShell"/"wechat.json"
 value=json.loads(saved.read_text());value["config"]["receiveTransfers"]=False;saved.write_text(json.dumps(value))
 root=pathlib.Path(json.loads((pathlib.Path(__file__).parent/"installation.json").read_text())["stateRoot"])
 before_submit(root/".local/payments.sqlite3",request["id"],value["binding"])
 raise AssertionError("revoked grant allowed submit")
'''
        _, digest = self.package({'receipt_worker.py': stub,
            'payment_tools.py': 'import json\nfrom pathlib import Path\nROOT=Path(__file__).parent\nDB=Path(json.loads((ROOT/"installation.json").read_text())["stateRoot"])/".local/payments.sqlite3"\ndef validate(method,params): pass\n'})
        runner = self.root/'worker-test.py'
        runner.write_text('''import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location("atomic_bridge",sys.argv[1]);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
bridge.control_root=lambda:pathlib.Path(sys.argv[2]);bridge.MANIFEST_SHA256=sys.argv[3]
try: bridge.run_isolated(json.loads(sys.stdin.read()),{"id":"a"*64})
except bridge.AtomicPaymentError as error: print(json.dumps({"code":error.code}))
''')
        result = subprocess.run([sys.executable, '-I', '-B', str(runner), bridge.__file__, str(self.control), digest],
                                input=json.dumps(self.request).encode(), capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)['code'], 'PAYMENT_RECEIVE_NOT_AUTHORIZED')


if __name__ == '__main__':
    unittest.main()
