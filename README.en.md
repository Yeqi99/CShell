<p align="center"><img src="assets/icon-512.png" width="88" alt="CShell" /></p>

# CShell

**One workspace for your computers and servers.**

[简体中文](README.md) · English · [日本語](README.ja.md)

CShell brings terminals, files, remote desktops and AI conversations into a workspace for each machine. Connect to one server for everyday work, or arrange several machines in a saved view and pick up where you left off.

[Download](https://github.com/Yeqi99/CShell/releases) · [Platform capabilities](docs/PLATFORMS.md) · [Report an issue](https://github.com/Yeqi99/CShell/issues) · [MIT License](LICENSE)

## CShell or CAgent?

| Product | Where it runs | What it does |
| --- | --- | --- |
| **CShell** | The computer or phone you work from | Connects to machines, opens terminals and files, displays remote desktops and provides AI assistance |
| **CAgent** | The machine you want to manage | Provides authenticated access to that machine's terminals, files and available capabilities; can also run an agent independently |

**You do not need CAgent for SSH.** Install it on a target when you need its machine workspace or supported remote desktop capabilities. Standalone CAgent does not require CShell, Electron or a bundled browser. On Android, supported host capabilities are provided by the CAgent extension inside CShell.

Basic connections do not require a CShell account. AI uses the model service you configure; inference location and charges depend on that service.

## What you can do

- **Machine desktops:** open installed apps from a machine workspace, with windows and a taskbar on desktop and touch-friendly app pages on Android. Use right-click or long-press for app management.
- **Machine browser:** render pages locally while using the selected machine's network. Tabs, history, bookmarks and sign-in data are isolated by machine; a disconnect never falls back to the local network.
- **Development apps:** install Codex, Claude Code and the Code Editor from the machine's app market, then open them directly. Projects and commands run on the target. Official sign-in and custom model providers depend on the selected client and service.
- **Connections and terminals:** group, favorite and search SSH, RDP, CAgent and file connections. Desktop SSH opens the native terminal by default; RDP opens remote desktop. Choose a visual workspace per connection from its context menu; Pro syncs this preference. Switching views preserves sessions.
- **Files:** desktop supports standalone FTP, explicit-TLS FTPS and SFTP connections. SFTP opens no shell. SSH / SFTP text editing preserves drafts on conflicts or disconnects; FTP / FTPS supports ordinary file transfers and empty-directory operations, not text editing or recursive transfers.
- **Remote desktops:** view and control supported CAgent desktops, adjust quality and transfer files. Client and host support are separate capabilities.
- **Saved views:** arrange terminals, remote desktops and AI conversations in tiled, focus or preview layouts. Desktop views support multiple monitors, individual pane closing and layout restoration.
- **AI assistance:** run commands, work with files and use tools within an explicit machine scope. Inspect execution records, review actions, stop tasks or trigger work through event rules.
- **Command workspace:** switch between overview, command and visual modes on desktop. The built-in console, external CLI, MCP and AI use the same authorized capability catalog; the console is not CMD or PowerShell. See the [CLI guide](docs/CLI.md).
- **Extensions:** add Python completion, Docker, HTTP, OpenCode model access or Tavily search. The application catalog installs and configures capabilities on the selected machine.

Model credentials, machine permissions and appearance settings are separate. Conversations and authorized tool results may be sent to your selected model provider.

## Get started

1. Download the package for your system and architecture from [Releases](https://github.com/Yeqi99/CShell/releases).
2. Create an SSH connection, or install CAgent on the target, configure its address, port and password, then connect from CShell and verify its identity.
3. On desktop, double-click SSH to open its native terminal. Use the connection menu to open or remember a visual workspace. CAgent opens its machine desktop; standalone FTP / FTPS / SFTP opens Files. Android files can switch between phone directories and remote files.
4. Create a desktop view to work with several machines. Configure a model provider and access scope before using AI.

## Platforms

| Platform | CShell | CAgent |
| --- | --- | --- |
| Windows x64 | Desktop workspace; `.exe` installer | Native standalone window; terminals, files and Windows desktop capabilities |
| macOS Apple Silicon / Intel | Desktop workspace; `.dmg` / `.zip` | Standalone runtime and browser UI; terminals, files and management |
| Linux x64 / ARM64 | Desktop workspace; `.AppImage` / `.deb` | Standalone runtime and browser UI; terminals, files and management |
| Android | `.apk`; SSH, files, CAgent connections and remote control | Built-in extension; system-authorized screen sharing and limited input |

**Platforms do not have identical feature sets.** Standalone FTP / FTPS / SFTP, the three workbench modes, external CLI and official OpenCode runtime are desktop features. Android retains SSH / CAgent file access; Pro sync preserves desktop connection fields that mobile does not consume. Android does not offer the full desktop multi-window workspace. macOS / Linux CAgent does not yet provide native desktop hosting equivalent to Windows. Android screen sharing while locked, Windows lock-screen access and headless desktops have system and hardware limitations. See the [capability matrix](docs/PLATFORMS.md) and [Android host guide](docs/ANDROID-CAGENT.md).

Only packages present in a release are published. Check its notes and `SHA256SUMS.txt`; signing, notarization and device validation status are documented per release.

## Application availability

Dedicated install directories keep CAgent and development-app runtimes separate from system Node/Python, package sources and global PATH. Traditional system packages show their own installation plans.

The Code Editor uses code-server standalone packages for Linux/macOS x64 and ARM64; native Windows installation is not offered. Connect to an actual WSL environment when needed. This is not Microsoft's official VS Code client. Android controls remote development apps rather than installing their CLI on the phone.

Android browsing requires compatible System WebView proxy and isolated-profile capabilities. Web downloads are not integrated yet; use the Files app for transfers. Mobile WebRTC and Service Worker networking are restricted. Account providers decide whether embedded sign-in is accepted. iOS has no published client, and arbitrary Linux graphical apps are not guaranteed to work.

## Documentation

- [Connections](docs/CONNECTION-PROVIDERS.md) · [File protocols](docs/FTP-FTPS.md) · [CAgent](docs/CAGENT.md)
- [Views](docs/MONITOR-VIEWS.md) · [Text editing](docs/TEXT-EDITOR.md)
- [AI](docs/AI.md) · [Events](docs/AI-EVENTS.md) · [OpenCode](docs/OPENCODE.md) · [Tavily](docs/TAVILY-EXTENSION.md)
- [Plugins](docs/PLUGINS.md) · [HTTP API](docs/API.md) · [MCP](docs/MCP.md) · [Command console and CLI](docs/CLI.md)
- [Android build](android/README.md) · [Dependencies](docs/DEPENDENCIES.md)

Detailed technical documentation is currently primarily in Chinese. This overview is available in Chinese, English and Japanese.

## Development and maintenance

Use Node.js 24 and the pnpm version specified in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
pnpm test
```

Build desktop installers with `pnpm run dist`, or standalone CAgent with `node scripts/agent-build.mjs`. Native components require the matching operating system and architecture. Android also requires a JDK, Gradle and the Android SDK.

After the current 0.8 machine-desktop and development-app closeout, the open-source edition will focus on bug fixes, compatibility, stability and documentation. New product features will primarily be developed for CShell Pro; its capabilities and availability will be announced when released. Existing open-source code remains under the MIT license.

[Issues](https://github.com/Yeqi99/CShell/issues) and pull requests are welcome. Include versions, client and host systems, reproduction steps and logs with credentials removed. Bundled third-party components retain their own licenses; see [notices](THIRD_PARTY_NOTICES.txt).
