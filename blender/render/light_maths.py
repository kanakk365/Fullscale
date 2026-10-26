# SPDX-License-Identifier: GPL-3.0-or-later
# The numbers behind a render's light, kept apart from Blender so they can be tested anywhere.
#
# Units follow Blender's physical ones, the same as its sky: a light's power in watts is its
# brightness in lumens divided by 683 (lumens per watt of light), so a 900 lm bulb, the sky and
# the sun keep the balance they have in a real room. The camera then exposes the picture the
# way a phone does: it meters the scene and brightens or darkens the whole picture to suit.
from __future__ import annotations

import math
from typing import Iterable, Sequence, Tuple

LUMENS_PER_WATT = 683.0

# How high the sun stands (degrees) and its colour (kelvin), by time of day.
SUN = {"day": (38.0, 5600.0), "evening": (7.0, 3400.0)}


def watts(lumens: float) -> float:
    return lumens / LUMENS_PER_WATT


def sun_strength(elevation_deg: float) -> float:
    """Sunlight on a surface facing the sun, in watts per square metre (Blender's units),
    weaker when the sun is low and its light crosses more air. Fitted to Blender's own sky:
    about 136 at 45° and 98 at 15°."""
    return 150.0 * math.sin(math.radians(max(1.0, elevation_deg))) ** 0.35


def glow_strength(lumens: float, area_m2: float, shaded: bool) -> float:
    """How bright a lamp's glowing part looks: its light spread over its surface (watts per
    square metre). A shade lets only part of the light through."""
    return watts(lumens) / max(area_m2, 1e-4) * (0.3 if shaded else 1.0)


def stand_in_lumens(floor_area_m2: float) -> float:
    """A room with no lights in the model gets one ceiling light this bright: about 150 lumens
    per square metre, an ordinary lived-in room."""
    return 150.0 * floor_area_m2


def white_balance(time: str, lamps: Iterable[Tuple[float, float]]) -> float:
    """The colour temperature a phone would balance to: daylight by day; at night the lamps'
    own colour (weighted by brightness), keeping some of the warmth of warm lamps as phones do."""
    if time == "day":
        return 6000.0
    lamps = [(k, lm) for k, lm in lamps if lm > 0]
    if not lamps:
        return 5000.0 if time == "evening" else 6500.0
    kelvin = sum(k * lm for k, lm in lamps) / sum(lm for _, lm in lamps)
    if time == "evening":
        kelvin = (kelvin + 5000.0) / 2
    return kelvin + (6500.0 - kelvin) * 0.35 if kelvin < 6500.0 else kelvin


def metered_exposure(luminance: Sequence[float], key: float = 0.18, ignore_brightest: float = 0.03) -> float:
    """Exposure in stops that brings the scene's average brightness to `key`, the way a camera
    meters: an average in stops (so a few dark corners don't dominate), leaving out the
    brightest pixels (lamps, a sunlit window) so they don't darken the whole picture."""
    values = sorted(v for v in luminance if math.isfinite(v) and v > 0)
    if not values:
        return 0.0
    keep = values[: max(1, int(len(values) * (1.0 - ignore_brightest)))]
    log_average = math.exp(sum(math.log(max(v, 1e-6)) for v in keep) / len(keep))
    return max(-20.0, min(20.0, math.log2(key / log_average)))


def sun_angles(towards_sun: Tuple[float, float, float]) -> Tuple[float, float]:
    """Elevation and rotation (radians) of the sun in Blender's sky texture, from a direction
    towards the sun in Blender's frame (+Z up). The sky's rotation is measured from +Y towards
    +X (checked against Blender's sky: a rotation of 90° puts the sun towards +X)."""
    x, y, z = towards_sun
    elevation = math.asin(max(-1.0, min(1.0, z)))
    rotation = math.atan2(x, y)
    return elevation, rotation
