"""Colours from the photos.

Every point of the shape takes its colour from the photos that see it, each photo placed
by its pose. A photo counts for a point only if nothing stands in between (checked against
a depth picture of the shape from that photo's camera). Sharp, close, head-on views count
far more than glancing or blurred ones, so the best view of each spot sets its colour and
the others only fill in.

Brightness is evened out first: the phone's camera changes its exposure as it moves, and
the same wall must not come out lighter in one photo than in the next. White balance needs
no correction, because the capture app locks it for each room.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import open3d as o3d
from PIL import Image

from .capture import Photo
from .geometry import image_camera_to_world, project


@dataclass(frozen=True)
class ColourSettings:
    # Views more glancing than this say little about a surface's colour.
    max_view_angle_deg: float = 75.0
    # Higher favours the single best view more strongly over a blend of views.
    best_view_power: float = 3.0
    # The depth check for "nothing in between" runs at this fraction of the photo's size.
    visibility_scale: float = 0.25
    # Pixels this close to the photo's edge are left out (lens falloff, blur).
    edge_px: int = 8


@dataclass
class ColourResult:
    colours: np.ndarray  # N x 3, sRGB 0..1
    seen: np.ndarray  # N, whether any photo coloured the point
    photos_used: int
    photos_skipped: list[str]


def colour_from_photos(
    mesh: o3d.geometry.TriangleMesh,
    photos: list[Photo],
    settings: ColourSettings,
    progress: Callable[[int, int], None] | None = None,
) -> ColourResult:
    points = np.asarray(mesh.vertices)
    if not mesh.has_vertex_normals():
        mesh.compute_vertex_normals()
    normals = np.asarray(mesh.vertex_normals)
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))

    total = np.zeros((len(points), 3))
    weights = np.zeros(len(points))
    gains = exposure_gains(photos)
    cos_limit = np.cos(np.radians(settings.max_view_angle_deg))
    used, skipped = 0, []
    for i, photo in enumerate(photos):
        try:
            with Image.open(photo.file) as picture:
                image = np.asarray(picture.convert("RGB"), dtype=np.float32) / 255.0
        except OSError as err:
            skipped.append(f"{photo.id}: {err}")
            continue
        if image.shape[:2] != (photo.height, photo.width):
            skipped.append(f"{photo.id}: the picture is {image.shape[1]} x {image.shape[0]}, not {photo.width} x {photo.height} as recorded")
            continue
        index, colour, weight = _one_photo(points, normals, scene, photo, image, settings, cos_limit)
        total[index] += weight[:, None] * colour * gains[i]
        weights[index] += weight
        used += 1
        if progress:
            progress(i + 1, len(photos))

    seen = weights > 0
    colours = np.zeros((len(points), 3))
    colours[seen] = linear_to_srgb(np.clip(total[seen] / weights[seen, None], 0.0, 1.0))
    return ColourResult(colours=colours, seen=seen, photos_used=used, photos_skipped=skipped)


def exposure_gains(photos: list[Photo]) -> np.ndarray:
    """How much to brighten or darken each photo so all match the typical exposure.

    Light reaching the picture grows with exposure time times ISO, so a photo taken at half
    of that is twice as bright once evened out. Photos without both numbers are left as they
    are.
    """
    exposure = np.array([p.exposure_s * p.iso if p.exposure_s and p.iso else np.nan for p in photos])
    known = exposure[np.isfinite(exposure)]
    if known.size == 0:
        return np.ones(len(photos))
    typical = float(np.median(known))
    return np.where(np.isfinite(exposure), typical / exposure, 1.0)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _one_photo(
    points: np.ndarray,
    normals: np.ndarray,
    scene: o3d.t.geometry.RaycastingScene,
    photo: Photo,
    image: np.ndarray,
    settings: ColourSettings,
    cos_limit: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    k = photo.intrinsics
    u, v, z = project(points, photo.pose, k)
    edge = settings.edge_px
    in_view = (z > 0.05) & (u >= edge) & (u <= photo.width - 1 - edge) & (v >= edge) & (v <= photo.height - 1 - edge)
    index = np.flatnonzero(in_view)

    eye = photo.pose[:3, 3]
    to_eye = eye - points[index]
    distance = np.linalg.norm(to_eye, axis=1)
    facing = np.einsum("ij,ij->i", normals[index], to_eye) / distance
    keep = facing > cos_limit
    index, facing, distance = index[keep], facing[keep], distance[keep]

    visible = _visible(scene, photo, u[index], v[index], z[index], settings.visibility_scale)
    index, facing, distance = index[visible], facing[visible], distance[visible]

    colour = srgb_to_linear(_sample(image, u[index], v[index]))
    # Head-on, close and sharp views count most; raising to a power lets the best view lead.
    quality = facing**2 / np.maximum(distance, 0.3) ** 2 / (1.0 + photo.blur_px)
    return index, colour, quality**settings.best_view_power


def _visible(
    scene: o3d.t.geometry.RaycastingScene, photo: Photo, u: np.ndarray, v: np.ndarray, z: np.ndarray, scale: float
) -> np.ndarray:
    """Whether each projected point is the first thing the camera sees at its pixel."""
    width, height = max(int(photo.width * scale), 1), max(int(photo.height * scale), 1)
    k = photo.intrinsics.scaled(width / photo.width, height / photo.height)
    columns, rows = np.meshgrid(np.arange(width), np.arange(height))
    # Through pixel centres, which are at half pixels.
    directions_camera = np.stack([(columns + 0.5 - k.cx) / k.fx, (rows + 0.5 - k.cy) / k.fy, np.ones_like(columns, dtype=float)], axis=-1)
    to_world = image_camera_to_world(photo.pose)
    directions = directions_camera.reshape(-1, 3) @ to_world[:3, :3].T
    lengths = np.linalg.norm(directions, axis=1)
    rays = np.concatenate([np.broadcast_to(to_world[:3, 3], directions.shape), directions / lengths[:, None]], axis=1)
    hit = scene.cast_rays(o3d.core.Tensor(rays.astype(np.float32)))["t_hit"].numpy()
    # Distance along each ray, turned into depth along the view (the ray's z is 1 per length).
    depth_map = (hit / lengths).reshape(height, width)

    column = np.clip(np.floor(u * width / photo.width).astype(int), 0, width - 1)
    row = np.clip(np.floor(v * height / photo.height).astype(int), 0, height - 1)
    nearest = depth_map[row, column]
    # The depth picture is coarse, so allow a little: 2 cm, more for far points.
    return z <= nearest + np.maximum(0.02, 0.01 * z)


def _sample(image: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear sample at pixel coordinates (pixel centres at half pixels)."""
    height, width = image.shape[:2]
    u, v = u - 0.5, v - 0.5
    x0 = np.clip(np.floor(u).astype(int), 0, width - 2)
    y0 = np.clip(np.floor(v).astype(int), 0, height - 2)
    fx = np.clip(u - x0, 0.0, 1.0)[:, None]
    fy = np.clip(v - y0, 0.0, 1.0)[:, None]
    top = image[y0, x0] * (1 - fx) + image[y0, x0 + 1] * fx
    bottom = image[y0 + 1, x0] * (1 - fx) + image[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy
