"""Building a room model from a capture: shape, then colours, then the files.

The model is written into the capture's `built/` folder: `room.glb` (the coloured shape, in
the capture's own world frame, so it lines up with the capture's photos and with its
`toHome` placement in a home) and `build.json` (what was built, from what, and with which
settings, so a model can always be traced back and rebuilt).
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import open3d as o3d

from . import __version__
from .capture import CaptureError, read_capture
from .colour import ColourSettings, colour_from_photos
from .fuse import FuseSettings, drop_small_pieces, fuse, keep_inside
from .geometry import room_boxes
from .glb import write_glb

REPORT_FORMAT = "fullscale-build/1"
# How far outside the scanned walls the model keeps going: enough for wall thickness, trim
# and a door left open, without the street seen through the window.
ROOM_MARGIN_M = 0.15


@dataclass(frozen=True)
class BuildSettings:
    fuse: FuseSettings = field(default_factory=FuseSettings)
    colour: ColourSettings = field(default_factory=ColourSettings)


@dataclass
class BuildReport:
    capture: str
    model: str
    points: int
    triangles: int
    coloured_share: float
    frames_used: int
    photos_used: int
    seconds: float
    problems: list[str]


def build(
    capture_folder: str | Path,
    out_folder: str | Path | None = None,
    settings: BuildSettings | None = None,
    say: Callable[[str], None] = lambda _: None,
) -> BuildReport:
    settings = settings or BuildSettings()
    started = time.monotonic()
    capture = read_capture(capture_folder)
    out = Path(out_folder) if out_folder else capture.folder / "built"
    out.mkdir(parents=True, exist_ok=True)
    say(f"Capture {capture.id}: {len(capture.frames)} depth frames, {len(capture.photos)} photos, {len(capture.walls)} scanned walls.")

    say("Building the shape from the depth frames…")
    fused = fuse(capture.frames, settings.fuse, _every_tenth("depth frames", say))
    mesh = fused.mesh
    boxes = room_boxes(capture.walls, ROOM_MARGIN_M)
    mesh = keep_inside(mesh, boxes)
    mesh = drop_small_pieces(mesh, settings.fuse.min_piece_triangles)
    mesh.compute_vertex_normals()
    if len(mesh.triangles) == 0:
        raise CaptureError("empty_model", f"Nothing was left of capture {capture.id} after cutting it to its rooms. Check that its walls were scanned.")

    say(f"Colouring {len(mesh.vertices):,} points from the photos…")
    coloured = colour_from_photos(mesh, capture.photos, settings.colour, _every_tenth("photos", say))
    # Points no photo saw keep the colour of the small pictures saved with the depth frames.
    colours = np.where(coloured.seen[:, None], coloured.colours, np.asarray(mesh.vertex_colors))

    model = out / "room.glb"
    size = write_glb(
        model,
        np.asarray(mesh.vertices),
        np.asarray(mesh.vertex_normals),
        colours,
        np.asarray(mesh.triangles),
        name=f"scan {capture.id}",
        extras={"capture": capture.id, "frame": "capture world, metres, +Y up"},
    )
    problems = capture.problems + fused.frames_skipped + coloured.photos_skipped
    if not capture.walls:
        problems.append("No scanned walls, so nothing seen through windows or doors was cut away.")
    report = BuildReport(
        capture=capture.id,
        model=model.name,
        points=len(mesh.vertices),
        triangles=len(mesh.triangles),
        coloured_share=round(float(coloured.seen.mean()), 4),
        frames_used=fused.frames_used,
        photos_used=coloured.photos_used,
        seconds=round(time.monotonic() - started, 1),
        problems=problems,
    )
    _write_report(out / "build.json", report, settings)
    say(
        f"Wrote {model} ({size / 1e6:.1f} MB): {report.points:,} points, {report.triangles:,} triangles, "
        f"{report.coloured_share:.0%} coloured from photos, in {report.seconds:.0f} s."
    )
    for problem in problems:
        say(f"Note: {problem}")
    return report


def _write_report(file: Path, report: BuildReport, settings: BuildSettings) -> None:
    document = {
        "format": REPORT_FORMAT,
        "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "builder": {"version": __version__, "open3d": o3d.__version__},
        "settings": asdict(settings),
        **asdict(report),
    }
    file.write_text(json.dumps(_camel_case(document), indent=2) + "\n")


def _camel_case(value):
    """Keys in camelCase, like every other Fullscale file."""
    if isinstance(value, dict):
        return {_camel(k): _camel_case(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_camel_case(v) for v in value]
    return value


def _camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def _every_tenth(what: str, say: Callable[[str], None]) -> Callable[[int, int], None]:
    def progress(done: int, total: int) -> None:
        if done == total or done % max(total // 10, 1) == 0:
            say(f"  {done}/{total} {what}")

    return progress
