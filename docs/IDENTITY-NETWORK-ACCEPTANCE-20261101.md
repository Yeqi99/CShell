# Typed identity network acceptance — 2026-11-01

The saved rule editor now accepts stable local, SSH and CAgent identities as both source and exit. It rejects duplicate sources and directed cycles. Rules and offline revocation receipts are encrypted locally; only portable source/exit choices enter account sync, never transport/session IDs. These are application HTTP proxy routes, not a TUN/VPN or retroactive changes to every running process.

CAgent sources expose a controller-authenticated loopback listener over bounded RPC streams. Source models, HTTP/browser requests and newly created terminals consume the selected route. SSH sources use a dedicated authenticated, host-pinned reverse loopback listener; newly opened CShell SSH terminals inherit its proxy environment. Neither implementation injects commands into an existing interactive terminal or opens a LAN listener. Failure leaves a configured CAgent source fail-closed.

Revocation is durable: removing an offline source records its stable binding ID and retries only that idempotent revoke when the source returns. The source persists controller ownership and binding. Old cleanup cannot clear a newer binding. Cloud restore does not connect until all account connections and credentials have been applied; unchanged rules preserve live transports. Removing the local rule restores system routing only if the current route still belongs to that rule, preserving a separately selected manual route.

Validation:

- TypeScript compilation passed.
- 19 tests passed across identity-network, network-proxy-review and machine-network-route: real pinned TLS with revocation; real SSH reverse forwarding to local and another SSH exit; half-closed requests with delayed responses; channel tail preservation; concurrent owners; disposal while persistence is pending; cycle rejection; offline removal/restart/reconnect; stale cleanup rejection; local cloud clearing; unchanged sync retaining the same live listener.
- Two real saved SSH machines (Hong Kong and United States) each fetched a unique response from an isolated HTTP server on this computer through their own remote loopback proxy and encrypted SSH connection. No saved application configuration, existing terminal, remote environment, listener or permission was changed. Temporary listeners and the isolated local rule directory were cleaned after the run.
- CAgent typed reverse transport was exercised with a real isolated TLS server; the two physical-machine runs above were SSH sources. This is not a claim that every OS, externally installed application, or full-system network stack has been tested.

The generic `identity_network_list` and `identity_network_configure` application tools are exposed to the assistant, MCP and the existing CLI tool dispatcher. Source and target machine authorization is evaluated by the backend, including configured downstream identities; configuring requires review and cannot gain access by rendering the settings UI.
