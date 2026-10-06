# 🏛️ EPIC V3: DiscoverMake — MVP Convergence Sprint

**Product Requirements Document — Harvard-Level Gap Analysis & Definition of Done Protocol**

> **Status**: ACTIVE — Sprint Begin  
> **Date**: 2026-02-10  
> **Priority**: P0 — Complete each profile hub sequentially. No advancing until DoD is met.   
> **Lesson Learned**: The V2 onboarding-to-dashboard transition bug consumed 2+ hours due to cascading fixes without verification. V3 enforces a strict DoD gate after every user story.

---

## 📋 Executive Summary

DiscoverMake has achieved high-fidelity UI convergence across all hubs under the "Aura & Iron" design system (EPIC V2). However, a comprehensive gap analysis reveals that **all hubs currently run on hardcoded mock data** — zero Firestore reads/writes exist in any dashboard, maker, or admin page. The onboarding flow is the only user-facing feature with real Firebase integration.

**V3's mandate**: Wire every hub to real data, complete each profile's full lifecycle, and enforce a Definition of Done that prevents regression.

---

## 🔍 Gap Analysis — Current State vs. MVP Requirements

### Legend
| Symbol | Meaning |
|:---:|:---|
| ✅ | Implemented and verified |
| ⚠️ | UI exists, no real data |
| ❌ | Not implemented |
| 🔌 | Needs Firestore integration |

### Hub-by-Hub Audit

| Feature | UI | Firestore | Auth-Gated | Functional | Notes |
|:---|:---:|:---:|:---:|:---:|:---|
| **Onboarding (6-step branched)** | ✅ | ✅ | ✅ | ⚠️ | Redirect to dashboard still under fix |
| **Seeker Dashboard (Architect Hub)** | ✅ | ❌ | ⚠️ | ❌ | 0 Firestore calls. All mock data |
| **Maker Dashboard (Forge Foundry)** | ✅ | ❌ | ⚠️ | ❌ | `INCOMING_GIGS` is hardcoded const |
| **Admin Apex Command** | ✅ | ❌ | ⚠️ | ❌ | Audit stream is static mock |
| **Admin Approval Queue** | ✅ | ⚠️ | ⚠️ | ⚠️ | Has mock approve/reject, partial Firestore |
| **Admin Revenue** | ✅ | ❌ | ⚠️ | ❌ | Charts are mock data |
| **Maker Earnings** | ✅ | ❌ | ⚠️ | ❌ | Financial data is hardcoded |
| **Maker Publish Wizard** | ✅ | ❌ | ⚠️ | ❌ | 3-step wizard submits to nowhere |
| **Bug Bounty Registry** | ✅ | ❌ | ❌ | ❌ | 5-page flow, all mock |
| **Bug Bounty Create** | ✅ | ❌ | ❌ | ❌ | Form submits to nowhere |
| **Bug Bounty Escrow** | ✅ | ❌ | ❌ | ❌ | Simulated credit lock |
| **Bug Bounty Status** | ✅ | ❌ | ❌ | ❌ | Static tracker |
| **Marketplace** | ✅ | ⚠️ | ❌ | ⚠️ | Template grid exists but sourcing unclear |
| **Landing Page** | ✅ | N/A | N/A | ✅ | Fully functional |
| **Auth (Login/Register)** | ✅ | ✅ | N/A | ✅ | Firebase Auth working |
| **AuthProvider** | ✅ | ✅ | N/A | ✅ | Fixed: subscribes once, ref-based path check |
| **Firestore Utilities** | ✅ | ✅ | N/A | ✅ | Offline-first with safeGetDoc + merge writes |

### Firestore Integration Score
- **Pages with real Firestore calls**: 2 / 34 (onboarding, auth)
- **Pages with only mock data**: 32 / 34
- **Overall data integration**: **5.9%**

---

## 🎯 Sprint Backlog — Sequential Execution Order

> **RULE**: Each user story must pass its DoD checklist before the next story begins. The `/verify-dod` skill runs after each completion.

