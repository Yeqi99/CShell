# Member domains backend integration

Member claims and renames reject platform-reserved labels (case-insensitive), including administration names such as `admin`, `console`, and `dashboard`. `mc.canp.site` is reserved for the operator outside member claims. These restrictions do not apply to labels inside a member's own namespace.

`Domains(service, Failure, adapter=None, clock=time.time)` uses the existing account database and `profile(account).membership.active`. Initialize once, after the service database is ready. Never pass a user-supplied account ID: all routes must use the authenticated account and the existing write/CSRF/rate-limit gate.

| Method / route | Call |
|---|---|
| GET `/v1/domains` | `domains.list(account)` |
| POST `/v1/domains/claim` | `domains.claim(account, body)` |
| POST `/v1/domains/rename` | `domains.claim(account, body)` |
| POST `/v1/domains/records` | `domains.write(account, body)` |
| POST `/v1/domains/records/update` | `domains.write(account, body)` |
| POST `/v1/domains/records/delete` | `domains.delete(account, body)` |

Claim/rename body: `{prefix, requestId}`. Prefix normalizes ASCII case/outer whitespace; 3–32 characters, starts with a letter, ends with a letter/digit, reserved names rejected. One current prefix per account, globally unique. Initial claim does not consume a rename. Rename is permitted once per natural month in Asia/Shanghai. Old prefixes stay reserved to the original account and their DNS is preserved; they cannot receive new/updated records. Renaming does not migrate a website or its DNS.

Create DNS body: `{prefix, name, type, content, ttl?, priority?, requestId}`. `name` is `@` or a full name at/below the owned current domain. Types: A, AAAA, CNAME, TXT, MX. TTL defaults to automatic (`1`); MX priority defaults to 10. Update includes the account-owned record `id`; delete is `{id, requestId}`. Client record IDs are opaque UUIDs, never provider IDs. `requestId` is 8–100 ASCII alphanumeric/underscore/hyphen characters. Reuse the same ID and exact body when retrying; reuse with a changed operation/body is rejected.

List returns `namespace`, `domains[{prefix,domain,retired}]`, `records[{id,prefix,name,type,content,ttl,proxied,priority?}]`, `membershipActive`, `renameAvailable`, `nextRenameAt` (Unix seconds or null), `timezone`, `recordLimit`, and `capabilities{read,claim,rename,writeDns,deleteDns}`. Membership expiration retains all domains/records and permits reading or explicitly deleting owned records, but denies claiming/renaming/writing. No payment flow is implied.

Cloudflare uses only the server environment variable `CF_CANP_SITE_TOKEN`, restricted to Zone DNS Edit for canp.site, fixed zone `ea6bf97000a0e2c3353f4f6d07cafeb4`. OAuth secrets must never be extracted from a desktop session. No credentials/provider IDs/errors are returned. Records are DNS-only (`proxied:false`); HTTPS/deployment is a separate verified workflow. `MEMBER_DNS_RECORD_LIMIT` defaults to 100; lowering it never deletes existing records. Per-account write and claim rate limiting must be applied by the HTTP layer.

Atomic local writes hold `BEGIN IMMEDIATE` through the bounded provider call; the HTTP layer must not retry with a new operation ID after a timeout. Provider create writes a deterministic opaque comment marker; retry reconciles a remote success followed by local transaction failure. Existing records are never claimed just because their hostname matches. Adapter calls are `put(record, provider_id_or_none, opaque_operation_digest) -> provider_id` and `delete(provider_id)` and are injectable for tests.

Validation: `python -m unittest discover -s services/cloud-sync -p test_domains.py -v`: 7 tests pass (concurrent uniqueness/idempotency, natural-month boundary, account isolation, retired/expired preservation, input validation, sanitized provider failure/retry). On 2026-11-12 the Hong Kong production service used its zone-scoped token to create, read back, and delete a unique TXT record in canp.site. A subsequent listing confirmed removal. Using an active desktop member session, the public API returned HTTP 200, claimed the selected namespace, then created, listed, and removed a TXT record below it. A final listing confirmed cleanup. These checks do not establish certificate issuance or renewal.


## Integrated acceptance

The authenticated HTTP routes are wired in `server.py`, with the existing origin guard and an additional 30 account writes/minute limit. Desktop `cloud:domains`, `CloudSync.domains(input?, signal?)`, shared strict command/state validation, and preload API are connected. Cancellation is propagated to the request and prevents the follow-up read; callers must retain the same requestId when the outcome is unknown.

`test_domains_http.py` exercises the actual local HTTP server: invalid bearer and cross-origin rejection, membership enforcement, ignored account injection, cross-account record isolation, monthly rename rejection and the next month. Combined domain tests: 8 passed. `tests/member-domains-client.test.ts`: 2 passed, including sanitized response and cancellation. Full cloud-sync service suite: 51 passed.

`scripts/member-domains-ui-smoke.ts` runs real Edge with mocked domain data at 1100/760/390 pixels. It verifies claim retry with the same requestId, rename, DNS create/edit/delete, and account remount clearing old state and drafts. Screenshots are in `test-results/member-domains/`; no horizontal overflow. Editing DNS preserves its existing TTL. These are local acceptance results, not production DNS verification.

### Production site verified on 2026-11-12

The member account owns yeqi76.canp.site. The member API created and returned its apex A record pointing to 154.219.103.127. Through the Hong Kong machine's saved CShell SSH connection, the existing Caddy service loaded a separate site configuration after validation. The local Windows client obtained HTTP 200 over trusted HTTPS using ordinary DNS, and HTTP returned 308 to the HTTPS URL when checked at the origin. The certificate matches yeqi76.canp.site and expires on 2027-02-10 at 13:26:50 UTC. Caddy is enabled at boot and has received renewal scheduling information. A future renewal has not yet occurred.
