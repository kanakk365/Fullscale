# SPDX-License-Identifier: GPL-3.0-or-later
# The light in a render, as in the real room: the home's own lamps where they hang, at their
# real brightness and colour; daylight from the sky and the sun coming in through the windows;
# and a camera that exposes and white-balances the picture the way a phone does.
#
# The studio's file marks each lamp with a light point: an empty node whose
# extras.fullscale.light says its shape (point, line or disc), size, facing, colour (kelvin),
# brightness (lumens) and whether it is on. The lamp's glowing part has a material marked
# with `glow`.
from __future__ import annotations

import math
import os
import tempfile

import bpy
from light_maths import SUN, glow_strength, metered_exposure, stand_in_lumens, sun_angles, sun_strength, watts, white_balance
from mathutils import Matrix, Vector
from surfaces import light_through


def add_lamps(scene: bpy.types.Scene) -> list:
    """A Blender light for every lamp in the home that is on; returns (kelvin, lumens) for
    each. The lamp's glowing part is made to look lit without lighting the room twice."""
    lamps = []
    for point in list(scene.objects):
        tag = point.get("fullscale")
        light = tag.get("light") if tag is not None else None
        if light is None:
            continue
        light = light.to_dict() if hasattr(light, "to_dict") else dict(light)
        if not light.get("on", True):
            continue
        kelvin = float(light.get("kelvin", 4000))
        lumens = float(light.get("lumens", 800))
        shape = light.get("shape", "point")
        size = float(light.get("size", 0.03))
        # The point's own axes are glTF's; turn its facing into Blender's frame and the world.
        turn = point.matrix_world.to_3x3()
        facing = (turn @ _from_gltf(light.get("facing", (0, -1, 0)))).normalized()
        along = (turn @ Vector((1, 0, 0))).normalized()
        item = _item_of(point)

        if shape == "point":
            data = bpy.data.lights.new(f"Lamp {item}", type="POINT")
            data.shadow_soft_size = size
        else:
            data = bpy.data.lights.new(f"Lamp {item}", type="AREA")
            if shape == "line":
                data.shape = "RECTANGLE"
                data.size = size
                data.size_y = 0.03
            elif shape == "panel":
                # A screen: a rectangle shining forwards.
                data.shape = "RECTANGLE"
                data.size = size
                data.size_y = float(light.get("height", size))
            else:
                data.shape = "DISK"
                data.size = 2 * size
        data.energy = watts(lumens)
        data.color = (1.0, 1.0, 1.0)
        data.use_temperature = True
        data.temperature = kelvin
        lamp = bpy.data.objects.new(data.name, data)
        lamp.matrix_world = _facing_matrix(point.matrix_world.translation, facing, along)
        scene.collection.objects.link(lamp)
        _light_up(point.parent, lumens, bool(light.get("shaded", False)))
        lamps.append((kelvin, lumens))
    return lamps


def add_stand_in_lights(scene: bpy.types.Scene) -> int:
    """A room with no lamps in the model, seen after dark, still has a light: one ordinary
    ceiling light in the middle of each ceiling. The result says so, so the person can be
    asked what lights the room really has."""
    count = 0
    for obj in list(scene.objects):
        tag = obj.get("fullscale")
        if obj.type != "MESH" or tag is None or tag.get("kind") != "ceiling":
            continue
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        xs = [c.x for c in corners]
        ys = [c.y for c in corners]
        area = sum(p.area for p in obj.data.polygons)
        data = bpy.data.lights.new(f"Stand-in ceiling light {tag.get('id', count)}", type="AREA")
        data.shape = "DISK"
        data.size = 0.35
        data.energy = watts(stand_in_lumens(area))
        data.use_temperature = True
        data.temperature = 4000
        light = bpy.data.objects.new(data.name, data)
        # Area lights shine down their -Z, which is down here.
        light.location = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(c.z for c in corners) - 0.02)
        scene.collection.objects.link(light)
        count += 1
    return count


