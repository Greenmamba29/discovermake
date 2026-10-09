# ADR-0009 · R2 accounts: self-hosted sessions, passkeys and guest device ownership

- **Status:** Accepted
- **Date:** 2026-10-09
- **Supersedes:** the "R2: Supabase Auth accounts" consequence of ADR-0008 (the R1 order, shop and ops mechanisms stay)
- **Related:** ADR-0006 (Postgres), ADR-0008 (R1 identity), workflow 09 (My Builds), workflow 10 (deferred signup), workflow 14 Stage 1

## Context
Stage 1 needs accounts. People should:
- sign in with a passkey, Apple, Google or an email code;
- keep the builds and orders they made as guests (deferred signup: quote first, sign in to save, order or sell);
- be the only ones who can change their builds.

ADR-0008 planned Supabase Auth for this. Three things changed:
1. The app already runs on plain Postgres with Drizzle and its own outbox. There is no Supabase client anywhere, and row-level security is not used yet, since every query goes through the server.
2. The guest model needs a **device principal** that owns builds before any account exists. Supabase anonymous users could model it, but every guest would become an `auth.users` row and the browser would hold a Supabase JWT.
3. Passkeys are first-class in Stage 1. SimpleWebAuthn and arctic are small, audited, dependency-light libraries that do the cryptography. Our code only stores challenges, credentials and sessions.

## Decision

### Principals
- **Guest device.** Every browser gets `dm_device`: 192 random bits, HttpOnly, SameSite=Lax, Secure in production, 1 year. The server stores only `sha256("dm_device." + value)`. A build created without an account carries `builds.device_hash`.
- **User.** `users` holds the lowercased unique email, `email_verified_at`, display name, optional unique creator `handle`, `roles text[]` and onboarding preferences.
- **Session.** `dm_session` holds a random 256-bit secret (`dms_…`). `user_sessions.secret_hash = sha256(secret)`. Sessions last 30 days and slide: the expiry is refreshed at most once a day (and `last_seen_at` at most once a minute). Sign-out revokes the row. The session row also records the device it was created on.

### Sign-in methods (all end in one `completeSignIn` transaction)
- **Email code.**
  - 6 digits, valid 10 minutes, one use, 5 wrong tries per code.
  - Stored as `HMAC-SHA256(AUTH_SECRET, "<challengeId>.<code>")`.
  - Rate limits: 5 codes per email per hour (durable, counted in `auth_challenges`) and 10 per IP per 10 minutes (in memory, like the other R2 limits).
  - Sent through the notify module (Resend). Outside production with no `RESEND_API_KEY`, the API also returns `devCode`. In production without Resend, email sign-in answers 503.
- **Passkeys (SimpleWebAuthn v13).**
  - The relying party is the `APP_URL` host. The origin is the `APP_URL` origin.
  - Registration needs a session. Credentials are discoverable (resident key required) with user verification required, so login is usernameless.
  - Every challenge is a one-shot `auth_challenges` row (5 minutes), consumed before verification.
  - The returned `userHandle` must match the credential's user. The signature counter is stored.
- **Google / Apple (arctic v3).**
  - Each provider is enabled only when its env is complete.
  - State plus PKCE (Google) or a nonce (Apple) in short-lived HttpOnly cookies scoped to `/api/auth/oauth`. Apple's cookies are SameSite=None because Apple posts the callback (`form_post`).
  - The ID token comes straight from the token endpoint over TLS, so its signature check is optional (OIDC Core 3.1.3.7). We still validate `iss`, `aud`, `exp` and `nonce`, and accept only `email_verified` emails.
  - An existing `(provider, subject)` link wins over the email, so a changed provider email never forks the account.

### On every sign-in
1. **Roles are recomputed.**
   - `buyer` always.
   - `creator` is kept (self-service via `PATCH /api/me`).
   - `ops` and `admin` exactly when the email is in `ADMIN_EMAILS`.
   - `shop` exactly when the email is an ACTIVE shop's `contact_email`. This is the only shop-to-email link today; shop memberships replace it later.
2. **Guest state is claimed.**
   - This device's builds with no owner.
   - Orders whose `buyer_email` equals the verified email and that have no `buyer_user_id`.
   - Legacy builds (no owner, no device) behind those orders.
   - The counts come back in `SignInResponse.claimed`.
3. **Guest onboarding preferences** (`device_preferences`) are copied to the account when it has none.
4. **Events** `user.created`, `user.signed_in` and `build.claimed` are written to the outbox in the same transaction.

### Build ownership (`assertCanEditBuild`)
| Build | Who may change it |
|---|---|
| `owner_user_id` set | that signed-in user, or an `ops`/`admin` user |
| else `device_hash` set | the same device; a signed-in user who has a session created on that device; `ops`/`admin` |
| neither (R1 legacy) | anyone holding the unguessable id (ADR-0008, unchanged) |

- **Guarded routes:**
  - answers, approve, CAD generation;
  - sourcing request and supplier-offer selection;
  - part upload and analyze;
  - reorder.
- **Not guarded:** remix and clone only read the source, so anyone with the id may fork it. The fork belongs to the forker.
- Every guarded route also rejects cross-origin requests (`Origin` must be the app).
- **Stamping:** builds created by upload, Make AI, remix and clone carry the signed-in user (if any) and the device.
- **Checkout:** records `orders.buyer_user_id` when the buyer is signed in.

### Ops
`requireAdmin` accepts the ADMIN_TOKEN bearer (unchanged) or a signed-in `ops`/`admin` session (same-origin only). A wrong bearer never falls back to the cookie. `CRON_SECRET` still opens only the two scheduler routes. Both guards are async now, and a test fails on any un-awaited call.

## Consequences
- **No third-party auth runtime or JWTs.** Revocation is immediate (delete or revoke the session row). Everything is testable against the throwaway Postgres databases the suite already uses.
- **We own the security-sensitive code paths:** challenge one-shot rules, rate limits, cookie flags and claim logic. They are covered by `tests/accounts/*` and the e2e journey (`tests/e2e/accounts-journey.spec.ts`, real WebAuthn through Chromium's virtual authenticator).
- **Email delivery is now on the sign-in path:** production needs `RESEND_API_KEY` and `AUTH_SECRET`.
- **Rate limits per IP are per instance.** They move to a shared store with the other R2 limits.
- **Supabase stays a migration option.** Users, sessions, passkeys and OIDC links are ordinary tables keyed by our ids:
  - users can be bulk-imported into Supabase Auth, keeping `users.id` in user metadata;
  - passkeys would have to be re-registered (WebAuthn credentials are bound to the relying party, not the vendor);
  - `owner_user_id` / `buyer_user_id` remain the keys for row-level security if we adopt it.
