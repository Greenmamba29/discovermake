# 09 · My Builds, Orders + Product Passport

One place for everything a person has created, remixed, ordered, commissioned, saved or manufactured. Buyer history and maker history live in the same place (spec §11).

## Routes

`/builds` (All · Created · Remixed · Ordered · Following) · `/orders` · `/orders/:orderId` · `/orders/:orderId/production` · `/passport/:passportId`

## Cards

Each card shows a thumbnail, name, Build ID, a status pill from the **universal status language**, a progress bar, and a chevron.

`DRAFT · ANALYZING · NEEDS_INPUT · READY · REVIEW · IN_PRODUCTION · LIVE · COMPLETE · FAILED · CANCELLED`

Examples: *Solar Pi Housing · IN_PRODUCTION · 74%* · *Walnut Desk Lamp · REVIEW · Waiting for approval* · *Titanium Bottle · COMPLETE · Passport available*.

## Production tracking

Never collapse tracking to "Processing / Shipped". Show each step:

```
DESIGN LOCKED → MATERIAL ORDERED → MATERIAL RECEIVED → MACHINE RESERVED → FABRICATION
→ QA → ASSEMBLY → PACKAGING → SHIPPED → DELIVERED
```

Each step comes from a domain event, with a timestamp and actor (shop, carrier or system).

## Watch My Build

If the shop has approved a camera for the cell or milestone the job is on, the card shows:

```
● PRODUCTION LIVE · Machine 04 · Housing milling · 64% · [WATCH]
```

- The stream is scoped to that job's window and cell, as a LiveKit room with a subscribe-only token.
- When there is no camera, show a time-lapse or milestone photos from the QA upload.

## Product Passport (`passport.activated` on delivery)

Contents:
- design version
- manufacturing date
- materials, with supplier lineage
- factory or shops for each leg
- QA results and measurements
- batch / lot
- original creator
- remix lineage
- assembly and repair instructions
- replacement parts (one-tap reorder of a single part)

**Trust.**
- Every passport gets a QR code on the packaging and optionally an engraved mark.
- The passport record is signed (hash of the Build Graph snapshot + QA results).
- A public verify page sits at `/passport/:id`.

The spec rules out a blockchain-only passport for V1. An anchoring service can be added later without changing the data model.

**Commercial hooks:**
- replacement parts
- "Make another"
- Remix
- resale provenance
- Show us what you made (UGC)

## Reorder, remix, repair (the Uber "Rebook" pattern)

Every completed order offers **Reorder** (same version), **Remix** (fork) and **Repair** (pick the broken part from the passport and get a quote for just that part).

## Acceptance

1. A delivered order shows a passport with every field filled from real records, not placeholders.
2. Scanning the packaging QR code opens the public verify page.
3. Replacing one part from the passport creates a quote for that part only.
