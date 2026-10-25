"""The `room-builder` command."""

from __future__ import annotations

import argparse
import sys

from .build import BuildSettings, build
from .capture import CaptureError
from .colour import ColourSettings
from .fuse import FuseSettings

_CONFIDENCE = {"low": 0, "medium": 1, "high": 2}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="room-builder",
        description="Turn a Fullscale phone capture into a detailed, coloured 3D model (built/room.glb inside the capture).",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build", help="build the model of one capture")
    make.add_argument("capture", help="the capture's folder (unzipped)")
    make.add_argument("--out", help="where to write the model (default: the capture's built/ folder)")
    make.add_argument("--voxel-cm", type=float, default=1.0, help="size of the smallest detail kept, in cm (default 1)")
    make.add_argument("--max-depth-m", type=float, default=4.0, help="ignore depth further than this, in metres (default 4)")
    make.add_argument("--min-confidence", choices=_CONFIDENCE, default="medium", help="least depth confidence used (default medium)")
    args = parser.parse_args(argv)

    if not 0.3 <= args.voxel_cm <= 10:
        parser.error("--voxel-cm must be between 0.3 and 10")
    settings = BuildSettings(
        fuse=FuseSettings(voxel_m=args.voxel_cm / 100, max_depth_m=args.max_depth_m, min_confidence=_CONFIDENCE[args.min_confidence]),
        colour=ColourSettings(),
    )
    try:
        build(args.capture, args.out, settings, say=print)
    except CaptureError as err:
        print(f"error [{err.code}]: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
