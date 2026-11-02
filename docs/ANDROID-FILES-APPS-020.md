# Android managed files and launcher applications (0.8.20)

The authenticated Android machine workspace implements `files.roots/list/read/action/uploadStart/uploadChunk/uploadFinish/uploadCancel`, using the same contracts as the desktop Files window. Root IDs are UUIDs. Paths are relative to the selected root and begin with `/`.

Available roots are the dedicated CAgent exchange directory and, only when Android still grants access, the SAF directory previously chosen in the phone's local Files page. Choosing a different SAF tree changes its root identity. This does not expose app settings, account tokens, other applications' private data, or unrestricted storage. Android may deny protected directories and read-only grants remain read-only.

Uploads use owner-bound IDs, 64 KiB chunks, four concurrent transfers and a 512 MiB per-file limit. Completion refuses an existing destination. Cancellation, expiry and host shutdown remove temporary uploads. File downloads return a version binding and reject changes between chunks. Rename stays within its parent; root deletion is refused. Directory responses have a transport budget and report an error instead of emitting a truncated or oversized successful result. Filesystem I/O does not hold the desktop/input state monitor.

`applications.list` returns real visible launcher apps as `{id,name}[]`; package visibility is limited to launcher intents. `packages.invoke` with `{packageId:'cagent.android',toolId:'android_app_launch',args:{packageName:id}}` rechecks the installed launcher before requesting launch. It returns `submitted`, not a guarantee of foreground display: Android lock-screen and background-start rules still apply. No package installation or system privilege bypass is performed.

The package catalog exposes these file operations and application list/launch with full input/output schemas and side-effect declarations for CShell's existing guarded capability wrapper. Authentication, connection scope and tool review remain in force.

Tests include file upload/download/rename/delete, no overwrite, traversal rejection, cross-owner upload denial, unknown launcher rejection, and a real loopback TLS file roundtrip in the Android host instrumentation suite. Local production and instrumentation Java compilation passed; emulator execution is tracked by CI, and no physical-device success is inferred from compilation.
