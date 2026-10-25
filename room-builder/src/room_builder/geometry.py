"""Cameras and room bounds.

Capture poses use the phone's camera axes (+x right, +y up, -z forward). Image maths and
Open3D use +y down and +z forward instead, so every pose is turned once, here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .capture import Intrinsics, Wall

# Turns the capture's camera axes into image axes: y and z flip.
_CAMERA_TO_IMAGE_AXES = np.diag([1.0, -1.0, -1.0, 1.0])


def image_camera_to_world(pose: np.ndarray) -> np.ndarray:
    """A capture pose as a camera-to-world matrix with +y down and +z forward."""
    return pose @ _CAMERA_TO_IMAGE_AXES


def world_to_image_camera(pose: np.ndarray) -> np.ndarray:
    """The inverse: what Open3D calls the extrinsic matrix."""
    return np.linalg.inv(image_camera_to_world(pose))


def intrinsic_matrix(k: Intrinsics) -> np.ndarray:
    return np.array([[k.fx, 0.0, k.cx], [0.0, k.fy, k.cy], [0.0, 0.0, 1.0]])


def project(points: np.ndarray, pose: np.ndarray, k: Intrinsics) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pixel x, pixel y and depth along the view of each world point, for one camera."""
    to_camera = world_to_image_camera(pose)
    p = points @ to_camera[:3, :3].T + to_camera[:3, 3]
    z = p[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        u = k.fx * p[:, 0] / z + k.cx
        v = k.fy * p[:, 1] / z + k.cy
    return u, v, z


@dataclass(frozen=True)
class RoomBox:
    """A scanned room's extent, turned to line up with its walls: x and z in the room's own
    axes, y up. Points outside every room (seen through windows and doors) are dropped."""

    yaw_rad: float
    min_xz: tuple[float, float]
    max_xz: tuple[float, float]
    floor_y: float
    top_y: float

    def contains(self, points: np.ndarray) -> np.ndarray:
        x, z = _turn(points[:, 0], points[:, 2], -self.yaw_rad)
        y = points[:, 1]
        return (
            (x >= self.min_xz[0]) & (x <= self.max_xz[0]) & (z >= self.min_xz[1]) & (z <= self.max_xz[1])
            & (y >= self.floor_y) & (y <= self.top_y)
        )


def room_boxes(walls: list[Wall], margin_m: float) -> list[RoomBox]:
    """One box per room, from the ends of its walls, grown by `margin_m` on every side."""
    boxes = []
    for room in sorted({w.room for w in walls}):
        mine = [w for w in walls if w.room == room]
        yaw = _main_direction(mine)
        ends, bottoms, tops = [], [], []
        for w in mine:
            centre, along = w.transform[:3, 3], w.transform[:3, 0]
            for side in (-0.5, 0.5):
                ends.append(centre + along * w.width_m * side)
            bottoms.append(centre[1] - w.height_m / 2)
            tops.append(centre[1] + w.height_m / 2)
        ends_arr = np.array(ends)
        x, z = _turn(ends_arr[:, 0], ends_arr[:, 2], -yaw)
        boxes.append(
            RoomBox(
                yaw_rad=yaw,
                min_xz=(float(x.min() - margin_m), float(z.min() - margin_m)),
                max_xz=(float(x.max() + margin_m), float(z.max() + margin_m)),
                floor_y=float(min(bottoms) - margin_m),
                top_y=float(max(tops) + margin_m),
            )
        )
    return boxes


def _main_direction(walls: list[Wall]) -> float:
    """The angle most walls run along, folded into a quarter turn (walls meet at right angles
    far more often than not), weighting long walls more."""
    # Angles are multiplied by four so walls at right angles to each other agree.
    s = c = 0.0
    for w in walls:
        along = w.transform[:3, 0]
        angle = math.atan2(along[2], along[0])
        s += w.width_m * math.sin(4 * angle)
        c += w.width_m * math.cos(4 * angle)
    return math.atan2(s, c) / 4


def _turn(x: np.ndarray, z: np.ndarray, angle: float) -> tuple[np.ndarray, np.ndarray]:
    cos, sin = math.cos(angle), math.sin(angle)
    return x * cos - z * sin, x * sin + z * cos
