# 0.8.20 common-source synchronization

Core branch: `codex/core-020-model-market`, isolated from the released 0.8.19 tree, based on `4761ea6`. No version bump, release, installer update or user-profile migration was performed.

## Applied scope

- Responsive CAgent market cards and compact search/refresh toolbar: Pro `086520b` and `8250b47`, narrowly merged into the Core web/native pages. Core retains its own navigation and has no account-login entry. The pre-existing native read-replay method allowlist is unchanged.
- Full market/application approval fixture: `51183ec`.
- Device-local network restore policy and tests: common files from `c97d7c6`; Pro's `desktop/cloud-sync.ts` transaction integration is deliberately not imported into Core, which does not provide that account service.
- Terra event protocol regression tests: `126d39b`. The existing shared `core/ai-protocol.ts` implementation already sends Responses-compatible parameters and needed no production change.

The common network module, protocol implementation, two protocol/network test files, and two market/application browser fixtures match the Pro 0.8.20 branch (ignoring line endings). Market rendering changes retain the existing edition-specific account features rather than copying whole Pro pages.

## Verification in this Core tree

- TypeScript check passed.
- Six network and Terra protocol tests passed, including explicit local direct choice retained, fresh system default, transaction rollback, official Responses conversion, and no fallback to another model.
- Real browser market fixture passed at 320/380/600/1000 px; refresh, filtering, draft preservation, and no implicit installation/authorization passed.
- Complete standalone application fixture passed: real assistant approval, exactly one command after approval, package authorization, installation planning and CSP.
- Core CAgent native window compiled successfully against Windows WPF. This port did not rerun a native-window visual fixture; the corresponding Pro fixture evidence remains documented separately.

## Installed-app boundary

The actual installed Pro remains 0.8.18. Its normal UI system-proxy save was observed in a later normal cloud sync: local and remote revision 114 both recorded `system`, with no pending local sync. The 0.8.20 restore-priority fix is still required to prevent another older client from later restoring a different device's local exit. No additional paid model request was made during that persistence check.
