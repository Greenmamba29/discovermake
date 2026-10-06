# 10 · Front end: Mobbin-driven design plan

**Target feel:**
- Ordering as clean as **DoorDash**.
- Logistics as legible as **Uber**.
- Onboarding from the best-researched consumer apps.
- Live commerce as immediate as **Whatnot**.
- All of it in DiscoverMake's own visual system: industrial minimalism, graphite UI, the object first, one signal color (spec §3).

The **Mobbin MCP** is connected to this workspace, so reference research can be repeated and saved. Every screen design starts with a Mobbin search, a saved reference board, and a short "what we take / what we change" note. Then it goes to hi-fi.

## Process

1. **Research sprint (Phase 2, week 6).** Run the query backlog below with `search_flows` / `search_screens`. Save the boards to a Mobbin collection named `DiscoverMake V1`.
2. **Pattern extraction.** For each surface, write a one-page pattern note: layout, components, states, copy, and what we deliberately do differently.
3. **Wireframes.** Low-fi in Figma (or the Claude Design canvas) for the R1 and R2 flows.
4. **Design system.** `packages/design-system`: tokens (color, type, spacing, radius, shadow, motion, layers, breakpoints) and the shared components in spec §22.
5. **Hi-fi + prototype.** Clickable prototypes of Configure → Track and of the Live viewer.
6. **Usability tests.** Five users per flow per release. Measure time-to-first-quote and checkout completion.

## Reference board (initial Mobbin research, Oct 2026)

### DoorDash → ordering (Configure, Quote, Cart, Checkout)

