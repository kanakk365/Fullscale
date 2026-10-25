"""Writing a coloured mesh as a GLB file (binary glTF 2.0).

Colours are stored per point. The material is unlit: the colours come from photos and
already hold the room's real light, so lighting them again would darken and double-shade
them. Units are metres and +Y is up, as in the capture and in glTF.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

_FLOAT, _UNSIGNED_SHORT, _UNSIGNED_INT = 5126, 5123, 5125
_ARRAY_BUFFER, _ELEMENT_ARRAY_BUFFER = 34962, 34963


def write_glb(
    file: Path,
    positions: np.ndarray,
    normals: np.ndarray,
    colours: np.ndarray,
    triangles: np.ndarray,
    name: str,
    extras: dict,
) -> int:
    """Write the mesh and return the file's size in bytes. `colours` are sRGB, 0..1."""
    positions = np.ascontiguousarray(positions, dtype="<f4")
    normals = np.ascontiguousarray(normals, dtype="<f4")
    rgba = np.ones((len(colours), 4), dtype=np.float64)
    rgba[:, :3] = np.clip(colours, 0.0, 1.0)
    # glTF vertex colours are linear; the photos' colours are sRGB. 16 bits keep dark
    # colours smooth once linear (8 bits would leave visible steps in shadows).
    rgba[:, :3] = np.where(rgba[:, :3] <= 0.04045, rgba[:, :3] / 12.92, ((rgba[:, :3] + 0.055) / 1.055) ** 2.4)
    colour_values = np.ascontiguousarray(np.rint(rgba * 65535), dtype="<u2")
    indices = np.ascontiguousarray(triangles, dtype="<u4").reshape(-1)

    chunks, views, accessors = [], [], []
    offset = 0

    def add(data: np.ndarray, target: int, component: int, kind: str, count: int, normalized: bool = False, bounds: bool = False) -> int:
        nonlocal offset
        raw = data.tobytes()
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": target})
        accessor = {"bufferView": len(views) - 1, "componentType": component, "count": count, "type": kind}
        if normalized:
            accessor["normalized"] = True
        if bounds:
            accessor["min"] = data.min(axis=0).astype(float).tolist()
            accessor["max"] = data.max(axis=0).astype(float).tolist()
        accessors.append(accessor)
        padded = raw + b"\0" * (-len(raw) % 4)
        chunks.append(padded)
        offset += len(padded)
        return len(accessors) - 1

    position = add(positions, _ARRAY_BUFFER, _FLOAT, "VEC3", len(positions), bounds=True)
    normal = add(normals, _ARRAY_BUFFER, _FLOAT, "VEC3", len(normals))
    colour = add(colour_values, _ARRAY_BUFFER, _UNSIGNED_SHORT, "VEC4", len(colour_values), normalized=True)
    index = add(indices, _ELEMENT_ARRAY_BUFFER, _UNSIGNED_INT, "SCALAR", len(indices))

    document = {
        "asset": {"version": "2.0", "generator": "Fullscale room builder"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name, "extras": extras}],
        "meshes": [
            {
                "name": name,
                "primitives": [{"attributes": {"POSITION": position, "NORMAL": normal, "COLOR_0": colour}, "indices": index, "material": 0}],
            }
        ],
        "materials": [
            {
                "name": "photo colours",
                "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1},
                "extensions": {"KHR_materials_unlit": {}},
            }
        ],
        "buffers": [{"byteLength": offset}],
        "bufferViews": views,
        "accessors": accessors,
    }
    json_bytes = json.dumps(document, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary = b"".join(chunks)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    with open(file, "wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, total))
        out.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        out.write(json_bytes)
        out.write(struct.pack("<I4s", len(binary), b"BIN\0"))
        out.write(binary)
    return total


def read_glb(file: Path) -> tuple[dict, bytes]:
    """The JSON document and binary chunk of a GLB file, checking its structure."""
    data = Path(file).read_bytes()
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("not a glTF 2.0 binary file")
    json_length, json_type = struct.unpack_from("<I4s", data, 12)
    if json_type != b"JSON":
        raise ValueError("the first chunk is not JSON")
    document = json.loads(data[20 : 20 + json_length])
    bin_start = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<I4s", data, bin_start)
    if bin_type != b"BIN\0":
        raise ValueError("the second chunk is not binary")
    return document, data[bin_start + 8 : bin_start + 8 + bin_length]
