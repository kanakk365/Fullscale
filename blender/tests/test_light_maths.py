# SPDX-License-Identifier: GPL-3.0-or-later
import math
import unittest

from render.light_maths import glow_strength, metered_exposure, stand_in_lumens, sun_angles, sun_strength, watts, white_balance


class Brightness(unittest.TestCase):
    def test_lights_and_the_sun_keep_their_real_balance(self):
        # Blender's sky puts about 136 W/m² of sun on a surface facing it at 45° (measured).
        self.assertAlmostEqual(sun_strength(45), 136, delta=6)
        self.assertAlmostEqual(sun_strength(15), 98, delta=6)
        self.assertLess(sun_strength(5), sun_strength(40))
        # A 900 lm bulb is a little over a watt of light: a sunny window outshines it.
        self.assertAlmostEqual(watts(900), 1.32, places=2)
        self.assertGreater(stand_in_lumens(12), 1000)

    def test_a_shade_glows_less_than_a_bare_bulb(self):
        self.assertLess(glow_strength(800, 0.1, shaded=True), glow_strength(800, 0.1, shaded=False))


class Camera(unittest.TestCase):
    def test_metering_brings_the_scene_to_mid_grey(self):
        dim = [0.002] * 1000
        self.assertAlmostEqual(metered_exposure(dim), math.log2(0.18 / 0.002), places=6)
        # A few very bright pixels (a lamp, a sunny window) don't darken the picture.
        self.assertAlmostEqual(metered_exposure(dim + [500.0] * 20), metered_exposure(dim), places=6)
        self.assertEqual(metered_exposure([]), 0.0)

    def test_white_balance_follows_the_light_and_keeps_some_warmth(self):
        self.assertEqual(white_balance("night", [(6500, 900)]), 6500)
        warm = white_balance("night", [(2700, 800)])
        self.assertGreater(warm, 2700)
        self.assertLess(warm, 4500)
        self.assertEqual(white_balance("day", [(2700, 800)]), 6000)


class Sun(unittest.TestCase):
    def test_the_sky_turns_its_sun_from_plus_y_towards_plus_x(self):
        elevation, rotation = sun_angles((1.0, 0.0, 0.0))
        self.assertAlmostEqual(elevation, 0.0)
        self.assertAlmostEqual(rotation, math.pi / 2)
        elevation, rotation = sun_angles((0.0, math.cos(0.5), math.sin(0.5)))
        self.assertAlmostEqual(elevation, 0.5)
        self.assertAlmostEqual(rotation, 0.0)


if __name__ == "__main__":
    unittest.main()