---

### 🔵 US-V3-001: Seeker Hub — Architect Dashboard (P0)

> **As a** Seeker (Architect), **I want to** see my real projects, their live status, and interact with the Devie AI assistant **so that** I have full control of my build lifecycle.

**Current State**: 200-line page with hardcoded UI. No Firestore reads. No project creation flow.

#### Acceptance Criteria
- [ ] Dashboard loads user's real projects from Firestore `projects` collection
- [ ] "New Project" button creates a real Firestore document
- [ ] Live Deployment Tracker shows real project status (pending → active → complete)
- [ ] Identity verification status reads from `userData.verificationStatus`
- [ ] AI "Devie Core" input sends messages (even if mocked AI response for MVP)
- [ ] Activity feed shows real user actions from Firestore

#### Tasks
- [ ] `[BE]` Create `src/lib/projects.ts` with `createProject`, `getUserProjects`, `updateProjectStatus`
- [ ] `[FE]` Wire `/dashboard/client/page.tsx` to fetch real projects via `getUserProjects(user.uid)`
- [ ] `[FE]` Implement "New Project" modal that calls `createProject`
- [ ] `[FE]` Connect verification badge to `userData.verificationStatus`
- [ ] `[FE]` Wire Devie AI input to a message state (local for MVP, Firestore stretch)

#### Definition of Done ✅
- [ ] `npm run lint` passes with 0 errors
- [ ] Page loads with authenticated user — no console errors
- [ ] Creating a project appears in Firestore `projects` collection
- [ ] Refreshing the page shows previously created projects
- [ ] Browser test confirms all interactive elements work
- [ ] No hardcoded mock data arrays remain in the component

---

### 🟠 US-V3-002: Maker Foundry — Workshop Console (P0)

> **As a** Maker (Forge Master), **I want to** see real incoming gig offers, track my earnings, and manage my skill profile **so that** I can operate as a professional freelancer.

**Current State**: 215-line page with `INCOMING_GIGS` hardcoded const. No Firestore reads.

#### Acceptance Criteria
- [ ] Dashboard loads maker's real gig offers from Firestore `gigs` collection
- [ ] Accept/Reject gig buttons update Firestore document status
- [ ] Skill profile reads from `userData.makerProfile`
- [ ] Earnings summary reads from Firestore `transactions` or `payouts` collection
- [ ] "Forge Rating" and acceptance rate display real calculated values

#### Tasks
- [ ] `[BE]` Create `src/lib/gigs.ts` with `getGigsForMaker`, `acceptGig`, `rejectGig`, `createGig`
- [ ] `[FE]` Wire `/dashboard/maker/page.tsx` to fetch real gigs
- [ ] `[FE]` Connect GigOfferCard accept/reject to Firestore state updates
- [ ] `[FE]` Wire skill matrix to `userData.onboardingData.projectTypes`
- [ ] `[FE]` Connect `/maker/earnings/page.tsx` to real transaction data

#### Definition of Done ✅
- [ ] `npm run lint` passes with 0 errors
- [ ] Page loads with authenticated maker — no console errors
- [ ] Accepting a gig updates its status in Firestore
- [ ] Earnings page shows real (or seed) transaction records
- [ ] No hardcoded `INCOMING_GIGS` or similar mock arrays remain
- [ ] Browser test confirms all interactive elements work

---

### 🟡 US-V3-003: Bug Bounty System — 5-Page Flow (P1)

> **As a** user, **I want to** discover bounties, submit bug reports, lock escrow credits, and track resolution **so that** the platform maintains security integrity.

**Current State**: 5 pages exist (registry, create, escrow, status, detail). All use mock data. Forms submit to nowhere.

#### Acceptance Criteria
- [ ] Bounty registry loads real bounties from Firestore `bounties` collection
- [ ] Create bounty form writes to Firestore
- [ ] Escrow page simulates credit lock (writes `escrowStatus: "locked"` to bounty doc)
- [ ] Status page shows real resolution state from Firestore
- [ ] Detail page (`/bounty/[id]`) loads specific bounty by ID

