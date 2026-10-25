"""A made-up capture for tests: a closed box room with a cube on the floor.

Depth frames and photos are rendered exactly from known surfaces, so the room builder's
results can be checked against the true shape and colours. Nothing here comes from a real
home.
"""

from __future__ import annotations

import json
import math
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

ROOM_MIN = np.array([0.0, 0.0, 0.0])
ROOM_MAX = np.array([4.0, 2.6, 3.0])
CUBE_MIN = np.array([1.7, 0.0, 1.2])
CUBE_MAX = np.array([2.3, 0.6, 1.8])
# A dark stripe on the far wall (z = 3) checks that photo colours land in the right place.
STRIPE_X = (1.8, 2.2)

# sRGB colours, each below 200 so a brighter photo can't clip them.
COLOURS = {
    "wall_x0": (190, 60, 50),
    "wall_x1": (60, 170, 80),
    "wall_z0": (60, 90, 190),
    "wall_z1": (200, 180, 60),
    "stripe": (30, 30, 30),
    "floor": (150, 120, 90),
    "ceiling": (200, 200, 200),
    "cube": (130, 60, 160),
}
_SURFACES = list(COLOURS)

DEPTH_SIZE = (64, 48)
PHOTO_SIZE = (160, 120)
BASE_EXPOSURE_S, BASE_ISO = 0.01, 400.0


@dataclass(frozen=True)
class View:
    eye: tuple[float, float, float]
    target: tuple[float, float, float]
    # Light reaching the photo compared with the typical photo (exposure time x ISO).
    light: float = 1.0


