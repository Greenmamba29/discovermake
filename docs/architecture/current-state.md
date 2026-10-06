# Current state (audit, 2026-10-06)

Spec Phase 0 output (§25). This document inventories what exists across the three DiscoverMake repositories, so the physical-product build reuses what works and does not carry forward what is risky.

## Headline

**None of the three repos contains manufacturing, CAD, quoting or 3D code today.** The `discovermake` app is a **Make.com automation-template marketplace**: "DiscoverMake" currently means *discover Make.com templates*. It also has a freelancer "Maker" gig platform. The V1 spec's assumption of an MVP with saved designs, manufacturing briefs and quote-readiness does not match these repos. That MVP may live somewhere else, such as a Lovable project. If it does, add it to this audit before G1.

The physical-product DiscoverMake is therefore a **pivot built on a reusable app shell**, not an extension of existing manufacturing features.

## Repositories

| Repo | What it is | Stack | Status |
|---|---|---|---|
| `Greenmamba29/discovermake` | Make.com template marketplace plus Maker gigs, bounties, onboarding, admin | Next.js ^16.1.6, React 19, TS, Tailwind, Firebase (Auth + Firestore), Stripe (Checkout, webhook, Connect), Vercel AI SDK + Gemini, framer-motion, reactflow, recharts, Playwright | Most complete. `EPIC_V3.md` says 32/34 pages ran on mock data at the time; lib files now back several hubs |
| `Greenmamba29/discovermake-2.0` | An earlier or subset snapshot of the same marketplace (despite the name) | Next.js 15.1.2, same family of deps | Two commits (Mar 2026). **Contains a committed secret** (see below) |
| `Greenmamba29/jobsdiscovermake` | A fork of Karpathy's US Job Market Visualizer (BLS occupations, LLM "AI exposure" scores, treemap) | Python (uv), Playwright, BeautifulSoup, OpenRouter | Unrelated to the product except by name |

## `discovermake` inventory

**Routes:**
- `/` landing ("Aura & Iron" design system)
- `/login`, `/register`
- `/onboarding` (6-step branched role onboarding; ID upload simulated)
- `/dashboard/*` (client, maker, developer)
- `/architect`
- `/marketplace` + bounty flow
- `/templates/*`
- `/maker/*` (dashboard, earnings, publish wizard)
- `/admin/*` (apex, approval, revenue)
- `/matching`, `/tracker`, `/checkout`, `/success`, `/pricing`, `/bundles`, `/blog`, `/referrals`, `/share`, `/creator/store`, `/connect/[...slug]`

**APIs:**
- `chat`: Gemini streaming with filename-keyword RAG
- `blueprints/generate`: Gemini JSON blueprint, the closest thing to a quote
- `checkout`: Stripe Checkout
- `webhooks/stripe`: signature-verified
- `payouts/connect`: Stripe Connect
- `download`
- `templates/*`
- `webhooks/make-sync`
- Simulated: `marketplace/unlock`, `verify`, `matching`

**Data:**
- Firestore collections: `users`, `projects`, `gigs`, `bounties`, `workflows`, `milestones`, `purchases`, `reviews`, `blueprints`, `audit_logs`, `system`
- Templates read from a gitignored `templates-db/`. The 7,947 committed JSON files in `src/data/templates_clean/` are unused.

**Other:**
- **Auth:** Firebase Auth, client-side guard only (`protected-route.tsx`). No server-side session checks.
- **Uploads:** none real.
- **3D:** none. Animation is framer-motion, plus flubber SVG morphs and reactflow graphs.

## Reuse vs. replace

| Keep / adapt | Becomes |
|---|---|
| Next.js app shell, Tailwind, `src/components/ui`, Aura & Iron tokens | `apps/web` and `packages/design-system` (restyled to the V1 visual system) |
| `/onboarding` branched wizard | 4-step onboarding (workflow 10) |
| Stripe Checkout + verified webhook + Connect payouts | Commerce + creator/shop payouts (workflows 04, 08) |
| `/maker/publish` wizard, `/maker/earnings` | Creator Studio publishing and revenue |
| `/admin` shell, audit log | Ops console, sourcing desk, shop verification |
| reactflow `visualizer.tsx` | Build Graph **Graph View** |
| AI SDK + Gemini routes | Make AI transport (multi-provider) |
| Playwright | E2E suite |

| Replace / retire (pending the G0 brand decision) | Why |
|---|---|
| Template catalog, `templates-db`, Make.com scraping scripts, `connect/[...slug]` SEO pages | Different product |
| Bounties / gigs / matching | Different product; the Shop network replaces "Makers" |
| `webhooks/make-sync` | Insecure, and it cannot run on Vercel |
| Firestore as the system of record | Build Graph needs relational node/edge tables (ADR-0006) |

## Security findings (act now; see workflow 11)

1. **`discovermake-2.0/make-creds.json` is committed.** It holds a Make.com browser session (`Cookie`, `x-xsrf-token`, `User-Agent`). Treat it as exposed: log the session out, remove the file, purge it from history.
2. `discovermake/EPIC_V3.md` notes that a **Stripe `sk_live_` key** was used in development (stored locally, not in git). Rotate it.
3. `webhooks/make-sync` is unauthenticated, runs `exec("bun …")`, and POSTs to a caller-supplied URL.
4. `api/download` uses the UID as an access token.
5. 2.0: `create-payment-intent` trusts a client price; `/admin` has no guard.
6. The Stripe webhook writes through the Firestore client SDK.

## Deployment

Vercel is implied (there is no `vercel.json`). `netlify-cli` and `firebase-tools` are dev dependencies without config. Reading gitignored files at runtime and using `exec("bun")` will fail on Vercel.

## Open questions (block G1)

1. **Where is the deployed MVP?** The scorecard describes a deployed DiscoverMake MVP with product discovery, saved designs, creation inputs, persistent projects/uploads, manufacturing-brief exports and quote-readiness tracking. It scores that MVP 28/100. On 2026-10-06 none of that was found in:
   - `discovermake`
   - `discovermake-2.0`
   - `jobsdiscovermake`
   - any of the three connected Lovable workspaces (searched for "discover", "discovermake", "manufacturing" and "make")

   Link that codebase so Phase 0 can map its entities into the canonical Build schema instead of rebuilding them.
2. **Brand:** retire, spin off, or keep the Make.com template marketplace that currently uses the DiscoverMake name.
3. **Accio Work workspace:** who owns the Accio Work account that will run the procurement agent group, and on which plan?
