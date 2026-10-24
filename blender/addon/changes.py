# SPDX-License-Identifier: GPL-3.0-or-later
# Keeping Blender and the studio in step without echoes.
#
# The add-on remembers the last state the studio told it about (item poses and material
# colours). Changes made in Blender are compared with that state, and only real differences
# are sent: a drag fires Blender's update handler many times a second, and moving an object
# to where the studio already has it must not send anything back. Changes from the studio
# update the remembered state first, so applying them in Blender is never mistaken for a
# change made in Blender.
from __future__ import annotations

from typing import Any, Dict, List, NamedTuple, Optional, Sequence

from .protocol import Message, remove_op, update_item_op, upsert_material_op

# Smaller differences are float noise from converting between Blender and the studio.
MOVE_TOLERANCE_M = 0.0005
TURN_TOLERANCE_DEG = 0.05


class ItemPose(NamedTuple):
    """An item's pose in studio terms: footprint centre [x, y, z] (y = height of its bottom)
    and turn in degrees."""

    position: Sequence[float]
    rotation: float


def turn_difference(a: float, b: float) -> float:
    """The smaller angle between two turns, in degrees."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def moved(a: ItemPose, b: ItemPose) -> bool:
    far = any(abs(p - q) > MOVE_TOLERANCE_M for p, q in zip(a.position, b.position))
    return far or turn_difference(a.rotation, b.rotation) > TURN_TOLERANCE_DEG


class KnownState:
    """What the studio last said about the things Blender can change."""

    def __init__(self) -> None:
        self.items: Dict[str, ItemPose] = {}
        self.materials: Dict[str, Message] = {}

    @classmethod
    def from_home(cls, home: Message) -> "KnownState":
        state = cls()
        for item in home.get("items", []):
            state.items[item["id"]] = ItemPose(tuple(item["position"]), float(item.get("rotation", 0.0)))
        for material in home.get("materials", []):
            state.materials[material["id"]] = dict(material)
        return state

    def apply_patch(self, patch: Message) -> None:
        """Follow a studio change: the patch's entries, as the studio sent them."""
        for entry in patch.get("entries", []):
            collection = entry.get("collection")
            if collection not in ("items", "materials"):
                continue
            entry_id = entry.get("id")
            op = entry.get("op")
            if op == "delete":
                (self.items if collection == "items" else self.materials).pop(entry_id, None)
            elif op == "create":
                element = entry.get("element", {})
                if collection == "items":
                    self.items[entry_id] = ItemPose(tuple(element["position"]), float(element.get("rotation", 0.0)))
                else:
                    self.materials[entry_id] = dict(element)
            elif op == "update":
                fields = entry.get("fields", {})
                if collection == "items" and entry_id in self.items:
                    pose = self.items[entry_id]
                    position = fields.get("position", {}).get("after", pose.position)
                    rotation = fields.get("rotation", {}).get("after", pose.rotation)
                    self.items[entry_id] = ItemPose(tuple(position), float(rotation))
                elif collection == "materials" and entry_id in self.materials:
                    for name, change in fields.items():
                        if "after" in change:
                            self.materials[entry_id][name] = change["after"]
                        else:
                            self.materials[entry_id].pop(name, None)


def item_moves(patch: Message) -> Optional[Dict[str, Dict[str, Any]]]:
    """If a patch only moves or turns items, the new pose fields by item id; else None (and
    the whole scene should be rebuilt). A move also updates the position's source, which
    Blender doesn't show, so source fields don't count."""
    moves: Dict[str, Dict[str, Any]] = {}
    for entry in patch.get("entries", []):
        if entry.get("op") != "update" or entry.get("collection") != "items":
            return None
        fields = entry.get("fields", {})
        shown = {name: change for name, change in fields.items() if not name.startswith("sources")}
        if not set(shown) <= {"position", "rotation"}:
            return None
        if shown:
            moves[entry["id"]] = {name: change.get("after") for name, change in shown.items()}
    return moves


def edits_for(known: KnownState, poses: Dict[str, ItemPose], colours: Dict[str, str], missing: Sequence[str]) -> List[Message]:
    """The edits that bring the studio to what Blender shows.

    `poses`: items as they stand in Blender; `colours`: '#rrggbb' of materials whose colour
    Blender shows; `missing`: items deleted in Blender."""
    ops: List[Message] = []
    for item_id, pose in sorted(poses.items()):
        before = known.items.get(item_id)
        if before is None or not moved(before, pose):
            continue
        position = [round(v, 4) for v in pose.position]
        rotation = round(pose.rotation, 3)
        ops.append(update_item_op(item_id, position=position, rotation=rotation))
    for material_id, colour in sorted(colours.items()):
        before = known.materials.get(material_id)
        if before is None or before.get("color", "").lower() == colour.lower():
            continue
        ops.append(upsert_material_op({**before, "color": colour.lower()}))
    gone = sorted(item_id for item_id in missing if item_id in known.items)
    if gone:
        ops.append(remove_op(gone))
    return ops
