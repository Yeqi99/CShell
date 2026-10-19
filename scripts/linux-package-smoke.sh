#!/usr/bin/env bash
set -euo pipefail

# Called inside the job's private D-Bus/Xvfb session. Never touch a user's keyring.
keyring_data=$(mktemp -d)
export XDG_DATA_HOME="$keyring_data"
trap 'rm -rf -- "$keyring_data"' EXIT
export XDG_CURRENT_DESKTOP=GNOME
keyring_environment=$(printf 'cshell-ci\n' | timeout 20s gnome-keyring-daemon --unlock --components=secrets)
eval "$keyring_environment"
keyring_environment=$(timeout 20s gnome-keyring-daemon --start --components=secrets)
eval "$keyring_environment"
export GNOME_KEYRING_CONTROL

# Prove the actual Secret Service is unlocked before Electron can synchronously
# ask it for the application encryption key (a GUI unlock prompt would hang CI).
printf 'cshell-keyring-probe' | timeout 20s secret-tool store --label='CShell CI preflight' application cshell-ci
test "$(timeout 20s secret-tool lookup application cshell-ci)" = 'cshell-keyring-probe'
timeout 20s secret-tool clear application cshell-ci
echo 'Secret Service encrypted keyring read/write preflight passed'
pnpm exec tsx scripts/platform-package-smoke.ts
