# Fresh AI defaults: final desktop rebuild scope

Status: candidate only; no release, update catalog switch or user application installation.

The production fixes are Pro `56eaf07` + `6b0375d`, narrowly ported to Core `96e04df`. They initialize permissions only for a genuinely new local configuration. Existing denials, account workspaces and missing cloud policy remain restricted; MCP stays disabled. Repeated AI service loading clears prior policy before reading the next configuration.

## Affected artifacts

Rebuild exactly 16 CShell desktop packages: Core Windows EXE, two macOS DMG + two ZIP, two Linux AppImage + two DEB (9); Pro Windows EXE, two macOS DMG, two Linux AppImage + two DEB (7). Regenerate both SHA256SUMS files after all new hashes are verified.

Retain ten standalone CAgent packages and two Android APKs. `scripts/build.mjs` embeds the Agent bundle, while standalone `scripts/agent-build.mjs` has a separate entry point. Rebuilding that entry in memory with the actual build options gave bytes identical to the latest native-reconnect stages:

- Core agent bundle SHA256: `3b2874d82803f7c2d6bd0a24642ee4c704f1c76d590a36ca443c1ff1b056c75d`
- Pro agent bundle SHA256: `34eb0d6ef2c4cf0d089fc669d448972e22ec9a2397726801fde6cbeef9163277`

The new shared AI factory is not retained by the Agent bundle; no Core AI/store or desktop initializer is imported into that runtime. Android production sources are unchanged. The newer CAgent Windows native recovery and final focused WebView Android packages therefore remain valid.

## Verification and provenance

- Windows: `windows-ai-default-final.json`, two exact installer archives, fresh defaults/preserved denial/restart, disabled MCP, platform and full desktop checks, simultaneous edition/token isolation.
- Pro POSIX workflow: run `41313105393`, commit `ac129ac690fee37d0f748d59d478af6b6bbd4312`, tree `dbaa3197f647aa4e47400456ae344dd2f5f72763` equals local `910243d`.
- Core POSIX workflow: run `41313107314`, commit `bb6e547e2ec765dfe203a416beb4c4aef05995c6`, tree `a3e65e974d8c0fed3eeaca68741c5928c5480ba7` equals local `d73ed54`.

The POSIX workflows are still running at this record. Their outputs must not be treated as verified until artifact digests and package file hashes are checked. The prior 16 desktop hashes are superseded; the publication gate remains closed.
