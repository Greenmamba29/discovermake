# Kids & Family

Owner brief: "a 10-year-old must be able to completely use it to discover, make and build", modelled on Amazon household and teen accounts. A grown-up adds kid profiles; kids browse and design; kids "Ask a grown-up"; the grown-up approves and pays; Prime benefits are shared with the household.

## Model

| Who | What they are | What they can do |
|---|---|---|
| **Grown-up** | A signed-in DiscoverMake user (the account holder, payer, consenting parent) | `/family`: add up to 4 kid profiles, set controls and the 4-digit PIN, "Hand to <kid>", approve & pay or decline requests, delete a profile, read the activity log |
| **Kid profile** | A row under the grown-up (`kid_profiles`): nickname, age band, preset avatar, controls | Nothing on its own: kids never sign in, have no email and never pay |
| **Kids mode** | The grown-up's own browser, handed to one kid | `/kids`: design allowed templates, see the real price, ask a grown-up, follow "My things"; optionally view-only Live and kid-safe Ideas |

Controls per kid (defaults from the age band, `defaultControlsFor` in `src/contracts/kids.ts`):

| Control | Default | Notes |
|---|---|---|
| Spending limit per request | $25 | $5 to $200. Checked when the kid asks; the grown-up still approves every request |
| Allowed templates | Age-appropriate: templates whose minimum age (`KID_TEMPLATES[...].ages`) is at most the band's youngest age (6–9: Name keychain, Bookmark; 10–12 and 13–17: all five) | The grown-up can turn any template on or off |
| Live viewing | Off under 13, on for 13–17 | View-only: subscribe-only video as an anonymous viewer; no chat, questions, polls, likes or drops |
| Ideas (kid-safe Discover) | Off under 13, on for 13–17 | Only public builds ops marked kid-safe (`kid_safe_builds`, `PUT /api/admin/kids/kid-safe/:buildId`); read-only; no feed events recorded |

## Data (Drizzle, `// Kids & Family` section at the end of `src/server/db/schema.ts`, migration `0012_kids_family`)

| Table | Holds |
|---|---|
| `families` | One row per grown-up who set up Family: `pin_hash` (`scrypt1$salt$hash`, scrypt N=2^15 over HMAC(AUTH_SECRET-derived key, pin)) |
| `kid_profiles` | nickname (1–12 letters/digits/spaces), age band, avatar id, spending limit, allowed templates, live/discover flags. Nothing else about a child exists anywhere |
| `kid_designs` | template, bounded params (incl. the ≤12-char label), the workshop result (`cad`: engine, geometry, artifact keys + sha256), the `kids` build/part, the print quote id and BINDING price |
| `kid_requests` | "Ask a grown-up": design, quote, price, status (pending / approved / declined), optional kind note |
| `family_activity` | Approvals, declines, Kids mode start/end, profile changes. Rows of a deleted kid go with it |
| `kid_mode_locks` | `user_sessions.id` -> kid: the grown-up's session is handed to a kid |
| `kid_safe_builds` | Ops-reviewed builds kids may see in Ideas |

