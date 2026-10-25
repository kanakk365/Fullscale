"""Cameras and room bounds."""

import math
import unittest

import numpy as np

from room_builder.capture import Intrinsics, Wall
from room_builder.geometry import project, room_boxes

from . import synthetic


def wall(start, end, height=2.5, room="r1"):
    a, b = np.array(start, float), np.array(end, float)
    along = (b - a) / np.linalg.norm(b - a)
    m = np.eye(4)
    m[:3, 0] = [along[0], 0, along[1]]
    m[:3, 2] = np.cross(m[:3, 0], [0, 1, 0])
    m[:3, 3] = [(a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2]
    return Wall(room=room, transform=m, width_m=float(np.linalg.norm(b - a)), height_m=height)


class ProjectTest(unittest.TestCase):
    def test_a_point_straight_ahead_lands_on_the_principal_point(self):
        pose = synthetic.look_at(np.array([1.0, 1.0, 1.0]), np.array([1.0, 1.0, 0.0]))
        k = Intrinsics(100, 100, 32, 24)
        u, v, z = project(np.array([[1.0, 1.0, -1.0], [1.1, 1.2, -1.0], [1.0, 1.0, 3.0]]), pose, k)
        np.testing.assert_allclose([u[0], v[0], z[0]], [32, 24, 2])
        # Right in the world is right in the picture; up in the world is up (smaller v).
        np.testing.assert_allclose([u[1], v[1]], [32 + 5, 24 - 10])
        self.assertLess(z[2], 0)


class RoomBoxTest(unittest.TestCase):
    def test_the_box_follows_turned_walls(self):
        turn = math.radians(20)
        corners = [(0, 0), (4, 0), (4, 3), (0, 3)]
        turned = [(x * math.cos(turn) - z * math.sin(turn), x * math.sin(turn) + z * math.cos(turn)) for x, z in corners]
        walls = [wall(turned[i], turned[(i + 1) % 4]) for i in range(4)]
        (box,) = room_boxes(walls, margin_m=0.1)
        self.assertAlmostEqual(abs(box.yaw_rad), turn, places=6)
        centre = np.mean(turned, axis=0)
        inside = np.array([[centre[0], 1.0, centre[1]]])
        # 0.3 m beyond the middle of the first wall, outside the room.
        outside_xz = np.mean(turned[:2], axis=0) + 0.3 * np.array([math.sin(turn), -math.cos(turn)])
        outside = np.array([[outside_xz[0], 1.0, outside_xz[1]]])
        self.assertTrue(box.contains(inside)[0])
        self.assertFalse(box.contains(outside)[0])
        self.assertAlmostEqual(box.floor_y, -0.1)
        self.assertAlmostEqual(box.top_y, 2.6)

    def test_each_room_gets_its_own_box(self):
        walls = [wall((0, 0), (3, 0)), wall((3, 0), (3, 3)), wall((5, 0), (8, 0), room="r2"), wall((8, 0), (8, 2), room="r2")]
        self.assertEqual(len(room_boxes(walls, 0.1)), 2)


if __name__ == "__main__":
    unittest.main()
