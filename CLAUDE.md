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
- **Built and tested (119 tests, typecheck clean):**
  - `packages/core` (format `fullscale/1`):
    - schema with per-field sources; values that follow their parent (`resolve.ts`);
    - a kind table (`kinds.ts`) and ids that are never reused (`ids.ts`);
    - coded errors (`errors.ts`) and shared building rules (`rules.ts`);
    - commands in `commands/`, each one validated input + a draft, with automatic source tracking and a wipe guard;
    - batch operations with step positions;
    - field-level patches and per-actor undo with conflict checks (`patch.ts`, `history.ts`);
    - migrations with quarantine (`migrate.ts`), unit-aware lengths (`units.ts`);
    - mitred corner joins (`joins.ts`);
    - measurements, validation, placement, SVG plan, user model references;
    - a boundary test (core imports only zod).
  - `packages/three`: scene builder with mitred wall ends (sheared extrusion, no CSG), metre UVs, correct ceiling normals; `fitModel`.
  - `apps/server/src/render-plan-png.ts`.
- **Not built yet:** studio server, MCP tools, editor app, capture apps, scan importer, Blender add-on.
