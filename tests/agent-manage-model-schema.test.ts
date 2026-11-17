import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionParameters } from '../src/core/ai-function-schema';
import { agentManageInput } from '../src/core/api/agent-inputs';

test('WSL password pattern sent to model APIs uses a portable null escape and still rejects control characters', () => {
  const schema = functionParameters(agentManageInput);
  const branch = (schema.oneOf as any[]).find(item => item.properties.method.const === 'wsl.account.initialize');
  const pattern: string = branch.properties.params.properties.password.pattern;
  assert.ok(!pattern.includes('\\0'));
  const accepts = (password: string) => agentManageInput.safeParse({method:'wsl.account.initialize',params:{distribution:'Ubuntu',username:'user',password,confirm:true}}).success;
  for(const password of ['valid pass', 'x\0y','x\ny','x\ry']){
    assert.equal(new RegExp(pattern).test(password),password==='valid pass');
    assert.equal(accepts(password),password==='valid pass');
  }
});