def light_outside(scene: bpy.types.Scene, lighting) -> dict:
    """The sky, and by day or evening the sun shining in through the windows, which become
    portals that guide the renderer to the light coming in."""
    world = bpy.data.worlds.new("Outside")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    background = next(n for n in nodes if n.type == "BACKGROUND")
    if lighting.time == "night":
        # A dark blue night outside: windows read as night, and it lights nothing.
        background.inputs["Color"].default_value = (0.004, 0.006, 0.014, 1.0)
        background.inputs["Strength"].default_value = 1.0
        return {"sun": False, "portals": 0}

    elevation, kelvin = SUN[lighting.time]
    heading = Vector(lighting.sun) if lighting.sun else Vector((0.6, -0.8, 0.0))
    heading.z = 0
    heading = heading.normalized() if heading.length > 1e-6 else Vector((0.0, -1.0, 0.0))
    towards = Vector((heading.x * math.cos(math.radians(elevation)), heading.y * math.cos(math.radians(elevation)), math.sin(math.radians(elevation))))
    sky = nodes.new("ShaderNodeTexSky")
    # The sun itself is a sun lamp below (cleaner, sharper shadows); the sky gives the soft
    # light from the rest of it, coloured by the time of day.
    sky.sun_disc = False
    sky.sun_elevation, sky.sun_rotation = sun_angles(tuple(towards))
    world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
    background.inputs["Strength"].default_value = 1.0

    data = bpy.data.lights.new("Sun", type="SUN")
    data.energy = sun_strength(elevation)
    data.angle = 0.0093  # the sun is about half a degree across
    data.use_temperature = True
    data.temperature = kelvin
    sun = bpy.data.objects.new("Sun", data)
    # A sun lamp shines down its -Z, so its +Z points at the sun.
    sun.rotation_euler = towards.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)

    portals = 0
    for window in lighting.windows:
        portal_data = bpy.data.lights.new(f"Window portal {portals + 1}", type="AREA")
        portal_data.shape = "RECTANGLE"
        portal_data.size = window.width
        portal_data.size_y = window.height
        portal_data.cycles.is_portal = True
        portal = bpy.data.objects.new(portal_data.name, portal_data)
        inward = Vector(window.inward).normalized()
        across = Vector((0, 0, 1)).cross(-inward)
        portal.matrix_world = _facing_matrix(Vector(window.centre) + inward * 0.01, inward, across if across.length > 1e-6 else Vector((1, 0, 0)))
        scene.collection.objects.link(portal)
        portals += 1
    return {"sun": True, "sunElevation": elevation, "portals": portals}


def expose_like_a_phone(scene: bpy.types.Scene, lighting, lamps: list, key: float = 0.18) -> dict:
    """Meter a small quick render and set the exposure and white balance from it, so a room
    lit by one bulb at night and the same room in sunshine both come out as a phone would show
    them. Returns the exposure (stops) and white balance (kelvin) used."""
    render = scene.render
    saved = (render.resolution_percentage, render.filepath, render.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising, scene.cycles.sample_clamp_indirect)
    folder = tempfile.mkdtemp(prefix="fullscale-meter-")
    path = os.path.join(folder, "meter.exr")
    render.resolution_percentage = max(5, round(100 * 240 / max(render.resolution_x, 1)))
    render.filepath = path
    render.image_settings.file_format = "OPEN_EXR"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.cycles.sample_clamp_indirect = 0.0
    scene.view_settings.exposure = 0.0
    try:
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        pixels = list(image.pixels)
        bpy.data.images.remove(image)
    finally:
        render.resolution_percentage, render.filepath, render.image_settings.file_format, scene.cycles.samples, scene.cycles.use_denoising, clamp = saved
        try:
            os.remove(path)
            os.rmdir(folder)
        except OSError:
            pass
    luminance = [0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2] for i in range(0, len(pixels), 4)]
    stops = metered_exposure(luminance, key=key)
    scene.view_settings.exposure = stops
    tame_screens(stops)
    # Keep stray bright bounces in check at the brightness the picture is shown at.
    scene.cycles.sample_clamp_indirect = clamp / (2.0**stops) if clamp else 0.0
    kelvin = white_balance(lighting.time, lamps)
    view = scene.view_settings
    view.use_white_balance = True
    view.white_balance_temperature = kelvin
    if lighting.time != "night":
        # Daylight through tinted glass takes its tint; a phone balances most of it away.
        tint = window_tint(scene)
        white = list(view.white_balance_whitepoint)
        view.white_balance_whitepoint = [w * (1.0 - 0.7 * (1.0 - t)) for w, t in zip(white, tint)]
    return {"exposure": round(stops, 2), "whiteBalance": round(kelvin)}


