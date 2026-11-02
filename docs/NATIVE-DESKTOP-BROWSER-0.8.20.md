# 0.8.20 native desktop discovery and browser investigation

## Implemented

The SSH workspace no longer adds a native-desktop app unconditionally. Positive evidence (a running compatible desktop, installed desktop startup command/session definition, or managed desktop sharing) is required. Installed-but-not-sharing desktops remain discoverable; missing or failed/permission-limited detection is not advertised as an available desktop. The explicit connection-menu action is named “检测服务器桌面” and can open a diagnostic view without claiming a usable desktop.

Detection remains read-only. It does not start a desktop, install a package, change a firewall or select another user's graphical session. Existing VNC connection and explicit sharing setup remain unchanged.

Validation: TypeScript passed; four native-desktop availability/endpoint/SSH-stream tests passed; the fixed remote Python program compiles. Real American target checked through the installed CShell MCP independently reports running Xtigervnc, xfce4-session and xfce4-panel, with startxfce4/tigervncserver installed and xfce.desktop present. Thus this target must retain its desktop option. Executing the full fixed inspect program through generic MCP command returned a generic execution failure; its exact runtime result has not been counted as verified.

## Browser evidence and remaining investigation

On 2026-11-02, the installed Pro's authenticated MCP opened a separate SSH test connection to the saved American target. Remote curl returned HTTP 200 and its actual MachineBrowser opened and read an HTTPS page successfully. The test tab and this test connection were subsequently closed, preserving the user's existing sessions.

An existing OAuth login tab was observed loading; its URL parameters and login state are not recorded here or modified. This does not establish why the user's specific URL fails. The user subsequently confirmed the browser works again; this is recorded as an intermittent incident without an established root cause. No further URL request is pending. Source inspection confirms that the machine browser uses its own per-machine Electron partition and a fixed SSH SOCKS proxy, separate from the local model's system-proxy setting; disconnection closes the proxy rather than falling back to the local network. Navigation currently relies on Electron's load/error completion with no application-level deadline; a stuck loading state remains an investigation item, not a proven network root cause.

## Authorized existing-device repair

The separately saved Windows CAgent target was read through its authenticated account relay. Its current assistant configuration was `commands=false`, `review=true`, `automation=false`, `delegates=[]`, matching the previous account-workspace defaults; current values alone cannot prove whether they were defaults or deliberate historical choices.

After explicit authorization to enable these assistant capabilities, the supported `assistant.configure` method received only the existing non-secret settings plus `commands=true`, `review=false`, `automation=true`, `delegates=['*']`. No key was submitted. A successful acknowledgement and subsequent `assistant.settings` read confirmed all four values; model, endpoint, provider ID and key-configured state remained unchanged. Pairing, device permissions and workspace data were not reset. An initial relay timeout was followed by a separate read confirming the old values before retrying this explicit configuration action. This is an existing-device settings repair, distinct from the new-account default-code fix.
