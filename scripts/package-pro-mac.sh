#!/usr/bin/env bash
set -euo pipefail

: "${CSC_LINK:?Missing Developer ID Application certificate}"
: "${CSC_KEY_PASSWORD:?Missing certificate password}"
: "${APPLE_ID:?Missing notarization Apple ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Missing notarization app-specific password}"
: "${APPLE_TEAM_ID:?Missing Apple team ID}"
arch=${1:?Missing architecture}
case "$arch" in arm64|x64) ;; *) exit 2 ;; esac
export CSC_IDENTITY_AUTO_DISCOVERY=true
pnpm exec electron-builder --config electron-builder.pro-mac.cjs --mac dmg "--$arch" --publish never

version=$(node -p "require('./package.json').version")
image="release/pro-$version/CShell-Pro-$version-mac-$arch.dmg"
xcrun notarytool submit "$image" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait --output-format json |
  node -e 'const fs = require("node:fs"); const r = JSON.parse(fs.readFileSync(0)); console.log(r.id, r.status); if (r.status !== "Accepted") process.exit(1)'
xcrun stapler staple "$image"
xcrun stapler validate "$image"
spctl --assess --type open --context context:primary-signature --verbose=2 "$image"

mount=$(mktemp -d)
trap 'rmdir "$mount"' EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image"
trap 'hdiutil detach "$mount" && rmdir "$mount"' EXIT
app="$mount/CShell Pro.app"
codesign --verify --deep --strict --verbose=2 "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"
