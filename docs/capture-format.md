# Capture format: `fullscale-capture/1`

A capture is one folder (or a zip of it) written by a capture app. It holds everything recorded in **one AR session**: one shared world frame, any number of rooms, the scanner's room layouts, the LiDAR mesh, posed photos, depth frames, tape checks and colour-card shots. Rooms in one capture are already aligned with each other; joining separate captures happens on the computer.

The importer (`packages/capture`) turns a capture into an editable home where every dimension says it was scanned and how sure it is.

## Rules

- **Units:** metres, seconds, degrees only where a field name says so.
- **World frame:** the AR session's world: right-handed, **+Y up** (against gravity). This is the home's frame too: a world point `(x, y, z)` is plan point `[x, z]`.
- **Poses:** camera-to-world 4 × 4 matrices as **16 numbers in column-major order** (translation in elements 12–14), which is what `Matrix4.fromArray` in Three.js and `simd_float4x4` columns give.
- **Camera axes:** +x right, +y up, −z forward, in the sensor's orientation.
- **Intrinsics:** named fields `{ fx, fy, cx, cy }` in pixels of the image they belong to. Never a bare 3 × 3 (row/column order mix-ups are a classic bug). Every image has its own, because focus changes `fx`. Pixel coordinates start at the top-left **corner** of the top-left pixel, so pixel centres are at half pixels (`i + 0.5`); intrinsics for a resized image are the same numbers times the scale. Half a pixel moves a surface several millimetres at room distances, so readers must use this convention too.
- **Images:** saved in sensor orientation with EXIF orientation 1. Readers ignore EXIF orientation.
- **Times:** `t` is seconds since the device booted (ARKit time). The manifest's `clock` pairs it with UTC.
- **Paths:** relative to the capture folder, `/`-separated, never containing `..`, never absolute.
- **Records:** index files are JSON Lines (one object per line). A line is written only after its files are closed and synced, so a capture cut short by a crash keeps every complete line.
- **Compatibility:** readers ignore fields they don't know. Adding fields bumps `revision`; anything that would break a reader becomes `fullscale-capture/2`.
- **Privacy:** captures of real homes are private. They never go into the repository.

## Layout

```
<capture-id>/                       e.g. 20261024T101200Z-7KQ2 (UTC time + 4 random characters)
  manifest.json                     written atomically: at start, after each room, at the end
  checksums.sha256                  at the end: "<sha256>  <path>" per file
  rooms/<room-id>/room.json         name, times, white balance, counts
  rooms/<room-id>/roomplan.json     the scanner's room layout (Apple's CapturedRoom JSON), unchanged
  rooms/<room-id>/roomplan-data.json  the scanner's raw data (CapturedRoomData), so the layout can be rebuilt later
  structure.json                    the scanner's merged multi-room layout, when made
  mesh/session.ply                  LiDAR mesh for the whole session, binary little-endian
  photos/index.jsonl                one line per photo
  photos/p000123.jpg
  frames/index.jsonl                one line per depth keyframe
  frames/f000456.depth | .conf | .jpg
  poses/poses.jsonl                 the camera pose of every AR frame (about 60 per second)
  checks/tape.jsonl                 tape-measure checks
  colour/cards.jsonl                grey or colour card shots
  log/events.jsonl                  events (tracking lost, thermal state, memory warnings…)
  log/diagnostics.json              counts of every outcome (photos kept, depth frames skipped and why…)
  worldmap.arworldmap               optional, to continue the capture later
  built/                            made on the computer by the room builder, never by the phone:
  built/room.glb                      the detailed, coloured model, in this capture's world frame
  built/build.json                    what was built, from what, and with which settings
```

Only `manifest.json` is required. Everything else is optional, so a phone without LiDAR (no mesh, no depth) or a capture cut short still opens.

## `manifest.json`

| Field | Meaning |
|---|---|
| `format` | `"fullscale-capture/1"` |
| `revision` | integer; grows when fields are added |
| `id` | the folder name |
| `status` | `recording`, `complete` or `interrupted` |
| `createdAt`, `endedAt` | UTC, ISO 8601 ending in `Z` |
| `clock` | `{ uptimeAtStart, utcAtStart, uptimeAtEnd?, utcAtEnd? }` to turn `t` into UTC |
| `app` | `{ name, version, build }` |
| `device` | `{ model, os, osVersion, lidar }`: the model identifier (e.g. `iPhone18,1`), never the device's name |
| `tier` | `1` LiDAR + scanner, `2` camera only (AR tracking), `3` Android ARCore, `4` photos only |
| `ar` | `{ videoFormat: { width, height, fps }, highResolutionStills }` |
| `rooms` | `[{ id, name, dir, startedAt, endedAt? }]` in scan order |
| `counts` | `{ photos, keyframes, poses, tapeChecks, cards, depthSkipped: { motion, busy, noDepth, writeFailed } }` |
| `alignment` | `{ method: "first" \| "relocalized" \| "unaligned", residualM? }`: how this session's world relates to an earlier one (continuing another day) |

## Records

**Photo** (`photos/index.jsonl`):
`{ id, file, room, kind, t, width, height, pose[16], intrinsics { fx, fy, cx, cy }, tracking, blurPx, camera { exposureS, iso, evOffset, whiteBalanceGains [r, g, b], whiteBalanceLocked, exposureLocked }, keyframe? }`
`kind` is `auto`, `manual`, `still`, `card` or `tape`. A `still` is a full-resolution picture taken alongside an `auto` photo of the same view; stills are rationed (at most one every 3 s, none when the phone is warm) and kept only when they match the photo's view and sharpness. `blurPx` is the motion blur predicted from the poses: focal length × exposure × (angular speed + linear speed ÷ 2). `camera.iso` is 0 and `whiteBalanceGains` empty when the camera did not report them.

