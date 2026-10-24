# SPDX-License-Identifier: GPL-3.0-or-later
# The add-on inside Blender: the timer that does all the work, the handlers, and the panel.
#
# Blender pitfalls this file is shaped around:
# - bpy may only be used on the main thread, so all Blender work happens in ONE timer
#   registered from the main thread. Timers registered from other threads can be lost.
# - A timer that raises an exception is silently unregistered, so the timer catches
#   everything and shows it in the panel instead.
# - The depsgraph handler fires many times a second during a drag, so it only notes that
#   something changed; the timer compares and sends after a short pause.
from __future__ import annotations

import os
import queue
import time
import traceback
from typing import Dict, List, Optional

import bpy
from bpy.app.handlers import persistent

from . import scene
from .changes import KnownState, edits_for, item_moves
from .link import StudioLink
from .protocol import RequestIds, combine_ops, error_text, history_message, ops_message, select_message, sync_message
from .run_folder import DEFAULT_RUN_FOLDER

# Send local changes after this long without further changes (a drag in progress).
QUIET_SECONDS = 0.3
# The timer runs this often while anything is happening, and slows down when idle.
BUSY_INTERVAL = 0.05
IDLE_INTERVAL = 1.0
IDLE_AFTER_SECONDS = 5.0


class Session:
    """Everything the link knows; one per Blender session."""

    def __init__(self) -> None:
        self.link: Optional[StudioLink] = None
        self.ids = RequestIds()
        self.status = "Not connected"
        self.note = ""
        self.rev = -1
        self.known = KnownState()
        self.found: Dict[str, str] = {}
        self.dirty_since: Optional[float] = None
        self.last_activity = 0.0
        self.last_selected: Optional[str] = None

    @property
    def connected(self) -> bool:
        return self.link is not None and self.link.running

    def connect(self, run_folder: str) -> None:
        self.disconnect()
        self.link = StudioLink(run_folder)
        self.link.start()
        self.status = "Connecting…"

    def disconnect(self) -> None:
        if self.link is not None:
            self.link.stop()
        self.link = None
        self.status = "Not connected"

    def send(self, message: dict) -> None:
        if self.link is not None:
            self.link.send(message)

    # ---------- the timer's work ----------

    def step(self) -> bool:
        """Handle what arrived and send what changed. True when there was work."""
        if self.link is None:
            return False
        busy = False
        while True:
            try:
                kind, value = self.link.inbox.get_nowait()
            except queue.Empty:
                break
            busy = True
            self._handle(kind, value)
        scene.lift_selection_to_items(self.found)
        self._send_selection()
        if self.dirty_since is not None and time.monotonic() - self.dirty_since >= QUIET_SECONDS:
            self.dirty_since = None
            self._send_local_changes()
            busy = True
        return busy

    def _handle(self, kind: str, value: object) -> None:
        if kind == "connected":
            self.status = "Connected; loading the home…"
        elif kind == "lost":
            self.status = f"Not connected: {value}"
        elif kind == "problem":
            self.note = str(value)
        elif kind == "glb":
            path, rev = value  # type: ignore[misc]
            try:
                self.found = scene.build_from_glb(path, self.known.materials.keys())
            finally:
                os.remove(path)
            self.status = f"Live · revision {self.rev}"
        elif kind == "message":
            self._message(value)  # type: ignore[arg-type]

    def _message(self, message: dict) -> None:
        kind = message["type"]
        if kind in ("welcome", "snapshot"):
            self.rev = message["rev"]
            self.known = KnownState.from_home(message["home"])
            self.link.request_glb()  # type: ignore[union-attr]
        elif kind == "changed":
            if message["rev"] != self.rev + 1:
                # A change went missing: start again from the whole home.
                self.send(sync_message(self.ids.next()))
                return
            self.rev = message["rev"]
            self.known.apply_patch(message["patch"])
            moves = item_moves(message["patch"])
            if moves is None:
                self.link.request_glb()  # type: ignore[union-attr]
            else:
                for element_id, fields in moves.items():
                    scene.place_item(self.found, element_id, fields.get("position"), fields.get("rotation"))
            self.status = f"Live · revision {self.rev}"
            if message["actor"] != "blender":
                self.note = f"{message['actor']}: {message['label']}"
        elif kind == "result" and not message["ok"]:
            # Refused: put Blender back to what the studio has.
            self.note = error_text(message)
            for element_id, pose in self.known.items.items():
                scene.place_item(self.found, element_id, list(pose.position), pose.rotation)
            for material_id, material in self.known.materials.items():
                scene.set_colour(material_id, material.get("color", "#cccccc"))
        elif kind == "highlight":
            scene.select_elements(self.found, message["ids"])
            self.note = f"{message['actor']}: {message.get('note') or 'look at ' + ', '.join(message['ids'])}"
        elif kind == "error":
            self.note = message["message"]

    def _send_local_changes(self) -> None:
        if not self.found or self.rev < 0:
            return
        items = list(self.known.items)
        poses = scene.read_poses(self.found, items)
        missing = scene.missing_items(self.found, items)
        ops = edits_for(self.known, poses, scene.read_colours(), missing)
        if not ops:
            return
        label = "Change in Blender" if len(ops) > 1 else _label(ops[0])
        self.send(ops_message(self.ids.next(), combine_ops(ops, label), label=label))

    def _send_selection(self) -> None:
        selected = scene.selected_element()
        if selected == self.last_selected:
            return
        self.last_selected = selected
        self.send(select_message([selected] if selected else []))


