# Contributing to Fullscale

Thank you for helping. This guide says how the code is laid out, how to check your work, and the rules that keep Fullscale accurate, private and pleasant to work on.

## Setting up

```sh
npm install
npm run check       # lint, types, TypeScript tests, Blender add-on and room builder tests
npm run test:ios    # CaptureKit (Swift 6), on a Mac
```

The room builder's tests need [uv](https://docs.astral.sh/uv/), which fetches Python 3.12 and Open3D the first time; on macOS, also `brew install libusb`. Run `npm run format` before committing. The browser tests run when a Chromium is installed (`npx playwright-core install chromium-headless-shell`); without one they are skipped.

## How the code is laid out

- **Layers stay apart.** `packages/core` is pure TypeScript with Zod as its only dependency: no React, three.js, Node or browser APIs, so the server, the editor, tests and agents all run it (a test enforces this). `packages/three` turns a home into three.js objects. Apps hold I/O and UI only.
- **One edit path.** Every change, from a person, an agent or Blender, is a core operation sent to the studio. Nothing changes a home any other way, so the same rules, sources and undo apply to all.
- **Small, focused modules**, each starting with a short comment saying what it is for and why it is shaped that way. Packages expose a public API through their `index.ts`; don't import another package's files directly.
- **The Blender add-on** (`blender/`) is GPL and talks to the MIT code only over the network and through files. Never import between them.

## Rules

- **Original code only.** Don't copy code, prompts, assets or test data from other projects. Use a library as a dependency instead, with a compatible licence (MIT, BSD, Apache-2.0 or similar; no GPL inside the MIT code). Assets in the repo must be CC0.
- **Accuracy is the point.** Every dimension carries where it came from and, when known, how sure it is. Never let a guess pass as a measurement: mark estimates as estimates, and make answers say what they did not check.
- **Privacy.** Never commit real scans, photos or homes. Test data is synthetic. People's own 3D models stay on their computer: never commit, bundle, upload or export them.
- **Units and axes:** metres, +Y up, plan points `[x, z]`, turns in degrees counter-clockwise seen from above. Put units in names where they are not obvious (`heightM`, `exposureS`).

## Code

- **Strict types, no `any`.** Validate at the edges with Zod and trust the types inside. Types come from schemas, not written twice.
- **Errors** carry a stable code and a plain sentence saying what went wrong and what would work ("use an offset between 0 and 2.10 m"), written for people and agents alike. Never swallow an error.
- **Comments explain why**, not what. Name things in full words.
- **No dead code**, no commented-out code, and no TODO without a linked issue.

## Tests

- Every feature has tests; every bug fix comes with a test that would have caught it.
- Test behaviour through a package's public API, with exact numbers for geometry and measurements.
- Name tests as sentences about behaviour ("splits a room in two where a wall crosses it").
- No real sleeps or clocks in unit tests: inject the clock.
- **Agents** learn Fullscale from the studio's short instructions (`apps/server/src/mcp.ts`, sent on connect) and the skill in `skills/fullscale/SKILL.md`. Change them when tools change; a test fails if the skill names a tool that doesn't exist. Teach agents to ask the person when a scan leaves them unsure, never to guess silently.
- Behaviour that must match across languages (reading lengths, grading tape checks) lives in `fixtures/` and is tested from TypeScript, Swift and Kotlin alike.

## Pull requests

Keep them small and focused, say what changed and why, and make sure `npm run check` passes.
