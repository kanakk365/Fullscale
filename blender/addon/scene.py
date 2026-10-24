# SPDX-License-Identifier: GPL-3.0-or-later
# The Fullscale objects in Blender: built from the studio's 3D file, moved when the studio
# moves things, and read back when the person moves things in Blender. Main thread only.
#
# Walls, doors, windows, floors and ceilings are locked: their sizes are the studio's to
# change, through its edit commands, so measurements stay right. Furniture can be moved on
# the floor and turned about the vertical; its size is locked too.
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional

import bpy

from .changes import ItemPose
from .conversions import blender_to_studio, hex_to_linear, linear_to_hex, studio_to_blender, turn_to_blender, turn_to_studio

COLLECTION_NAME = "Fullscale"
# Custom properties we put on objects and materials.
ID_PROP = "fullscale_id"
KIND_PROP = "fullscale_kind"
PART_OF_PROP = "fullscale_part_of"
MATERIAL_PROP = "fullscale_material"
# Blender adds ".001" and so on to names that are already taken.
NAME_SUFFIX = re.compile(r"\.\d{3}$")


def collection() -> Optional[bpy.types.Collection]:
    return bpy.data.collections.get(COLLECTION_NAME)


def build_from_glb(path: str, material_ids: Iterable[str]) -> Dict[str, str]:
    """Replace the Fullscale collection with the home in `path`. Returns element id →
    object name for the elements the add-on follows."""
    _remove_collection()
    target = bpy.data.collections.new(COLLECTION_NAME)
    bpy.context.scene.collection.children.link(target)
    before_objects = set(bpy.data.objects)
    before_materials = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=path)
    created = [o for o in bpy.data.objects if o not in before_objects]

    for obj in created:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        target.objects.link(obj)

    known_materials = set(material_ids)
    for material in bpy.data.materials:
        if material in before_materials:
            continue
        base = NAME_SUFFIX.sub("", material.name)
        if base in known_materials:
            material[MATERIAL_PROP] = base

    found: Dict[str, str] = {}
    for obj in created:
        tag = obj.get("fullscale")
        element_id = tag.get("id") if tag is not None else None
        kind = tag.get("kind") if tag is not None else None
        if not element_id or not kind:
            continue
        obj[ID_PROP] = element_id
        obj[KIND_PROP] = kind
        _lock(obj, kind)
        if kind == "item":
            _use_euler(obj)
            for part in obj.children_recursive:
                part[PART_OF_PROP] = element_id
                part.lock_location = (True, True, True)
                part.lock_rotation = (True, True, True)
                part.lock_scale = (True, True, True)
        if kind in ("item", "wall", "opening", "room"):
            found[element_id] = obj.name
    return found


def _remove_collection() -> None:
    old = collection()
    if old is None:
        return
    for obj in list(old.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)


def _lock(obj: bpy.types.Object, kind: str) -> None:
    movable = kind == "item"
    obj.lock_location = (not movable, not movable, not movable)
    # Furniture turns only about the vertical.
    obj.lock_rotation = (True, True, not movable)
    obj.lock_scale = (True, True, True)


def _use_euler(obj: bpy.types.Object) -> None:
    # The glTF importer gives objects quaternion rotations; a Z angle is what we exchange.
    basis = obj.matrix_basis.copy()
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = basis.to_euler("XYZ")


# ---------- reading and writing poses ----------


def item_object(found: Dict[str, str], element_id: str) -> Optional[bpy.types.Object]:
    name = found.get(element_id)
    return bpy.data.objects.get(name) if name else None


def read_poses(found: Dict[str, str], item_ids: Iterable[str]) -> Dict[str, ItemPose]:
    """Item poses as Blender shows them, in studio terms. Locations are relative to the
    level's object, as the studio's item positions are relative to their level's floor."""
    poses: Dict[str, ItemPose] = {}
    for element_id in item_ids:
        obj = item_object(found, element_id)
        if obj is None:
            continue
        poses[element_id] = ItemPose(blender_to_studio(obj.location), turn_to_studio(obj.rotation_euler.z))
    return poses


def missing_items(found: Dict[str, str], item_ids: Iterable[str]) -> List[str]:
    """Items whose objects the person has deleted in Blender."""
    return [element_id for element_id in item_ids if element_id in found and item_object(found, element_id) is None]


def place_item(found: Dict[str, str], element_id: str, position: Optional[List[float]], rotation: Optional[float]) -> None:
    obj = item_object(found, element_id)
    if obj is None:
        return
    if position is not None:
        obj.location = studio_to_blender(position)
    if rotation is not None:
        obj.rotation_euler = (0.0, 0.0, turn_to_blender(rotation))


# ---------- colours ----------


def _principled(material: bpy.types.Material) -> Optional[bpy.types.Node]:
    if not material.use_nodes or material.node_tree is None:
        return None
    # Found by type, not by name: node names are translated into the person's language.
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def read_colours() -> Dict[str, str]:
    """'#rrggbb' of each studio material, from its Base Color (skipping textured ones)."""
    colours: Dict[str, str] = {}
    for material in bpy.data.materials:
        material_id = material.get(MATERIAL_PROP)
        node = _principled(material) if material_id else None
        if node is None:
            continue
        base = node.inputs.get("Base Color")
        if base is None or base.is_linked:
            continue
        colours[material_id] = linear_to_hex(tuple(base.default_value)[:3])
    return colours


def set_colour(material_id: str, colour: str) -> None:
    for material in bpy.data.materials:
        if material.get(MATERIAL_PROP) != material_id:
            continue
        node = _principled(material)
        base = node.inputs.get("Base Color") if node else None
        if base is not None and not base.is_linked:
            r, g, b = hex_to_linear(colour)
            base.default_value = (r, g, b, 1.0)


# ---------- selection ----------


def selected_element() -> Optional[str]:
    """The element the active object belongs to, if any."""
    obj = bpy.context.view_layer.objects.active
    if obj is None:
        return None
    return obj.get(ID_PROP) or obj.get(PART_OF_PROP)


def lift_selection_to_items(found: Dict[str, str]) -> None:
    """Clicking a part of a piece of furniture selects the whole piece, so it moves as one."""
    active = bpy.context.view_layer.objects.active
    owner_id = active.get(PART_OF_PROP) if active is not None else None
    owner = item_object(found, owner_id) if owner_id else None
    if owner is None:
        return
    active.select_set(False)
    owner.select_set(True)
    bpy.context.view_layer.objects.active = owner


def select_elements(found: Dict[str, str], ids: Iterable[str]) -> None:
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    last = None
    for element_id in ids:
        obj = item_object(found, element_id)
        if obj is not None:
            obj.select_set(True)
            last = obj
    if last is not None:
        bpy.context.view_layer.objects.active = last
