"""Reading captures: poses, depth, and records that can't be used."""

import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from room_builder.capture import CaptureError, Photo, pose_matrix, read_capture, read_depth
from room_builder.colour import exposure_gains

from . import synthetic


class PoseTest(unittest.TestCase):
    def test_poses_are_read_column_by_column(self):
        m = pose_matrix([float(v) for v in range(16)])
        np.testing.assert_array_equal(m[:3, 3], [12, 13, 14])
        np.testing.assert_array_equal(m[0, :], [0, 4, 8, 12])

    def test_a_pose_must_have_sixteen_finite_numbers(self):
        with self.assertRaises(ValueError):
            pose_matrix([1.0] * 15)
        with self.assertRaises(ValueError):
            pose_matrix([math.nan] + [0.0] * 15)


class ReadCaptureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = synthetic.write_capture(Path(self.temp.name) / "c", views=synthetic.standard_views()[:4], ghost_frames=0)

    def tearDown(self):
        self.temp.cleanup()

    def test_depth_comes_back_in_metres_with_its_confidence(self):
        capture = read_capture(self.folder)
        depth, confidence = read_depth(capture.frames[0])
        want, _ = synthetic.render(synthetic.look_at(np.array((1.0, 1.5, 0.8)), np.array((1.0, 1.5, -0.2))), 48.0, synthetic.DEPTH_SIZE)
        self.assertEqual(depth.shape, (synthetic.DEPTH_SIZE[1], synthetic.DEPTH_SIZE[0]))
        self.assertLess(np.abs(depth - want).max(), 0.02)
        self.assertTrue(np.all(confidence == 2))

    def test_records_it_cannot_use_are_reported(self):
        index = self.folder / "frames" / "index.jsonl"
        good = index.read_text().splitlines()
        escaping = json.loads(good[0])
        escaping["depth"]["file"] = "../../outside.depth"
        index.write_text("\n".join([*good, json.dumps(escaping), "{not json"]) + "\n")
        capture = read_capture(self.folder)
        self.assertEqual(len(capture.frames), 4)
        self.assertEqual(len(capture.problems), 2)
        self.assertIn("leaves the capture folder", capture.problems[0])
        self.assertIn("not valid JSON", capture.problems[1])

    def test_only_photos_of_the_room_are_used(self):
        index = self.folder / "photos" / "index.jsonl"
        lines = index.read_text().splitlines()
        card = json.loads(lines[0])
        card["kind"] = "card"
        index.write_text("\n".join([json.dumps(card), *lines[1:]]) + "\n")
        self.assertEqual([p.kind for p in read_capture(self.folder).photos], ["auto"] * 3)

    def test_a_folder_without_a_manifest_is_refused(self):
        with self.assertRaises(CaptureError) as caught:
            read_capture(Path(self.temp.name))
        self.assertEqual(caught.exception.code, "not_a_capture")

    def test_another_format_is_refused(self):
        (self.folder / "manifest.json").write_text(json.dumps({"format": "something-else/3"}))
        with self.assertRaises(CaptureError) as caught:
            read_capture(self.folder)
        self.assertEqual(caught.exception.code, "unknown_format")


class ExposureTest(unittest.TestCase):
    def photo(self, exposure_s, iso):
        return Photo("p", None, "auto", Path("p.jpg"), 4, 3, np.eye(4), None, 0.0, exposure_s, iso)

    def test_photos_are_evened_out_to_the_typical_exposure(self):
        gains = exposure_gains([self.photo(0.01, 400), self.photo(0.01, 400), self.photo(0.005, 400), self.photo(0.01, 800)])
        np.testing.assert_allclose(gains, [1, 1, 2, 0.5])

    def test_photos_without_exposure_are_left_alone(self):
        np.testing.assert_allclose(exposure_gains([self.photo(None, None), self.photo(0.01, 400)]), [1, 1])


if __name__ == "__main__":
    unittest.main()