def tame_screens(stops: float, above: float = 3.0) -> int:
    """Keep switched-on screens readable: at most `above` stops brighter than the picture's
    mid grey, as a phone's camera keeps a screen's picture visible in a dim room rather than
    a white glare. Returns how many screens were dimmed."""
    cap = 0.18 * 2.0**above * math.pi / 2.0**stops
    dimmed = 0
    for material in bpy.data.materials:
        tag = material.get("fullscale")
        if tag is None or not tag.get("screen") or material.node_tree is None:
            continue
        bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None and bsdf.inputs["Emission Strength"].default_value > cap:
            bsdf.inputs["Emission Strength"].default_value = cap
            dimmed += 1
    return dimmed


def window_tint(scene: bpy.types.Scene) -> tuple:
    """The average tint daylight picks up through the home's window glass (white for clear
    glass or no windows)."""
    tints = []
    for obj in scene.objects:
        tag = obj.get("fullscale")
        if tag is None or tag.get("kind") != "opening":
            continue
        for part in [obj, *obj.children_recursive]:
            for slot in getattr(part, "material_slots", []):
                mat_tag = slot.material.get("fullscale") if slot.material else None
                bsdf = next((n for n in slot.material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat_tag is not None else None
                if mat_tag is not None and mat_tag.get("kind") == "glass" and bsdf is not None:
                    tints.append(light_through(tuple(bsdf.inputs["Base Color"].default_value)))
    if not tints:
        return (1.0, 1.0, 1.0)
    return tuple(sum(t[i] for t in tints) / len(tints) for i in range(3))


# ---------- helpers ----------


def _from_gltf(v) -> Vector:
    """A direction in glTF's axes (+Y up) in Blender's (+Z up), as the importer turns them."""
    x, y, z = (float(c) for c in v)
    return Vector((x, -z, y))


def _facing_matrix(location: Vector, facing: Vector, along: Vector) -> Matrix:
    """Place a light at `location` shining towards `facing` (lights shine down their -Z),
    with its X axis along `along`."""
    z = -facing.normalized()
    x = (along - z * along.dot(z)).normalized() if abs(along.dot(z)) < 0.999 else z.orthogonal().normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = location
    return m


def _item_of(obj) -> str:
    parent = obj.parent
    while parent is not None:
        tag = parent.get("fullscale")
        if tag is not None and tag.get("id"):
            return str(tag.get("id"))
        parent = parent.parent
    return obj.name


def _light_up(item, lumens: float, shaded: bool) -> None:
    """The lamp's glowing part: bright to look at and in reflections of it, but the light
    in the room comes from the lamp itself, so the glow doesn't light anything twice. A bulb's
    glass lets its light through; a shade keeps its shadow."""
    if item is None:
        return
    glowing = [o for o in item.children_recursive if o.type == "MESH" and any(_glows(s.material) for s in o.material_slots)]
    area = sum(_world_area(o) for o in glowing)
    for obj in glowing:
        for slot in obj.material_slots:
            if not _glows(slot.material):
                continue
            # Its own copy: two lamps sharing a material may differ in brightness.
            material = slot.material.copy()
            slot.link = "OBJECT"
            slot.material = material
            bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is not None:
                bsdf.inputs["Emission Strength"].default_value = glow_strength(lumens, area, shaded)
            material.cycles.emission_sampling = "NONE"
        obj.visible_diffuse = False
        obj.visible_glossy = False
        obj.visible_transmission = False
        obj.visible_volume_scatter = False
        obj.visible_shadow = shaded


def _glows(material) -> bool:
    tag = material.get("fullscale") if material is not None else None
    return tag is not None and tag.get("glow") is not None


def _world_area(obj) -> float:
    m = obj.matrix_world
    total = 0.0
    for polygon in obj.data.polygons:
        points = [m @ obj.data.vertices[i].co for i in polygon.vertices]
        for i in range(1, len(points) - 1):
            total += (points[i] - points[0]).cross(points[i + 1] - points[0]).length / 2
    return total
