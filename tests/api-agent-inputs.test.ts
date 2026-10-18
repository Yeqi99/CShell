import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { agentManageInput, agentRelayInput } from '../src/core/api/agent-inputs';
import { agentMethods, agentCapability } from '../src/shared/agent';
import { agentMethodOutputs, agentOutputContract } from '../src/core/api/agent-outputs';
import { agentApiExcludedMethods } from '../src/core/api/agent-exposure';

test('Agent management and relay catalogs describe every exported method with concrete parameters', () => {
  const excluded = Object.keys(agentApiExcludedMethods);
  assert.deepEqual(Object.keys(agentMethodOutputs).sort(), agentMethods.filter((method) => !excluded.includes(method)).sort());
  for (const capability of ['agent.manage', 'agent.hosting', 'agent.relay']) {
    const bytes = Buffer.byteLength(JSON.stringify(z.toJSONSchema(agentOutputContract(capability))));
    assert.ok(bytes < 131072, `${capability} output contract must fit the maximum catalog budget with room for inputs`);
  }
  for (const [capability, schema] of [['agent.manage', agentManageInput], ['agent.relay', agentRelayInput]] as const) {
    const json = z.toJSONSchema(schema) as unknown as { oneOf: { properties: { method: { const: string }; params: object } }[] };
    assert.deepEqual(json.oneOf.map((s) => s.properties.method.const).sort(), agentMethods.filter((method) => agentCapability(method) === capability && !excluded.includes(method)).sort());
    for (const option of json.oneOf) assert.ok(Object.keys(option.properties.params).length > 0);
  }
  assert.equal(agentManageInput.safeParse({ method: 'wsl.install', params: {} }).success, false);
  assert.equal(agentManageInput.safeParse({ method: 'wsl.network.apply', params: { confirmDisconnect: false } }).success, false);
  assert.equal(agentManageInput.safeParse({ method: 'client.status', params: { extra: true } }).success, false);
  assert.equal(agentManageInput.safeParse({ method: 'client.status' }).success, true);
  assert.equal(agentRelayInput.safeParse({ method: 'relay.revealCredential' }).success, false);
  assert.equal(agentRelayInput.safeParse({ method: 'relay.configure', params: { enabled: false } }).success, false);
  assert.equal(agentRelayInput.safeParse({ method: 'relay.configure', params: { enabled: false, expectedRevision: 'a'.repeat(64) } }).success, true);
  assert.equal(agentRelayInput.safeParse({ method: 'relay.reverse.configure', params: { enabled: true } }).success, false);
});

test('trusted local and dedicated transport methods cannot leak through generic API management', () => {
  for (const [method, reason] of Object.entries(agentApiExcludedMethods)) {
    assert.ok(reason.length > 20, `${method} must have an explicit exposure decision`);
    assert.ok(agentMethods.includes(method as typeof agentMethods[number]));
    assert.equal(agentMethodOutputs[method], undefined);
    for (const schema of [agentManageInput, agentRelayInput]) {
      assert.equal(schema.safeParse({ method }).success, false, method);
      assert.equal(schema.safeParse({ method, params: {} }).success, false, method);
    }
  }
});
