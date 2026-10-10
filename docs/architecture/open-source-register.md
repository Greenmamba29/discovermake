# Open-source adoption register

Each repo below becomes a **service or worker behind the Build Graph**. None is merged into the web app's code. Licenses must be confirmed by the copyleft review before code is embedded or shipped. Copyleft engines run as isolated, unmodified services and are recorded in a patch ledger.

## Priority 1: V1 foundation

| Repo | Role in DiscoverMake | License (verify) | Enters | Integration shape |
|---|---|---|---|---|
| earthtojake/text-to-cad (cadgen 0.7.20) | Natural language → CAD: Make AI writes a build123d model, cadgen builds STEP/GLB/STL | MIT (verified, commit b48ff49) | **R6 (in use)** | `services/cad-worker` runs cadgen in its own venv as a sandboxed subprocess after a static gate; skill docs vendored as Make AI's guide (`src/server/text-to-cad/guide`). See `text-to-cad.md` |
| CadQuery/cadquery | Parametric, scriptable geometry | Apache-2.0 | **R2 (in use)** | `services/cad-worker` (Python): sheet panel, L-bracket, enclosure |
| FreeCAD/FreeCAD | Validation, STEP, assemblies, sheet-metal unfold | LGPL-2.1+ | R1.5–R2 | Isolated worker, unmodified |
| mrdoob/three.js | Browser 3D viewer | MIT | **R1** | Part preview, configure |
| pmndrs/react-three-fiber | React renderer for Three.js | MIT | **R1** | Configure page, Build Workspace |
| xyflow/xyflow | Build Graph visualizer | MIT | R1 (order page) / **R2 (in use)** | `@xyflow/react`: order page + Build Workspace Graph View |
| livekit/livekit | Interactive rooms, AI participants, viewers, data tracks | Apache-2.0 | R4 | Core LIVE layer |
| owncast/owncast | Creator channels, scheduled broadcasts, community chat | MIT | R4 | **Core broadcast/channel layer** (ADR-0003) |
| bluenviron/mediamtx | RTMP/RTSP/SRT/WebRTC factory and robot camera ingest | MIT | R4.5 | In front of LiveKit |
| temporalio/temporal | Long-running manufacturing and order workflows | MIT | R2 | Replaces the R1 Postgres state machine (ADR-0007) |
| openai/openai-agents-python | MAKE Agent + specialist orchestration | MIT | R2 | Python agents service |
| modelcontextprotocol/typescript-sdk (+ python-sdk) | Accio Work bridge and other agent integrations | MIT | **R2 (in use)** | `POST /api/mcp/sourcing` (ADR-0005 notes) |
| supabase/supabase | Postgres, auth, storage, realtime | Apache-2.0 | R1 (Postgres) / R2 (Auth) | System of record (ADR-0006) |
| medusajs/medusa | Cart, checkout, fulfillment primitives | MIT | R2+ | Selected modules only. R1 uses Stripe directly because R1 is quote-based, not catalog-based |
| google/or-tools | Supplier, factory, machine and route optimization | Apache-2.0 | R3 (heuristic dispatch in R1) | Routing service |
| open-policy-agent/opa | Production approval, safety, compliance, permissions | Apache-2.0 | R2 | Sidecar policy engine (Accio approval boundary, export screening) |
| meilisearch/meilisearch | Search over products, materials, makers, factories | MIT (community edition; enterprise features differ, verify) | R2 | Search service |

## Priority 2: after V1

| Repo | Role | License (verify) | Enters |
|---|---|---|---|
| qdrant/qdrant | Similar designs, parts and materials | Apache-2.0 | After V1 |
| opencv/opencv | Vision, measurement, QA photos | Apache-2.0 | R5 (QA) / R6 |
| facebookresearch/sam2 | Segment parts and products from images/video | Apache-2.0 | R6 |
| colmap/colmap | Photo/video → 3D reconstruction | BSD | R6 |
| isl-org/Open3D | Point clouds, scans, meshes | MIT | R6 |
| huggingface/lerobot | Robot policies | Apache-2.0 | Robotics phase |
| google-deepmind/mujoco | Simulation before execution | Apache-2.0 | Robotics phase |
| ros2/ros2 | Robot / machine communications | Apache-2.0 | Production phase |
| prusa3d/PrusaSlicer | 3D-print slicing | **AGPL-3.0**: isolated worker only | Additive phase |
| Klipper3d/klipper, MarlinFirmware/Marlin, grbl/grbl | Machine adapter references | **GPL-3.0**: reference / external adapters only | Machine phase |
| frappe/erpnext | Manufacturing ERP, procurement and BOM patterns | **GPL-3.0**: study and integrate via API, never core | Enterprise adapters |
| KiCad/kicad-source-mirror | PCB / electronics design | **GPL-3.0**: isolated worker | Electronics category |

## Watch list
- **Streamplace** (AT Protocol live video): not in the V1 dependency chain. It could inform a future federated DiscoverMake Media Network.

## Pipelines these compose into

```
CAD:            MAKE Agent → text-to-cad → CadQuery → STEP → FreeCAD validation → three.js / r3f → Build Workspace
Reconstruction: photo/video/scan → SAM 2 → OpenCV → COLMAP + Open3D → geometry → text-to-cad → CadQuery → human dimension confirmation
Live:           Owncast (channels) + MediaMTX (factory/robot ingest) → LiveKit (rooms, AI co-host, data) → Live Build Protocol → Build Graph / commerce / production
Sourcing:       Build Graph → SourcingRequest → DiscoverMake MCP ← Accio Work (Alibaba, RFQs, negotiation) → SupplierOffer → OR-Tools → Manufacturing Route
Transaction:    Configure → Quote → Source → Compare → Approve → Order  (Medusa modules + OR-Tools + MCP SDK)
```

## Owned by DiscoverMake (not sourced from GitHub)

Build Graph ontology · MAKE Compiler · Makeability Engine · Materials Intelligence · Universal Quote Engine · Supplier Performance Graph · Machine Capability Graph · Live Build Protocol · Build-slot commerce · Product Passport · Manufacturing-to-media recommendation graph.

## Where R1 deliberately differs

R1 (upload a DXF → binding quote → real order) needs none of the CAD-generation stack.

- DXF parsing and DFM run in TypeScript (`dxf-parser`) so the whole path deploys as one app.
- CadQuery and FreeCAD arrive with STEP and sheet-metal unfolding in R1.5/R2.
- Temporal arrives in R2 (ADR-0007).
- Medusa modules arrive only where they save effort.
