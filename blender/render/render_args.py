# SPDX-License-Identifier: GPL-3.0-or-later
# What a render job asks for, read from the command line, and the camera maths. Kept apart
# from Blender so it can be tested anywhere.
#
#   blender -b --factory-startup --python blender/render/render.py -- \
#       --glb home.glb --out picture.png --camera '{"eye":[x,y,z],"target":[x,y,z],"fov":40}' \
#       --preset preview [--blend scene.blend] \
#       [--lighting '{"time":"day","sun":[x,y,z],"windows":[{"centre":[x,y,z],"width":w,"height":h,"inward":[x,y,z]}]}'] \
#       [--files <the home's folder, for pictures on materials>] \
#       [--models '[{"item":id,"file":path,"fit":"uniform","yaw":0,"size":[w,h,d]}]']
#
# The camera, the sun and the windows are in the studio's terms (metres, +Y up); Blender is
# +Z up. `sun` points towards the sun; a window's `inward` points into its room.
from __future__ import annotations

import argparse
import json
import math
from typing import List, NamedTuple, Optional, Sequence, Tuple

Vector3 = Tuple[float, float, float]


class Preset(NamedTuple):
    width: int
    height: int
    samples: int
    # Adaptive sampling stops a pixel once its noise is below this.
    noise_threshold: float


PRESETS = {
    "thumb": Preset(320, 240, 16, 0.1),
    "preview": Preset(1280, 720, 64, 0.05),
    "final": Preset(1920, 1080, 256, 0.01),
}


TIMES = ("day", "evening", "night")


class Window(NamedTuple):
    """A window the daylight comes in through, in Blender's frame."""

    centre: Vector3
    width: float
    height: float
    inward: Vector3


class Lighting(NamedTuple):
    """The light outside: the time of day, which way the sun is (towards it, in Blender's
    frame) and the windows it comes in through."""

    time: str = "day"
    sun: Optional[Vector3] = None
    windows: Tuple[Window, ...] = ()


class OwnModel(NamedTuple):
    """The person's own model for an item: its file on this computer, how to fit it, and the
    item's real size [width, height, depth]."""

    item: str
    file: str
    fit: str
    yaw: float
    size: Vector3


class Job(NamedTuple):
    glb: str
    out: str
    eye: Vector3
    target: Vector3
    fov: float
    preset: Preset
    # Also save the scene as a Blender file here, to open and look around in.
    blend: Optional[str] = None
    lighting: Lighting = Lighting()
    # The home's folder, where pictures on materials live.
    files: Optional[str] = None
    models: Tuple[OwnModel, ...] = ()


class JobError(Exception):
    """The job's arguments can't be used."""


def parse_job(argv: List[str]) -> Job:
    """Read the arguments after Blender's "--"."""
    parser = argparse.ArgumentParser(prog="render.py", add_help=False)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--camera", required=True)
    parser.add_argument("--preset", default="preview", choices=sorted(PRESETS))
    parser.add_argument("--blend")
    parser.add_argument("--lighting")
    parser.add_argument("--files")
    parser.add_argument("--models")
    try:
        args = parser.parse_args(argv)
    except SystemExit as error:  # argparse exits on bad arguments; report instead
        raise JobError("The render arguments are wrong: " + " ".join(argv)) from error
    try:
        camera = json.loads(args.camera)
        eye = _vector(camera["eye"])
        target = _vector(camera["target"])
        fov = float(camera.get("fov", 40))
    except (ValueError, KeyError, TypeError) as error:
        raise JobError('The camera must be {"eye": [x, y, z], "target": [x, y, z], "fov": degrees}.') from error
    if not 10 <= fov <= 120:
        raise JobError("The field of view must be between 10 and 120 degrees.")
    if math.dist(eye, target) < 1e-6:
        raise JobError("The camera's eye and target are the same point.")
    lighting = parse_lighting(args.lighting) if args.lighting else Lighting()
    models = parse_models(args.models) if args.models else ()
    return Job(args.glb, args.out, eye, target, fov, PRESETS[args.preset], args.blend, lighting, args.files, models)


