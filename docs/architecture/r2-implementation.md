# R2 "Make + Source": implementation (increment 1)

**Status (2026-10-07):** built on top of R1 (PR #1, merged). It covers ideation → Build → CAD → instant quote, and the Accio Work sourcing bridge with a human approval boundary.

**Verification:**
- `tsc`, `eslint`: clean
- vitest: 381 tests in 55 files
- CAD worker pytest: 18
- Playwright: 5 journeys, R1 included
- `next build`: passes

## What a customer can do now

```
Describe it (/make/ai) ─▶ Make AI CreationIntent (persisted) ─▶ Continue to Build
   ─▶ Build Workspace v1 (requirements, NEEDS_INPUT questions, catalog materials)
   ─▶ answer questions (new version each time) ─▶ approve version (immutable)
   ─▶ Generate CAD (Make AI spec or buyer dimensions) ─▶ STEP / DXF / GLB + new version
        ├─ sheet part ─▶ /parts/:partId instant quote ─▶ BINDING ─▶ R1 checkout → order
        └─ anything else ─▶ "Find manufacturing partners" ─▶ Accio Work (MCP) ─▶ offers
Upload a DXF (R1) whose quote is REVIEW ─▶ sourcing job queued automatically ─▶ Accio Work
Partner offers on the Manufacturing Route (trust-labelled, no supplier identity)
   ─▶ buyer chooses a SUPPLIER-CONFIRMED offer ─▶ ops approves ─▶ route confirmed
```

Ordering through a supplier route (deposit, PO, supplier fulfilment leg, Delivery Promise) is **R3**. In R2, checkout still accepts BINDING quotes only.

## Modules

| Area | Code | Notes |
|---|---|---|
| Build Graph | `src/server/build-graph/` | Copy-on-write graph per `design_version` (`bg_nodes`, `bg_edges`). APPROVED versions are never mutated. Diff by stable node key; remix/clone lineage; derived trust state (CONCEPT → ORDERABLE) |
| Make AI → Build | `src/server/make-ai/{builds,materials}.ts` | Intents are persisted (sha256 and length only, no prompt). The Materials Engineer may only answer with a catalog slug or `needs_sourcing` |
| Workspace UI | `src/components/workspace/`, `/build/:id/workspace` | Overview (next step, CAD, sourcing), Requirements, Questions, Materials, Parts, Graph (with version diff), Versions (approve), Remix / Make This |
| CAD worker | `services/cad-worker/` (Python, CadQuery) | `sheet_panel`, `l_bracket`, `enclosure`. Bounded specs, process timeout, deterministic DXF using the R1 layer conventions |
| CAD in the app | `src/server/cad/` | Client (sha256 and size checks), CAD agent (refuses untraceable dimensions), pipeline (stores artifacts, attaches a quotable part), build CAD (writes a new version) |
| Sourcing bridge | `src/server/sourcing/`, `POST /api/mcp/sourcing` | 9 MCP tools, leases, policy, offers and trust, approvals, signed REDACTED package, audit, auto-request on REVIEW quotes |
| Sourcing UI | `src/components/sourcing/`, `src/components/trust/`, `/admin/sourcing` | Buyer panel and partner routes; ops desk (queue, job detail, approvals, desk fallback, Accio clients) |
| Accio config | `mcp/discovermake-sourcing/` | Agent-group prompts and schedule, setup README |

## API surface (new in R2)

**Build Graph and Make AI** (public, like the other build routes; per-IP limits on writes):
- `POST /api/make-ai/builds { intentId }` → `{ buildId, displayId, created }`
- `GET /api/builds/:id/graph?version=` → `BuildGraphView`
- `GET /api/builds/:id/graph/diff?from=&to=` → `BuildGraphDiff`
- `POST /api/builds/:id/answers { answers: [{ unknownKey, value }] }` → new version
- `POST /api/builds/:id/versions/:v/approve`
- `POST /api/builds/:id/remix` and `POST /api/builds/:id/clone` → `BuildForkResponse`
- `GET | POST /api/builds/:id/cad { spec? }` → `BuildCadResponse`. POST returns 501 without `CAD_WORKER_URL`, and 409 unless the latest version is approved with no open questions

**Sourcing, buyer:**
- `GET | POST /api/builds/:id/sourcing`
- `POST /api/builds/:id/sourcing/offers/:offerId/select`

**Sourcing, ops** (`ADMIN_TOKEN`):
- `GET | POST /api/admin/sourcing/clients`, `DELETE /api/admin/sourcing/clients/:id`
- `GET | POST /api/admin/sourcing/jobs`, `GET /api/admin/sourcing/jobs/:id`
- `POST /api/admin/sourcing/jobs/:id/{cancel,requeue,suppliers,offers}`
- `GET /api/admin/sourcing/approvals`, `POST /api/admin/sourcing/approvals/:id/decision`

**MCP** (Accio Work, `Bearer dmsc_…`): `POST /api/mcp/sourcing` exposes these `discovermake.sourcing.*` tools:
- `next_job`, `get_job`, `get_attachments`
- `submit_supplier`, `submit_offer`, `update_negotiation`
- `attach_document`, `request_approval`, `complete_job`

**Events:**
- Build Graph: `build.forked`, `design.version_created`, `design.version_approved`, `requirements.generated`, `material.recommended`
- CAD: `cad.generated`
- Sourcing jobs: `sourcing.requested`, `sourcing.job_leased`, `sourcing.lease_released`, `sourcing.completed`, `sourcing.cancelled`
- Suppliers and offers: `sourcing.supplier_found`, `sourcing.offer_received`, `sourcing.offer_stale`, `sourcing.negotiation_updated`, `sourcing.document_attached`, `sourcing.package_accessed`
- Approvals: `sourcing.approval_requested`, `sourcing.approval_decided`, `sourcing.boundary_blocked`, `supplier.selected`

## Rules enforced in code

- **No invented dimensions.** The CAD agent may only use numbers the buyer stated: user-sourced requirements and answered questions. Anything else becomes an open question in a new version, and holes the buyer never placed are dropped and listed.
- **No model-written CAD code.** The worker takes a strict, bounded spec. Unknown fields are rejected, and each generation runs in a killable process.
- **Approval boundary.** Accio can search, RFQ, negotiate within bounds, submit offers and request approvals. It cannot purchase, pay, release the full package, accept substitutions or tolerance changes, or pick the winner. Those paths return `APPROVAL_REQUIRED` and are recorded as `sourcing.boundary_blocked`.
- **Customers never see the supplier.** Route offers show region, verification, price, dates and the trust label only.
- **Trust labels are honest.** AI estimate and supplier estimate are never orderable. Supplier-confirmed can be chosen, and ops confirms it. Only BINDING goes to checkout.

## Where R2 deliberately differs from the plan

| Plan | R2 increment 1 | Why / next |
|---|---|---|
| `services/accio-bridge` as its own service | Route inside the web app | One deployable. Split it out when traffic warrants |
| OPA sidecar for the boundary | TypeScript policy table with tests | Same rules. OPA in R3 |
| Temporal workflows | Postgres state machines and the outbox (ADR-0007) | R3, with supplier fulfilment legs |
| 11-section workspace nav | 7 sections, only those with real data | No placeholder features |
| Object View (r3f) | Rendered in Stage 1 (see below) | — |
| Rate limits | In-memory per instance | Move to a shared store before scaling out |
| Make AI intent ids `mki_…` | UUIDv7 (the frozen contract types `intentId` as a UUID) | Harmless; revisit with accounts |

## Owner actions to switch R2 on

1. Run `bun run db:migrate` in production (applies `0003_r2_build_graph_sourcing`).
2. **Make AI:** set `MAKE_AI_ENABLED=true`, `NEXT_PUBLIC_MAKE_AI_ENABLED=true` and `GOOGLE_GENERATIVE_AI_API_KEY`, and verify `MAKE_AI_MODEL`.
3. **CAD worker:** deploy `services/cad-worker` (Dockerfile) to Fly.io, Render or Cloud Run with `CAD_WORKER_TOKEN`. Then set `CAD_WORKER_URL` and `CAD_WORKER_TOKEN` in Vercel.
4. **Accio Work:**
   1. In `/admin/sourcing` → Accio clients, create a client and copy the one-time token.
   2. In your Accio Work workspace, register the MCP server `${APP_URL}/api/mcp/sourcing` with that bearer token.
   3. Paste the agent group from `mcp/discovermake-sourcing/accio-agent-group.md` and schedule the Procurement Lead (every 15 minutes).
5. Ops checks `/admin/sourcing` for pending approvals. The ops board links to it with a count.

## Stage 1: Build Workspace upgrades (600-3, 300-2, 300-3, 100-1, 1000-3)

The workspace nav now has **Object**, **Files** and **Ask Make AI** next to the existing
sections. The active section is kept in `?section=` (e.g. `/build/:id/workspace?section=object`).

### Object View (600-3, 300-2)

`src/components/workspace/object-view/`. Modelled on the Microsoft Copilot 3D-object screen
(Mobbin): a large viewport beside Properties, Download and Recreate panels.

- **Source:** the GLB from the latest CAD record (`GET /api/builds/:id/cad`, signed URLs from
  `builds/<id>/cad/v<n>/<file>`).
- **Lazy:** three.js loads through `next/dynamic` (`ssr: false`) and only when the Object section
  is open and WebGL is available. The Overview card is a static SVG (no three.js), so the
  workspace's first paint stays light.
- **Viewport** (`object-viewport-3d.tsx`): orbit controls, an auto-fit camera, neutral studio
  lighting (no HDR download) and world units in millimetres. The GLB is in metres and Y-up, like
  CadQuery's export; `inferScaleToMm` checks it against the CAD bounding box. Also: a bounding box
  with X/Y/Z labels (canvas-texture sprites, no DOM inside the canvas), a two-point measure mode,
  a wireframe toggle and Reset view.
- **Controls:** real buttons with `aria-pressed`, plus a mm / inch toggle.
- **Accessibility:** the canvas has `role="img"` and a name that holds the dimension summary. The
  dimensions are always listed as text, and the measure readout is an `aria-live` region.
- **Fallbacks:**
  - no WebGL, or no GLB: the 2D DXF flat pattern of the CAD part, or a dimensioned isometric box;
  - no CAD yet: "Generate CAD to see the 3D model".
- **Pure helpers** (`geometry.ts`, unit-tested): unit conversion, bounding-box text, two-point
  distance, the glTF to CAD axis map, GLB scale and camera fit.

### Ask Make AI (300-3)

`src/server/workspace/assistant.ts`, `src/components/workspace/assistant-panel.tsx`.
- Scoped to the build's **latest** design version. The model sees one line per graph node
  (requirements, questions, materials, parts, processes) and treats the buyer's message as data.
- **Asking never writes.** A change request comes back as at most one proposal: an answer to an
  open question, or a new requirement. Only the buyer's **Confirm** writes it as a NEW design
  version, through `answerUnknowns` or `writeVersion`, as a user-sourced node
  (`provenance: make-ai-assistant:confirmed`).
- **Guards:** a proposal is dropped, with a plain note, when it carries any number that is not in
  the buyer's message, in a buyer-stated node or (for an answer) in that question's displayed
  default. A relative change stays relative ("20 mm wider than the stated 100 mm"). The CAD agent
  then still only uses buyer-stated numbers.
- **Unavailable** (`MAKE_AI_ENABLED` off or no key): `GET` says so with a reason, `ask` returns
  `status: unavailable` (200), and "Add a requirement yourself" still writes a version.
- A stale proposal (the build moved on) gets 409 "ask again".

### Attachment tray (100-1)

`src/server/workspace/attachment{s,-files}.ts`, `src/components/workspace/attachment-tray.tsx`,
table `build_attachments` (`att_` ids).
- **Accepted files:**
  - images: png, jpg, webp and heic, up to 15 MB;
  - CAD: dxf, step, stp, stl and svg, up to 50 MB.
- **Upload:** create, which checks the extension, the content type for that extension and the
  size, and returns a signed PUT bound to that content type and cap. The browser then PUTs the
  bytes with progress. Complete re-checks the stored size (S3 does not enforce the cap), the
  **magic bytes** for the extension, and records sha256. A file that fails is deleted.
- **SVG:** an SVG with scripts, event handlers or embedded content is refused. Downloads are
  always served with `Content-Disposition: attachment`. Thumbnails are png, jpg and webp only.
- **Storage:** `builds/<id>/attachments/<attId>/<safe filename>`. The filename is reduced to an
  ASCII basename, so `../` cannot escape the folder.
- **Use as a part** (DXF): the bytes become a part on the same build, run through the R1
  analyze → `/parts/:partId` instant quote. It runs once per attachment.
- **Ownership:** writes go through `assertCanEditBuild(request, build)` from
  `src/server/auth/viewer.ts` (a permissive stub until the accounts module replaces it).
  `device_hash` is the sha256 of the `dm_device` cookie when present.

### Replacement part from the Passport (1000-3)

`src/server/passport/replacement.ts`, "Order a replacement" on `/passport/:id`.
- **Quote:** a new quote through the R1 quote engine for the same verified file (checked against
  the passport's signed file fingerprint), with the same material, thickness, finish and
  operations, quantity 1 by default. The buyer lands on `/parts/:partId?from=:quoteId`.
- **Privacy:** it needs only the public passport link. The file is **copied onto a new build**, so
  the original build, its graph, attachments, other quotes and the order (buyer email, address)
  are never reachable from a public passport. Repeat requests reuse the replacement part.
- **Traceability:** `quotes` has no metadata column, so the `passport_replacements` table holds
  `quote_id → replacement_of_passport_id` and `source_quote_id`, plus a
  `passport.replacement_quoted` event.

### API surface (Stage 1)

- `GET | POST /api/builds/:id/attachments`
- `POST /api/builds/:id/attachments/:attId/complete`
- `POST /api/builds/:id/attachments/:attId/use-as-part`
- `DELETE /api/builds/:id/attachments/:attId`
- `GET | POST /api/builds/:id/assistant`, where the POST `action` is `ask`, `confirm` or `add_requirement` (16 KB body cap)
- `POST /api/passport/:id/replacement { quantity? }` (1 KB body cap)

Contracts live in `src/contracts/workspace.ts`. Per-IP limits (in-memory, like the other R2 limits):
- Make AI asks: 10 per minute;
- attachment writes: 60 per minute;
- replacements: 6 per minute;
- confirmations: the Build Graph write limiter.

**Events:** `build.attachment_added`, `build.attachment_removed`, `passport.replacement_quoted`.

**Migration:** `0004_r2_attachments` (`build_attachments`, `passport_replacements`). It was
generated for local testing; regenerate it on integration.

## Next increments

- CAD evals across model providers.
- More CAD families (U-channel, multi-bend, plates with slots).
- Database triggers that make approved graph rows immutable at the database level.
- Supplier-route ordering, OR-Tools route comparison and the Delivery Promise (R3).

## Accounts and My Builds (Stage 1, ADR-0009)

**What a person can do.**
- **Guest.** Upload or describe a part, quote it and order it with no account. Everything made in a browser shows under **My Builds** (`/builds`), with a "Sign in to keep these builds" banner.
- **Sign in** at `/signin` with:
  - an email code;
  - a passkey (usernameless);
  - Google or Apple, when they are configured.

  `?next=` takes same-site paths only. `?mode=create` shows the "Save your build" copy.
- **On sign-in.** The browser's guest builds and the email's guest orders move to the account. Guest onboarding answers are kept.
- **`/me`.** Display name, become a creator (handle), passkeys (add / remove), preferences, sign out. Ops and shop users also get shortcuts to their consoles.
- **My Builds.** Tabs All / Created / Remixed / Ordered / Following with counts and universal status pills. Every row has three actions:
  - **Reorder:** a fresh quote with the last order's options, straight to checkout.
  - **Remix:** forks the approved version into a new workspace.
  - **Repair:** opens `/parts/:partId?replacement=1` for a replacement quote of that part.
- **Only the owner can change a build.** That means the signed-in owner, or the guest device that made it. Others get 403, and the workspace shows them a read-only notice.

**Modules.**
| Path | What |
|---|---|
| `src/server/auth/viewer.ts` | `getViewer`, `requireViewer`, `requireRole`, `hasRole`, `getDeviceHash`, `assertCanEditBuild`, owner stamping helpers |
| `src/server/auth/{device,sessions,cookies}.ts` | `dm_device` and `dm_session` cookies, sliding sessions, same-origin check, safe `next` |
| `src/server/auth/{email-code,passkeys,oidc,users,sign-in}.ts` | sign-in methods; `completeSignIn` (roles, claims, preferences, session, events) |
| `src/server/auth/build-access.ts`, `page.ts` | route guards by build / part id; Server Component helpers |
| `src/server/accounts/{me,my-builds,follows}.ts` | Me API, My Builds tabs and Reorder, follows |
| `src/components/account/**` | `/signin`, `/me`, `/builds` screens and the browser passkey client |

**API.**
| Route | Notes |
|---|---|
| `POST /api/auth/email/start` · `POST /api/auth/email/verify` | 6-digit code; `devCode` outside production without Resend |
| `POST /api/auth/passkey/{register,login}/{options,verify}` | register needs a session; login is usernameless |
| `GET /api/auth/oauth/:provider` · `GET\|POST /api/auth/oauth/:provider/callback` | google, apple (404 when unconfigured) |
| `POST /api/auth/signout` | revokes the session |
| `GET\|PATCH /api/me` · `PUT /api/me/preferences` · `DELETE /api/me/passkeys/:id` | `GET /api/me` works signed out |
| `GET /api/me/builds?tab=` · `POST /api/me/builds/:id/reorder` | guest = this device's builds |
| `POST\|DELETE /api/builds/:id/follow` | signed in |

**Owner actions.**
1. Run `bun run db:migrate` (applies `0004_r2_accounts`).
2. Set `AUTH_SECRET` (32+ random chars) and `RESEND_API_KEY`. Email sign-in answers 503 in production without Resend.
3. Set `ADMIN_EMAILS` to the ops team's emails. They get the ops board without the shared token. `ADMIN_TOKEN` keeps working.
4. Optional:
   - **Google:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with redirect URI `${APP_URL}/api/auth/oauth/google/callback`.
   - **Apple:** `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` (.p8), with return URL `${APP_URL}/api/auth/oauth/apple/callback`.
5. Passkeys need nothing beyond `APP_URL`, which must be the real public origin (it is the WebAuthn relying party).

**Not yet.**
- Shop memberships per user. Today the `shop` role comes from a shop's contact email, and the Shop Console still uses console tokens.
- Org accounts.
- A shared store for the per-IP sign-in limits.
- The ops board UI still asks for the token. The API already accepts an ops session.
