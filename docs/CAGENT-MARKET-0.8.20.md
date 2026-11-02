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
- Full `cagent-app-smoke.ts`: passed after updating stale test selectors (approval now says “允许这次操作？” and capability grants are in the “工具能力授权” disclosure). The fixture now implements read-only account status/appearance calls used by the current page. The real assistant engine reaches approval with zero commands executed; explicit approval executes exactly one command. Install does not grant tools, checkbox edits do not grant until saved, disable/uninstall confirmation and application plan remain covered. No product permission policy was changed to satisfy this test.

Header refinement: search and accessible refresh icon share one toolbar on native/web; native blank feedback space is removed only on the market page. Refresh rereads the actual catalog/policy and preserves the native search query. Browser smoke also verifies refresh requests the catalog.
