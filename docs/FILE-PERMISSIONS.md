# Remote file permissions

On an active SSH or SFTP connection, select one file or directory and use File permissions in its context menu. The panel reads the target mode, UID and GID; select owner/group/other read, write and execute bits, then save. It stays inside the file pane and reports server denials there. This changes only the selected item, never children, and preserves special mode bits.

The backend uses the original connection's SFTP channel, rejects observed symbolic links and non-file/non-directory targets, opens a read handle, rechecks mode and ownership, applies FCHMOD to that handle and reads back the result. A stale mode is rejected; a failed operation is not retried and never invokes sudo or a shell. Standard SFTP does not expose inode identity or an atomic no-follow OPEN flag, so this is not an atomic path-identity guarantee against adversarial concurrent replacement before OPEN. Once opened, mutation remains bound to the same handle.

The server must permit opening a read handle and support handle permission updates. Servers that reject directory handles, unreadable files or FCHMOD return their error; no less-safe path mutation fallback is attempted. FTP/FTPS and CAgent do not yet expose a verified equivalent, so this editor is not shown for those providers. This is OS file mode editing, not MCP capability grants or Windows ACL editing.

Validation: three backend tests cover special-bit preservation, stale snapshots, invalid modes, symlinks, server denial and handle cleanup. A real React component at 320px with a mock bridge verifies save/error feedback and overflow. Real remote validation is recorded below.

## Real SSH/SFTP verification — 2026-10-30

The new product `filePermissions` API was exercised on the saved **美国机器** connection (199.102.219.30), using its existing pinned SSH host identity and saved credentials decrypted only in memory. No application configuration, trust records or permissions were changed.

Within a newly created UUID directory `/tmp/cshell-permissions-17c82896-e118-4677-a5e2-bac32fc813ef`:

- A new sample file changed to `0640`, then `0600`; independent subsequent reads matched each requested mode.
- The test directory changed to `0750`, then `0700`; independent subsequent reads matched, confirming this server supports the required directory handle operations.
- A stale expected mode (`0644` against actual `0600`) was rejected and the file remained `0600`.
- Cleanup checked the directory's absolute realpath and removed only the newly created sample file and directory. Cleanup succeeded.

Evidence timestamp: `2026-10-30T12:36:39.218Z`. Local receipt: `.local/file-permissions-real-evidence.json`; repeatable diagnostic script: `.local/verify-file-permissions-real.ts` in the Pro worktree. This verifies the backend against one real Linux SFTP server, not every server implementation or the installed desktop UI end to end. The separate narrow-panel UI check uses a mock bridge.

