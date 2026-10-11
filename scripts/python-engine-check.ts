import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { analysisScript } from '../src/core/environments';
const python = process.env.CSHELL_TEST_PYTHON;
if (!python) throw new Error('Set CSHELL_TEST_PYTHON to the test interpreter');
const analyze = (code: string, line: number, column: number) =>
  new Promise<any>((resolveResult, reject) => {
    const process = spawn(python, [
      '-c',
      `import sys\nsys.path.insert(0,${JSON.stringify(resolve('test-results/python-engine'))})\n${analysisScript}`,
    ]);
    let output = '',
      error = '';
    process.stdout.on('data', (data) => (output += data));
    process.stderr.on('data', (data) => (error += data));
    process.on('error', reject);
    process.on('close', (code) =>
      code === 0 ? resolveResult(JSON.parse(output)) : reject(new Error(error)),
    );
    process.stdin.end(JSON.stringify({ code, line, column }));
  });
const completion = await analyze('import pathlib\npathlib.Pa', 2, 10);
assert.ok(completion.completions.some((c: any) => c.label === 'Path'));
const signature = await analyze('def greet(name: str):\n    return name\ngreet(', 3, 6);
assert.ok(signature.signatures.some((s: string) => s.includes('greet(name: str)')));
const diagnostics = await analyze('def broken(:\n    pass', 2, 8);
assert.ok(diagnostics.diagnostics.length);
const unicode = await analyze('名字 = "test"\n名字.upp', 2, 6);
assert.ok(unicode.completions.some((c: any) => c.label === 'upper'));
console.log('Real Jedi: imports, signatures, syntax diagnostics and Unicode passed.');