| Mobbin reference | What we take | DiscoverMake translation |
|---|---|---|
| [DoorDash · Adding to cart](https://mobbin.com/flows/4c86869c-0cb7-4557-8049-e4e0fb6054c9) | Item sheet with grouped options labeled **"Required · Select 1"** / **"Optional · Select up to N"**, radio and checkbox rows with thumbnails. The sticky red CTA reads **"Make 1 required selection"** until valid, then **"Save Options"**. | Configure sheet: **Material** (Required · Select 1, swatch thumbnails), **Thickness**, **Finish**, **Hardware** (Optional · up to N), **Personalize**. The CTA counts the missing choices, then shows **Save & Get Quote · $189**. |
| [DoorDash · Placing an order](https://mobbin.com/flows/dd5c1ed4-eed8-467a-b6b1-99c6a3d3c897) | Store page with a floating cart pill ("Subway · $11.38 total · 1"). A cart sheet with a qty stepper and "recommended items" upsell. A checkout summary with every fee carrying an ⓘ tooltip. The order status sheet has a 4-stage icon progress bar. | Floating **Build cart pill**. The cart offers "Complete your build" upsells (hardware kit, spare part, powder coat). The quote breakdown has ⓘ on materials, machine time, finishing, QA, shipping and Make fee. The production status sheet has 6 icon stages. |
| [DoorDash · Placing an order (full)](https://mobbin.com/flows/54cba8e2-91c0-436b-80a4-4ae2d53760cb) | Checkout map pin with a delivery-time choice (**Standard 16–26 min / Schedule Ahead** as cards). A "You seem far from this address" warning. Ends with rating. | Shipping-method cards with **Promise dates** (Standard / Expedited / Express). Address validation warnings. After delivery, rate the build and post UGC. |

**Rules borrowed:**
- Prices visible on every option row.
- The running total is always visible.
- The upsell comes *after* the main choice, never before.
- Fees are explained up front and never shown first at the last step.

### Uber → logistics (Track, Activity, Shop contact)

| Mobbin reference | What we take | DiscoverMake translation |
|---|---|---|
| [Uber · Booking a ride](https://mobbin.com/flows/c54d8dfb-8f67-4e82-afb6-7943d8886c5b) | A single **"Where to?"** bar plus recents, a **Suggestions** tile grid, and a map with a bottom sheet ("Pickup in 3 min", driver card with rating and plate, call and message buttons). | Home: a single **"What do you want to make?"** bar plus recent builds, and a **Make anything** tile grid (Laser cut · Bend · CNC · 3D print · Wood · Reconstruct). Tracking is a bottom sheet over a map or the 3D object ("Cutting now · Ships Thu"), with a **shop card** (name, rating, machine) and Message and Watch buttons. |
| [Uber · Message driver](https://mobbin.com/flows/c447156b-3263-43fb-8801-cb44fdf3beac) | Safety banner and **quick-reply chips** ("I'm here", "Be right there"). | Shop/creator chat with quick replies ("Approve change", "Send photo", "Hold production"). Safety and off-platform payment warnings. |
| [Uber · Activity](https://mobbin.com/flows/c8c8b75b-d49a-430a-9581-3bc669f3ce74) | Upcoming vs. Past, with **Rebook** / **Reserve** on each row. | My Builds / Orders lists, with **Reorder**, **Remix** and **Repair** on each row. |

**Rules borrowed:**
- One primary status sentence, always in plain words.
- The ETA comes first.
- The human (shop) is visible with a face and a rating.
- Communication is in-app with quick replies.

### Onboarding (the best-researched patterns)

| Mobbin reference | What we take | DiscoverMake translation |
|---|---|---|
| [Blinkist · Onboarding](https://mobbin.com/flows/a9e95e3d-961b-422b-b217-d3fe6fe34e0f) | A **"Step 1 of 4"** progress bar, a goals question ("You can always update your answers"), a like/dislike content card, and a **free-trial timeline** (Today → reminder → billing). | Step 1 asks *What brings you here?* (Make something · Discover things · Sell my designs · I run a shop). The DiscoverMake Prime trial uses the same timeline screen. |
| [Pinterest · Onboarding](https://mobbin.com/flows/181f0864-8d03-4f31-9aef-99dd251b93cb) | **"Pick 5 to customize your home feed"** image grid with checkmarks, ending in "Meet your home feed". | *Pick 5 things you love to make*: an image grid of furniture, EDC, auto, home, robotics, outdoor, fashion, gifts. This seeds For You and Discover. |
| [Behance · Onboarding](https://mobbin.com/flows/f232980a-e49d-48bc-ae56-baccc5883db8) | Creative-fields grid before sign-in. Account creation is deferred. | **Deferred signup.** Users get an instant quote or Make AI concept *before* creating an account. Sign-in (passkey / Apple / Google) is asked for only at save, order, or go live. |

**DiscoverMake onboarding (4 steps, 60 seconds):**
1. **Intent:** Make · Discover · Sell · Shop. This branches the rest of onboarding, as the current `/onboarding` already does.
2. **Taste:** pick 5.
3. **First build** (the "aha" moment): a pre-filled prompt or a sample DXF produces a quote with a ring and a price in under 5 seconds.
4. **Save it:** create an account with a passkey. Optional Prime trial timeline.

Shops and creators get a longer verified track: business details, machines or channel, and Stripe Connect.

### Whatnot → Live viewer and live home

| Mobbin reference | What we take | DiscoverMake translation |
|---|---|---|
| [Whatnot · live show with bid](https://mobbin.com/screens/f7f96444-b4c5-498b-8231-8fb3045cc401) | Seller header plus viewer count. A right action rail (more, boost, clip, share, wallet, shop). Show notes. Chat over the video. A bottom **product card** with a **Custom** button and a primary **Bid** button with a countdown. | Right rail: like · ask · clip · share · cart. Bottom **NOW SHOWING** card with **Make Mine** (primary), **Remix** (the "Custom" equivalent) and **Buy**. A Build Slot counter replaces the bid timer. |
| [Whatnot · home live feed](https://mobbin.com/screens/ef2533f6-b2f7-493f-9fe6-88e09bc65569) | Category chips, a "Get started · Go live · Step 3 of 4" checklist, and live tiles with **Live · 387** badges. | Live home with channel chips (Mega Builds, Factory Floor, Drops…). Creator go-live checklist. Live tiles show viewers and the product price. |
| [Whatnot · seller profile](https://mobbin.com/screens/f0203959-3478-4ca1-af8a-e8632df0866b) | Rating, average ship time, units sold, follow, and live-notification settings. | Creator/factory channel: rating, avg lead time, builds made, quality score, Follow, notification preferences. |

## Query backlog (run during the research sprint)

| Surface | Mobbin queries |
|---|---|
| Make intake | "AI prompt composer with file attachments and suggestion chips" · "camera-first capture with object detection overlay" |
| Build Workspace (web) | "3D model viewer with properties side panel" · "version history timeline with compare" · "node graph editor with inspector" |
| Quote | "pricing tiers comparison with most popular badge" · "price breakdown with info tooltips" |
| Route | "compare vendors cards with ratings and lead time" |
| Checkout | "Shopify checkout with express pay and shipping options" · "ACH bank payment selection" |
| Tracking | "Instacart order tracking with live shopper updates" · "package tracking map timeline" |
| Creator Studio | "creator analytics dashboard revenue breakdown" · "live stream studio controls scenes" (OBS / Streamlabs / TikTok Live Studio) |
| Live | "TikTok Live shopping product pin" · "live poll overlay" |
| Passport | "digital certificate of authenticity with QR" |
| Shop Console | "driver app job offer accept decline" · "kitchen display order queue" |
| Prime | "membership benefits paywall with trial timeline" |

## Information architecture and navigation

| Mobile bottom nav (5) | Desktop top nav |
|---|---|
| Discover · Make · Live · Builds · Me | Discover · Make · Live · My Builds · Creator Studio · Account |

Reconstruct, Materials and Robotics are reached from Discover tiles and Make actions. Creator Studio and Shop Console are reached from Me. The spec's full nav list is available in the desktop overflow.

## Visual system decisions (from the concept boards)

- **Surfaces.** Warm-white editorial pages for marketing and passport. Graphite app UI (`#0c0e0d` to `#1a1d1c`) for the app surfaces.
- **One signal color**, green `#5fe08a`, for Makeability, accepted states and production activity. Red is reserved for **LIVE** only.
- **Typography.** An industrial grotesk with width axes for display (e.g. Archivo, Expanded for headings) and a mono for technical data (dimensions, IDs, prices in tables).
- **The object first.** Product imagery or a 3D view takes ≥ 40% of the viewport on product, configure and live screens. AI panels sit around the object, never over it.
- **Material swatches** are real texture photos, never flat color chips, for wood, metal and plastics.
- **Motion.**
  - Purposeful only: the configure-to-price tick, slot counters, and status-bar progress.
  - The concept page `public/concepts/transformer/` sets the tone for 3D transitions.
  - Respect `prefers-reduced-motion`.

## Front-end architecture

- Next.js App Router (already in the repo). React Server Components for catalog and SEO pages. Client components for configure, live and workspace.
- **3D:** `three` + `@react-three/fiber` + `@react-three/drei` for the object viewport, the configure preview and the live product model.
- **State:** server state with TanStack Query. Realtime via LiveKit data tracks (live) and a websocket or SSE channel for order events.
- **Forms:** `react-hook-form` + `zod` (already dependencies), sharing schemas with `contracts/`.
- **Mobile apps:** after R2, wrap with Expo (React Native) and share `packages/design-system` tokens and `contracts`. The LiveKit React Native SDK covers the live viewer and phone publishing.
- **Accessibility:** WCAG 2.2 AA. Every 3D viewport has a text equivalent: a part list with dimensions.

## Deliverables by gate

| Gate | Design deliverable |
|---|---|
| G2 | Mobbin board + pattern notes, IA, tokens v1, R1 hi-fi (upload → quote → checkout → track), onboarding |
| G3-R2 | Make intake + Build Workspace hi-fi |
| G3-R4 | Live viewer, Live home, Creator Studio show control |
| G3-R5 | Channels, replay player, clip cards |
