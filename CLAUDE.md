# Fullscale

An **open-source** (MIT) system to capture, design and edit spaces in 3D at **real size**, built so that an AI agent can do the work alongside a person.

If `CLAUDE.local.md` exists, read it too: it holds maintainers' private notes.

## Goal
People can:
1. **Design a new space** from scratch.
2. **Design from a floor plan** (an image or PDF).
3. **See an existing space in 3D**, captured with a phone (LiDAR + photos, or photos only at lower accuracy).
4. **Edit**: wall/floor colours and materials, add, move or replace furniture, change walls, doors and windows. **Dimensions stay accurate.**

An AI agent edits the same model through MCP. Both Three.js (the live editor) and Blender (photo-real renders) are supported.

## Decisions so far
1. **Capture with LiDAR and photos together** for high-quality data; phones without LiDAR are supported at lower accuracy (tiers in `docs/DECISIONS.md`).
2. **Open source, not paid.**
3. **Our own editor, capture apps and capture format.** The agent connects through MCP.
4. **Both Three.js and Blender.** Proposed roles: Three.js is the live editor and the agent's quick views; Blender gives photo-real renders, opens the home as a real Blender scene, and syncs edits both ways through our own add-on. The home file stays the one source of truth, so the two can never disagree on sizes.
5. **Your own models, locally:** people may use 3D models they download themselves (e.g. IKEA's) from the git-ignored `data/models/` folder. They are never in the repo.

Stack decisions are in `docs/DECISIONS.md`; the plan is in `docs/PLAN.md`.

## Rules
- **Original code only.** Don't copy code, prompts, assets or test data from other projects. Use a library as a dependency instead, with a compatible licence.
- **Licences:** our code is MIT. Dependencies must be MIT, BSD, Apache-2.0 or similar. No GPL code inside the MIT core; Blender is called as a separate program, and our Blender add-on (GPL, as Blender requires) lives in its own folder. Assets in the repo must be CC0.
- **Users' own models** (IKEA etc.) are `local-only`: never commit, bundle, upload or export them, and don't ship or link a downloader for a shop's site. The home stores only the file path.
- **Privacy:** never commit real scans or photos of anyone's home. Real captures go in ignored folders. Sample data is synthetic.
- **Accuracy:** every dimension carries where it came from (measured, scanned, maker, estimated, user-entered) and, when known, how uncertain it is. Units are metres and +Y is up, matching ARKit and Three.js.
- Commit or push only when asked.

## Code quality
The code must be good enough that strangers want to read and contribute to it.
- **Layers stay apart.** `packages/core` is pure TypeScript: no React, three.js, Node or browser APIs, so the server, tests and agents can all run it (a test enforces this). `packages/three` turns documents into three.js objects. Apps (server, editor) hold I/O and UI only.
- **One edit path.** Every change, from a person, an agent or Blender, is a core operation. No app mutates a home directly.
- **Small, focused modules** with a short header comment saying what the file is for. Packages expose a public API through their `index.ts`; no deep imports into another package's files.
- **Types:** strict TypeScript, no `any`. Validate at the edges with Zod; trust types inside.
- **Errors** carry a stable code and a plain sentence saying what went wrong and how to fix it, written for people and agents alike. Never swallow an error.
- **Tests** for every feature, with exact numbers for geometry and measurements. Every bug fix comes with a test that would have caught it. Test data is synthetic. Run tests from the project folder.
- **Comments explain why**, not what. Name things in full words; put units in names when unclear (`heightM`, `offsetMm`).
- **No dead code**, no commented-out code, and no TODO without a linked issue.

## Status (2026-10-24)
- **Built and tested** (TypeScript 289 tests incl. 9 browser tests; Blender add-on 33; CaptureKit 35; lint and types clean):
  - `packages/core` (format `fullscale/1`): schema with per-field sources; commands with source tracking; patches and per-actor undo; migrations; units; joins; walls as a network (`topology.ts`: junctions, rooms found from walls, loose ends); drawing commands (draw with snapping and splitting, split, merge, move a whole wall, join a loose end, draw a room) and rooms that follow their walls (`commands/follow.ts`); snapping (`snap.ts`); plan shapes for every renderer (`plan-geometry.ts`) and the SVG plan; label placement; fit checks with evidence (`fit.ts`); measuring with ±; plan pictures and scale (`calibration.ts`); cameras (`camera.ts`).
  - `packages/three`: scene builder and our own GLB writer (element ids in extras; never the user's own models).
  - `packages/protocol`: live messages and `HomeMirror`.
  - `packages/capture`: `fullscale-capture/1` schemas and the scan importer (synthetic scans in tests).
  - `apps/server`: the studio (one writer), WebSocket hub, HTTP, 40 MCP tools, stdio bridge (`fullscale mcp`), Blender render runner, CLI.
  - `apps/editor`: Vite + React + R3F editor (plan tools, 3D view, inspector, issues), browser tests with Playwright.
  - `blender/`: add-on (link thread, protocol, change tracking, scene) and render script; pure parts tested.
  - `apps/capture-ios`: CaptureKit (tested); the iOS app builds in Xcode (Swift 6, no warnings) with white balance locked per room, camera settings and full-resolution stills recorded, grey-card photos, tracking advice and an event log. The Xcode project is generated by XcodeGen and git-ignored.
  - `fixtures/tape-checks.json`: shared cases for TypeScript, Swift and Kotlin.
- **Not built yet:** Android app; scan refinement pipeline (Python, Open3D); colour from photos; splats; plan-picture tracing in the editor; iPad touch.
- **Not verified on real hardware/software yet:** the iOS app on a phone (it builds and opens in the simulator; scanning needs a device), the Blender-side add-on code and renders (no Blender here).
