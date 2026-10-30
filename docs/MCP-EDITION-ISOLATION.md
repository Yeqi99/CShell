# MCP edition isolation

CShell defaults to loopback port 3777; CShell Pro defaults to 3778. Existing configured ports, grants and encrypted tokens are preserved, including legacy port 3777: old files do not record whether that value was customized. Use the edition-default button and save when a legacy configuration conflicts.

A bind conflict leaves the service stopped and publishes no endpoint. The settings page displays the currently bound endpoint, not an unsaved draft. External MCP clients must use that address and the token from the same edition; no token is shared or rotated by this change.

API responses identify the edition and a hashed data-directory scope without exposing paths or secrets. CLI and the built-in command console send an expected-edition header; the server rejects mismatch before execution. CLI verifies an authenticated, read-only capability response before invoking a command. Older services with no edition marker are refused by the new CLI. A custom port remains available via --endpoint or CSHELL_API_URL. These markers prevent accidental cross-edition routing; they are not a replacement for authentication.

The Pro userData path is set before the single-instance lock. Account workspaces remain beneath the Pro root. Ordinary cloud sync and source import use Store.cloudExport's explicit allowlist, excluding MCP service settings and tokens. Intentional access to the same separately authenticated CAgent is not configuration sharing.

Regression: temporary real HTTP services verify port contention, no advertised endpoint on failure, wrong-edition rejection and non-secret capability identity. Existing custom port and token survive save/reload. No installed app, live profile or permission is modified by these tests.
