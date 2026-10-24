# SPDX-License-Identifier: GPL-3.0-or-later
# Converting between the studio's conventions and Blender's.
#
# Axes: the studio (like glTF and Three.js) has +Y up, metres; Blender has +Z up. Blender's
# glTF importer turns a studio point (x, y, z) into Blender (x, -z, y), and we must do the
# same for every value we send or receive. Turns: the studio turns items by degrees about
# +Y, counter-clockwise seen from above; in Blender that is the same angle about +Z.
#
# Colours: the studio stores colours as sRGB hex ("#9caf88"), as people pick them; Blender's
# shader colours are linear. Sending a linear value as if it were sRGB makes every colour
# darker on each round trip.
from __future__ import annotations

import math
from typing import Sequence, Tuple

Vector3 = Tuple[float, float, float]


def studio_to_blender(point: Sequence[float]) -> Vector3:
    x, y, z = point
    return (float(x), -float(z), float(y))


def blender_to_studio(point: Sequence[float]) -> Vector3:
    x, y, z = point
    return (float(x), float(z), -float(y))


def turn_to_blender(degrees: float) -> float:
    """A studio turn in degrees, as a Blender Z rotation in radians."""
    return math.radians(degrees)


def turn_to_studio(radians: float) -> float:
    """A Blender Z rotation, as a studio turn in degrees from 0 up to (not including) 360."""
    degrees = math.degrees(radians) % 360.0
    # Rounding to a thousandth of a degree hides float noise such as 89.99999999999999.
    degrees = round(degrees, 3)
    return 0.0 if degrees >= 360.0 else degrees


def srgb_to_linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def linear_to_srgb(channel: float) -> float:
    channel = min(max(channel, 0.0), 1.0)
    if channel <= 0.0031308:
        return channel * 12.92
    return 1.055 * channel ** (1 / 2.4) - 0.055


def hex_to_linear(hex_colour: str) -> Vector3:
    """'#rrggbb' as linear RGB in 0..1, ready for a Blender shader."""
    text = hex_colour.lstrip("#")
    if len(text) != 6:
        raise ValueError(f"Not a #rrggbb colour: {hex_colour!r}")
    r, g, b = (int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def linear_to_hex(rgb: Sequence[float]) -> str:
    """Linear RGB from a Blender shader as '#rrggbb'."""
    return "#" + "".join(f"{round(linear_to_srgb(c) * 255):02x}" for c in rgb[:3])
