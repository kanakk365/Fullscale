# Fullscale for Blender

A live link between Blender and the Fullscale studio on your computer, and the script the studio uses for photo-real renders.

- **Live link** (`addon/`): opens your home in Blender as real objects at real size, and keeps it in step with the studio. Move or turn furniture, change a material's colour or delete an item in Blender, and the change goes to the studio as a normal edit (with its own undo), so the editor and agents see it at once. Changes made elsewhere show up in Blender.
- **Renders** (`render/`): the studio runs `render/render.py` in Blender without a window for its `render_photoreal` agent tool.

## Install the add-on

Needs Blender 4.2 or newer.

1. Build the extension zip from the repo folder:
   ```sh
   cd blender/addon && zip -r ../fullscale-blender.zip . -x '__pycache__/*' && cd -
   ```
   (Or, with Blender on your PATH: `blender --command extension build --source-dir blender/addon --output-dir blender`.)
2. In Blender: **Edit → Preferences → Get Extensions → ⌄ → Install from Disk…**, and pick `blender/fullscale-blender.zip`.
3. Start the studio (`npm run studio`), then in the 3D view press **N**, open the **Fullscale** tab and click **Connect**.

The add-on finds the studio through its run folder (`~/.fullscale`, changeable in the add-on's preferences), and only ever connects to `127.0.0.1`.

## What syncs

| In Blender | Goes to the studio as |
|---|---|
| Move or turn furniture (about the vertical) | `updateItem` (position, turn) |
| Change a home material's Base Color | `upsertMaterial` (as an sRGB colour) |
| Delete a piece of furniture | `remove` |

Walls, doors, windows, floors and ceilings are **locked** in Blender: their sizes are the studio's to change (in the editor, or by an agent), so measurements stay right. Furniture sizes are locked too; change them in the editor. Clicking part of a piece of furniture selects the whole piece.

Use the panel's **Undo** and **Redo** for edits you made in Blender; they go through the studio's undo, which never undoes someone else's work. Your own 3D models (for example furniture downloaded from a shop) stay on your computer and show as catalogue shapes here.

## Renders

```sh
blender -b --factory-startup --python blender/render/render.py -- \
  --glb home.glb --out picture.png --preset preview \
  --camera '{"eye": [6, 1.6, 6], "target": [2, 1, 2], "fov": 40}'
```

The camera is in the studio's terms (metres, +Y up). Presets: `thumb` (320 × 240, 16 samples), `preview` (1280 × 720, 64), `final` (1920 × 1080, 256). Cycles uses the GPU (Metal on a Mac) when Blender finds one. The last line printed is `FULLSCALE_RESULT {…}` or `FULLSCALE_ERROR {…}`.

## Tests

The parts that don't need Blender are tested with plain Python 3.9 or newer:

```sh
cd blender && python3 -m unittest discover -s tests -t .
FULLSCALE_LIVE_TEST=1 python3 -m unittest discover -s tests -t .   # also against a real studio
```

**Not checked inside Blender yet:** everything in `addon/ui.py` and `addon/scene.py` (the panel, the timer, importing the 3D file, locks, reading poses and colours) and `render/render.py` have not been run in Blender. In particular: how the glTF importer names imported materials and stores the `fullscale` extras, whether Blender 5's sky texture still exists (there is a fallback), and how Blender's own Ctrl+Z interacts with changes from the studio (use the panel's Undo for now).

## Licence

Everything in this folder is GPL-3.0-or-later (see `LICENSE`), as Blender add-ons must be. It talks to the MIT-licensed studio only over the network and through files; the studio never includes this code.
