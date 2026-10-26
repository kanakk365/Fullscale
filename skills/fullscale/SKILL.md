---
name: fullscale
description: Work on a home or any space in Fullscale through its MCP tools, at real size. Use when the person wants to turn a phone scan into a 3D model or a replica of their room, redesign a space (paint, add, move or remove things, try real furniture), check whether something fits, or render a photo-real picture. Covers the workflow from scan to replica, and when to stop and ask the person instead of guessing.
---

# Working on a space with Fullscale

Fullscale holds one home (or any space) at real size. The person sees it live in the editor while you work, and Blender renders it. Every change goes through the studio's tools, so the person can watch, undo and correct.

## Start

1. `get_home`, then `get_level` for the level you'll work on.
2. Look before and after editing: `view_plan` for the plan, `view_3d` for a quick 3D picture.
3. Pass `expect_rev` on writes when the person may be editing too; `recent_changes` and `get_selection` show what they did.

## From a phone scan to a model

1. **Import** the capture with `import_capture` (its folder sits inside the home's folder, for example `captures/<capture id>`). Walls, doors, windows, rooms and the scanner's furniture boxes appear, each marked as scanned with its ±.
2. **Read the notes** the import returns: tape checks that disagree, guessed wall thicknesses and door swings, a capture still marked "recording".
3. **Look at the photos** with `view_photo`: a page of them with what each shows, `of` for the photos of one element (most of it first), and one photo with a pixel grid (`region` zooms in). They show what the scanner can't name: colours, materials, small things, whether a wall is painted or covered.
4. **Ask about what you're unsure of** (next section) before you build on it.
5. **Build the replica** with the furnishing tools:
   - `paint` walls, floors and ceilings with colours from the photos, and doors, windows and their glass (`{ opening, part }`);
   - `upsert_material` for materials that aren't plain paint, giving their `kind` (`fabric` for bedding and curtains, `wood`, `tile` with its `tileSize`, `metal`, `glass` with opacity below 1): renders give each kind its own surface, so this is what makes a room look real;
   - `add_opening` with `type: "niche"` for an alcove cut into the wall (with `depth` and built-in `shelves`), and `update_opening` with `openDegrees` to show a door shut (0) or open;
   - doors and windows as they look: `leaves: 2` for a pair, a door's raised `panels`, a window's `panes` per leaf (`[1, 4]` is four stacked);
   - `update_wall` for wall thickness when photos show deep door or window recesses (the scan only sees the room side, so mark it as an `estimate`);
   - `add_items` from the catalogue (`search_catalog`) at the scanned positions and sizes, then `update_item` and `paint` for their parts;
   - plain `box` items for anything the catalogue doesn't have, named for what they are;
   - the room's **real lights** (below), and the ceiling fan if it has one;
   - **real pictures** from the photos on the surfaces that have one (below).
6. **Compare** with the person's photos: `view_photo` on a photo gives its `eye`, `target` and `fov`; render the model from there with `render_photoreal` at the photo's time of day, and put the two side by side. Fix what doesn't match, and tell the person what still differs.

## Make it look like their things

The scan gives boxes at the right places; the person recognises their room by what's on the surfaces and how things are arranged.

- **Pictures from the photos:** `texture_from_photo` cuts a flat surface out of a photo, straightened, at its real size, and makes it a material. Easiest is `at` (a point on the surface) with `size` in metres. Use it for prints and patterns (bedding, curtains, rugs: `fit: "repeat"`, which hides the seams), and for things seen once (a photo in a frame, a poster, a screen: `fit: "stretch"`, cut with its own `corners`). Pick a clear, sharp area, close and straight on (`detail` photos are best): whatever lies on the surface is cut too. Bigger patches repeat more naturally. Look at the picture it returns before using it.
- **Check what each cut was laid on.** The answer says which element the point met in the model; if that's not the surface you meant (the model's surface isn't where the photo shows it), pick another point or photo, or give `corners` and `size`.
- **Screens:** switch them on (`update_item` with `light: { on: true }`) and cut what they show onto their `screen` part; a screen that's on with no picture glows in its own colour.
- **Which way things face:** check against the photos which end of a bed has the headboard and pillows, which way a chair or a monitor faces, and turn them (`rotation`) to match. The scanner's box for a bed includes its pillows: the mattress is lower than the box's top.
- **The small things that make a desk or a shelf:** laptops and their stands, a desk mat, a second screen. Place them where the photos show them, compare a matched render, and move them until it matches.
- **Real furniture:** the person's own models (`list_models`, `model` on an item) are drawn in the editor and used by Blender renders on this computer, fitted to the item's size.

## Several scans of one room

Three or four scans of a room give more photos and depth than one. On the phone they are **Scan more** of the room (the app also asks for **Detail** photos: close-ups of prints, pictures and screens).

- Import each extra scan with `import_capture` and `room`: it adds no walls; it is lined up with the room (by the phone when it recognised the room, else by its walls, doors and windows) and its photos join the others in `view_photo`.
- Read how well it agrees: wall ends and wall lengths. Scans that disagree by more than a few centimetres mean one drifted or a wall is wrong; ask the person for a tape measurement before trusting either, and don't build the detailed model from both.
- When they agree, the detailed model (the room builder) can use them all: `room-builder build <first capture> --with <extra capture>`.
- When a surface you need isn't sharp in any photo, ask the person for a Detail photo of it, or another scan.

## Light it like the real room

Light is what makes a render look like the person's room rather than a model of it. The scanner doesn't find lights, so add them yourself:

- Find them in the photos: look up at the ceiling and the tops of walls for bulbs, tube lights, ceiling lights, hanging lights and lamps, and note which are switched on.
- Add each from the catalogue's lighting group (`search_catalog` with category `lighting`) where it really is: a bulb or tube light `against` its wall at its height, ceiling lights and fans by position (they go up to the ceiling by themselves).
- Give each light its colour and brightness with `light`: `kelvin` about 2700 for warm yellow, 4000 for neutral white, 6500 for cool daylight white; `lumens` about 800 for a 9 W LED bulb, 2000 for an LED tube light. Switch lights off with `update_item` (`light: { on: false }`).
- Walls with a rough, hand-textured finish are `plaster` materials, not `paint`; light raking across them shows the texture.
- Render with `time`: `day` (sun and sky through the windows), `evening`, or `night` (only the room's lights). Match the time of the person's photos when comparing. The render says how it was lit; if it used a stand-in ceiling light, the home has no lights switched on yet.

## Ask when you're unsure

Scans and photos leave real doubts. A good question takes the person seconds; a wrong guess built into the model costs them much more. Ask before you build on a guess when:

- **What it is:** a curtain or a painted wall, glass or a mirror, a built-in alcove or a shelf unit, a cupboard door or a room door.
- **The lights:** which lights the room has and which are usually on, whether a light is warm yellow or white, and how bright (a 9 W bulb or a bigger one).
- **Which way round:** which end of the bed the person sleeps at, which way a door opens, when the photos don't show it clearly.
- **Colour or material:** photos shift colours with the light (a cream wall can look yellow at night), so ask when a colour matters or two photos disagree. The same goes for wood or laminate, and matt or gloss.
- **What an object is:** the scanner only names about 16 kinds of furniture, and calls many things "storage".
- **Which measurement is right:** two scans that disagree, a scan against a tape check, or a size the scan couldn't see.
- **What the person wants:** keep or replace, which side a door opens, which room is which.

How to ask:

- A few short questions at a time (three to five), most important first.
- Say what you see and offer the choices: "The wall behind the bed comes out solid blue. Is it painted blue, or covered by a curtain?"
- Point at the place with `highlight` (with a note), and mention the photo you mean.
- Don't ask what you can find out yourself: measure with `measure`, look with `view_3d` or the photos.
- Use the answer, and record where it came from: what the person tells you is `user`; what you still had to guess, mark as an `estimate` with `set_source`.

## Redesigning

- **Never redesign the real home.** It is the person's room as scanned and built; keep it that way. Start a design with `new_design` (a copy, opened at once, so edits go to it); `open_design` switches between designs and back to `"real"`; `list_designs` says what each changes.
- Offer a few ideas, not one: two or three designs that differ in a clear way ("Calm and tidy", "Bigger workspace"), each with a one-line `note`. Keep what the person keeps (their bedding, their photos, their desk setup) unless they say otherwise.
- Show them side by side with `compare_designs` (the real home and the designs, from the same spot, at the time of day they live in the room), then say in a few words what each changes and ask which direction they like.
- Paint, move, add and remove with the tools; each answer says what really changed.
- Check fit with `check_fit`, and whether something gets through a door with `fits_through`. Both say what they did and didn't check; don't claim more.
- Real products: put the size from the maker's page on the item (source `maker`). The person's own 3D models (`list_models`) are drawn and rendered locally and never leave their computer.
- Render with `render_photoreal` when the person wants to see it for real, by day and at night if the room is used at both.
- Keep what the person keeps looking like theirs (their pictures, their bedding), so a redesign shows their room changed, not a different room.

## Never

- Never invent a measurement. Ask, measure, or mark it as an estimate.
- Never undo the person's edits; `undo` only undoes yours.
- Never send the person's scans, photos or own models anywhere.
