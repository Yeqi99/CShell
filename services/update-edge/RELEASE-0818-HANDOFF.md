# 0.8.18 edge deployment handoff

Generated 2026-11-02 after both product releases became public (Core 430971150, Pro 430971685). Public release inventories, source commits, sizes, digests, and full checksum lists passed generation validation.

- Bundle: `deployment.json`; code SHA256 `6fadcbdd3a265384908d9e59110ad10a29ab439b8d7b188301bf93ee7c03fbe9` (38,746 bytes).
- Manifest: 90 assets; all 60 historical 0.8.16/0.8.17 entries are unchanged.
- Routes: preserve six existing bindings; add only `shell.canp.ai/downloads/opensource/v0.8.18/*` and `shell.canp.ai/downloads/pro/v0.8.18/*`.
- Worker/generator tests: 10 passed.

## Deployment still pending

At 2026-11-02 01:28:23 UTC, both exact public catalog URLs still returned only 0.8.17. `verify-deployed.mjs` failed catalog equality, correctly. The Hong Kong origin catalogs have been updated separately; query-string URLs returning 0.8.18 do not verify the exact URL requested by existing updaters.

Cloudflare browser editing is blocked by an iframe input automation error. The parent task requested the user to paste the exact prepared code and deploy through the already authenticated editor. This document does not claim that the Worker was deployed or that 0.8.18 automatic update acceptance passed.

After deployment, run `verify-deployed.mjs`, all 28 new binary range checks, and the actual AgentUpdater full download/verify check. Do not install local applications as part of this test. Private prepared scripts and standalone worker/catalog files are under `.local/edge-0818/`.
