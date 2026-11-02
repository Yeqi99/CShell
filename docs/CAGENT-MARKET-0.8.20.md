# CAgent market layout — 0.8.20 candidate

Implemented only in the isolated 0.8.20 worktree; not part of 0.8.19 assets.

- Native market uses available-width card sizing (single-column at narrow widths, more columns when space permits), with 36 px capability icons and aligned name/status labels.
- Web market uses the same compact icon/name/status hierarchy, separates capability packages from system installation plans, and spans pending restore across the grid.
- Card state reflects verified capability status rather than merely `installed`. Opening a card does not grant permissions or install a package.
- Search, keyboard-labelled cards, current conversation draft, installation settings, and existing package detail actions remain available.

Validation:
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec tsx scripts/cagent-market-layout-smoke.ts`: passed at 320/380/600/1000 px, no horizontal overflow or page/API error, 1→multiple responsive columns, no implicit install/grant, filtering and conversation draft retained.
- Native C# compilation and `--fixture <image> market`: passed actual WPF rendering at 340/540/900 px, no tile overflow, draft/permission assertions retained. No runtime/real software installation used in this fixture.
- Screenshots: `test-results/market-020/web-{320,380,600,1000}.png`, `native.png-{340,540,900}.png`.
- Existing broader `cagent-app-smoke.ts` currently stops before reaching the market while waiting for the legacy command-approval heading. This is not counted as passed; only its market selectors were updated for the new accessible names.