New id prefixes: `kid_`, `kdz_`, `kreq_`, `fac_`. New build origin: `kids` (owned by the grown-up, named after the template only: the kid's words never go into names, filenames, notes or emails).

## Kid designs: workshop -> BINDING print quote

`src/server/kids/designs.ts`:

1. The kid picks an allowed template and options; `parseKidTemplateParams` validates them (KidLabel: letters, digits, spaces, ≤ 12, with kid-friendly messages). No free text reaches an AI model: the template is our own parametric model.
2. The workshop: `buildKidTemplate` (`src/server/cad/text-to-cad.ts`, replaced at integration by the text-to-CAD client) posts `{ params }` to `${CAD_WORKER_URL}/v1/kid-templates/<template>/build`. Artifacts are decoded, size- and sha256-checked and stored under `kids/designs/<id>/`.
3. The STL becomes a READY printed part on a `kids` build owned by the grown-up, and `createPrintQuote` prices it (PLA, quantity 1, the worker's geometry; min wall = the kid templates' 2 mm design rule). Only a READY + BINDING quote shows a price.
4. No worker configured, unreachable or timing out: the design is `offline` and the kid sees "The workshop is offline right now" with Try again. A price is never estimated or faked.

E2E has no CAD worker: `tests/e2e/support/kids.ts` plants the golden worker output (a generated, valid 50 x 20 x 4 mm STL from `tests/support/kids-golden.ts`) for exactly the kid's design, like Reconstruct's `plantGoldenKnobCad`; then "Try again" runs the real print engine on it.

## Requests, approval and order status

- **Ask a grown-up** (`askGrownUp`): only a priced design whose price ≤ the kid's limit (else 409 `OVER_LIMIT` with "Pick a smaller option"). Emails the grown-up's account email (`family.kid_request` through `src/server/notify`); the kid has no email and none is asked.
- **Approve & pay** (`approveKidRequest`): marks the request approved and returns `/checkout/<quoteId>`: the grown-up's normal checkout. A stale quote is re-priced by the engine first.
- **Not this time** (`declineKidRequest`): optional kind note (≤ 140 chars) shown to the kid.
- **Order status flows back**: "My things" reads the grown-up's latest order for the request's quote (`orders.buyer_user_id` = grown-up) and maps it to kid stages: Waiting for a grown-up / Yes! It's being made / On its way / Here! (`kidStageFor`).

## Prime household

Approved kid orders are the grown-up's orders, so `POST /api/checkout` applies `getMembershipForBenefits(grownUp)` exactly as for anything else they buy: free standard shipping when the order reaches the member threshold (`PRIME_FREE_SHIPPING_THRESHOLD_CENTS`), member material pricing, priority shop slot and guaranteed dates (`order_benefits`). `/prime` and `/me/membership` explain "Prime Family: share free shipping with your kids' approved orders". Non-members can use Family the same way.

## Kids mode and the guards

Entering: on `/family` the signed-in grown-up taps "Hand to <kid>" (`POST /api/family/kids/:id/hand-off`; PIN must be set). The server:

1. writes `kid_mode_locks(session_id = the grown-up's session, kid)`;
2. sets `dm_kid` = `v1.<claims>.<HMAC-SHA256>` (key derived from AUTH_SECRET; claims: kid, grown-up, session, iat), HttpOnly, SameSite=Lax, Secure on HTTPS, one year.

A request is a **kid session** only when the signature checks, the grown-up's `dm_session` resolves to the session in the claims, the lock row matches, and the profile still exists under that grown-up (`src/server/kids/session.ts`). Every kid route scopes reads and writes by that kid and grown-up, never by ids in the request alone.

While Kids mode is on, three layers refuse everything a kid may not do:

| Layer | Where | What |
|---|---|---|
| Allowlist | `src/lib/kids/policy.ts` | Pages: `/kids/**`, `/legal/**`. API: `/api/kids/**`, `/api/health`, signed `GET /api/storage/local/**`. Everything else is refused |
| Proxy | `src/proxy.ts` (matcher now also `/api/:path*`) | With any `dm_kid` cookie present (fail closed): pages redirect to `/kids`, API routes answer 403 |
| Session lock | `getViewer` (`src/server/auth/viewer.ts`) | A locked session is not a grown-up session: `getViewer` answers null, so every signed-in route (account, Family, studio, admin via session) refuses, even if the cookie is deleted by hand |
| Route guard | `assertNotKidMode(request)` | In checkout (5 routes), cart (8), account settings, membership, My Builds, studio, sourcing, shop session, uploads (parts, attachments, order/rating uploads), Make AI intake/builds/assistant, Live chat and questions, Reconstruct capture/segment/measurements, publishing. 403 "This part is for grown-ups" |

Publishing additionally refuses any `kids` build (`publishBuild`), so a kid's words can never become public.

Leaving: `/kids/exit`, a big keypad; `POST /api/kids/exit { pin }` checks the PIN of the family that started Kids mode (from the lock, else the signed cookie), 5 attempts per grown-up per 15 minutes through the shared limiter (`RateLimiter('kids_pin_attempt')`), then removes the lock and clears the cookie. A deleted profile or tampered cookie shows "Kids mode is over" and still needs the PIN.

## Kid UX

Paper surface, big type, target reading age about 8, every tap target ≥ 48 px, one choice per screen with "Step 2 of 4" dots, a live drawing of the project with the kid's words (3D Object View when the workshop returns a GLB), the price in kid words ("This costs $12.40. A grown-up needs to say yes."). Kid nav: Make · My things · Exit (replaces the adult 5-tab nav; the adult nav and its sweep expectations are unchanged elsewhere). No third-party scripts or analytics exist in the app, and Kids mode records no feed events.

## Deleting a kid profile

`DELETE /api/family/kids/:id` (one tap + confirm): the lock, requests, designs, activity rows and the profile go in one transaction; then the workshop files and every `kids` build that was never ordered (quotes, print details, part files). Paid orders stay: they are the grown-up's purchase records (tax, warranty) and carry no kid data beyond the printed object. The activity log keeps one line, "Removed a kid profile …", without the nickname.

## What needs counsel (before launch)

See docs/architecture/legal-inventory.md (Kids row and the Kids & Family review): verdict **needs counsel before launch**. Open questions: COPPA verifiable parental consent method (is a signed-in account holder enough; which 16 CFR 312.5 method), whether the nickname / printed label is "personal information", notice wording (the Kids section of the draft Privacy Policy is marked "needs counsel review"), retention period for kid designs, state laws (California AADC, CCPA minors), and UK / EU children's codes if offered there.

## Not done / follow-ups

- Kid-safe review tooling is an API only (`PUT /api/admin/kids/kid-safe/:buildId`); there is no ops screen yet.
- Kids mode ends only by PIN or profile deletion; there is no time limit yet.
- `kids` builds have no Build Graph version, so they cannot be remixed or cloned (forking needs an approved version). The grown-up can Reorder a paid one from My Builds like any printed part.
