"""The room's shape, from every depth keyframe.

Each depth frame is placed in the world by its pose and merged into one volume that stores,
for every small cube of space, how far it is from the nearest surface (a truncated signed
distance field). The surface is then taken where that distance is zero. Many frames
averaged this way give a cleaner, more complete shape than the mesh the phone builds live.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import open3d as o3d
import open3d.core as o3c
from PIL import Image

from .capture import CaptureError, DepthFrame, read_depth
from .geometry import RoomBox, intrinsic_matrix, world_to_image_camera

_MM_PER_M = 1000.0


@dataclass(frozen=True)
class FuseSettings:
    voxel_m: float = 0.01
    # LiDAR depth gets noisier with distance; closer frames of the same surface do better.
    max_depth_m: float = 4.0
    # 0 low, 1 medium, 2 high. Low-confidence depth is mostly edges and dark or shiny surfaces.
    min_confidence: int = 1
    # Pieces smaller than this are floating noise, not things in the room.
    min_piece_triangles: int = 400


@dataclass
class FuseResult:
    mesh: o3d.geometry.TriangleMesh
    frames_used: int
    frames_skipped: list[str]


def fuse(frames: list[DepthFrame], settings: FuseSettings, progress: Callable[[int, int], None] | None = None) -> FuseResult:
    # A sparse volume: space is stored in small blocks, only where there are surfaces. Blocks
    # of 8 voxels a side use about half the memory of larger ones for the same result.
    volume = o3d.t.geometry.VoxelBlockGrid(
        attr_names=("tsdf", "weight", "color"),
        attr_dtypes=(o3c.float32, o3c.float32, o3c.float32),
        attr_channels=(1, 1, 3),
        voxel_size=settings.voxel_m,
        block_resolution=8,
        # Grows as needed; this is only the starting size.
        block_count=10_000,
        device=o3c.Device("CPU:0"),
    )
    used, skipped = 0, []
    for i, frame in enumerate(frames):
        try:
            depth_mm, colour = _frame_images(frame, settings)
        except CaptureError as err:
            skipped.append(f"{frame.id}: {err}")
            continue
        depth = o3d.t.geometry.Image(o3c.Tensor(depth_mm))
        picture = o3d.t.geometry.Image(o3c.Tensor(colour))
        k = o3c.Tensor(intrinsic_matrix(frame.intrinsics), o3c.float64)
        extrinsic = o3c.Tensor(world_to_image_camera(frame.pose), o3c.float64)
        blocks = volume.compute_unique_block_coordinates(depth, k, extrinsic, _MM_PER_M, settings.max_depth_m)
        volume.integrate(blocks, depth, picture, k, k, extrinsic, _MM_PER_M, settings.max_depth_m)
        used += 1
        if progress:
            progress(i + 1, len(frames))
    if used == 0:
        raise CaptureError("no_depth", "The capture has no usable depth frames, so there is no shape to build. Scan with a LiDAR phone.")
    mesh = volume.extract_triangle_mesh().to_legacy()
    return FuseResult(mesh=mesh, frames_used=used, frames_skipped=skipped)


def keep_inside(mesh: o3d.geometry.TriangleMesh, boxes: list[RoomBox]) -> o3d.geometry.TriangleMesh:
    """Drop everything outside the scanned rooms, such as what was seen through a window."""
    if not boxes:
        return mesh
    points = np.asarray(mesh.vertices)
    inside = np.zeros(len(points), dtype=bool)
    for box in boxes:
        inside |= box.contains(points)
    mesh.remove_vertices_by_mask(~inside)
    return mesh


def drop_small_pieces(mesh: o3d.geometry.TriangleMesh, min_triangles: int) -> o3d.geometry.TriangleMesh:
    piece_of_triangle, triangles_per_piece, _ = mesh.cluster_connected_triangles()
    piece_of_triangle = np.asarray(piece_of_triangle)
    small = np.asarray(triangles_per_piece)[piece_of_triangle] < min_triangles
    mesh.remove_triangles_by_mask(small)
    mesh.remove_unreferenced_vertices()
    return mesh


def _frame_images(frame: DepthFrame, settings: FuseSettings) -> tuple[np.ndarray, np.ndarray]:
    """Depth in millimetres (0 = none) and a colour picture of the same size."""
    depth, confidence = read_depth(frame)
    depth_mm = np.rint(depth * _MM_PER_M).astype(np.uint16)
    if confidence is not None:
        depth_mm[confidence < settings.min_confidence] = 0
    # The small colour picture saved with each depth frame colours what no photo sees.
    if frame.rgb_file and frame.rgb_file.is_file():
        with Image.open(frame.rgb_file) as picture:
            colour = np.asarray(picture.convert("RGB").resize((frame.width, frame.height), Image.Resampling.BILINEAR))
    else:
        colour = np.full((frame.height, frame.width, 3), 160, dtype=np.uint8)
    return np.ascontiguousarray(depth_mm), np.ascontiguousarray(colour)
