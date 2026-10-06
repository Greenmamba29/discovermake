# 01 · Discover + Make intake

**Question answered:** *What do you want to make?* Every input becomes one persistent **Build**. That includes text, voice, a photo, a sketch, a product URL, a CAD file, a broken object, or "Make This" tapped on a livestream.

Spec reference: §7 (MAKE), §8 (Build Workspace), §15 (Materials Engineer), §16 (Reconstruction).

## Entry points

| Entry | Example | Lands as |
|---|---|---|
| Describe | "A weatherproof enclosure for a Raspberry Pi with a solar battery" | `intent=create` |
| Upload CAD | `bracket.step`, `panel.dxf` | `intent=manufacture` (skips straight to the quote engine, workflow 02) |
| Upload image or sketch | A napkin sketch of a shelf | `intent=create`, with image as a reference |
| Reconstruct | A photo of a broken knob plus a caliper reading | `intent=reconstruct` (R6) |
| Product URL | A link to an out-of-stock lamp | `intent=modify` or `intent=reconstruct` |
| Make This (live) | Tapped during a stream | `intent=clone` of an existing Build Graph |
| Remix | "30% larger and orange" | `intent=remix` with `DERIVED_FROM` edge |

## Pipeline

```
INPUT
 → Intent normalization          (Make AI router: which intent, which specialists)
 → Requirements                  (Requirements Agent → Requirement[] with source + confidence)
 → Unknown detection             (critical dimensions, loads, environment → NEEDS_INPUT questions)
 → Product decomposition         (Assembly / Part tree)
 → Initial Build Graph           (Postgres nodes + edges, ADR-0001)
 → Material recommendation       (Materials Engineer, structured output)
 → CAD / geometry                (CAD worker: CadQuery → STEP, DXF flat patterns, GLB preview)
 → Process selection             (laser / bend / CNC / print / wood / finish)
 → Makeability                   (DFM rules from workflow 02 + process fit)
 → Preliminary quote             (quote engine, range + confidence)
 → BUILD WORKSPACE
```

Each step emits a domain event (ADR-0002): `build.created` → `requirements.generated` → `design.generated` → `material.recommended` → `makeability.completed` → `quote.preliminary`.

## Rules

1. **Never silently guess manufacturing-critical dimensions.** Ask instead, as a `NEEDS_INPUT` question card with sensible defaults the user taps to confirm.
2. **AI output is structured, never free text, on the critical path.** Every agent returns a zod-validated object such as `CreationIntent`, `Requirement[]` or `MaterialRecommendation`. Chat is a view of the structure.
3. **One Make AI.** Users see a single assistant. Internally it routes to these specialists:
   - Requirements
   - Materials
   - CAD
   - Makeability
   - Cost
   - Sourcing
4. **Versioning.** Every accepted change creates a `DesignVersion`. Nothing overwrites a version.

## Agents and tools (V1)

| Agent | Input | Output | Tools |
|---|---|---|---|
| Requirements | Raw input + attachments | `CreationIntent`, `Requirement[]`, `unknowns[]` | Vision model for images |
| Materials Engineer | Requirements, geometry, process | Recommended material, alternatives, tradeoffs, cost and lead-time effect, confidence (spec §15) | Materials catalog (Postgres), supplier price feed |
| CAD | Requirements + decomposition | CadQuery script → STEP/DXF/GLB | Sandboxed Python worker (`services/cad-worker`) |
| Makeability | Geometry + process | Score 0–100, violations, fixes | DFM rule engine (workflow 02) |
| Cost | Geometry + material + qty | Price range + drivers | Quote engine |
| Sourcing | BOM | Offers + Promise | Sourcing provider interface (workflow 03) |

**Model choice.** The existing repo uses Gemini through the Vercel AI SDK. Keep the AI SDK as the abstraction so models can be swapped per agent. For the CAD agent, run evals across providers, scored on *geometry that compiles and passes DFM*, not on text quality.

## Acceptance test (spec §7.10)

Input: *"Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery."*
The system must persist all eleven of these:
1. structured requirements
2. missing-info list
3. part decomposition
4. materials
5. initial CAD
6. preliminary BOM
7. process recommendation
8. Makeability score
9. price range
10. production time
11. a persistent Build

## UI (see workflow 10)

- **Hero:** one input bar, *"What do you want to make?"*, modeled on Uber's "Where to?".
- **Input actions** below the bar: Describe · Upload Image · Upload CAD · Reconstruct · Build From Scratch.
- **Result:** an object-first concept card with the requirements checklist, material swatches, a Makeability ring, a price range, and **Continue to Build**.

## Reuse from the current repo

- `src/app/api/blueprints/generate`: Gemini JSON generation. Reuse the pattern and replace the schema.
- `src/app/api/chat`: AI SDK streaming. This becomes the Make AI panel transport.
- `src/components/visualizer.tsx` (reactflow) becomes the Build Graph **Graph View** (spec §8.4).
