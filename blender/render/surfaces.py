# SPDX-License-Identifier: GPL-3.0-or-later
# Real surfaces for a Fullscale home in Blender. Every material in the studio's file says what
# it's made of (extras.fullscale.kind: fabric, wood, tile…), and each kind gets a surface to
# match, built from Blender's own procedural textures: tiles with grout lines at their real
# size, wood with grain, fabric with a soft weave and sheen, plaster with a faint unevenness,
# metal that shines, glass you see through. No image files are needed or shipped.
#
# A lit lamp's glowing part (marked `glow` with the lamp's colour temperature) shines in that
# colour; lighting.py sets how brightly.
#
# Edges are softened too: real things are never razor sharp, and a few millimetres of bevel
# is what makes boxes read as furniture. Fabric gets rounder edges than wood or metal.
from __future__ import annotations

import math
import os

import bpy


def finish_surfaces(files: str | None = None) -> dict:
    """Give every tagged material the surface of its kind, and its picture when it has one
    (from the home's folder, `files`); returns how many of each."""
    done: dict = {}
    for material in bpy.data.materials:
        tag = material.get("fullscale")
        tree = getattr(material, "node_tree", None)
        if tag is None or tree is None:
            continue
        kind = tag.get("kind")
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        make = _SURFACES.get(kind)
        if bsdf is None or bsdf.inputs["Base Color"].is_linked:
            continue
        if make is not None:
            make(tree, bsdf, tag)
            done[kind] = done.get(kind, 0) + 1
        image = tag.get("image")
        if image is not None:
            key = "pictures" if _picture(tree, bsdf, image, files) else "missingPictures"
            done[key] = done.get(key, 0) + 1
        if tag.get("glow") is not None:
            _glow(tree, bsdf, float(tag.get("glow")), bool(tag.get("screen", False)))
            done["glowing"] = done.get("glowing", 0) + 1
    return done


def soften_edges(scene: bpy.types.Scene) -> int:
    """A bevel on every solid mesh, rounder for fabric; returns how many meshes got one."""
    count = 0
    for obj in scene.objects:
        # The person's own models keep their own edges.
        if obj.type != "MESH" or not obj.data.polygons or obj.get("fullscale_own_model"):
            continue
        kind = _kind_of(obj)
        if kind == "glass":
            continue
        sizes = [d for d in obj.dimensions if d > 1e-4]
        # Flat things (floors, ceilings, screens) have nothing to round.
        if len(sizes) < 3:
            continue
        soft = kind in ("fabric", "carpet")
        width = min(0.035 if soft else 0.005, min(sizes) * (0.3 if soft else 0.2))
        if width < 0.0005:
            continue
        bevel = obj.modifiers.new("Soft edges", "BEVEL")
        bevel.width = width
        bevel.segments = 4 if soft else 2
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(40)
        bevel.use_clamp_overlap = True
        if soft:
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
        count += 1
    return count


def _kind_of(obj: bpy.types.Object) -> str | None:
    for slot in obj.material_slots:
        tag = slot.material.get("fullscale") if slot.material else None
        if tag is not None:
            return tag.get("kind")
    return None


# ---------- one surface per kind ----------


def _tile(tree, bsdf, tag) -> None:
    """Square tiles at their real size (default 60 cm), with matt, slightly sunken grout."""
    size = float(tag.get("tileSize", 0.6))
    base = _base(bsdf)
    position = tree.nodes.new("ShaderNodeNewGeometry")
    brick = tree.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.0
    brick.squash = 1.0
    tree.links.new(position.outputs["Position"], brick.inputs["Vector"])
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = size
    brick.inputs["Row Height"].default_value = size
    brick.inputs["Mortar Size"].default_value = 0.0025
    brick.inputs["Mortar Smooth"].default_value = 0.3
    brick.inputs["Color1"].default_value = base
    brick.inputs["Color2"].default_value = _shade(base, 0.97)
    brick.inputs["Mortar"].default_value = _shade(base, 0.7)
    tree.links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])
    rough = tree.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = _value(bsdf, "Roughness", 0.15)
    rough.inputs["To Max"].default_value = 0.8
    tree.links.new(brick.outputs["Fac"], rough.inputs["Value"])
    tree.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    _bump(tree, bsdf, brick.outputs["Fac"], 0.25, invert=True)


