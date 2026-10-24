# SPDX-License-Identifier: GPL-3.0-or-later
import math
import unittest

from addon.conversions import blender_to_studio, hex_to_linear, linear_to_hex, studio_to_blender, turn_to_blender, turn_to_studio


class Axes(unittest.TestCase):
    def test_studio_up_is_blender_up(self):
        self.assertEqual(studio_to_blender((1.0, 2.0, 3.0)), (1.0, -3.0, 2.0))

    def test_points_go_there_and_back(self):
        for point in [(0.5, 0.0, -2.25), (-3.0, 1.2, 4.5)]:
            self.assertEqual(blender_to_studio(studio_to_blender(point)), point)

    def test_turns_keep_their_angle(self):
        self.assertAlmostEqual(turn_to_blender(90), math.pi / 2)
        self.assertEqual(turn_to_studio(math.radians(-90)), 270.0)
        self.assertEqual(turn_to_studio(math.radians(359.9999)), 0.0)


class Colours(unittest.TestCase):
    def test_mid_grey_is_darker_in_linear_light(self):
        self.assertAlmostEqual(hex_to_linear("#808080")[0], 0.21586, places=4)

    def test_every_grey_level_comes_back_exactly(self):
        for level in range(256):
            hex_colour = "#" + f"{level:02x}" * 3
            self.assertEqual(linear_to_hex(hex_to_linear(hex_colour)), hex_colour)


if __name__ == "__main__":
    unittest.main()
