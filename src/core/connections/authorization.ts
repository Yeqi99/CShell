import type { AiPolicy } from '../../shared/ai';
import type { ApiClient, McpSettings } from '../../shared/contracts';

/** Review is independent of grants. Call only after target and operation authorization.
 * Legacy AI/API spellings retain their meaning; missing policies require review. */
export function requiresReview(
  mode: 'review' | 'restricted' | 'allow' | 'always' | 'mutations' | 'authorized' | undefined,
  operationNeedsReview: boolean,
): boolean {
  switch (mode) {
    case 'allow':
    case 'authorized':
      return false;
    case 'restricted':
    case 'mutations':
      return operationNeedsReview;
    default:
      return true;
  }
}

export interface CallerPolicy {
  readonly enabled: boolean;
  readonly application: readonly string[];
  readonly scope: {
    readonly allMachines: boolean;
    readonly profiles: readonly string[];
    readonly groups: readonly string[];
    readonly localEnvironments: readonly string[];
  };
  readonly capabilities: readonly string[];
  readonly override: (targetId: string) => readonly string[] | undefined;
}
export interface PolicyTarget {
  readonly id: string;
  readonly group?: string;
  readonly localEnvironment?: string;
}

/** Ephemeral read-only views for one synchronous decision, never approval caches.
 * Read current configuration again after awaits; no caller inherits another caller's policy. */
export function aiCallerPolicy(policy: AiPolicy): CallerPolicy {
  return {
    enabled: true,
    application: policy.application,
    scope: {
      allMachines: policy.allMachines,
      profiles: policy.profiles,
      groups: policy.groups,
      localEnvironments: [],
    },
    capabilities: policy.capabilities,
    // Preserve first matching override, including an empty one.
    override: (id) => policy.overrides.find((item) => item.profileId === id)?.capabilities,
  };
}
export function apiCallerPolicy(
  policy: McpSettings | ApiClient,
  serviceEnabled: boolean,
): CallerPolicy {
  const capabilities = (value: { capabilities?: readonly string[]; allowCommands: boolean }) =>
    value.allowCommands
      ? [...(value.capabilities ?? []), 'commands.execute']
      : (value.capabilities ?? []);
  return {
    enabled: serviceEnabled && policy.enabled,
    application: policy.applicationCapabilities ?? [],
    scope: {
      allMachines: false,
      profiles: policy.allowedProfiles,
      groups: [],
      localEnvironments: policy.allowedLocalShells ?? [],
    },
    capabilities: capabilities(policy),
    override: (id) => {
      const value = policy.targetPolicies?.[id];
      return value ? capabilities(value) : undefined;
    },
  };
}
export function allowsApplication(policy: CallerPolicy, capability: string) {
  return policy.enabled && policy.application.includes(capability);
}
export function allowsTarget(policy: CallerPolicy, target: PolicyTarget) {
  if (!policy.enabled) return false;
  if (target.localEnvironment !== undefined)
    return policy.scope.localEnvironments.includes(target.localEnvironment);
  return (
    policy.scope.allMachines ||
    policy.scope.profiles.includes(target.id) ||
    (target.group !== undefined && policy.scope.groups.includes(target.group))
  );
}
export function allowsCapability(policy: CallerPolicy, target: PolicyTarget, capability: string) {
  return (
    allowsTarget(policy, target) &&
    (policy.override(target.id) ?? policy.capabilities).includes(capability)
  );
}
/** For catalog visibility only. A concrete execution must call allowsCapability with its target. */
export function advertisesCapability(policy: CallerPolicy, capability: string) {
  return (
    policy.enabled &&
    (policy.capabilities.includes(capability) ||
      policy.scope.profiles.some((id) => policy.override(id)?.includes(capability)))
  );
}
