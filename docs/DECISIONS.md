# Stack decisions (2026-10-24)

Each pick says what we use and why. All code in this repo is our own. Items marked **(proposed)** wait on a final OK.

## Picks

| Part | Pick | Licence | Why |
|---|---|---|---|
| Editor | **Our own** (**built**): React 19 + React Three Fiber for 3D, an interactive SVG plan for 2D, a small store of our own for UI state, all on `packages/core` and `packages/three`; Vite to build | MIT | Full control over accuracy features (± on every dimension, evidence), and one edit path shared by people and agents |
| Phone capture | **Our own native apps**: Swift for iPhone (CaptureKit **built and tested**; the app layer written, not yet compiled), Kotlin for Android (later). The iPhone app: RoomPlan layout, LiDAR depth and mesh, posed photos and full-resolution stills in one AR session; tape-measure checks; a grey/colour card photo | MIT | Records everything the accuracy pipeline needs in one go |
| Capture format | **Our own** bundle format (`fullscale-capture/1`): a manifest, RoomPlan JSON per room, mesh, photos with camera poses and intrinsics, depth with confidence, tape checks | MIT | Plain files we control and can version |
| Devices | **Every phone, in tiers** (decided 2026-10-24). **Tier 1**, LiDAR iPhones/iPads: RoomPlan + LiDAR + photos, about ±1–2 cm. **Tier 2**, iPhones without LiDAR (11 and newer), in the **same Swift app** in camera-only mode: AR tracking, full-resolution stills, floor/wall planes, corner taps and tape checks; on the computer, COLMAP (BSD) refines camera positions and a permissively licensed model (MapAnything, Apache weights) adds dense geometry; about ±1–3 % from tracking alone, ±1–3 cm with 2–3 tape checks per room. **Tier 3**, Android with ARCore: a native Kotlin app recording the same, plus ARCore raw depth where supported; about ±2–4 cm with tape checks. **Tier 4**: a web upload page for any camera's photos or video, scaled by a tape measurement or a printed A4 sheet; or typing in tape/laser measurements by hand. All non-LiDAR figures are estimates until we measure them against a laser | Swift / Kotlin / web | Everyone can capture their home; each dimension's ± value honestly shows how good its tier is. iPhone Safari has no WebXR, so a web page can't replace the apps |
| Scan → structure | RoomPlan gives walls/openings and what they are; then fit planes to the LiDAR mesh with Open3D (RANSAC + least squares) to correct positions; join rooms through a shared AR session, else doorway matching + ICP | Open3D: MIT | RoomPlan alone is about ±5 cm per wall; plane fitting should give about ±1–2 cm (an estimate we will measure) |
| Accuracy | Every dimension stores source, ± value, method and evidence; 2–5 tape checks per room; an accuracy report on held-out checks | MIT | We prove accuracy instead of claiming it |
| Colours | White balance locked per room, exposure correction, grey card, the `colour` library; match to a paint colour (ΔE 2–5 with a card, "approximate" without) | BSD-3 | Real paint colours, not camera guesses |
| Photo-real view | Our converter (ARKit poses + LiDAR seed points) → **msplat** (Metal, on the Mac) → SOG → **Spark** in Three.js, as its own layer | Apache / MIT | Photo-real "before" view; never used for dimensions |
| Floor plan import | Exact lines from vector PDFs; a vision model proposes walls from images; scale from one known dimension, checked against a second | MIT | Plans arrive as PDFs and photos |
| Agent connection | MCP SDK v2 (`@modelcontextprotocol/server` 2.4.0, spec 2026-07-28); one studio server owns the home and serves `/mcp` plus a stdio shim | MIT | One edit path for people and agents; dimension-safe tools, not arbitrary code |
| Agent's eyes | 2D plan as SVG → PNG with resvg (**done**); 3D views drawn by the person's open editor and sent back (**done**), the plan when none is open; photo-real stills from Blender (**done**); later, a render from a capture photo's camera beside the photo | MIT / Apache | The agent checks its own work visually |
| Blender **(proposed roles; built)** | Blender 4.2+, run as a separate program: photo-real stills (Cycles on Metal) from our GLB and a camera; our own add-on connects out to the studio, opens the home as named objects in metres, and sends furniture moves, turns, colours and deletions back as normal edits. Walls stay locked in Blender | GPL add-on kept in `blender/` | Both Three.js and Blender are required; the home file stays the one source of truth |
| Assets | CC0 only in the repo, plus procedural furniture; an `ASSETS.json` ledger checked in CI | CC0 | Safe to redistribute |
| Your own models | People put their own `.glb`/`.gltf` files (e.g. IKEA downloads) in `data/models/` (git-ignored). Items store only the path, marked `local-only`, with the size typed from the product page (`source: maker`); the model is fitted to that size, with a warning if its shape doesn't match | owner's terms | Real products at real sizes without the repo ever containing them |
| Python | Python 3.12 via `uv` for the scan pipeline (system 3.9 is too old for Open3D and msplat); the Blender add-on's tests run on 3.9+ | – | – |
| Lint and format | Biome, one config for all TypeScript | MIT / Apache | One fast tool for both; matches the code's existing style |

## Avoid
- **Non-commercial licences** (models, datasets or code): they would break the MIT promise that anyone can use this for anything.
- **AGPL and GPL code inside the MIT core.** GPL tools may run only as separate programs.
- **Code with no licence.**
- **Third-party assets in the repo** unless CC0, including shop models and paint-brand colour lists.
- **A cross-platform phone app (React Native, Flutter)** (decided 2026-10-24). Scanning needs native code on each phone anyway (RoomPlan and LiDAR on iPhone, ARCore on Android), camera frames are too heavy to pass into a JavaScript layer, and the screens around a scan are few. So there are two native apps, Swift and Kotlin, kept in step by the capture format and shared test cases (`fullscale-capture/1`, sample captures, tape-check cases) rather than by shared code.

## Already decided in code
- **Undo is per actor, using element-level patches.** Undoing the person's edit never wipes the agent's later edits, and a conflicting undo is refused.
- **Units and axes:** metres, +Y up, plan points `[x, z]`, rotations in degrees counter-clockwise seen from above.
- **Scanned walls keep their room-side face exact** (`line: left/right`), even when the wall thickness is a guess.
- **One writer.** The studio owns the home; the editor, Blender and agents all send it operations, get numbered patches back, and undo only their own edits.
- **One tool layer.** Agent tools are plain definitions (name, schema, run) served over MCP; each write answers with what really changed, counted from the home.
- **Rooms follow their walls.** A room whose outline is exactly the area its walls close off keeps following them through wall edits; rooms drawn by hand are never reshaped. Drawing a wall that ends on or crosses another splits it, so each room keeps its own wall to paint.
- **Our own GLB writer** builds the 3D file from the same scene the editor draws, tags each element with its id, and runs without a browser. The user's own models are never in it.
- **Phone and computer agree by test, not by shared code:** `fixtures/tape-checks.json` holds the length-reading and tape-grading cases that TypeScript, Swift (and later Kotlin) all test against.
- **Your own models never change measurements.** The item's `size` is the truth; the model is fitted to it (`uniform` fits inside the box by default). A missing file falls back to the catalogue shape at the same size. Exports must replace `local-only` models with the catalogue shape.
