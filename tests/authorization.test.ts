import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyAiPolicy } from '../src/shared/ai';
import { mcpSettingsSchema } from '../src/shared/contracts';
import {
  aiCallerPolicy,
  apiCallerPolicy,
  allowsApplication,
  allowsTarget,
  allowsCapability,
  advertisesCapability,
  requiresReview,
} from '../src/core/connections/authorization';

test('AI and API review modes agree and never grant an operation', () => {
  for (const [ai, api, read, mutation] of [
    ['review', 'always', true, true],
    ['restricted', 'mutations', false, true],
    ['allow', 'authorized', false, false],
  ] as const) {
    assert.equal(requiresReview(ai, false), read);
    assert.equal(requiresReview(api, false), read);
    assert.equal(requiresReview(ai, true), mutation);
    assert.equal(requiresReview(api, true), mutation);
    const settings = mcpSettingsSchema.parse({ enabled: false, port: 39701, allowedProfiles: [], allowCommands: false, review: api });
    assert.equal(allowsCapability(apiCallerPolicy(settings, true), { id: randomUUID() }, 'commands.execute'), false);
  }
  assert.equal(requiresReview(undefined, false), true);
  assert.equal(requiresReview(undefined, true), true);
});

test('shared authorization keeps scope, operation overrides and application grants independent', () => {
  const granted = randomUUID(),
    outside = randomUUID();
  const settings = mcpSettingsSchema.parse({
    enabled: true,
    port: 39701,
    allowedProfiles: [granted],
    allowCommands: false,
    capabilities: ['files.read'],
    applicationCapabilities: ['plugins.read'],
    targetPolicies: {
      [granted]: { allowCommands: false, capabilities: [], review: 'authorized' },
      [outside]: { allowCommands: true, capabilities: ['files.write'], review: 'authorized' },
    },
  });
  const policy = apiCallerPolicy(settings, true);
  assert.equal(allowsTarget(policy, { id: granted }), true);
  assert.equal(allowsCapability(policy, { id: granted }, 'files.read'), false);
  assert.equal(allowsTarget(policy, { id: outside }), false);
  assert.equal(allowsCapability(policy, { id: outside }, 'commands.execute'), false);
  assert.equal(advertisesCapability(policy, 'files.write'), false);
  assert.equal(allowsApplication(policy, 'plugins.read'), true);
  assert.equal(allowsApplication(policy, 'plugins.manage'), false);
  assert.equal(
    allowsCapability(apiCallerPolicy(settings, false), { id: granted }, 'files.read'),
    false,
  );
  assert.equal(allowsApplication(apiCallerPolicy(settings, false), 'plugins.read'), false);
  assert.equal(
    allowsApplication(apiCallerPolicy({ ...settings, enabled: false }, true), 'plugins.read'),
    false,
  );
});

test('legacy API adaptation grants no new capabilities or local environment scope', () => {
  const id = randomUUID();
  const settings = mcpSettingsSchema.parse({
    enabled: true,
    port: 39701,
    allowedProfiles: [id],
    allowCommands: true,
  });
  const policy = apiCallerPolicy(settings, true);
  assert.equal(allowsCapability(policy, { id }, 'commands.execute'), true);
  assert.equal(allowsCapability(policy, { id }, 'files.read'), false);
  assert.equal(
    allowsCapability(policy, { id, localEnvironment: 'powershell' }, 'commands.execute'),
    false,
  );
  const local = apiCallerPolicy(
    { ...settings, allowedLocalShells: ['cmd'], capabilities: ['terminal.read'] },
    true,
  );
  assert.equal(
    allowsCapability(local, { id: randomUUID(), localEnvironment: 'cmd' }, 'terminal.read'),
    true,
  );
  assert.equal(
    allowsCapability(local, { id, localEnvironment: 'powershell' }, 'terminal.read'),
    false,
  );
});

test('AI adaptation preserves group membership and first empty override without mutating stored policy', () => {
  const id = randomUUID();
  const stored = {
    ...emptyAiPolicy(),
    groups: ['lab'],
    capabilities: ['files.read' as const],
    overrides: [
      { profileId: id, capabilities: [] },
      { profileId: id, capabilities: ['files.read' as const] },
    ],
  };
  const before = structuredClone(stored);
  const policy = aiCallerPolicy(stored);
  assert.equal(allowsTarget(policy, { id, group: 'lab' }), true);
  assert.equal(allowsCapability(policy, { id, group: 'lab' }, 'files.read'), false);
  assert.equal(allowsCapability(policy, { id: randomUUID(), group: 'lab' }, 'files.read'), true);
  assert.equal(allowsCapability(policy, { id: randomUUID(), group: 'other' }, 'files.read'), false);
  assert.equal(
    allowsCapability(aiCallerPolicy(emptyAiPolicy()), { id, group: 'lab' }, 'files.read'),
    false,
  );
  assert.deepEqual(stored, before);
});