#### Tasks
- [ ] `[BE]` Create `src/lib/bounties.ts` with CRUD operations
- [ ] `[FE]` Wire `/marketplace/bounty/page.tsx` to real Firestore query
- [ ] `[FE]` Wire `/marketplace/bounty/create/page.tsx` form submission
- [ ] `[FE]` Wire `/marketplace/bounty/escrow/page.tsx` to update bounty doc
- [ ] `[FE]` Wire `/marketplace/bounty/status/page.tsx` to read bounty state
- [ ] `[FE]` Wire `/marketplace/bounty/[id]/page.tsx` to `getDoc` by ID

#### Definition of Done ✅
- [ ] `npm run lint` passes with 0 errors
- [ ] Creating a bounty appears in Firestore
- [ ] Escrow lock writes status update successfully
- [ ] Full 5-page flow navigable without errors
- [ ] Browser test confirms end-to-end bounty lifecycle

---

### 🔴 US-V3-004: Apex Command — Admin Dashboard (P1)

> **As an** Admin (Apex Overseer), **I want to** see real-time platform metrics, manage approvals, and monitor security **so that** I can govern the network effectively.

**Current State**: 255-line page with static mock audit stream. Revenue page has mock chart data.

#### Acceptance Criteria
- [ ] Apex dashboard shows real user count from Firestore `users` collection
- [ ] Audit stream shows real recent events from Firestore `audit_log`
- [ ] Security matrix reads real status indicators
- [ ] Revenue page charts pull from `transactions` collection aggregations
- [ ] Approval queue loads real pending projects

#### Tasks
- [ ] `[BE]` Create `src/lib/admin.ts` with `getAuditLog`, `getPlatformStats`, `getRevenueMetrics`
- [ ] `[FE]` Wire `/admin/apex/page.tsx` to real admin data
- [ ] `[FE]` Wire `/admin/revenue/page.tsx` to real transaction aggregations
- [ ] `[FE]` Ensure `/admin/approval/page.tsx` uses real Firestore project data
- [ ] `[FE]` Add real-time listener (`onSnapshot`) for audit stream

#### Definition of Done ✅
- [ ] `npm run lint` passes with 0 errors
- [ ] Admin pages load real data (or empty states if no data exists)
- [ ] Approval actions write to Firestore
- [ ] No static mock arrays remain in admin pages
- [ ] Browser test confirms admin flow end-to-end

---

### 🟢 US-V3-005: Infrastructure & Stability Hardening (P0, Ongoing)

> **As a** developer, **I want to** have a stable, offline-resilient, error-free application **so that** users never see uncaught runtime errors.

**Current State**: Firebase offline core is fixed. AuthProvider re-sync loop is fixed. Onboarding redirect has 3s timeout fallback.

#### Acceptance Criteria
- [ ] Zero `FirebaseError` overlays in any user flow
- [ ] Onboarding → Dashboard redirect works 100% of the time (verified in browser)
- [ ] All Firestore utilities use `safeGetDoc` and `setDoc` merge pattern
- [ ] No page throws an unhandled promise rejection
- [ ] Build succeeds with `npm run build` (not just `lint`)

#### Tasks
- [ ] `[FE]` Verify onboarding redirect with browser subagent (when available)
- [ ] `[FE]` Add error boundaries to all dashboard layouts
- [ ] `[FE]` Run `npm run build` and fix any type errors
- [ ] `[QA]` Full regression test of auth → onboarding → dashboard flow

#### Definition of Done ✅
- [ ] `npm run build` succeeds with 0 errors
- [ ] `npm run lint` passes with 0 warnings
- [ ] Browser test of full user journey completes without errors
- [ ] No `FirebaseError` in console during normal usage

---

### 🟣 US-V3-006: Maker Publish Wizard & Earnings (P2)

> **As a** Maker, **I want to** publish new workflows and track my financial activity **so that** I can monetize my expertise.