def _label(op: dict) -> str:
    kind = op.get("op")
    if kind == "updateItem":
        return f"Move {op['id']} in Blender"
    if kind == "upsertMaterial":
        return f"Recolour {op['material'].get('name', op['material']['id'])} in Blender"
    return "Delete in Blender"


session = Session()


def tick() -> float:
    try:
        if session.step():
            session.last_activity = time.monotonic()
    except Exception as error:  # A timer that raises is dropped for good; keep it alive.
        session.note = f"Error: {error}"
        traceback.print_exc()
    idle = time.monotonic() - session.last_activity > IDLE_AFTER_SECONDS
    return IDLE_INTERVAL if idle and session.dirty_since is None else BUSY_INTERVAL


@persistent
def on_depsgraph_update(_scene: bpy.types.Scene, _depsgraph: bpy.types.Depsgraph) -> None:
    # Only note it: the timer compares with the studio's state once the change settles.
    if session.found:
        session.dirty_since = time.monotonic()
        session.last_activity = session.dirty_since


@persistent
def on_load_post(_filepath: str) -> None:
    # Another .blend was opened: its objects are not ours, so rebuild from the studio.
    session.found = {}
    if session.connected:
        session.send(sync_message(session.ids.next()))


# ---------- interface ----------


ADDON = __package__  # the extension's package name, which Blender keys preferences by


class FullscalePreferences(bpy.types.AddonPreferences):
    bl_idname = ADDON

    run_folder: bpy.props.StringProperty(  # type: ignore[valid-type]
        name="Studio run folder",
        description="Where the studio writes its address and token",
        default=DEFAULT_RUN_FOLDER,
        subtype="DIR_PATH",
    )

    def draw(self, _context: bpy.types.Context) -> None:
        self.layout.prop(self, "run_folder")


def _run_folder(context: bpy.types.Context) -> str:
    prefs = context.preferences.addons[ADDON].preferences
    return prefs.run_folder or DEFAULT_RUN_FOLDER


class FULLSCALE_OT_connect(bpy.types.Operator):
    bl_idname = "fullscale.connect"
    bl_label = "Connect"
    bl_description = "Connect to the Fullscale studio running on this computer"

    def execute(self, context: bpy.types.Context) -> set:
        session.connect(_run_folder(context))
        return {"FINISHED"}


class FULLSCALE_OT_disconnect(bpy.types.Operator):
    bl_idname = "fullscale.disconnect"
    bl_label = "Disconnect"

    def execute(self, _context: bpy.types.Context) -> set:
        session.disconnect()
        return {"FINISHED"}


class FULLSCALE_OT_history(bpy.types.Operator):
    bl_idname = "fullscale.history"
    bl_label = "Studio undo"
    bl_description = "Undo or redo your last edit made in Blender, in the studio"

    direction: bpy.props.EnumProperty(items=[("undo", "Undo", ""), ("redo", "Redo", "")])  # type: ignore[valid-type]

    def execute(self, _context: bpy.types.Context) -> set:
        session.send(history_message(self.direction, session.ids.next()))
        return {"FINISHED"}


class FULLSCALE_OT_reload(bpy.types.Operator):
    bl_idname = "fullscale.reload"
    bl_label = "Reload"
    bl_description = "Rebuild the home from the studio"

    def execute(self, _context: bpy.types.Context) -> set:
        session.send(sync_message(session.ids.next()))
        return {"FINISHED"}


class FULLSCALE_PT_panel(bpy.types.Panel):
    bl_label = "Fullscale"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Fullscale"

    def draw(self, _context: bpy.types.Context) -> None:
        layout = self.layout
        layout.label(text=session.status)
        if session.note:
            box = layout.box()
            for line in _wrap(session.note, 40):
                box.label(text=line)
        if session.connected:
            layout.operator("fullscale.disconnect")
            row = layout.row(align=True)
            row.operator("fullscale.history", text="Undo").direction = "undo"
            row.operator("fullscale.history", text="Redo").direction = "redo"
            layout.operator("fullscale.reload")
        else:
            layout.operator("fullscale.connect")
        layout.label(text="Furniture moves and colours sync.")
        layout.label(text="Walls change in the studio.")


def _wrap(text: str, width: int) -> List[str]:
    lines: List[str] = []
    line = ""
    for word in text.split():
        if len(line) + len(word) + 1 > width and line:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


CLASSES = (FullscalePreferences, FULLSCALE_OT_connect, FULLSCALE_OT_disconnect, FULLSCALE_OT_history, FULLSCALE_OT_reload, FULLSCALE_PT_panel)


def register() -> None:
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.app.handlers.depsgraph_update_post.append(on_depsgraph_update)
    bpy.app.handlers.load_post.append(on_load_post)
    bpy.app.timers.register(tick, persistent=True)


def unregister() -> None:
    session.disconnect()
    if bpy.app.timers.is_registered(tick):
        bpy.app.timers.unregister(tick)
    for handlers, handler in ((bpy.app.handlers.depsgraph_update_post, on_depsgraph_update), (bpy.app.handlers.load_post, on_load_post)):
        if handler in handlers:
            handlers.remove(handler)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