def _wood(tree, bsdf, tag) -> None:
    """Grain: bands of lighter and darker wood, gently warped."""
    base = _base(bsdf)
    coords = tree.nodes.new("ShaderNodeTexCoord")
    wave = tree.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 7.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.2
    tree.links.new(coords.outputs["Object"], wave.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = _shade(base, 0.8)
    ramp.color_ramp.elements[1].color = _shade(base, 1.12)
    tree.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.5
    _bump(tree, bsdf, wave.outputs["Fac"], 0.03)


def _fabric(tree, bsdf, tag) -> None:
    """A fine weave you feel more than see, a soft sheen, and faint patches of wear."""
    base = _base(bsdf)
    coords = tree.nodes.new("ShaderNodeTexCoord")
    weave = _noise(tree, coords.outputs["Object"], 380.0, 2.0)
    patches = _noise(tree, coords.outputs["Object"], 6.0, 3.0)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = base
    mix.inputs["B"].default_value = _shade(base, 0.88)
    tree.links.new(patches.outputs["Fac"], mix.inputs["Factor"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    _set(bsdf, "Sheen Weight", 0.5)
    _set(bsdf, "Sheen Roughness", 0.4)
    _bump(tree, bsdf, weave.outputs["Fac"], 0.12)


def _carpet(tree, bsdf, tag) -> None:
    _fabric(tree, bsdf, tag)
    _set(bsdf, "Sheen Weight", 0.7)


def _plaster(tree, bsdf, tag) -> None:
    """Hand-textured plaster: flattened blobs and trowel marks you see when light rakes across
    the wall or you stand close; from across the room it reads as an even colour, a touch
    darker in the hollows."""
    base = _base(bsdf)
    coords = tree.nodes.new("ShaderNodeTexCoord")
    blobs = _noise(tree, coords.outputs["Object"], 16.0, 4.0)
    blobs.inputs["Distortion"].default_value = 0.6
    # Knock the tops of the blobs flat, as a trowel does: steep edges, flat plateaus.
    flat = tree.nodes.new("ShaderNodeMapRange")
    flat.inputs["From Min"].default_value = 0.47
    flat.inputs["From Max"].default_value = 0.53
    tree.links.new(blobs.outputs["Fac"], flat.inputs["Value"])
    grain = _noise(tree, coords.outputs["Object"], 220.0, 3.0)
    height = tree.nodes.new("ShaderNodeMath")
    height.operation = "MULTIPLY_ADD"
    height.inputs[1].default_value = 0.2
    tree.links.new(grain.outputs["Fac"], height.inputs[0])
    tree.links.new(flat.outputs["Result"], height.inputs[2])
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = _shade(base, 0.975)
    mix.inputs["B"].default_value = base
    tree.links.new(flat.outputs["Result"], mix.inputs["Factor"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.002
    tree.links.new(height.outputs["Value"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def _paint(tree, bsdf, tag) -> None:
    """Painted plaster: matt, with a faint unevenness in tone and surface."""
    base = _base(bsdf)
    coords = tree.nodes.new("ShaderNodeTexCoord")
    tone = _noise(tree, coords.outputs["Object"], 4.0, 4.0)
    plaster = _noise(tree, coords.outputs["Object"], 45.0, 8.0)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = base
    mix.inputs["B"].default_value = _shade(base, 0.95)
    tree.links.new(tone.outputs["Fac"], mix.inputs["Factor"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.88
    _bump(tree, bsdf, plaster.outputs["Fac"], 0.04)


def _metal(tree, bsdf, tag) -> None:
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.28


def _plastic(tree, bsdf, tag) -> None:
    bsdf.inputs["Roughness"].default_value = min(_value(bsdf, "Roughness", 0.35), 0.35)


def _stone(tree, bsdf, tag) -> None:
    base = _base(bsdf)
    coords = tree.nodes.new("ShaderNodeTexCoord")
    grain = _noise(tree, coords.outputs["Object"], 25.0, 6.0)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = base
    mix.inputs["B"].default_value = _shade(base, 0.85)
    tree.links.new(grain.outputs["Fac"], mix.inputs["Factor"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55


def _glass(tree, bsdf, tag) -> None:
    """Real glass: light passes through it, tinted by its colour; a rough one is frosted or
    patterned. The see-through look comes from transmission, not from fading the surface.
    Sunlight and the sky's light pass straight through a pane, tinted, as they do through a
    real window (a renderer would otherwise treat the pane as a wall that blocks them)."""
    _set(bsdf, "Transmission Weight", 1.0)
    _set(bsdf, "IOR", 1.45)
    bsdf.inputs["Alpha"].default_value = 1.0
    output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if output is None:
        return
    path = tree.nodes.new("ShaderNodeLightPath")
    through = tree.nodes.new("ShaderNodeMath")
    through.operation = "MAXIMUM"
    tree.links.new(path.outputs["Is Shadow Ray"], through.inputs[0])
    tree.links.new(path.outputs["Is Diffuse Ray"], through.inputs[1])
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value = light_through(_base(bsdf))
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(through.outputs["Value"], mix.inputs["Fac"])
    tree.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    tree.links.new(clear.outputs["BSDF"], mix.inputs[2])
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def light_through(colour: tuple) -> tuple:
    """The tint light picks up passing through a pane. A pane's colour is mostly what it looks
    like against the dark outside; the light through it is far paler (green glass still lets
    most daylight in, slightly green)."""
    top = max(colour[0], colour[1], colour[2], 1e-6)
    return tuple(1.0 - 0.3 * (1.0 - c / top) for c in colour[:3]) + (1.0,)


def _glow(tree, bsdf, kelvin: float, screen: bool = False) -> None:
    """A lit lamp's glowing part, in the colour of its light; a screen glows with what it
    shows: its picture, or else its own colour."""
    base = bsdf.inputs["Base Color"]
    if base.is_linked and base.links[0].from_node.type == "TEX_IMAGE":
        tree.links.new(base.links[0].from_socket, bsdf.inputs["Emission Color"])
    elif screen:
        bsdf.inputs["Emission Color"].default_value = tuple(base.default_value)
    else:
        blackbody = tree.nodes.new("ShaderNodeBlackbody")
        blackbody.inputs["Temperature"].default_value = kelvin
        tree.links.new(blackbody.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0


def _picture(tree, bsdf, image, files: str | None) -> bool:
    """Show the material's picture: repeating at its real size (the surfaces' texture
    coordinates are in metres), mirrored to hide the seams of a patch cut from a photo, or
    once across each face."""
    file = image.get("file")
    path = os.path.join(files, file) if files and file else None
    if path is None or not os.path.isfile(path):
        return False
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(path, check_existing=True)
    fit = image.get("fit", "repeat")
    coords = tree.nodes.new("ShaderNodeTexCoord")
    if fit == "stretch":
        texture.extension = "EXTEND"
        tree.links.new(coords.outputs["UV"], texture.inputs["Vector"])
    else:
        texture.extension = "MIRROR" if fit == "mirror" else "REPEAT"
        width = float(image.get("width", 1.0))
        height = float(image.get("height", width))
        mapping = tree.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0 / width, 1.0 / height, 1.0)
        tree.links.new(coords.outputs["UV"], mapping.inputs["Vector"])
        tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    return True


_SURFACES = {
    "tile": _tile,
    "wood": _wood,
    "fabric": _fabric,
    "carpet": _carpet,
    "paint": _paint,
    "plaster": _plaster,
    "metal": _metal,
    "plastic": _plastic,
    "stone": _stone,
    "glass": _glass,
}


# ---------- helpers ----------


def _base(bsdf) -> tuple:
    return tuple(bsdf.inputs["Base Color"].default_value)


def _shade(colour: tuple, factor: float) -> tuple:
    return (min(1.0, colour[0] * factor), min(1.0, colour[1] * factor), min(1.0, colour[2] * factor), colour[3])


def _value(bsdf, name: str, fallback: float) -> float:
    socket = bsdf.inputs.get(name)
    return float(socket.default_value) if socket is not None else fallback


def _set(bsdf, name: str, value: float) -> None:
    socket = bsdf.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def _noise(tree, vector, scale: float, detail: float):
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    tree.links.new(vector, noise.inputs["Vector"])
    return noise


def _bump(tree, bsdf, height, strength: float, invert: bool = False) -> None:
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.invert = invert
    tree.links.new(height, bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
