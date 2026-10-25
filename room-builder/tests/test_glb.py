"""The GLB writer: structure, bounds and colours."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from room_builder.glb import read_glb, write_glb


class GlbTest(unittest.TestCase):
    def test_a_mesh_survives_the_round_trip(self):
        positions = np.array([[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]], dtype=float)
        normals = np.tile([0.0, 0.0, 1.0], (4, 1))
        colours = np.array([[0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0], [0.04, 0.04, 0.04]])
        triangles = np.array([[0, 1, 2], [0, 2, 3]])
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "m.glb"
            size = write_glb(file, positions, normals, colours, triangles, name="m", extras={"capture": "x"})
            self.assertEqual(size, file.stat().st_size)
            document, binary = read_glb(file)
        self.assertEqual(size % 4, 0)
        accessors = document["accessors"]
        position, normal, colour, index = (accessors[i] for i in range(4))
        self.assertEqual((position["count"], normal["count"], colour["count"], index["count"]), (4, 4, 4, 6))
        self.assertEqual(position["min"], [0, 0, 0])
        self.assertEqual(position["max"], [1, 2, 3])
        self.assertTrue(colour["normalized"])
        self.assertEqual(document["nodes"][0]["extras"], {"capture": "x"})
        self.assertIn("KHR_materials_unlit", document["materials"][0]["extensions"])
        for view in document["bufferViews"]:
            self.assertEqual(view["byteOffset"] % 4, 0)
        view = document["bufferViews"][colour["bufferView"]]
        stored = np.frombuffer(binary, dtype="<u2", count=16, offset=view["byteOffset"]).reshape(4, 4) / 65535
        # sRGB mid grey is about 0.214 once linear; dark colours keep their detail.
        self.assertAlmostEqual(stored[0, 0], 0.2140, places=3)
        self.assertAlmostEqual(stored[3, 0], 0.04 / 12.92, places=4)
        self.assertEqual(stored[0, 3], 1.0)


if __name__ == "__main__":
    unittest.main()