#### Acceptance Criteria
- [ ] 3-step publish wizard writes workflow to Firestore `workflows` collection
- [ ] Published workflows appear in the marketplace
- [ ] Earnings page shows real payout history
- [ ] Financial ledger links to (simulated) Stripe Connect

#### Tasks
- [ ] `[BE]` Create `src/lib/workflows.ts` with `publishWorkflow`, `getMakerWorkflows`
- [ ] `[FE]` Wire `/maker/publish/page.tsx` form to Firestore
- [ ] `[FE]` Wire `/maker/earnings/page.tsx` to real or seeded data
- [ ] `[FE]` Connect marketplace to display maker-published workflows

#### Definition of Done ✅
- [ ] Publishing a workflow creates a Firestore document
- [ ] Published workflow appears in marketplace grid
- [ ] Earnings page renders without errors
- [ ] Browser test confirms end-to-end publish flow

---

## 📐 Definition of Done (DoD) Protocol — Global Standard

Every user story in this EPIC must satisfy ALL of the following before being marked complete:

| # | Gate | Command / Method |
|:---:|:---|:---|
| 1 | **Lint** | `npm run lint` → 0 errors, 0 warnings |
| 2 | **Build** | `npm run build` → 0 errors |
| 3 | **No Mock Data** | `grep -r "MOCK\|hardcoded\|dummy" <page>` → 0 results |
| 4 | **Firestore Verified** | New data appears in Firestore console or via `getDoc` |
| 5 | **Browser Test** | Navigate full flow in browser — 0 error overlays |
| 6 | **Console Clean** | Browser console has 0 uncaught errors during flow |
| 7 | **Auth-Gated** | Unauthenticated users cannot access the page |
| 8 | **Offline-Safe** | Page loads gracefully (empty state, not crash) when offline |

> **Enforcement**: The `/verify-dod` workflow skill runs automatically after each user story completion. It performs gates 1-3 programmatically and prompts for gates 4-8.

## 🔧 Tooling, Skills & MCP Requirements Matrix

> **Purpose**: Pre-determine every skill, MCP, workflow, and agent tool required for each user story. Read instructions from the referenced skill file **before starting each story**.

### Installed SDK Inventory

| Package | Version | Purpose | Used By |
|:---|:---:|:---|:---|
| `firebase` | ^12.7.0 | Auth, Firestore, Storage | All stories |
| `react-firebase-hooks` | ^5.1.1 | `useCollection`, `useDocument` hooks | US-001, 002, 003, 004 |
| `@ai-sdk/google` | ^3.0.1 | Gemini API via Vercel AI SDK | US-001 (Devie AI) |
| `@ai-sdk/react` | ^3.0.3 | `useChat` client hook | US-001 (Devie AI) |
| `@stripe/stripe-js` | ^8.6.0 | Stripe client-side | US-002, 006 (Payments) |
| `stripe` | ^20.1.0 | Stripe server-side | US-006 (Payouts) |
| `framer-motion` | ^11.15.0 | Animations, transitions | All stories |
| `sonner` | ^2.0.7 | Toast notifications | All stories |
| `lucide-react` | ^0.469.0 | Icon library | All stories |

### 🚨 Missing Dependencies (Install Before Sprint)

| Package | Install Command | Required For |
|:---|:---|:---|
| `recharts` | `npm install recharts` | US-004 (Admin Revenue charts), US-002 (Maker Earnings charts) |
| `date-fns` | `npm install date-fns` | US-003 (Bounty timestamps), US-004 (Audit log formatting) |

---

### Existing Skills — Required Per Story

| Skill | Path | Required By | Read Before |
|:---|:---|:---|:---|
| **aura-iron-design** | `.agent/skills/aura-iron-design/SKILL.md` | ALL stories | Every FE task — ensures all new components use `GlassPanel`, `IronButton`, `RetroStrata`, `StatCard` from the design system |
| **ai-orchestration** | `.agent/skills/ai-orchestration/SKILL.md` | US-001 | Wiring Devie AI input — use `AIOrchestrator.processRequest()` with tier routing |
| **google_integrations** | `.agent/skills/google_integrations.md` | US-001 | AI chat API route — use `@ai-sdk/google` with `gemini-1.5-flash` model |
| **discovermake-i18n** | `.agent/skills/discovermake-i18n/SKILL.md` | ALL stories (stretch) | Use `t()` for new user-facing strings when adding copy |

