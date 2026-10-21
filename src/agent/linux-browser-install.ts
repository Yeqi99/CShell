// Installed only by an explicit, target-bound applications plan. Google apt
// metadata and packages are authenticated by its dedicated signed-by keyring.
export const linuxBrowserInstall = `set -eu
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 https://dl.google.com/linux/linux_signing_key.pub -o "$tmp/google.pub"
gpg --batch --dearmor --output "$tmp/google.gpg" "$tmp/google.pub"
install -m 644 "$tmp/google.gpg" /usr/share/keyrings/cagent-google.gpg
printf '%s\\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/cagent-google.gpg] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/cagent-google.list
apt-get update
apt-get install -y google-chrome-stable fonts-noto-cjk xvfb xauth x11-utils xdotool xclip openbox wmctrl ffmpeg
if ! getent passwd cagent-browser >/dev/null; then useradd --system --create-home --home-dir /var/lib/cagent-browser --shell /usr/sbin/nologin cagent-browser; fi
/usr/bin/google-chrome-stable --version
`;
