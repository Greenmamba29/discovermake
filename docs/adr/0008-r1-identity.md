# ADR-0008 · R1 identity: guest checkout, signed order links, shop console tokens, ops token

- **Status:** Accepted
- **Date:** 2026-10-06
- **Related:** ADR-0006 (Postgres/Supabase), workflow 11 (security)

## Context
The Firebase Auth stack was removed with the template marketplace. R1 needs exactly three principals: a buyer who places and tracks an order, a partner shop that works jobs in the Shop Console, and DiscoverMake ops. Workflow 10 asks for deferred signup ("instant quote before account creation"). Building full accounts, passkeys and orgs before the first real order would delay R1 without changing the order flow.

## Decision

### Buyers: guest checkout + HMAC-signed order links
- Checkout needs no account. The buyer gives an email, a name and a shipping address.
- At checkout the server generates a random 192-bit token (`dmo_…`). It stores only `orders.access_token_hash = HMAC-SHA256(ORDER_LINK_SECRET, "<orderId>.<token>")`.
- The token is shown once, in the checkout response (`orderUrl`), and sent in the confirmation email. The link is `${APP_URL}/orders/<orderId>?t=<token>`.
- `GET /api/orders/:id` accepts the token from the `x-order-token` header or the `?t=` query. The check is constant-time, and a wrong token returns 404, the same as a missing order.
- A database leak alone cannot forge links. Rotating `ORDER_LINK_SECRET` revokes every outstanding link.
- Parts and quotes are reachable by unguessable ids (100-bit random) during the guest flow. Uploaded designs are never listed or searchable.

### Shops: hashed console tokens + httpOnly session cookie
- Each shop gets one or more console tokens (`dmshop_…`, 256-bit), shown once at creation. Only `sha256(token)` is stored in `shop_access_tokens`. Tokens can expire and be revoked.
- `POST /api/shop/session {token}` exchanges a valid token for a session. The server stores `sha256(sessionSecret)` in `shop_sessions` (12 h TTL) and sets the cookie `dm_shop_session=<sessionSecret>` with `HttpOnly; Secure; SameSite=Lax; Path=/`. `DELETE /api/shop/session` revokes the session.
- Every `/api/shop/*` handler resolves the session server-side and scopes every query by `shop_id`. A shop can never read another shop's job (404).

### Ops: `ADMIN_TOKEN`
- `/api/admin/*` requires `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time. The admin API is disabled when the variable is unset.

### Secrets
- All secrets come from the environment and are never stored in git (`.env.local.example` has placeholders). Outside production, missing signing secrets fall back to clearly labelled dev constants. In production they throw (`requireSecret()`).

## Consequences
- Zero-friction checkout for the first customers. The trade-off is that order access is a bearer link: forwarding the email forwards access, as with most guest checkouts.
- No password storage and no session store beyond `shop_sessions`.
- **R2: Supabase Auth accounts** (passkeys, Google/Apple, orgs and roles: buyer, creator, shop, ops, admin). Migration path:
  - Guest orders attach to an account by verified email (`orders.buyer_email`).
  - Shop console tokens become per-user shop memberships.
  - `ADMIN_TOKEN` is replaced by an `ops` role.
  - Row-level security keyed by `owner_id` / `org_id` follows ADR-0006.