### Existing Workflows

| Workflow | Path | Trigger |
|:---|:---|:---|
| **verify-dod** | `.agent/workflows/verify-dod.md` | Run after EVERY user story completion — 8 quality gates |

---

### New Skills to Create During Sprint

#### 1. `firestore-patterns` Skill (Create during US-V3-005)

> **Path**: `.agent/skills/firestore-patterns/SKILL.md`

This skill codifies the offline-first Firestore patterns established in this sprint so every new `src/lib/*.ts` service file follows them consistently:

```markdown
- Always use `safeGetDoc()` for reads (server-first, cache fallback)
- Always use `setDoc(ref, data, { merge: true })` for writes (queues offline)
- Wrap all Firestore calls in try/catch with graceful fallback
- Export typed interfaces for every Firestore collection
- Use `onSnapshot` for real-time listeners with error callbacks
- Return `null` or `[]` on failure — never throw
```

**Create this skill** during US-V3-005 (Infrastructure) so all subsequent stories inherit the pattern.

#### 2. `hub-wiring` Skill (Create during US-V3-001)

> **Path**: `.agent/skills/hub-wiring/SKILL.md`

Step-by-step checklist for converting a mock-data hub page to a real-data hub:

```markdown
1. Identify all hardcoded const arrays in the page (e.g., `INCOMING_GIGS`)
2. Create corresponding `src/lib/<collection>.ts` service file
3. Define TypeScript interface for the Firestore document shape
4. Implement CRUD functions using firestore-patterns skill
5. Replace const arrays with `useEffect` + `useState` data fetching
6. Add loading skeleton states (use `GlassPanel` with opacity animation)
7. Add empty states for when collection has no documents
8. Add error states with retry button
9. Run /verify-dod
```

---

### Agent Tools — Required Per Story Step

| Tool | Used For | Critical Stories |
|:---|:---|:---|
| `browser_subagent` | Visual verification, screenshot evidence, DoD Gate 5 | ALL |
| `run_command` | `npm run lint`, `npm run build`, grep scans, DoD Gates 1-4 | ALL |
| `view_file` / `view_code_item` | Code audit before editing | ALL |
| `grep_search` | Find mock data, verify Firestore integration | ALL |
| `write_to_file` / `replace_file_content` | Create new lib files, modify pages | ALL |
| `generate_image` | Generate placeholder assets if needed | US-001, 002 |

### Per-Story Tooling Checklist

#### US-V3-005: Infrastructure
```
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Create: .agent/skills/firestore-patterns/SKILL.md
□ Run: npm run build (fix type errors)
□ Run: browser_subagent (onboarding → dashboard flow)
□ Run: /verify-dod
```

#### US-V3-001: Seeker Hub
```
□ Read: .agent/skills/firestore-patterns/SKILL.md
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Read: .agent/skills/ai-orchestration/SKILL.md
□ Read: .agent/skills/google_integrations.md
□ Create: src/lib/projects.ts (follows firestore-patterns)
□ Create: .agent/skills/hub-wiring/SKILL.md
□ Install: (none — all deps exist)
□ Run: /verify-dod
```

#### US-V3-002: Maker Foundry
```
□ Read: .agent/skills/firestore-patterns/SKILL.md
□ Read: .agent/skills/hub-wiring/SKILL.md
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Install: npm install recharts (for earnings charts)
□ Create: src/lib/gigs.ts (follows firestore-patterns)
□ Run: /verify-dod
```

#### US-V3-003: Bug Bounty
```
□ Read: .agent/skills/firestore-patterns/SKILL.md
□ Read: .agent/skills/hub-wiring/SKILL.md
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Install: npm install date-fns (for timestamp formatting)
□ Create: src/lib/bounties.ts (follows firestore-patterns)
□ Run: /verify-dod
```

