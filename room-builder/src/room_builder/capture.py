"""Reading a `fullscale-capture/1` folder: depth keyframes, photos and the scanner's walls.

Only what the room builder needs is read, and records it can't use are reported, never
silently dropped. Paths come from the capture's own index files, so each one is checked to
stay inside the capture folder. The format is described in docs/capture-format.md.
"""

from __future__ import annotations

import json
import zlib
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

FORMAT = "fullscale-capture/1"
# Photos that show the room as it is. Card and tape photos have a hand or a card in front.
ROOM_PHOTO_KINDS = ("auto", "manual", "still", "detail")


class CaptureError(Exception):
    """A capture that can't be used, with a stable code and a sentence saying how to fix it."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Intrinsics:
    """Pinhole camera intrinsics in pixels of the image they belong to. Pixel coordinates
    start at the top-left corner of the top-left pixel, so pixel centres are at half pixels
    (as in the capture format, and as Open3D expects)."""

    fx: float
    fy: float
    cx: float
    cy: float

    def scaled(self, sx: float, sy: float) -> Intrinsics:
        """For the same camera at a different image size."""
        return Intrinsics(self.fx * sx, self.fy * sy, self.cx * sx, self.cy * sy)


@dataclass(frozen=True)
class DepthFrame:
    id: str
    room: str | None
    pose: np.ndarray  # 4 x 4 camera-to-world, capture axes (+y up, -z forward)
    depth_file: Path
    confidence_file: Path | None
    width: int
    height: int
    intrinsics: Intrinsics
    rgb_file: Path | None


@dataclass(frozen=True)
class Photo:
    id: str
    room: str | None
    kind: str
    file: Path
    width: int
    height: int
    pose: np.ndarray
    intrinsics: Intrinsics
    blur_px: float
    exposure_s: float | None
    iso: float | None


@dataclass(frozen=True)
class Wall:
    room: str
    transform: np.ndarray  # 4 x 4, the wall's own frame to the world; x along the wall
    width_m: float
    height_m: float


@dataclass
class Capture:
    folder: Path
    id: str
    frames: list[DepthFrame]
    photos: list[Photo]
    walls: list[Wall]
    problems: list[str] = field(default_factory=list)


def pose_matrix(values: list[float]) -> np.ndarray:
    """A 4 x 4 matrix from 16 numbers in column-major order, as the capture stores poses."""
    m = np.asarray(values, dtype=np.float64)
    if m.shape != (16,) or not np.all(np.isfinite(m)):
        raise ValueError("a pose needs 16 finite numbers")
    return m.reshape(4, 4).T


def read_capture(folder: str | Path) -> Capture:
    folder = Path(folder).resolve()
    manifest_file = folder / "manifest.json"
    if not manifest_file.is_file():
        raise CaptureError("not_a_capture", f"{folder} has no manifest.json: give the folder of one capture (unzipped).")
    try:
        manifest = json.loads(manifest_file.read_text())
    except json.JSONDecodeError as err:
        raise CaptureError("bad_manifest", f"{manifest_file} is not valid JSON: {err}.") from err
    if manifest.get("format") != FORMAT:
        raise CaptureError("unknown_format", f"{manifest_file} is not a {FORMAT} capture (format: {manifest.get('format')!r}).")

    capture = Capture(folder=folder, id=str(manifest.get("id", folder.name)), frames=[], photos=[], walls=[])
    for line, record in _json_lines(folder / "frames" / "index.jsonl", capture.problems):
        try:
            capture.frames.append(_depth_frame(folder, record))
        except (KeyError, TypeError, ValueError) as err:
            capture.problems.append(f"frames/index.jsonl line {line}: left out ({err})")
    for line, record in _json_lines(folder / "photos" / "index.jsonl", capture.problems):
        if record.get("kind") not in ROOM_PHOTO_KINDS:
            continue
        try:
            capture.photos.append(_photo(folder, record))
        except (KeyError, TypeError, ValueError) as err:
            capture.problems.append(f"photos/index.jsonl line {line}: left out ({err})")
    for room in manifest.get("rooms", []):
        capture.walls.extend(_walls(folder, room, capture.problems))
    return capture


def read_aligned(main: Capture, folder: str | Path) -> Capture:
    """Another scan of the same room, moved into the main capture's coordinates so their depth
    and photos can be put together. Scans the phone carried on from the main one (relocalized)
    already share its coordinates; others are lined up by the studio when imported as another
    scan of the room, which writes `built/aligned.json`."""
    extra = read_capture(folder)
    aligned = extra.folder / "built" / "aligned.json"
    manifest = json.loads((extra.folder / "manifest.json").read_text())
    adds_to = {(r.get("addsTo") or {}).get("capture") for r in manifest.get("rooms", [])}
    if aligned.is_file():
        try:
            document = json.loads(aligned.read_text())
            matrix = pose_matrix(document["matrix"])
        except (json.JSONDecodeError, KeyError, ValueError) as err:
            raise CaptureError("bad_alignment", f"{aligned} can't be read ({err}); import the scan into the home again.") from err
        if document.get("to") != main.id:
            raise CaptureError("not_aligned", f"Capture {extra.id} is lined up with {document.get('to')}, not {main.id}. Build with that capture first.")
    elif main.id in adds_to and (manifest.get("alignment") or {}).get("method") == "relocalized":
        matrix = np.eye(4)
    else:
        raise CaptureError(
            "not_aligned",
            f"Capture {extra.id} isn't lined up with {main.id}. Import it into the home as another scan of the room "
            "(import_capture with room), which lines it up, then build again.",
        )
    return Capture(
        folder=extra.folder,
        id=extra.id,
        frames=[replace(f, pose=matrix @ f.pose) for f in extra.frames],
        photos=[replace(p, pose=matrix @ p.pose) for p in extra.photos],
        walls=[replace(w, transform=matrix @ w.transform) for w in extra.walls],
        problems=[f"{extra.id}: {p}" for p in extra.problems],
    )


def read_depth(frame: DepthFrame) -> tuple[np.ndarray, np.ndarray | None]:
    """The frame's depth in metres (0 where there is none) and its confidence (0 low to 2 high)."""
    depth_mm = _inflate(frame.depth_file, np.dtype("<u2"), frame)
    depth_m = depth_mm.astype(np.float32) / 1000.0
    confidence = _inflate(frame.confidence_file, np.dtype("u1"), frame) if frame.confidence_file else None
    return depth_m, confidence


