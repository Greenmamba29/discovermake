# ADR-0002 · Domain event model

- **Status:** Accepted (draft for G2 review)
- **Date:** 2026-10-06

## Decision
Every meaningful state transition emits a domain event in one envelope:

```ts
type DomainEvent = {
  event_id: string;          // uuid v7
  event_type: string;        // e.g. "quote.supplier_confirmed"
  build_id: string | null;
  actor_id: string;          // user, agent, shop, accio-bridge, system
  timestamp: string;         // ISO-8601
  payload: unknown;          // zod schema per event_type in packages/contracts
  correlation_id: string;    // one customer journey / workflow run
  causation_id: string | null; // event that caused this one
  schema_version: number;
};
```

- **Transactional outbox.** The event row is written in the same Postgres transaction as the state change. A relay then publishes it, starting with Postgres LISTEN/NOTIFY and moving to NATS or Kafka at scale.
- Consumers are idempotent and keyed by `event_id`.
- The vocabulary is the union of spec §19 and scorecard §23. Where names differ, the scorecard's sourcing and quote-trust names win: `sourcing.offer_received`, `quote.supplier_confirmed`, `quote.binding`.
- Live Build Protocol events (workflow 06) use their own envelope on LiveKit data tracks. Commerce-affecting live events are mirrored into the domain log.

## Consequences
- The UI feeds directly from events: activity timelines, Uber-style tracking, production stories and clip triggers.
- Event replay tests can rebuild Build and Order state (workflow 12).
