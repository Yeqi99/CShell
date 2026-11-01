# Verified update download edge

The deployed Worker pins published 0.8.17 catalogs and preserves all 0.8.16 assets. Deployment `d36adb3fc6a244ed9a586967b0bc4aaa` has six exact routes: two edition catalogs and the two edition-specific asset subtrees for each version. Other site routes and origin DNS are unchanged.

`node generate.mjs --released` checks public release state, exact asset sets, fixed source SHAs and the adjacent verified edition manifests before generating the deployment bundle. It preserves previous-manifest.json assets; absent digests, wrong channels and changed files fail closed. No token is needed. Regeneration does not deploy.

Run `node --test worker.test.mjs generate.test.mjs` for allowlist, authentication-header stripping, redirects, range checks, channel preservation and rejection tests. `node verify-deployed.mjs` validates actual public catalogs, complete checksum files and installer byte ranges without client redirects. Production results are in production-acceptance.json; all-0817-public-ranges.json covers all 28 new binary assets with 206 / 1024-byte range / total length / pinned SHA headers. Range acceptance is not a complete binary digest check.

agent-updater-0817-acceptance.json separately records the real AgentUpdater checking 0.8.16 → 0.8.17 and downloading/verifying the entire 25,587,138-byte CAgent Windows installer, without installing from that test. Full Hong Kong files and GitHub digests were verified before publication. HEAD metadata alone is not upstream availability evidence.

Rollback removes only these six bindings or restores the previously verified deployment; do not broaden routing to all downloads or alter unrelated services. Future releases must explicitly refresh the pinned catalogs and verified release manifests.