def look_at(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    """A camera-to-world pose in capture axes: +x right, +y up, looking along -z."""
    back = eye - target
    back /= np.linalg.norm(back)
    right = np.cross([0.0, 1.0, 0.0], back)
    right /= np.linalg.norm(right)
    up = np.cross(back, right)
    pose = np.eye(4)
    pose[:3, 0], pose[:3, 1], pose[:3, 2], pose[:3, 3] = right, up, back, eye
    return pose


def standard_views() -> list[View]:
    views = []
    for i, (x, z) in enumerate([(1.0, 0.8), (3.0, 0.8), (1.0, 2.3), (3.0, 2.3), (2.0, 0.5), (0.6, 1.5), (3.4, 1.5)]):
        eye = (x, 1.5, z)
        for j, turn in enumerate(range(0, 360, 45)):
            angle = math.radians(turn)
            for k, drop in enumerate((0.0, 1.2)):
                target = (x + math.sin(angle), 1.5 - drop, z - math.cos(angle))
                # One photo in four is half as bright, as when the camera re-exposes.
                light = 0.5 if (i + j + k) % 4 == 0 else 1.0
                views.append(View(eye, target, light))
    return views


def render(pose: np.ndarray, fx: float, size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Depth along the view (metres) and the surface index seen at every pixel."""
    width, height = size
    cx, cy = width / 2, height / 2
    columns, rows = np.meshgrid(np.arange(width), np.arange(height))
    # Through pixel centres (half pixels). Image axes: +y down, +z forward; with z = 1, the
    # distance along a ray is the depth.
    directions = np.stack([(columns + 0.5 - cx) / fx, (rows + 0.5 - cy) / fx, np.ones(columns.shape)], -1).reshape(-1, 3)
    to_world = pose @ np.diag([1.0, -1.0, -1.0, 1.0])
    d = directions @ to_world[:3, :3].T
    o = to_world[:3, 3]

    with np.errstate(divide="ignore", invalid="ignore"):
        exit_planes = np.where(d > 0, (ROOM_MAX - o) / d, (ROOM_MIN - o) / d)
    exit_planes[~np.isfinite(exit_planes)] = np.inf
    axis = np.argmin(exit_planes, axis=1)
    t = exit_planes[np.arange(len(d)), axis]
    positive = d[np.arange(len(d)), axis] > 0
    hit = o + d * t[:, None]
    surface = np.select(
        [(axis == 0) & ~positive, (axis == 0) & positive, (axis == 2) & ~positive, (axis == 2) & positive, (axis == 1) & ~positive],
        [0, 1, 2, 3, 5],
        default=6,
    )
    on_stripe = (surface == 3) & (hit[:, 0] >= STRIPE_X[0]) & (hit[:, 0] <= STRIPE_X[1])
    surface = np.where(on_stripe, 4, surface)

    with np.errstate(divide="ignore", invalid="ignore"):
        low, high = (CUBE_MIN - o) / d, (CUBE_MAX - o) / d
    near = np.nanmax(np.minimum(low, high), axis=1)
    far = np.nanmin(np.maximum(low, high), axis=1)
    cube = (near <= far) & (near > 0) & (near < t)
    t = np.where(cube, near, t)
    surface = np.where(cube, 7, surface)
    return t.reshape(height, width), surface.reshape(height, width)


def write_capture(folder: Path, views: list[View] | None = None, noise_mm: float = 3.0, ghost_frames: int = 3) -> Path:
    """Write the capture and return its folder. `ghost_frames` frames carry a band of wrong
    depth marked low confidence, which the builder must leave out."""
    views = views or standard_views()
    rng = np.random.default_rng(7)
    (folder / "frames").mkdir(parents=True)
    (folder / "photos").mkdir()
    (folder / "rooms" / "r1").mkdir(parents=True)
    palette = np.array([COLOURS[name] for name in _SURFACES], dtype=np.float64) / 255.0
    palette_linear = np.where(palette <= 0.04045, palette / 12.92, ((palette + 0.055) / 1.055) ** 2.4)

    frames, photos = [], []
    for i, view in enumerate(views):
        pose = look_at(np.array(view.eye), np.array(view.target))
        flat_pose = pose.T.reshape(-1).tolist()

        depth_fx = 48.0
        depth, surface = render(pose, depth_fx, DEPTH_SIZE)
        depth_mm = np.clip(np.rint(depth * 1000 + rng.normal(0, noise_mm, depth.shape)), 0, 65535).astype("<u2")
        confidence = np.full(depth.shape, 2, dtype="u1")
        if i < ghost_frames:
            depth_mm[10:14, :] = np.clip(depth_mm[10:14, :].astype(int) - 500, 1, None).astype("<u2")
            confidence[10:14, :] = 0
        name = f"f{i:06d}"
        _deflate(folder / "frames" / f"{name}.depth", depth_mm.tobytes())
        _deflate(folder / "frames" / f"{name}.conf", confidence.tobytes())
        Image.fromarray(_srgb_bytes(palette[surface])).save(folder / "frames" / f"{name}.jpg", quality=95)
        frames.append({
            "id": name, "t": float(i), "room": "r1", "pose": flat_pose,
            "depth": {"file": f"frames/{name}.depth", "width": DEPTH_SIZE[0], "height": DEPTH_SIZE[1], "intrinsics": _intrinsics(depth_fx, DEPTH_SIZE)},
            "confidence": {"file": f"frames/{name}.conf"},
            "rgb": {"file": f"frames/{name}.jpg", "width": DEPTH_SIZE[0], "height": DEPTH_SIZE[1], "intrinsics": _intrinsics(depth_fx, DEPTH_SIZE)},
        })

        photo_fx = 120.0
        _, photo_surface = render(pose, photo_fx, PHOTO_SIZE)
        linear = palette_linear[photo_surface] * view.light
        srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)
        name = f"p{i}"
        Image.fromarray(_srgb_bytes(srgb)).save(folder / "photos" / f"{name}.jpg", quality=95)
        photos.append({
            "id": name, "file": f"photos/{name}.jpg", "room": "r1", "kind": "auto", "t": float(i),
            "width": PHOTO_SIZE[0], "height": PHOTO_SIZE[1], "pose": flat_pose, "intrinsics": _intrinsics(photo_fx, PHOTO_SIZE),
            "tracking": "normal", "blurPx": 0.5,
            "camera": {"exposureS": BASE_EXPOSURE_S * view.light, "iso": BASE_ISO, "evOffset": 0, "whiteBalanceGains": [2, 1, 1.8], "whiteBalanceLocked": True, "exposureLocked": False},
        })

    _write_lines(folder / "frames" / "index.jsonl", frames)
    _write_lines(folder / "photos" / "index.jsonl", photos)
    (folder / "rooms" / "r1" / "roomplan.json").write_text(json.dumps({"walls": _walls()}))
    (folder / "manifest.json").write_text(json.dumps({
        "format": "fullscale-capture/1", "revision": 1, "id": folder.name, "status": "complete", "tier": 1,
        "rooms": [{"id": "r1", "name": "Test room", "dir": "rooms/r1", "startedAt": "2026-01-01T00:00:00Z"}],
    }))
    return folder


def nearest_surface_distance(points: np.ndarray) -> np.ndarray:
    """How far each point is from the true room or cube surface, in metres."""
    to_room = np.min(np.concatenate([points - ROOM_MIN, ROOM_MAX - points], axis=1), axis=1)
    outside_cube = np.maximum(np.maximum(CUBE_MIN - points, points - CUBE_MAX), 0)
    inside_cube = np.min(np.concatenate([points - CUBE_MIN, CUBE_MAX - points], axis=1), axis=1)
    to_cube = np.where(np.all(outside_cube == 0, axis=1), inside_cube, np.linalg.norm(outside_cube, axis=1))
    return np.minimum(np.abs(to_room), to_cube)


def _walls() -> list[dict]:
    """The four walls as the phone's scanner writes them: x along the wall, centred."""
    height = float(ROOM_MAX[1])
    walls = []
    for start, end in [((0, 0), (4, 0)), ((4, 0), (4, 3)), ((4, 3), (0, 3)), ((0, 3), (0, 0))]:
        a, b = np.array(start, float), np.array(end, float)
        along = (b - a) / np.linalg.norm(b - a)
        centre = (a + b) / 2
        matrix = np.eye(4)
        matrix[:3, 0] = [along[0], 0, along[1]]
        matrix[:3, 1] = [0, 1, 0]
        matrix[:3, 2] = np.cross(matrix[:3, 0], matrix[:3, 1])
        matrix[:3, 3] = [centre[0], height / 2, centre[1]]
        walls.append({"identifier": f"w{len(walls)}", "transform": matrix.T.reshape(-1).tolist(), "dimensions": [float(np.linalg.norm(b - a)), height, 0]})
    return walls


def _intrinsics(fx: float, size: tuple[int, int]) -> dict:
    return {"fx": fx, "fy": fx, "cx": size[0] / 2, "cy": size[1] / 2}


def _srgb_bytes(colour: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(colour * 255), 0, 255).astype(np.uint8)


def _deflate(file: Path, data: bytes) -> None:
    packer = zlib.compressobj(wbits=-15)
    file.write_bytes(packer.compress(data) + packer.flush())


def _write_lines(file: Path, records: list[dict]) -> None:
    file.write_text("".join(json.dumps(r) + "\n" for r in records))