#### US-V3-004: Apex Command
```
□ Read: .agent/skills/firestore-patterns/SKILL.md
□ Read: .agent/skills/hub-wiring/SKILL.md
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Create: src/lib/admin.ts (follows firestore-patterns)
□ Use: onSnapshot for real-time audit stream
□ Use: recharts for revenue charts
□ Run: /verify-dod
```

#### US-V3-006: Publish & Earnings
```
□ Read: .agent/skills/firestore-patterns/SKILL.md
□ Read: .agent/skills/hub-wiring/SKILL.md
□ Read: .agent/skills/aura-iron-design/SKILL.md
□ Read: .agent/skills/google_integrations.md (if AI-assisted publishing)
□ Create: src/lib/workflows.ts (follows firestore-patterns)
□ Use: Stripe SDK for payout simulation
□ Run: /verify-dod
```

---

### MCP Servers — Recommended

> No MCP servers are currently configured. The following are recommended for enhanced development velocity:

| MCP Server | Purpose | Install When | Benefit |
|:---|:---|:---|:---|
| **Firebase MCP** | Direct Firestore queries from agent context | US-V3-005 | Verify data writes without browser — DoD Gate 4 becomes automated |
| **GitHub MCP** | Issue tracking, PR creation | Post-MVP | Automated issue creation from DoD failures |
| **Stripe MCP** | Test payment flows from agent context | US-V3-006 | Verify payout simulation without Stripe dashboard |

> [!NOTE]
> MCP servers are optional enhancements. All stories can be completed without them using the browser subagent and Firestore console.

---

## 📎 Reference Documents

- [Walkthrough (Aura & Iron Sprint)](file:///Users/paco/.gemini/antigravity/brain/9690efbf-77ec-4d9f-bdcd-2e8491799e45/walkthrough.md)
- [Implementation Plan (Onboarding Fix)](file:///Users/paco/.gemini/antigravity/brain/9690efbf-77ec-4d9f-bdcd-2e8491799e45/implementation_plan.md)
- [EPIC V2 (Completed)](file:///Users/paco/.gemini/antigravity/scratch/discovermake/EPIC_V2.md)
- [Architecture Skeleton](file:///Users/paco/.gemini/antigravity/brain/9690efbf-77ec-4d9f-bdcd-2e8491799e45/architecture_skeleton.md)


---

## 📊 Sprint Velocity Targets

| Story | Estimated Effort | Priority | Depends On |
|:---|:---:|:---:|:---|
| US-V3-001 Seeker Hub | L | P0 | US-V3-005 (infra) |
| US-V3-002 Maker Foundry | L | P0 | US-V3-005 (infra) |
| US-V3-003 Bug Bounty | M | P1 | US-V3-001 |
| US-V3-004 Apex Command | M | P1 | US-V3-002 |
| US-V3-005 Infrastructure | S | P0 | None |
| US-V3-006 Publish & Earnings | M | P2 | US-V3-002 |

**Execution Order**: US-V3-005 → US-V3-001 → US-V3-002 → US-V3-003 → US-V3-004 → US-V3-006

---

*"No hub ships until its DoD is green. No story advances until the previous is verified."*

---

## 🔐 Post-MVP Security Checklist

> [!CAUTION]
> **ROTATE STRIPE LIVE KEY** immediately after MVP launch. The current `sk_live_` key was used during development and must be rotated via [Stripe Dashboard → API Keys](https://dashboard.stripe.com/apikeys). Update both `.env.local` and `mcp_config.json` with the new key.

- [ ] Rotate `STRIPE_SECRET_KEY` in `.env.local`
- [ ] Rotate `STRIPE_SECRET_KEY` in `mcp_config.json`
- [ ] Rotate `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (replace placeholder with real `pk_live_`)
- [ ] Audit all environment variables for exposed credentials
- [ ] Enable Stripe webhook signature verification
