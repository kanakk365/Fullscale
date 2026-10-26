"""Building a whole made-up room and checking its shape and colours against the truth."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from room_builder.build import BuildSettings, build
from room_builder.fuse import FuseSettings
from room_builder.glb import read_glb

from . import synthetic


def _accessor(document: dict, binary: bytes, index: int, dtype: str, width: int) -> np.ndarray:
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    return np.frombuffer(binary, dtype=dtype, count=accessor["count"] * width, offset=view["byteOffset"]).reshape(-1, width)


class BuildRoomTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        folder = synthetic.write_capture(Path(cls.temp.name) / "20260101T000000Z-TEST")
        settings = BuildSettings(fuse=FuseSettings(voxel_m=0.02))
        cls.report = build(folder, settings=settings)
        cls.out = folder / "built"
        document, binary = read_glb(cls.out / "room.glb")
        attributes = document["meshes"][0]["primitives"][0]["attributes"]
        cls.points = _accessor(document, binary, attributes["POSITION"], "<f4", 3).astype(np.float64)
        linear = _accessor(document, binary, attributes["COLOR_0"], "<u2", 4)[:, :3] / 65535.0
        cls.colours = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055) * 255

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def colour_of(self, mask: np.ndarray) -> np.ndarray:
        self.assertGreater(mask.sum(), 20, "too few points in the region to judge its colour")
        return np.median(self.colours[mask], axis=0)

    def assertColour(self, mask: np.ndarray, name: str, tolerance: float = 12):
        got = self.colour_of(mask)
        want = np.array(synthetic.COLOURS[name], dtype=float)
        self.assertTrue(np.all(np.abs(got - want) <= tolerance), f"{name}: got {got.round()}, want {want}")

    def test_the_shape_lies_on_the_true_surfaces(self):
        distance = synthetic.nearest_surface_distance(self.points)
        self.assertLess(np.median(distance), 0.003)
        # Corners come out slightly rounded; that is all of the last few per cent.
        self.assertLess(np.percentile(distance, 99), 0.015)
        # Wrong depth marked low confidence must not make surfaces in mid-air.
        self.assertEqual(int((distance > 0.05).sum()), 0)

    def test_the_room_is_the_right_size(self):
        np.testing.assert_allclose(self.points.min(axis=0), synthetic.ROOM_MIN, atol=0.025)
        np.testing.assert_allclose(self.points.max(axis=0), synthetic.ROOM_MAX, atol=0.025)

    def test_the_cube_on_the_floor_is_there(self):
        top = (np.abs(self.points[:, 1] - synthetic.CUBE_MAX[1]) < 0.02) & np.all(
            (self.points[:, [0, 2]] > synthetic.CUBE_MIN[[0, 2]] + 0.05) & (self.points[:, [0, 2]] < synthetic.CUBE_MAX[[0, 2]] - 0.05), axis=1
        )
        self.assertGreater(int(top.sum()), 100)
        self.assertColour(top, "cube")

    def test_walls_and_floor_take_their_colours_from_the_photos(self):
        p = self.points
        middle = (p[:, 1] > 0.4) & (p[:, 1] < 2.2)
        self.assertColour(middle & (p[:, 0] < 0.03) & (p[:, 2] > 0.4) & (p[:, 2] < 2.6), "wall_x0")
        self.assertColour(middle & (p[:, 0] > 3.97) & (p[:, 2] > 0.4) & (p[:, 2] < 2.6), "wall_x1")
        self.assertColour(middle & (p[:, 2] < 0.03) & (p[:, 0] > 0.4) & (p[:, 0] < 3.6), "wall_z0")
        floor = (p[:, 1] < 0.03) & (np.abs(p[:, 0] - 2) > 0.6) & (p[:, 0] > 0.3) & (p[:, 0] < 3.7)
        self.assertColour(floor, "floor")

    def test_colours_land_where_they_belong(self):
        p = self.points
        far_wall = (p[:, 2] > 2.97) & (p[:, 1] > 0.4) & (p[:, 1] < 2.2)
        self.assertColour(far_wall & (p[:, 0] > 1.9) & (p[:, 0] < 2.1), "stripe", tolerance=20)
        self.assertColour(far_wall & (p[:, 0] > 2.5) & (p[:, 0] < 3.5), "wall_z1")

    def test_the_report_says_what_was_built(self):
        report = json.loads((self.out / "build.json").read_text())
        self.assertEqual(report["format"], "fullscale-build/1")
        self.assertEqual(report["capture"], "20260101T000000Z-TEST")
        self.assertEqual(report["points"], len(self.points))
        self.assertEqual(report["framesUsed"], len(synthetic.standard_views()))
        self.assertGreater(report["colouredShare"], 0.95)
        self.assertEqual(report["settings"]["fuse"]["voxelM"], 0.02)


if __name__ == "__main__":
    unittest.main()


class SeveralScansTest(unittest.TestCase):
    """Two scans of one room, the second in its own coordinates, lined up and built together."""

    def test_a_second_scan_lined_up_adds_its_depth_and_photos(self):
        with tempfile.TemporaryDirectory() as temp:
            views = synthetic.standard_views()
            main = synthetic.write_capture(Path(temp) / "20260101T000000Z-MAIN", views=views[::2])
            extra = synthetic.write_capture(Path(temp) / "20260101T000100Z-MORE", views=views[1::2])
            # The second scan's world is turned and moved; aligned.json says how to undo that.
            angle = np.radians(30)
            to_main = np.eye(4)
            to_main[:3, :3] = [[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]]
            to_main[:3, 3] = [0.7, 0.0, -1.2]
            _move_world(extra, np.linalg.inv(to_main))
            (extra / "built").mkdir()
            (extra / "built" / "aligned.json").write_text(json.dumps({"format": "fullscale-alignment/1", "to": main.name, "matrix": to_main.T.reshape(-1).tolist()}))

            report = build(main, settings=BuildSettings(fuse=FuseSettings(voxel_m=0.02)), with_folders=[extra])
            self.assertEqual(report.with_captures, [extra.name])
            self.assertEqual(report.frames_used, len(views))
            document, binary = read_glb(main / "built" / "room.glb")
            attributes = document["meshes"][0]["primitives"][0]["attributes"]
            points = _accessor(document, binary, attributes["POSITION"], "<f4", 3).astype(np.float64)
            self.assertLess(np.median(synthetic.nearest_surface_distance(points)), 0.003)

    def test_a_scan_not_lined_up_is_refused(self):
        from room_builder.capture import CaptureError

        with tempfile.TemporaryDirectory() as temp:
            main = synthetic.write_capture(Path(temp) / "20260101T000000Z-MAIN")
            extra = synthetic.write_capture(Path(temp) / "20260101T000100Z-MORE")
            with self.assertRaises(CaptureError) as caught:
                build(main, with_folders=[extra])
            self.assertEqual(caught.exception.code, "not_aligned")


def _move_world(folder: Path, matrix: np.ndarray) -> None:
    """Rewrite a capture's poses and walls as if its world were moved by `matrix`."""
    for index in (folder / "frames" / "index.jsonl", folder / "photos" / "index.jsonl"):
        records = [json.loads(line) for line in index.read_text().splitlines() if line.strip()]
        for r in records:
            pose = np.asarray(r["pose"]).reshape(4, 4).T
            r["pose"] = (matrix @ pose).T.reshape(-1).tolist()
        index.write_text("".join(json.dumps(r) + "\n" for r in records))
    plan = folder / "rooms" / "r1" / "roomplan.json"
    layout = json.loads(plan.read_text())
    for wall in layout["walls"]:
        t = np.asarray(wall["transform"]).reshape(4, 4).T
        wall["transform"] = (matrix @ t).T.reshape(-1).tolist()
    plan.write_text(json.dumps(layout))
