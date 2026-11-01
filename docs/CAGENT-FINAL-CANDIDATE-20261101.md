# Windows CAgent final candidate verification — 2026-11-01

This is a candidate build, not an installation or publication.

- Build source commit: `4403eb62b29dcbcb9c80499f5050ac8196905080`.
- SHA256 of the sorted 556 tracked build-related files (path + bytes): `936af1a29e0c325b0adf129396434c6962efff8062eec7acdf570424433cf2b4`. Identical before/after build and after acceptance. Subsequent HEAD `89d794b6961aa6ec56e1e03afa1fb957852d933d` changes only Android instrumented tests and acceptance documents.
- New independent staging directory: `.local/cagent-final-20261101-4403`.
- Standalone Windows x64 version: 0.8.18. No Electron dependency.
- Deployment archive: `.local/cagent-final-deployment-20261101-4403.zip`, 38,929,494 bytes, SHA256 `c202cfb815477b41380ef5ca5e9a7af3b5a4f3a2a8bef41ac86d77dddcc8c452`.
- All 48 payload file sizes and SHA256 hashes independently matched `deployment.json`.

Selected payload hashes:

| File | SHA256 |
| --- | --- |
| agent.cjs | f06f3b37fde844851b31d0eee12c1896c03806699b13a7c8da6bf1726a9a869f |
| Cagent.exe | 3aae6b193814a02338684d5531c4ab13601ceb163a6a9818c4e33b9540598420 |
| cagent-desktop.exe | 95d6ea50261a9a24d02db007951facc2e28f2b0457c7ae779f42741644ccc8fd |

Actual packaged verification passed after the Pro desktop suite released the desktop:

1. `agent-package-smoke.ts` with the new staging path: actual Windows CMD PTY over authenticated TLS, restricted authorization rejection and clean stop.
2. `native-cagent-capabilities-smoke.ts` with the newly built Cagent.exe: actual isolated WPF panels reached, shared model listed/selected, cloud theme applied, paused automation created/updated/deleted, explicit permissions and connection settings preserved, encrypted device identity unchanged across restart. Invalid verification paths were rejected before runtime contact.

No model request, WeChat action, real user configuration change or application upgrade occurred. Paused automation CRUD is not evidence of actual event delivery or task execution. These runs do not add new claims about physical Android, WeChat callbacks or remote Windows screen capture.

Logs: `test-results/cagent-final-build.log`, `cagent-final-package.log`, `cagent-final-tls-pty.log`, `cagent-final-native.log`; structured native evidence: `test-results/cagent-native-runtime-capabilities.json`.
