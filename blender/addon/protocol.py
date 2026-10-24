# SPDX-License-Identifier: GPL-3.0-or-later
# The studio's live protocol, as the add-on speaks it: building the messages we send and
# checking the messages we receive. The studio defines the protocol; this file follows it
# and changes only when the studio's protocol version changes.
from __future__ import annotations

import itertools
import json
from typing import Any, Dict, List, Optional

PROTOCOL_VERSION = 1
SOCKET_PATH = "/live"
CLIENT_KIND = "blender"
ACTOR = "blender"
# Keep in step with `version` in blender_manifest.toml (a test checks this).
ADDON_VERSION = "0.1.0"

# Limits the studio enforces; checking them here gives a clear error instead of a refusal.
MAX_IDS = 500
MAX_LABEL_LENGTH = 120
MAX_GROUP_KEY_LENGTH = 64

Message = Dict[str, Any]


class ProtocolError(Exception):
    """A message from the studio that the add-on cannot use."""


class RequestIds:
    """Request ids for messages that get an answer, unique within one Blender session."""

    def __init__(self, prefix: str = "blender") -> None:
        self._prefix = prefix
        self._counter = itertools.count(1)

    def next(self) -> str:
        return f"{self._prefix}-{next(self._counter)}"


# ---------- messages we send ----------


def hello_message(token: str, actor: str = ACTOR) -> Message:
    return {
        "type": "hello",
        "protocol": PROTOCOL_VERSION,
        "client": CLIENT_KIND,
        "token": token,
        "actor": actor,
        "version": ADDON_VERSION,
    }


def ops_message(req: str, operation: Message, label: Optional[str] = None, group_key: Optional[str] = None) -> Message:
    message: Message = {"type": "ops", "req": req, "operation": operation}
    if label:
        message["label"] = shorten(label, MAX_LABEL_LENGTH)
    if group_key:
        message["groupKey"] = group_key[:MAX_GROUP_KEY_LENGTH]
    return message


def history_message(direction: str, req: str) -> Message:
    if direction not in ("undo", "redo"):
        raise ValueError(f"Unknown history direction {direction!r}.")
    return {"type": direction, "req": req}


def select_message(ids: List[str]) -> Message:
    return {"type": "select", "ids": list(ids)[:MAX_IDS]}


def sync_message(req: str) -> Message:
    return {"type": "sync", "req": req}


def encode(message: Message) -> str:
    return json.dumps(message, separators=(",", ":"))


# ---------- operations ----------


def update_item_op(item_id: str, position: Optional[List[float]] = None, rotation: Optional[float] = None) -> Message:
    op: Message = {"op": "updateItem", "id": item_id}
    if position is not None:
        op["position"] = list(position)
    if rotation is not None:
        op["rotation"] = rotation
    return op


def upsert_material_op(material: Message) -> Message:
    return {"op": "upsertMaterial", "material": material}


def remove_op(ids: List[str]) -> Message:
    return {"op": "remove", "ids": list(ids)}


def combine_ops(ops: List[Message], label: str) -> Message:
    """One operation, or a batch when there are several, so the studio applies them as
    one all-or-nothing edit and one undo step."""
    if not ops:
        raise ValueError("Nothing to send.")
    if len(ops) == 1:
        return ops[0]
    return {"op": "batch", "label": shorten(label, MAX_LABEL_LENGTH), "ops": ops}


def shorten(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


# ---------- messages we receive ----------

# For each message type, the fields we rely on and their Python types. Anything else in
# the message is passed through untouched.
_REQUIRED: Dict[str, Dict[str, Any]] = {
    "welcome": {"protocol": int, "actor": str, "rev": int, "home": dict, "undo": dict},
    "changed": {"rev": int, "actor": str, "label": str, "patch": dict, "undo": dict},
    "result": {"req": str, "ok": bool},
    "snapshot": {"rev": int, "home": dict, "undo": dict},
    "highlight": {"actor": str, "ids": list},
    "selection": {"actor": str, "ids": list},
    "render": {"req": str},
    "error": {"code": str, "message": str},
}


def parse_server_message(data: Any) -> Message:
    """Check a decoded JSON message from the studio. Raises ProtocolError with a plain
    sentence if it is not something we can use."""
    if not isinstance(data, dict):
        raise ProtocolError("The studio sent a message that is not a JSON object.")
    kind = data.get("type")
    required = _REQUIRED.get(kind) if isinstance(kind, str) else None
    if required is None:
        raise ProtocolError(f"The studio sent an unknown message type {kind!r}; the add-on may be out of date.")
    for field, expected in required.items():
        value = data.get(field)
        # bool is a subclass of int in Python, so a revision of `true` must be refused here.
        if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
            raise ProtocolError(f"The studio's {kind} message has a missing or wrong {field!r}.")
    if kind == "changed" and not isinstance(data["patch"].get("entries"), list):
        raise ProtocolError("The studio's changed message has a patch without entries.")
    if kind == "result" and not data["ok"]:
        error = data.get("error")
        if not isinstance(error, dict) or not isinstance(error.get("message"), str):
            raise ProtocolError("The studio refused an edit without saying why.")
    return data


def decode(text: str) -> Message:
    try:
        data = json.loads(text)
    except ValueError as error:
        raise ProtocolError("The studio sent a message that is not JSON.") from error
    return parse_server_message(data)


def error_text(result: Message) -> str:
    """The plain sentence from a refused result."""
    error = result.get("error") or {}
    code = error.get("code")
    message = error.get("message") or "The studio refused the edit."
    return f"{message} ({code})" if code else message
