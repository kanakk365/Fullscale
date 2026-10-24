# SPDX-License-Identifier: GPL-3.0-or-later
# Fullscale for Blender: a live link to the Fullscale studio on this computer.
#
# The add-on connects out to the studio (it never listens on a port and never runs code it
# receives), builds the home from the studio's 3D file, and sends furniture moves, turns,
# colour changes and deletions back as ordinary studio edits, so the studio's rules and undo
# apply to them as to any other edit.
#
# Blender is imported only when the add-on is switched on, so the parts that don't need it
# (the WebSocket client, the protocol, change tracking) can be tested with plain Python.


def register() -> None:
    from . import ui

    ui.register()


def unregister() -> None:
    from . import ui

    ui.unregister()
