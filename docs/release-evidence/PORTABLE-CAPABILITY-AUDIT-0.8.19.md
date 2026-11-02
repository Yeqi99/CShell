# 0.8.19 production capability configuration audit

Reviewed actual adapter storage, not just the portable interface. Package selection, exact version and manifest digest remain portable. No current production adapter has a persisted non-sensitive cross-device preference to add to `portableConfiguration`.

| Adapter | Actual configuration | Portability decision |
|---|---|---|
| Managed WeChat (`src/agent/managed-wechat-capability.ts`) | API/listener ports, enabled state, account/contact scope and messaging/history grants | Local service identity and authorization; excluded. |
| Legacy WeChat adapter | Process selection, local enablement and contact/operation authorization | Device binding and grants; excluded. |
| Desktop (`src/agent/desktop-capability.ts`, `src/shared/agent-desktop.ts`) | Listener address/ports, local and controller view/control grants | Excluded. Quality/display parameters are session requests, not saved user preferences. |
| System applications (`src/agent/applications.ts`) | Installation enabled state and authorized controllers | Grants; excluded. |
| Process capability adapter | Host-pinned executable, environment/resources and runtime grants | Package/runtime trust data; excluded. |

Do not invent configuration fields or migrate ports, file paths, process IDs, contacts, secrets or grants to make this interface appear populated. Future non-sensitive preferences require an adapter-owned exact export/validate/import allowlist and a real persisted consumer.

Fixed `CapabilityRuntime.cloudImport` to validate optional portable configuration **before** package installation/registration. Unsupported configuration now stays pending without installing the package. Invalid allowlisted settings cannot run adapter inspect/register or mutate existing settings. Valid package-only recovery still verifies package files and restores no grants.

Validation: `pnpm exec tsx --test tests/agent-capability-runtime.test.ts` (8 cases), including production system-apps rejection before installation and an allowlisted adapter rejecting injected permission fields before side effects.
