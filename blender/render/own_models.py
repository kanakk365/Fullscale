# SPDX-License-Identifier: GPL-3.0-or-later
# The person's own 3D models (a sofa downloaded from a shop's website, a chair they scanned) in
# renders. The studio's file never contains them: it draws those items with their catalogue
# shape, and the studio tells this script, on this computer, which file belongs to which
# item. Each model is fitted to its item's real size the way the editor does it (measured,
# never trusting the file's units), stands where the item stands, and replaces the stand-in.
from __future__ import annotations

import math
import os

import bpy
from mathutils import Matrix, Vector

OWN = "fullscale_own_model"


def use_own_models(scene: bpy.types.Scene, models) -> dict:
    """Swap each item's stand-in shape for its model; returns how many were used and what
    went wrong with the rest."""
    items = {}
    for obj in scene.objects:
        tag = obj.get("fullscale")
        if tag is not None and tag.get("kind") == "item" and tag.get("id"):
            items[str(tag.get("id"))] = obj
    used = 0
    problems = []
    for model in models:
        item = items.get(model.item)
        if item is None:
            problems.append(f"{model.item}: not in this view")
            continue
        if not os.path.isfile(model.file):
            problems.append(f"{model.item}: its model file is missing")
            continue
        try:
            holder = _import(model)
        except Exception as error:  # A broken file shouldn't stop the render.
            problems.append(f"{model.item}: the model could not be read ({type(error).__name__})")
            continue
        if holder is None:
            problems.append(f"{model.item}: the model has no shape")
            continue
        for child in list(item.children_recursive):
            # The stand-in goes; a lamp's light point stays.
            tag = child.get("fullscale")
            if child.type == "MESH" and not (tag is not None and tag.get("light") is not None):
                bpy.data.objects.remove(child, do_unlink=True)
        holder.parent = item
        holder.matrix_parent_inverse = Matrix.Identity(4)
        used += 1
    return {"ownModels": used, **({"ownModelProblems": problems} if problems else {})}


def _import(model):
    """Import a model file under one empty, turned by its yaw, scaled to the item's size
    (width × height × depth, or inside it keeping its proportions), standing bottom-centred on
    the empty's origin with its front towards -Y, the way items face in Blender."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=model.file)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        for o in imported:
            bpy.data.objects.remove(o, do_unlink=True)
        return None
    holder = bpy.data.objects.new(f"Own model {model.item}", None)
    bpy.context.scene.collection.objects.link(holder)
    holder[OWN] = True
    for o in imported:
        o[OWN] = True
        if o.parent is None or o.parent not in imported:
            o.parent = holder
    turn = Matrix.Rotation(math.radians(model.yaw), 4, "Z")
    bpy.context.view_layer.update()
    corners = [turn @ o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    native = high - low
    # Blender's x, y, z are the item's width, depth and height.
    wanted = (model.size[0], model.size[2], model.size[1])
    ratios = [w / n if n > 1e-6 else None for w, n in zip(wanted, native)]
    finite = [r for r in ratios if r is not None]
    uniform = min(finite)
    scale = [r if (r is not None and model.fit == "stretch") else uniform for r in ratios]
    centre = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    fit = Matrix.Diagonal((*scale, 1.0)) @ Matrix.Translation(-centre) @ turn
    for o in imported:
        if o.parent is holder:
            o.matrix_world = fit @ o.matrix_world
    return holder