def _inflate(file: Path, dtype: np.dtype, frame: DepthFrame) -> np.ndarray:
    try:
        raw = zlib.decompress(file.read_bytes(), wbits=-15)
    except (OSError, zlib.error) as err:
        raise CaptureError("bad_depth", f"{file} could not be read: {err}.") from err
    values = np.frombuffer(raw, dtype=dtype)
    if values.size != frame.width * frame.height:
        raise CaptureError("bad_depth", f"{file} has {values.size} values, not {frame.width} x {frame.height}.")
    return values.reshape(frame.height, frame.width)


def _depth_frame(folder: Path, r: dict) -> DepthFrame:
    depth = r["depth"]
    return DepthFrame(
        id=str(r["id"]),
        room=r.get("room"),
        pose=pose_matrix(r["pose"]),
        depth_file=_inside(folder, depth["file"]),
        confidence_file=_inside(folder, r["confidence"]["file"]) if r.get("confidence") else None,
        width=int(depth["width"]),
        height=int(depth["height"]),
        intrinsics=_intrinsics(depth["intrinsics"]),
        rgb_file=_inside(folder, r["rgb"]["file"]) if r.get("rgb") else None,
    )


def _photo(folder: Path, r: dict) -> Photo:
    camera = r.get("camera") or {}
    exposure = camera.get("exposureS")
    iso = camera.get("iso")
    return Photo(
        id=str(r["id"]),
        room=r.get("room"),
        kind=str(r["kind"]),
        file=_inside(folder, r["file"]),
        width=int(r["width"]),
        height=int(r["height"]),
        pose=pose_matrix(r["pose"]),
        intrinsics=_intrinsics(r["intrinsics"]),
        blur_px=float(r.get("blurPx", 0.0)),
        # 0 means the camera didn't report it.
        exposure_s=float(exposure) if exposure else None,
        iso=float(iso) if iso else None,
    )


def _walls(folder: Path, room: dict, problems: list[str]) -> list[Wall]:
    file = _inside(folder, f"{room['dir']}/roomplan.json")
    if not file.is_file():
        return []
    try:
        layout = json.loads(file.read_text())
    except json.JSONDecodeError as err:
        problems.append(f"{room['dir']}/roomplan.json is not valid JSON ({err}); its walls were not used")
        return []
    walls = []
    for i, w in enumerate(layout.get("walls", [])):
        try:
            transform = w["transform"]
            flat = [v for column in transform for v in column] if isinstance(transform[0], list) else transform
            width, height = float(w["dimensions"][0]), float(w["dimensions"][1])
            walls.append(Wall(room=str(room["id"]), transform=pose_matrix(flat), width_m=width, height_m=height))
        except (KeyError, TypeError, ValueError, IndexError) as err:
            problems.append(f"{room['dir']}/roomplan.json walls[{i}]: left out ({err})")
    return walls


def _intrinsics(r: dict) -> Intrinsics:
    k = Intrinsics(float(r["fx"]), float(r["fy"]), float(r["cx"]), float(r["cy"]))
    if not (k.fx > 0 and k.fy > 0):
        raise ValueError("focal lengths must be positive")
    return k


def _inside(folder: Path, relative: str) -> Path:
    path = (folder / relative).resolve()
    if folder not in path.parents:
        raise ValueError(f"the path {relative!r} leaves the capture folder")
    return path


def _json_lines(file: Path, problems: list[str]):
    if not file.is_file():
        return
    for number, text in enumerate(file.read_text().splitlines(), start=1):
        if not text.strip():
            continue
        try:
            yield number, json.loads(text)
        except json.JSONDecodeError:
            problems.append(f"{file.parent.name}/{file.name} line {number}: not valid JSON, left out")
