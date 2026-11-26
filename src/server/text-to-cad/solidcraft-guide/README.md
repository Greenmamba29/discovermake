# Make AI "Make it in 3D" with SolidCraft: model-writing guide

The instructions Make AI follows when it writes a SolidCraft model script (`../solidcraft-script.ts`
reads them at runtime when `TEXT_TO_CAD_ENGINE=solidcraft`).

| File | Source |
|---|---|
| `PREAMBLE.md` | DiscoverMake. The script format the worker builds (`{"commands": [...]}` for `solidcraft-cli run`), the allow-list it enforces (`services/cad-worker/cad_worker/solidcraft/gate.py`), parameters the buyer edits, printability. It is read first and wins where the upstream docs describe the MCP workflow we do not run (`batch`, `measure`, `screenshot`, `set_parameter`, `export`). |
| `SKILL.md` | `skills/solidcraft-modeling/SKILL.md` |
| `reference.md` | `skills/solidcraft-modeling/reference.md` |
| `LICENSE-MIT` | `LICENSE-MIT` (SolidCraft is MIT OR Apache-2.0, at the user's option; we use MIT) |

Upstream: [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft), release **v0.48.1**,
commit **e5bc928**, the same release the worker pins (`services/cad-worker/Dockerfile`). The two
upstream files are copied verbatim. When the pin changes, copy them from that release and update this
table and `SOLIDCRAFT_GUIDE_VERSION` in `../guide.ts`.

Nothing from SolidCraft's brand-licensed interface (`crates/ui-kit`, `crates/look`, `crates/theme`,
the name, logo and icons; `LICENSE-BRAND`) is used anywhere in DiscoverMake. The engine is named
only to describe what builds the model.
