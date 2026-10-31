# Update download emergency edge acceptance

The Worker was deployed with exactly four bindings: the opensource and pro `releases.json` endpoints and each edition’s `v0.8.16/*` assets. Other website/download paths and origin DNS are unchanged. Deployed code ETag: `9edc6cb5bc04f3db3ed584f563badebf96783e8bb3dc0ef2f79caae209022546`.

## Scope and verification

The allowlist contains 30 published assets (16 Core, 14 Pro including both checksum files), using the current public GitHub release digest and size. Both complete SHA256SUMS responses were downloaded through the same handler, hashed, and every package checksum was compared with GitHub’s asset digest. Full installer acceptance is recorded separately in production-acceptance.json; local binaries remain under .local and are not committed.

The deployed endpoints returned catalogs 200 and installer byte ranges 206 from the local machine and the independent US check performed by the deployment task. The older CAgent-compatible path streams a direct 200 for full GET and never asks clients to follow a 302. HEAD is pinned metadata only; it is not evidence of upstream availability.

## Complete Windows payloads

| Package | Bytes | SHA256 | Result |
|---|---:|---|---|
| CShell Core 0.8.16 | 123619494 | 9a678431213c642f571ce9cf627d53621e6f40b2c8ff950e2d4651a72b673c93 | Full public-domain GET 200, redirects disabled, exact size and digest |
| CShell Pro 0.8.16 | 123874979 | 8519ad2eed69e8d179e3cdded0330d782876caf1fcf2c45b1deb7dabb7693d39 | Full public-domain GET 200, redirects disabled, exact size and digest |
| CAgent Pro 0.8.16 | 25568112 | 84cca14038fb7f3108ea41e0149c83917822525cddb389ee34bce8ede7e66a43 | Deployment task full GET verified; independent local size and digest rechecked |

## Existing updater compatibility

The isolation check loads actual selector function text from the released Pro source revision cc9e9b7, preserving the logic and recording source hashes. It checks Core and Pro Windows selection against their public catalogs, rejects opposite-edition CShell selection, and verifies CAgent selection remains in the supplied catalog’s edition. This is a read-only selector exercise; it does not launch an installer or alter user configuration.

The old CAgent selector trusts its configured catalog channel and does not independently reject an opposite-channel catalog maliciously supplied to the function. The deployed allowlists keep those catalogs separate; the test does not claim the old selector has a stronger restriction than its source implements.

## Limits and operations

Six local Worker tests cover allowlists, unsupported requests, metadata-only HEAD, private redirects, credential stripping, hostile origins, content length and single Range handling. Installers continue to require client-side checksum validation. No applications were installed or restarted for this acceptance. The route pins updates to 0.8.16: before the next release, regenerate and deploy the correct manifest or remove these four fallback routes. Historical downloads, new versions and installation scripts are outside these bindings.
