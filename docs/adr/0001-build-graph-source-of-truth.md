# ADR-0001 · The Build Graph is the source of truth for what a product is

- **Status:** Accepted (draft for G2 review)
- **Date:** 2026-10-06

## Context
DiscoverMake has five surfaces: Make, Build Workspace, Creator Studio, Live and My Builds. There is also an ordering flow and partner shops. If each surface keeps its own idea of "the product", remixes, live product cards and passports will drift apart.

## Decision
- One persistent **Build** per creation, with a single Build ID across all surfaces.
- The **Build Graph** is stored as Postgres node and edge tables:
  - `bg_nodes(id, build_id, type, version, status, data jsonb, confidence, source, provenance, created_by, approved_by, created_at, updated_at, supersedes)`
  - `bg_edges(id, build_id, type, from_id, to_id, data jsonb, …)`
- Node types follow spec §6.1. Edge types follow §6.2: `CONTAINS`, `MADE_OF`, `REQUIRES_PROCESS`, `MANUFACTURED_BY`, `DERIVED_FROM`, and the others listed there.
- Every meaningful change creates a `DesignVersion`. Versions are immutable once approved, and orders and quotes reference a specific version.
- Remix = fork with a `DERIVED_FROM` edge. Make This = clone. Both go through `packages/build-graph`, never through a surface's internals.
- **Do not** introduce a graph database in V1 (spec §6). Recursive CTEs cover the traversals we need.

## Consequences
- Surfaces read and write through one API. Live product cards, quotes and passports always agree on what the product is.
- Querying needs care: indexed `(build_id, type)` and JSONB GIN indexes.
- Temporal (state of work), commerce (state of payment), the Live Protocol (state of a broadcast) and the Passport (final record) stay separate, as spec §18 requires.
