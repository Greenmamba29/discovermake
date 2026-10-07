# ADR-0006 · Move the system of record from Firestore to Postgres (Supabase)

- **Status:** Proposed (needs G2 approval)
- **Date:** 2026-10-06

## Context
The current app uses Firebase Auth and Firestore. The Build Graph (ADR-0001), the double-entry ledger, quotes with snapshots, row-level permissions and reporting all need relational integrity and transactions. Both the V1 spec and the scorecard name Postgres/Supabase.

## Decision
- **Supabase** (Postgres, Auth, Storage, Realtime) becomes the system of record. Neon plus a separate auth provider is the fallback if Supabase limits bite.
- Migrate in steps:
  1. Stand up the schema and migrations (`database/`).
  2. Map Firebase UIDs to new users in `identities`, keeping Firebase sign-in working during the transition.
  3. Export `users`, `purchases`, `reviews` and `projects` once.
  4. Dual-read for one release, then cut over.
- Template-marketplace-only collections (`gigs`, `bounties`, `blueprints`, `workflows`) are archived unless the G0 brand decision keeps that product.
- Row-level security on `org_id` / `owner_id`. Service roles only in server code.

## Consequences
Server-side auth checks replace today's client-only guards. The Stripe webhook moves off the client SDK, which closes audit finding #6.
