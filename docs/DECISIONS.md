# Stack decisions (2026-10-24)

Each pick says what we use and why. All code in this repo is our own. Items marked **(proposed)** wait on a final OK.

## Picks

| Part | Pick | Licence | Why |
|---|---|---|---|
| Editor | **Our own**: React 19 + React Three Fiber + drei for 3D, an interactive SVG plan for 2D, Zustand for UI state, all on `packages/core` and `packages/three` | MIT | Full control over accuracy features (± on every dimension, evidence), and one edit path shared by people and agents |
| Phone capture | **Our own iPhone app** (Swift): RoomPlan layout, LiDAR depth and mesh, posed photos and full-resolution stills in one AR session; tape-measure checks; a grey/colour card photo | MIT | Records everything the accuracy pipeline needs in one go |
| Capture format | **Our own** bundle format (`fullscale-capture/1`): a manifest, RoomPlan JSON per room, mesh, photos with camera poses and intrinsics, depth with confidence, tape checks | MIT | Plain files we control and can version |
| Devices | **Every phone, in tiers** (decided 2026-10-24). **Tier 1**, LiDAR iPhones/iPads: RoomPlan + LiDAR + photos, about ±1–2 cm. **Tier 2**, iPhones without LiDAR (11 and newer), in the **same Swift app** in camera-only mode: AR tracking, full-resolution stills, floor/wall planes, corner taps and tape checks; on the computer, COLMAP (BSD) refines camera positions and a permissively licensed model (MapAnything, Apache weights) adds dense geometry; about ±1–3 % from tracking alone, ±1–3 cm with 2–3 tape checks per room. **Tier 3**, Android with ARCore: a native Kotlin app recording the same, plus ARCore raw depth where supported; about ±2–4 cm with tape checks. **Tier 4**: a web upload page for any camera's photos or video, scaled by a tape measurement or a printed A4 sheet; or typing in tape/laser measurements by hand. All non-LiDAR figures are estimates until we measure them against a laser | Swift / Kotlin / web | Everyone can capture their home; each dimension's ± value honestly shows how good its tier is. iPhone Safari has no WebXR, so a web page can't replace the apps |
| Scan → structure | RoomPlan gives walls/openings and what they are; then fit planes to the LiDAR mesh with Open3D (RANSAC + least squares) to correct positions; join rooms through a shared AR session, else doorway matching + ICP | Open3D: MIT | RoomPlan alone is about ±5 cm per wall; plane fitting should give about ±1–2 cm (an estimate we will measure) |
| Accuracy | Every dimension stores source, ± value, method and evidence; 2–5 tape checks per room; an accuracy report on held-out checks | MIT | We prove accuracy instead of claiming it |
| Colours | White balance locked per room, exposure correction, grey card, the `colour` library; match to a paint colour (ΔE 2–5 with a card, "approximate" without) | BSD-3 | Real paint colours, not camera guesses |
| Photo-real view | Our converter (ARKit poses + LiDAR seed points) → **msplat** (Metal, on the Mac) → SOG → **Spark** in Three.js, as its own layer | Apache / MIT | Photo-real "before" view; never used for dimensions |
| Floor plan import | Exact lines from vector PDFs; a vision model proposes walls from images; scale from one known dimension, checked against a second | MIT | Plans arrive as PDFs and photos |
| Agent connection | MCP SDK v2 (`@modelcontextprotocol/server` 2.4.0, spec 2026-07-28); one studio server owns the home and serves `/mcp` plus a stdio shim | MIT | One edit path for people and agents; dimension-safe tools, not arbitrary code |
| Agent's eyes | 2D plan as SVG → PNG with resvg (**done**); 3D views via Playwright Chromium; render from a capture photo's camera beside the photo | MIT / Apache | The agent checks its own work visually |
| Blender **(proposed roles)** | Blender 5.2, run as a separate program: photo-real stills (Cycles on Metal) from GLB + scene JSON; our own add-on opens the home as named objects in metres with a live two-way link | GPL add-on kept in its own folder | Both Three.js and Blender are required; the home file stays the one source of truth |
| Assets | CC0 only in the repo, plus procedural furniture; an `ASSETS.json` ledger checked in CI | CC0 | Safe to redistribute |
| Your own models | People put their own `.glb`/`.gltf` files (e.g. IKEA downloads) in `data/models/` (git-ignored). Items store only the path, marked `local-only`, with the size typed from the product page (`source: maker`); the model is fitted to that size, with a warning if its shape doesn't match | owner's terms | Real products at real sizes without the repo ever containing them |
| Python | Python 3.12 via `uv` (system 3.9 is too old for Open3D and msplat) | – | – |

## Avoid
- **Non-commercial licences** (models, datasets or code): they would break the MIT promise that anyone can use this for anything.
- **AGPL and GPL code inside the MIT core.** GPL tools may run only as separate programs.
- **Code with no licence.**
- **Third-party assets in the repo** unless CC0, including shop models and paint-brand colour lists.

## Already decided in code
- **Undo is per actor, using element-level patches.** Undoing the person's edit never wipes the agent's later edits, and a conflicting undo is refused.
- **Units and axes:** metres, +Y up, plan points `[x, z]`, rotations in degrees counter-clockwise seen from above.
- **Scanned walls keep their room-side face exact** (`line: left/right`), even when the wall thickness is a guess.
- **Your own models never change measurements.** The item's `size` is the truth; the model is fitted to it (`uniform` fits inside the box by default). A missing file falls back to the catalogue shape at the same size. Exports must replace `local-only` models with the catalogue shape.
