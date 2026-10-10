# DiscoverMake Sourcing MCP server · Accio Work setup

Accio Work (Alibaba) has no inbound API or webhook, so DiscoverMake does not call Accio.
Accio calls DiscoverMake instead: an Accio Work **agent group** runs on a schedule and
uses the **DiscoverMake Sourcing MCP server** to pull sourcing jobs and push structured
supplier offers back (ADR-0005, workflow 03).

| File | What it is |
|---|---|
| `accio-agent-group.md` | The versioned agent group configuration to paste into Accio Work: team lead, sub-agents, prompts, skills, schedule, approval boundary. Change it by pull request, like code. |
| `README.md` | This setup guide. |

Server code: `src/server/sourcing/**`. Route: `src/app/api/mcp/sourcing/route.ts`.

## 1. Create an MCP client token (once per Accio Work workspace)

```bash
curl -sS -X POST "$APP_URL/api/admin/sourcing/clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"Accio Work · DiscoverMake procurement"}'
# -> {"clientId":"scl_...","name":"...","token":"dmsc_..."}
```

The `dmsc_...` token appears **once**. DiscoverMake stores only its sha256. Keep it in
Accio Work's secret store and nowhere else.

- List clients (no secrets are returned): `GET /api/admin/sourcing/clients`
- Revoke a client: `DELETE /api/admin/sourcing/clients/<clientId>`. The token stops
  working immediately and the client's leased jobs return to the queue.
- Limit a client (per-workspace allowlist):
  `PUT /api/admin/sourcing/clients/<clientId>/allowlist` with
  `{"allowedTools": ["next_job", "get_job"], "allowedCidrs": ["203.0.113.0/24"]}`. Use `null` for "all nine tools" or "any IP"; the same fields are accepted at creation and in the Accio clients panel.
  - Tools outside the list disappear from `tools/list`, and calls to them return `TOOL_NOT_ALLOWED`.
  - Requests from other IPs get HTTP 403 (JSON-RPC `-32003`, `IP_NOT_ALLOWED`). The IP is read from the platform header, else from the rightmost `x-forwarded-for` hop.

## 2. Register the MCP server in Accio Work

In Accio Work, go to **Settings → MCP servers → Add server**:

| Field | Value |
|---|---|
| Name | `discovermake-sourcing` |
| Transport | Streamable HTTP (remote) |
| URL | `${APP_URL}/api/mcp/sourcing` (for example `https://discovermake.com/api/mcp/sourcing`) |
| Auth header | `Authorization: Bearer dmsc_...` |

Then attach the server to the agent group described in `accio-agent-group.md`.

Server properties:
- Stateless: there are no session ids, so every POST stands alone.
- Responses are JSON. GET and DELETE return 405.
- The request body is capped at 8 MB. A document can be at most 5 MB after base64 decoding.
- Each client gets a token bucket of 60 calls, refilled at 1 call per second. Above that,
  tool calls return `RATE_LIMITED`. The bucket is in memory, one per instance, and must
  become shared before the server scales out.
- Every tool call is written to `sourcing_tool_calls`, which stores a sha256 of the
  arguments and never the raw arguments.

## 3. Tools

All tools are named `discovermake.sourcing.<tool>`:

| Tool | Purpose |
|---|---|
| `next_job` | Lease the next queued job. The lease lasts 30 minutes and every write extends it. |
| `get_job` | Read the full `SourcingRequest`, the offers so far, and approval decisions. |
| `get_attachments` | Signed URLs that expire in 15 minutes and are access-logged. Returns the REDACTED package by default. FULL needs an approved `RELEASE_FULL_PACKAGE` for the named supplier. |
| `submit_supplier` | Register a candidate supplier with evidence. Suppliers are de-duplicated on (platform, platform_ref). |
| `submit_offer` | Submit a normalized `SubmitOfferInput` in integer cents. Idempotent on `idempotency_key`. |
| `update_negotiation` | Set the thread status and append a note. |
| `attach_document` | Attach a quote, certificate, drawing, or photo (base64, max 5 MB). |
| `request_approval` | Ask a human to decide. Creates a PENDING approval. |
| `complete_job` | Close the job with outcome `offers_submitted`, `no_viable_suppliers`, or `needs_desk`. |

Tool errors are `isError: true` results whose `structuredContent` is
`{ "error": { "code", "message", "approval_kind"? } }`. The codes are:
`APPROVAL_REQUIRED`, `STALE_DESIGN_VERSION`, `LEASE_INVALID`, `NOT_FOUND`,
`VALIDATION_FAILED`, `CONFLICT`, `RATE_LIMITED`, `UNAUTHORIZED`.

## 4. Smoke test from a terminal

```bash
H=(-H "Authorization: Bearer $DMSC_TOKEN" -H "content-type: application/json" -H "accept: application/json, text/event-stream")
curl -sS "${H[@]}" "$APP_URL/api/mcp/sourcing" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -sS "${H[@]}" "$APP_URL/api/mcp/sourcing" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -sS "${H[@]}" "$APP_URL/api/mcp/sourcing" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"discovermake.sourcing.next_job","arguments":{}}}'
```

## 5. Where jobs come from

- **Automatically.** When a quote lands in `REVIEW` (outside the instant catalog, or no
  partner shop can run it), DiscoverMake queues one job for that part, version, and
  quantity. The outbox relay runs at most once a minute, and `next_job` also runs it, so
  the scheduled agent picks up the job with no manual step.
- **Buyer.** `POST /api/builds/<buildId>/sourcing` ("Find manufacturing partners").
- **Ops.** `POST /api/admin/sourcing/jobs`.

Jobs on the `desk` channel are never leased by agents. A job lands on the desk when the
agent completes it with `needs_desk`, or when ops requeue it with `{"channel":"desk"}`.

## 6. What happens after an offer

Buyers see offers on the Manufacturing Route without the supplier's name or platform,
labelled only like "Verified partner · Vietnam". Only offers that are `SUPPLIER_CONFIRMED`
and `ACTIVE` can be chosen. Choosing one creates a PENDING `SELECT_SUPPLIER_OFFER`
approval, and ops confirm it with `POST /api/admin/sourcing/approvals/<id>/decision`.
In R2 a selected offer does **not** become a checkout: checkout stays BINDING-only, and
ordering supplier-sourced routes end to end is R3.
