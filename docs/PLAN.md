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

### Phase 1: core and agent loop (done 2026-10-24)
- [x] **Home document schema**: metres, per-dimension source and uncertainty, Zod validation.
- [x] **Geometry**, **measurements** (areas, paintable wall area, door fit, clearances), **validation**, **edit commands**, **batch operations** and **per-actor undo**.
- [x] **Placement helpers** ("against this wall, facing the room") and a **2D plan SVG → PNG** for the agent's eyes.
- [x] **Three.js scene builder**: walls with real holes, corner joins, furniture at exact sizes.
- [x] **A sample flat** built only through edit commands.
- [x] **Your own models** (e.g. IKEA downloads) in git-ignored `data/models/`: items store a path, the model is fitted to the item's true size, with a warning if its shape doesn't match.
- [x] **Core rebuilt for accuracy and safety**: format `fullscale/1` with migrations; a source per field; ids never reused; coded errors; field-level undo per person or agent; strict inputs; mitred corners; unit-aware lengths.
- [x] **Walls as a network**: walls join where they touch (also at a face), rooms are found from the walls and follow them through edits, loose ends are found and can be joined; drawing a wall snaps, splits the walls it meets and skips stretches already built; split, merge, move whole walls.
- [x] **"Will it fit?" with evidence**: footprint against walls, furniture, door swings and the room; says what was not checked; suggests the nearest spot that works. Measuring with ±.
- [x] **Plan pictures**: lay a floor plan picture under a level and scale it from known lengths (refused if they disagree by over 2%).
- [x] **Studio server**: one writer owns the home; WebSocket for the editor and Blender with numbered patches; HTTP for the home, its plan and its 3D file; the user's models served to this computer only; token, Host and Origin checks.
- [x] **MCP tools** (40): look (overview, level, elements, find, measure, check fit, fits through, problems, plan picture, 3D view, photo-real render), build (walls, rooms, openings, split/merge/join), furnish (items, paint, materials, your own models), manage (sources, remove, raw edits, undo/redo, clear, highlight), plan pictures and phone scans. A stdio bridge (`fullscale mcp`) for agent apps that start local programs.
- [x] **GLB export** with element ids, from the same scene the editor draws; the user's own models are never in it.

### Phase 2: our editor (first version done 2026-10-24)
- [x] Vite + React 19 + React Three Fiber + an interactive SVG plan, on `packages/core` and `packages/three`.
- [x] Draw walls with snapping (corners, middles, crossings, grid, angles) and typed lengths; rooms by dragging (corners snap to wall faces); doors and windows on walls; furniture from the catalogue, standing against walls; select, drag, nudge, turn, delete; click a dimension and type a length; paint; undo and redo.
- [x] Live with the studio: agents' edits appear as they happen; agents can point things out; the editor draws 3D pictures for agents.
- [x] Browser tests that drive the real editor against a real studio.
- [ ] Floor plan import in the editor: show the scaled plan picture under the plan, and trace over it.
- [ ] Touch: pinch and two-finger pan on iPad.
- [ ] Inside-dimension chains and opening dimensions on the plan.

