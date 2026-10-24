# SPDX-License-Identifier: GPL-3.0-or-later
import json
import math
import unittest

from render.render_args import PRESETS, JobError, euler_matrix, look_at_euler, parse_job, studio_to_blender


def camera_axes(angles):
    m = euler_matrix(angles)
    forward = (-m[0][2], -m[1][2], -m[2][2])  # the camera looks along its local -Z
    up = (m[0][1], m[1][1], m[2][1])
    return forward, up


class Arguments(unittest.TestCase):
    def test_a_job_is_read_from_the_command_line(self):
        job = parse_job(["--glb", "h.glb", "--out", "p.png", "--camera", json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]}), "--preset", "thumb"])
        self.assertEqual(job.preset, PRESETS["thumb"])
        self.assertEqual(job.fov, 40)

    def test_bad_cameras_are_refused_in_plain_words(self):
        with self.assertRaisesRegex(JobError, "eye"):
            parse_job(["--glb", "h", "--out", "o", "--camera", '{"eye": [1, 2]}'])
        with self.assertRaisesRegex(JobError, "same point"):
            parse_job(["--glb", "h", "--out", "o", "--camera", '{"eye": [1, 1, 1], "target": [1, 1, 1]}'])


class Camera(unittest.TestCase):
    def test_the_camera_faces_its_target_with_up_up(self):
        eye = studio_to_blender((4.0, 1.6, 6.0))
        target = studio_to_blender((1.0, 1.0, 2.0))
        forward, up = camera_axes(look_at_euler(eye, target))
        want = [t - e for t, e in zip(target, eye)]
        length = math.sqrt(sum(v * v for v in want))
        for got, w in zip(forward, want):
            self.assertAlmostEqual(got, w / length, places=9)
        self.assertGreater(up[2], 0)

    def test_looking_straight_down_keeps_north_up(self):
        forward, up = camera_axes(look_at_euler((0, 0, 10), (0, 0, 0)))
        self.assertAlmostEqual(forward[2], -1, places=9)
        self.assertAlmostEqual(up[1], 1, places=9)


if __name__ == "__main__":
    unittest.main()
