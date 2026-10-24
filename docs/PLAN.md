# Plan (2026-10-24)

Stack choices are in `docs/DECISIONS.md`.

## The idea in one picture

```
 Our iPhone app (LiDAR + photos)      Floor plan image/PDF        Start from scratch
   fullscale-capture/1 bundle                 │                          │
            │                                 │                          │
            ▼                                 ▼                          ▼
   OUR ACCURACY PIPELINE ───────────►  EDITABLE HOME (walls, doors, windows, rooms, furniture)
   RoomPlan + LiDAR plane fit               ▲         edited by people (our editor: 2D + 3D)
   tape checks, ± per dimension             │         and agents (MCP tools)
   colours from photos, evidence links      │
            │                               │
            ▼                               ▼
   photo-real splat (msplat → Spark)   ·   Blender: photo-real stills + two-way link
```

**What makes this project different:** a phone scan becomes an editable home whose every dimension says how it was measured and how sure we are, and people and agents redesign it together in the browser or in Blender.

## Phases

### Phase 0: research and decisions (done 2026-10-24)
- [x] Research and `DECISIONS.md`.
- [x] Decision: our own editor, our own capture apps and our own capture format.

### Phase 1: core and agent loop (started)
- [x] **Home document schema**: metres, per-dimension source and uncertainty, Zod validation.
- [x] **Geometry**, **measurements** (areas, paintable wall area, door fit, clearances), **validation**, **edit commands**, **batch operations** and **per-actor undo**.
- [x] **Placement helpers** ("against this wall, facing the room") and a **2D plan SVG → PNG** for the agent's eyes.
- [x] **Three.js scene builder**: walls with real holes, corner joins, furniture at exact sizes.
- [x] **A sample flat** built only through edit commands.
- [x] **Your own models** (e.g. IKEA downloads) in git-ignored `data/models/`: items store a path, the model is fitted to the item's true size, with a warning if its shape doesn't match.
- [x] **Core rebuilt for accuracy and safety** (2026-10-24): format `fullscale/1` with migrations; a source per field, updated automatically on every edit; ids never reused; coded errors that say how to fix the problem; field-level undo per person or agent; strict inputs (misspelt fields are refused); mitred corners at any angle and T-junctions; unit-aware lengths ("12' 6\"", "350 cm").
- [ ] **Studio server**: owns the home, WebSocket to the browser, MCP at `/mcp` plus a stdio shim. SDK v2 is installed.
- [ ] **MCP tools**: summary, room, measure, check_fit, edit, place_item, paint, validate, render_plan, undo/redo, history, list_models / use_model.
- [ ] Server serves `data/models/` to the local browser only, and loads GLBs to record each model's `nativeSize`.
- [ ] Exports (GLB, IFC, shared files) swap `local-only` models for the catalogue shape.

### Phase 2: our editor
- [ ] Write the editor spec, then build: Vite + React 19 + React Three Fiber + an interactive SVG plan on `packages/core` + `packages/three`.
- [ ] Draw walls with snapping, typed dimensions that drive geometry, doors/windows sliding along walls, rooms, furniture drag/rotate/against-wall, paint, undo.
- [ ] Live sync with the studio server, so agent edits appear as they happen.
- [ ] Floor plan import (vector PDF lines, vision proposals from images, scale from a known dimension).

### Phase 3: your existing home from a scan
- [ ] Importer for `fullscale-capture/1` → home document. Start from a synthetic test bundle; real scans stay private.
- [ ] Python 3.12 pipeline (uv + Open3D): fit LiDAR planes to tighten walls, floor and ceiling; find openings; join rooms.
- [ ] Accuracy report: tape checks against the model, and ± values on every dimension.
- [ ] Colours from photos, with grey-card calibration.
- [ ] Matched-camera comparison: render the model from a photo's camera next to the photo.

### Phase 4: capture on every phone
- [ ] Our own iPhone app (Swift), one app for all iPhones. With LiDAR (Tier 1): RoomPlan + LiDAR depth/mesh + posed photos + full-resolution stills in one session. Without LiDAR (Tier 2): AR tracking + photos. Both: tape checks and a colour card; writes `fullscale-capture/1`.
- [ ] Android (Tier 3): a native Kotlin app with ARCore, writing the same format.
- [ ] Any camera (Tier 4): photos plus a few tape measurements, processed on the computer; or measure by hand.
- [ ] Every result shows its tier and honest ± values.
- [ ] Needs Xcode.

### Phase 5: photo-real and Blender (both Three.js and Blender are required)
- [ ] Splat: our converter (poses + LiDAR seeds) → msplat (Mac) → SOG → Spark layer in the viewer.
- [ ] Blender 5.2 headless renders from GLB + scene.json (`render_photoreal` MCP tool).
- [ ] Blender add-on (GPL, own folder): opens the home as named objects in metres, live link to the studio server, sends furniture moves, rotations and colour/material changes back as normal edits. Wall and size changes go through our edit commands so measurements stay correct. Custom models made in Blender come back as GLB into `data/models/`.
- [ ] MCP tools for the agent: `render_photoreal`, `blender_look`, and a guarded Blender script tool whose results come back as proposed edits.

## Out of scope for now
Accounts, cloud hosting, multi-user editing and payments.