### Phase 3: your existing home from a scan (started)
- [x] The `fullscale-capture/1` format (`docs/capture-format.md`) and an importer: scanned rooms become walls (room-side face exact, thickness a marked guess unless both sides were scanned), doors, windows, furniture and rooms, each with a scanned source and ±; tape checks compared and offered as fixes. Tested on synthetic scans.
- [x] **Room builder** (`room-builder/`, Python 3.12, uv + Open3D, first version 2026-10-26): every depth frame merged into one surface, cut to the scanned rooms, coloured from the photos (visibility-checked, best views first, exposure evened out); written as `built/room.glb` with a report. The editor's 3D view shows it (**Scan** switch), placed by the capture's `toHome`. Tested on made-up rooms against the true shape and colours; run on the first real scans.
- [x] Several scans of one room (2026-10-26): lined up with the room on import (relocalised, or by walls, doors and windows), checked against the model, photos used together; the room builder builds from all of them (`--with`). The app asks for detail photos (close-ups of prints, pictures and screens) and says what an extra scan is for.
- [x] Real pictures from the photos (2026-10-26): `view_photo` and `texture_from_photo`; materials with pictures in the editor and in renders; door leaves and panels, window panes; rounded, more lifelike catalogue shapes (bed with pillows, ergonomic chair, slim monitors, laptops, sofas); screens that switch on; the person's own models used in renders.
- [x] Designs (2026-10-26): copies of the real home to redesign, switched in the editor and by agents (`new_design`, `open_design`, `list_designs`, `compare_designs`, `delete_design`). Next: carry later fixes of the real home into designs.
- [ ] Room builder, next: flat walls, floor and ceiling at the scanned positions (keeping their colours); furniture and objects cut out as separate, movable pieces; colour at photo resolution (textures) instead of per point; a lighter file for big homes.
- [ ] Fit LiDAR planes to tighten the imported walls, floor and ceiling; find openings; join rooms.
- [ ] Accuracy report across held-out tape checks.
- [ ] Grey-card calibration of the photo colours (the room builder already colours from photos, with white balance locked per room).
- [ ] Matched-camera comparison as a tool: render the model from a photo's camera next to the photo (done by hand for the first replica, 2026-10-26; needs a `compare_with_photo` agent tool).
- [ ] Replica building (started 2026-10-26): detailed catalogue shapes (office chair, desk with drawers, monitor, laptop, wall AC, clothes rail, picture frame); door and window materials (leaf, frame, tinted glass); niches (alcoves with built-in shelves); doors shown shut or open; every material says what it's made of, and Blender renders give each kind a real surface (tiles with grout at their size, wood grain, fabric weave and sheen, plaster, metal, transmissive glass) with softened edges; each render saves its Blender file. Real lights (2026-10-26): bulbs, tube lights, ceiling and hanging lights, lamps and a ceiling fan in the catalogue, each light with its colour and brightness, lighting renders by `day`, `evening` or `night` with the sun through the windows and phone-like exposure. Next: agent tools to see a capture's photos and the objects found in it; textures cut from photos (bedding prints, posters, screens); proper 3D models for furniture (CC0, or scanned with the phone); soft, draped fabrics; items that rest on or in others without counting as overlaps (things on shelves, a blanket on a bed).

### Phase 4: capture on every phone (started)
- [x] **iPhone, CaptureKit** (Swift package, tested on the Mac): the format, frame and photo selection, still rules, tracking and budget rules, tape checks (same cases as the studio), depth and mesh encoding, the crash-safe bundle writer and checker.
- [x] **iPhone app layer** (builds in Xcode, Swift 6): one ARSession with RoomPlan, depth and mesh; photos with camera settings; full-resolution stills; white balance locked per room; grey-card photos; tracking advice; pose and event logs; tape checks; sharing.
- [ ] First real scans on an iPhone, with tape checks, to verify the app and measure its accuracy.
- [ ] Android (Tier 3): a native Kotlin app with ARCore, writing the same format and tested against the same cases.
- [ ] Any camera (Tier 4): photos plus a few tape measurements, processed on the computer; or measure by hand.
- [ ] Every result shows its tier and honest ± values.

### Phase 5: photo-real and Blender (both Three.js and Blender are required)
- [x] Blender add-on (GPL, `blender/`): connects out to the studio, opens the home as real objects, syncs furniture moves, turns, colours and deletions both ways; walls locked. Pure parts tested; the Blender-side code not yet run in Blender.
- [x] Photo-real stills: `render_photoreal` runs Blender without a window on our GLB, with presets and a dry run.
- [x] Renders run and tuned in a real Blender (5.2.3): real lights, daylight through windows, phone-like exposure (2026-10-26).
- [ ] Run the add-on's live link in a real Blender.
- [ ] Splat: our converter (poses + LiDAR seeds) → msplat (Mac) → SOG → Spark layer in the viewer.

## Out of scope for now
Accounts, cloud hosting, multi-user editing and payments.
