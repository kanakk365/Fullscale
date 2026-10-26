# SPDX-License-Identifier: GPL-3.0-or-later
import json
import math
import unittest

from render.render_args import PRESETS, JobError, Lighting, euler_matrix, look_at_euler, parse_job, studio_to_blender


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
        self.assertIsNone(job.blend)

    def test_a_job_can_also_save_the_blender_file(self):
        job = parse_job(["--glb", "h.glb", "--out", "p.png", "--camera", json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]}), "--blend", "scene.blend"])
        self.assertEqual(job.blend, "scene.blend")

    def test_the_light_outside_is_turned_into_blenders_frame(self):
        lighting = json.dumps({"time": "evening", "sun": [0, 0, -2], "windows": [{"centre": [1, 1.5, 0], "width": 1.2, "height": 1.0, "inward": [0, 0, 1]}]})
        job = parse_job(["--glb", "h", "--out", "o", "--camera", json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]}), "--lighting", lighting])
        self.assertEqual(job.lighting.time, "evening")
        # Studio -z (north on the plan) is Blender +y.
        self.assertEqual(job.lighting.sun, (0.0, 1.0, 0.0))
        window = job.lighting.windows[0]
        self.assertEqual(window.centre, (1.0, 0.0, 1.5))
        self.assertEqual(window.inward, (0.0, -1.0, 0.0))

    def test_without_lighting_it_is_day(self):
        job = parse_job(["--glb", "h", "--out", "o", "--camera", json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]})])
        self.assertEqual(job.lighting, Lighting())
        self.assertEqual(job.lighting.time, "day")

    def test_bad_lighting_is_refused_in_plain_words(self):
        camera = json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]})
        with self.assertRaisesRegex(JobError, "time of day"):
            parse_job(["--glb", "h", "--out", "o", "--camera", camera, "--lighting", '{"time": "noon"}'])
        with self.assertRaisesRegex(JobError, "lighting must be"):
            parse_job(["--glb", "h", "--out", "o", "--camera", camera, "--lighting", '{"sun": [0, 0, 0]}'])

    def test_pictures_and_own_models_come_from_this_computer(self):
        camera = json.dumps({"eye": [5, 1.6, 5], "target": [0, 1, 0]})
        models = json.dumps([{"item": "sofa-1", "file": "/models/ikea/sofa.glb", "fit": "stretch", "yaw": 90, "size": [2.1, 0.85, 0.92]}])
        job = parse_job(["--glb", "h", "--out", "o", "--camera", camera, "--files", "/homes/mine", "--models", models])
        self.assertEqual(job.files, "/homes/mine")
        self.assertEqual(job.models[0].item, "sofa-1")
        self.assertEqual(job.models[0].fit, "stretch")
        self.assertEqual(job.models[0].size, (2.1, 0.85, 0.92))
        with self.assertRaisesRegex(JobError, "models must be"):
            parse_job(["--glb", "h", "--out", "o", "--camera", camera, "--models", '[{"item": "x"}]'])

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
