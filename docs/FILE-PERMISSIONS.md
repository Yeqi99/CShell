# Remote file permissions

On an active SSH or SFTP connection, select one file or directory and use File permissions in its context menu. The panel reads the target mode, UID and GID; select owner/group/other read, write and execute bits, then save. It stays inside the file pane and reports server denials there. This changes only the selected item, never children, and preserves special mode bits.

The backend uses the original connection's SFTP channel, rejects observed symbolic links and non-file/non-directory targets, opens a read handle, rechecks mode and ownership, applies FCHMOD to that handle and reads back the result. A stale mode is rejected; a failed operation is not retried and never invokes sudo or a shell. Standard SFTP does not expose inode identity or an atomic no-follow OPEN flag, so this is not an atomic path-identity guarantee against adversarial concurrent replacement before OPEN. Once opened, mutation remains bound to the same handle.

The server must permit opening a read handle and support handle permission updates. Servers that reject directory handles, unreadable files or FCHMOD return their error; no less-safe path mutation fallback is attempted. FTP/FTPS and CAgent do not yet expose a verified equivalent, so this editor is not shown for those providers. This is OS file mode editing, not MCP capability grants or Windows ACL editing.

Validation: three backend tests cover special-bit preservation, stale snapshots, invalid modes, symlinks, server denial and handle cleanup. A real React component at 320px with a mock bridge verifies save/error feedback and overflow. Remote machine chmod is not claimed as performed.
