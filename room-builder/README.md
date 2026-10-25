# Fullscale room builder

Turns a phone capture (`fullscale-capture/1`, see [docs/capture-format.md](../docs/capture-format.md)) into a detailed, coloured 3D model of the space: its real shape, everything in it down to things on a desk, and the colours from the photos. The editor shows it with the **Scan** switch in its 3D view, lined up with the editable walls and furniture the scan importer made.

A scan holds three kinds of data, and each has part of the truth:

| Data | Good at | Missing |
|---|---|---|
| The phone's room layout | straight walls, doors and windows at the right size | small things; furniture is boxes; no colour |
| LiDAR depth frames | the shape of everything | colour; each frame alone is noisy and partial |
| Photos | detail and colour | depth |

The room builder joins them:

1. **Shape.** Every depth frame is placed by the camera's pose and merged into one volume that stores how far each 1 cm cube is from the nearest surface. Averaging hundreds of frames this way gives a cleaner, more complete surface than the mesh the phone builds live. Depth the phone marked low-confidence is left out.
2. **Cut to the rooms.** Anything outside the scanned walls (the street through a window, the hall through a door) is dropped, along with small floating pieces of noise.
3. **Colour.** Every point takes its colour from the photos that see it, where nothing stands in between. Sharp, close, head-on views count far more than glancing or blurred ones, so the best view sets each spot's colour. Brightness is evened out first, because the camera re-exposes as it moves; white balance is already locked per room by the capture app.
4. **Files.** `built/room.glb` (in the capture's world frame, metres, +Y up) and `built/build.json`, which records what was built, from what, and with which settings.

Planned next: replace the wall, floor and ceiling surfaces with flat ones at the scanned positions, and cut furniture out as separate, movable pieces.

## Use

Needs [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 and the libraries the first time). On macOS, Open3D also needs `brew install libusb`.

```sh
npm run room-builder -- build data/homes/my-home/captures/<capture-id>
```

or, from this folder, `uv run room-builder build <capture folder>`. A one-room scan takes about 10 seconds on a recent laptop and about 2 GB of memory.

| Option | Default | What it does |
|---|---|---|
| `--voxel-cm` | 1 | Size of the smallest detail kept. Smaller is finer but bigger and slower. |
| `--max-depth-m` | 4 | Ignore depth further away; LiDAR gets noisier with distance. |
| `--min-confidence` | medium | Least depth confidence used: `low`, `medium` or `high`. |
| `--out` | `<capture>/built` | Where to write the model. |

## How good is it?

The tests build a made-up room with known walls, a cube and coloured surfaces, rendered exactly, and check the result against the truth: half of all points lie within 3 mm of the true surfaces and 99% within 1.5 cm (the rest are corners, which come out slightly rounded); walls, floor and ceiling are within 3 mm of where they should be; and every surface, including a thin stripe, gets its own colour. Wrong depth marked low-confidence leaves no surfaces in mid-air.

Real scans are as good as the phone's data. LiDAR depth is noisy by several millimetres, and the phone's poses drift a little over a long scan. Glass, mirrors, shiny screens and very dark things return little depth, and thin things (cables, chair legs) may be lumpy or missing. Photos taken closer give sharper colours.

## Develop

```sh
npm run test:room-builder     # or, here: uv run python -m unittest discover -s tests -t .
```

The tests use made-up captures from `tests/synthetic.py`. Never add a real scan to the repository.

| File | What it does |
|---|---|
| `capture.py` | Reads a capture: depth frames, photos and the scanner's walls |
| `geometry.py` | Camera axes, projection, and each room's bounds |
| `fuse.py` | The shape, from the depth frames |
| `colour.py` | Colours from the photos |
| `glb.py` | Writes the model as a GLB file |
| `build.py` | Runs the steps and writes the report |
| `cli.py` | The `room-builder` command |

Open3D (MIT) does the volume and ray casting; NumPy and Pillow do the rest. The room builder is MIT, like the rest of Fullscale.
