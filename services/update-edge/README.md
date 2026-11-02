# Verified update download edge

The deployed Worker pins public 0.8.18 catalogs and preserves all verified 0.8.16/0.8.17 assets. It has eight exact routes: two edition catalogs and both edition-specific asset subtrees for each of the three versions. Other routes and origin DNS are unchanged. Code SHA256: `6fadcbdd3a265384908d9e59110ad10a29ab439b8d7b188301bf93ee7c03fbe9`.

## Current acceptance

`deployed-acceptance.json` verifies both exact public catalogs, complete checksum bodies for all three versions/channels, and installer byte ranges without redirects. `all-0818-public-ranges.json` verifies all 28 new binary assets: HTTP 206, 1024-byte body, exact total size and pinned Worker SHA256 header. Ranges alone do not prove full binary digests.

`agent-updater-0818-acceptance.json` separately records the real AgentUpdater checking 0.8.17 → 0.8.18 and downloading/verifying all 26,230,795 bytes of the Windows CAgent installer through the final public route. No installer was launched. Full Hong Kong and GitHub artifact digests were verified before release publication. HEAD metadata alone is not download acceptance.

## Next release checklist

1. Finish builds and source verification for both editions. Keep existing tags immutable; prepare exact `verified-opensource-VERSION.json` and `verified-pro-VERSION.json` manifests (VERSION without dots).
2. Stage, fully hash, and publish both GitHub releases and the Hong Kong artifacts. Do not generate against draft or incomplete releases.
3. Back up the currently deployed `manifest.json`, then run `node generate.mjs --released --version 0.8.19 --previous manifest.json` from this directory. This example does not authorize publication before development is complete. The command verifies public state, asset sets, source SHAs, digests and complete checksum lists; it generates but does not deploy.
4. Use `deployment.json.code` exactly as `worker.mjs` in the existing `cshell-update-emergency` Worker. Preserve existing routes and add only the two new version-specific edition routes listed in the generated bundle. Do not create a replacement site or change DNS.
5. Atomically update the Hong Kong edition catalogs from `manifest.json.catalogs`, after backing up existing files. Origin/query-string success does not verify the exact bare catalog URL used by clients.
6. Run `node --test worker.test.mjs generate.test.mjs` and `node verify-deployed.mjs`. Verify every new binary range, total size, SHA header and absence of client redirects. Download a complete installer with the actual AgentUpdater and verify its digest without installing. Record routing, timestamps, limits, and results.
7. Commit bundle, manifest and receipts to the release control branch; update the website/docs only to reflect actually published and verified packages.

Rollback restores the previously verified Worker code/catalogs and removes only the newly added bindings if necessary. Never broaden routing to unrelated paths. Regeneration without deployment leaves clients pinned to the previous release.
