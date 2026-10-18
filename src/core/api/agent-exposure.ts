import type { AgentCall } from '../../shared/agent';

/**
 * Agent RPC is also used by trusted local settings and the desktop main process.
 * Membership in agentMethods therefore does NOT grant API/MCP discoverability.
 * Every method outside the public schemas must have an explicit reason here;
 * the catalog coverage test rejects newly added, unclassified RPC methods.
 */
export const agentApiExcludedMethods = {
  'files.roots': 'Machine file operations use the dedicated authenticated file interface, not generic API management.',
  'files.list': 'Machine file operations require a dedicated file capability and target authorization contract.',
  'files.read': 'File contents must not be exposed through a generic agent.manage capability.',
  'files.action': 'File mutations require dedicated file permissions and review, not generic management.',
  'files.uploadStart': 'Upload sessions belong to the dedicated authenticated machine file transport.',
  'files.uploadChunk': 'Upload chunks require ownership checks on the dedicated file transport.',
  'files.uploadFinish': 'Upload completion belongs to the dedicated file transport ownership domain.',
  'files.uploadCancel': 'Upload cancellation belongs to the dedicated file transport ownership domain.',
  'connection.autostart': 'Autostart is controlled through authenticated administration UI only.',
  'connection.settings': 'Credentials belong to authenticated administration UI only.',
  'connection.save': 'Connection configuration is not an autonomous tool.',
  'assistant.settings': 'Model configuration belongs to administration UI.',
  'assistant.configure': 'Model configuration belongs to administration UI.',
  'client.access': 'Local permission and credential configuration is not an API management tool.',
  'client.reconfigure': 'Local listener and credential migration is not exported.',
  'relay.revealCredential': 'Secret material must remain in the trusted configuration UI.',
  'relay.rotateCredential': 'Credential rotation is a separate local configuration action.',
  'relay.registrationCredential': 'Relay registration secrets are not disclosed to API callers.',
  'relay.rotateRegistrationCredential': 'Registration secret rotation is local configuration.',
  'applications.policy': 'Runtime allows only the target local owner to read installation grants.',
  'applications.configure': 'Runtime allows only the target local owner to change installation grants.',
  'packages.install': 'Capability installation is restricted to the target local owner.',
  'packages.grant': 'Capability authorization is restricted to the target local owner.',
  'packages.uninstall': 'Capability removal is restricted to the target local owner.',
  'packages.refresh': 'Capability re-registration is restricted to the target local owner.',
  'packages.catalog': 'Package metadata needs a dedicated permission-filtered API catalog before exposure.',
  'packages.list': 'Installed package metadata needs a dedicated permission-filtered API catalog before exposure.',
  'packages.tools': 'Dynamic tool schemas must enter the permission-filtered capability registry, not an opaque management wrapper.',
  'packages.invoke': 'Dynamic invocation requires its concrete tool schema and operation authorization; agent.manage alone must not expose it.',
  'assistant.start': 'Delegated execution needs a dedicated API capability and task ownership contract, not generic management authorization.',
  'assistant.tasks': 'Delegated task discovery remains on the authenticated Agent delegation interface until its dedicated API contract exists.',
  'assistant.task': 'Delegated task content remains on the authenticated Agent delegation interface with owner validation.',
  'assistant.cancel': 'Delegated cancellation remains on the authenticated Agent delegation interface with owner validation.',
  'desktop.configure': 'Desktop grants and listener configuration are local-owner-only.',
  'desktop.open': 'Connection tickets and session keys are main-process-only; use the dedicated authenticated desktop transport.',
  'desktop.status': 'Desktop status belongs to the dedicated viewing/control permission boundary, not generic API management.',
  'desktop.close': 'Desktop sessions are owned and closed by the dedicated desktop transport.',
} as const satisfies Partial<Record<AgentCall['method'], string>>;