def parse_models(text: str) -> Tuple[OwnModel, ...]:
    """Read the --models argument: [{"item", "file", "fit", "yaw", "size": [w, h, d]}]."""
    try:
        models = tuple(
            OwnModel(str(m["item"]), str(m["file"]), str(m.get("fit", "uniform")), float(m.get("yaw", 0)), _vector(m["size"])) for m in json.loads(text)
        )
    except (ValueError, KeyError, TypeError) as error:
        raise JobError('The models must be [{"item": id, "file": path, "fit": "uniform" | "stretch", "yaw": degrees, "size": [w, h, d]}].') from error
    if any(min(m.size) <= 0 for m in models):
        raise JobError("An item's size must be more than 0 each way.")
    return models


def parse_lighting(text: str) -> Lighting:
    """Read the --lighting argument (studio frame) into Blender's frame."""
    try:
        value = json.loads(text)
        time = value.get("time", "day")
        sun = _unit(studio_to_blender(_vector(value["sun"]))) if value.get("sun") is not None else None
        windows = tuple(
            Window(
                studio_to_blender(_vector(w["centre"])),
                float(w["width"]),
                float(w["height"]),
                _unit(studio_to_blender(_vector(w["inward"]))),
            )
            for w in value.get("windows", [])
        )
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise JobError('The lighting must be {"time": "day" | "evening" | "night", "sun": [x, y, z], "windows": [...]}.') from error
    if time not in TIMES:
        raise JobError(f'The time of day must be one of {", ".join(TIMES)}, not "{time}".')
    if any(w.width <= 0 or w.height <= 0 for w in windows):
        raise JobError("A window's width and height must be more than 0.")
    return Lighting(time, sun, windows)


def _unit(v: Vector3) -> Vector3:
    length = math.sqrt(_dot(v, v))
    if length < 1e-9:
        raise ValueError("a direction can't be zero")
    return (v[0] / length, v[1] / length, v[2] / length)


def _vector(value: Sequence[float]) -> Vector3:
    if len(value) != 3:
        raise ValueError("a point has three numbers")
    x, y, z = (float(v) for v in value)
    if not all(math.isfinite(v) for v in (x, y, z)):
        raise ValueError("points are finite numbers")
    return (x, y, z)


def studio_to_blender(point: Vector3) -> Vector3:
    x, y, z = point
    return (x, -z, y)


def look_at_euler(eye: Vector3, target: Vector3) -> Vector3:
    """Blender XYZ Euler angles (radians) that turn a camera at `eye` to face `target`. Both
    are in Blender's frame. A camera looks along its local -Z with local +Y up."""
    forward = _normalise(_sub(target, eye))
    world_up = (0.0, 0.0, 1.0)
    if abs(_dot(forward, world_up)) > 0.9999:
        # Looking straight up or down: let image-up be +Y (north on the studio's plan is -z,
        # which is +Y in Blender).
        world_up = (0.0, 1.0, 0.0)
    right = _normalise(_cross(forward, world_up))
    up = _cross(right, forward)
    back = (-forward[0], -forward[1], -forward[2])
    # Rotation matrix with columns right, up, back, written as rows r[i][j].
    r = [[right[i], up[i], back[i]] for i in range(3)]
    # Blender's XYZ order means R = Rz · Ry · Rx.
    beta = math.asin(max(-1.0, min(1.0, -r[2][0])))
    if abs(math.cos(beta)) > 1e-9:
        alpha = math.atan2(r[2][1], r[2][2])
        gamma = math.atan2(r[1][0], r[0][0])
    else:
        alpha = 0.0
        gamma = math.atan2(-r[0][1], r[1][1])
    return (alpha, beta, gamma)


def euler_matrix(angles: Vector3) -> List[List[float]]:
    """The rotation matrix for XYZ Euler angles (R = Rz · Ry · Rx); for checking."""
    a, b, c = angles
    rx = [[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]]
    ry = [[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]]
    rz = [[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]]
    return _matmul(rz, _matmul(ry, rx))


def _matmul(a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _sub(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Vector3, b: Vector3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vector3, b: Vector3) -> Vector3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _normalise(v: Vector3) -> Vector3:
    length = math.sqrt(_dot(v, v))
    return (v[0] / length, v[1] / length, v[2] / length)