**Depth keyframe** (`frames/index.jsonl`):
`{ id, t, room, pose[16], depth { file, width, height, intrinsics }, confidence { file }, rgb { file, width, height, intrinsics } }`
Depth is uint16 millimetres, little-endian, compressed with raw DEFLATE (no zlib header); 0 means no value. Confidence is uint8 0–2, raw DEFLATE. The RGB image is a small JPEG for colouring the depth.

**Tape check** (`checks/tape.jsonl`): a length the person measured with a tape, to check the scan against.
`{ id, room, kind, element?, a?, b?, appM, tapeM, entered, unit, heldOut, obstructed, note?, t }`
- `kind`: `wall_length`, `door_width`, `door_height`, `window_width`, `ceiling_height`, `diagonal` or `other`.
- `element`: the scanner identifier of the wall, door or window measured, when the person picked one.
- `a`, `b`: the two measured points in world metres, when picked on the mesh.
- `appM`: what the scan says; `tapeM`: what the tape says; `entered`: the text typed, e.g. `"3.41 m"` or `"11' 2\""`.
- `heldOut`: true for checks kept back to test the result rather than to correct it.

**Colour card** (`colour/cards.jsonl`):
`{ id, room, card, photo, whiteBalanceGains [r, g, b], temperatureK, tint, iso, exposureS, evOffset, corners? }`
`card` names the card (e.g. `grey-18`). `photo` is the card photo's file; that photo is also in `photos/index.jsonl` with `kind: "card"`. `corners` are the card's four corners in the photo's pixels, when tapped.

**Pose** (`poses/poses.jsonl`): `{ t, pose[16], tracking }` for every AR frame, with `tracking` = `normal`, `limited` or `notAvailable`. Why tracking was limited is in the event log.

**Room** (`rooms/<room-id>/room.json`, one object, written when the room ends and again after each tape check):
`{ id, name, startedAt, endedAt?, whiteBalance?: { gains [r, g, b], temperatureK, tint, locked }, counts: { photos, stills, keyframes, tapeChecks, cards } }`
The white balance is locked once per room, when tracking first settles, so every photo of a room shares one colour. `locked: false` means the camera would not hold it, and colour may drift between that room's photos.

**Event** (`log/events.jsonl`): `{ t, kind, room?, detail?, value? }`. `kind` is one of `tracking_lost`, `tracking_resumed`, `tracking_limited` (`detail`: `initializing`, `relocalizing`, `excessive_motion`, `insufficient_features` or `other`), `world_jumped` (`value`: metres), `thermal` (`detail`: `nominal`, `fair`, `serious` or `critical`), `memory_warning`, `white_balance_locked` (`value`: kelvin), `white_balance_failed`, `still_failed`, `scanner_failed` and `write_failed`, each with a plain `detail` where there is more to say.

## The mesh (`mesh/session.ply`)

Binary little-endian PLY in world metres. Vertex properties: `x y z nx ny nz` (float), `red green blue` (uchar), `room` (uchar, the index in `manifest.rooms`, 255 if none). Face properties: `vertex_indices` (uchar count, uint indices) and `classification` (uchar: ARKit's mesh classes 0 none, 1 wall, 2 floor, 3 ceiling, 4 table, 5 seat, 6 window, 7 door).

## The scanner's room layout (`roomplan.json`)

Apple's `CapturedRoom` encoded as JSON, unchanged, except that numbers JSON can't hold (NaN and infinity, which the scanner sometimes produces) are written as the strings `"nan"`, `"inf"` and `"-inf"`. `roomplan-data.json` is written the same way, so decode both with the matching setting. The importer reports an element such a value makes unreadable and reads the rest. Each of `roomplan-data.json`, `roomplan.json` and `mesh/session.ply` is saved on its own: a room may have some without the others, and the event log says why one is missing. `roomplan-data.json` is often missing: on iOS 27 Apple's own encoder for it fails with "Invalid data". It is only a backup; the importer doesn't need it. What the importer reads:
- `walls`, `doors`, `windows`, `openings`, `floors`, `objects`: arrays of elements, each with `identifier`, `category` (an object with one key, e.g. `{"door": {"isOpen": true}}`), `confidence` (one key: `high`, `medium` or `low`), `dimensions` `[width, height, depth]` (depth 0 for walls, doors and windows), and `transform` (16 numbers, column-major).
- Doors, windows and openings name their wall in `parentIdentifier`.
- Floors may list `polygonCorners` (in the floor's own frame).
- Walls may have a `curve`; curved walls are imported straight, with a warning.

How the importer reads them:
- A wall's plane is the face the scanner saw, so it is the room-side face: walls import with `line: "right"` (the room on their right) and a thickness of 0.12 m marked as an **estimate**.
- Positions get a scanned source with an uncertainty from the scanner's confidence: high ±2 cm, medium ±4 cm, low ±8 cm. These defaults are estimates until tape checks on real phones measure them; tape checks in the capture refine them.
- The whole capture is turned so most walls run along the plan's axes; the turn and offset are stored with the capture so photos and the mesh line up with the home.
- Tape checks are compared with the imported model and reported (difference in cm and %). Applying a tape value is a separate, explicit step.
