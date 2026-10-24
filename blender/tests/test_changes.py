# SPDX-License-Identifier: GPL-3.0-or-later
import unittest

from addon.changes import ItemPose, KnownState, edits_for, item_moves

HOME = {
    "items": [{"id": "sofa", "position": [2.5, 0, 0.48], "rotation": 0}],
    "materials": [{"id": "paint-white", "name": "White", "kind": "paint", "color": "#f1ede4", "roughness": 0.9}],
}


class LocalEdits(unittest.TestCase):
    def setUp(self):
        self.known = KnownState.from_home(HOME)

    def test_float_noise_sends_nothing(self):
        self.assertEqual(edits_for(self.known, {"sofa": ItemPose((2.5003, 0, 0.48), 359.98)}, {}, []), [])

    def test_a_real_move_becomes_one_update(self):
        ops = edits_for(self.known, {"sofa": ItemPose((2.51, 0, 0.48), 90)}, {}, [])
        self.assertEqual(ops, [{"op": "updateItem", "id": "sofa", "position": [2.51, 0, 0.48], "rotation": 90}])

    def test_a_new_colour_keeps_the_rest_of_the_material(self):
        ops = edits_for(self.known, {}, {"paint-white": "#AABBCC"}, [])
        self.assertEqual(ops[0]["material"], {**HOME["materials"][0], "color": "#aabbcc"})

    def test_a_deleted_item_is_removed(self):
        self.assertEqual(edits_for(self.known, {}, {}, ["sofa", "never-known"]), [{"op": "remove", "ids": ["sofa"]}])


class StudioChanges(unittest.TestCase):
    def test_moves_by_others_are_followed_without_echo(self):
        known = KnownState.from_home(HOME)
        patch = {"entries": [{"op": "update", "collection": "items", "id": "sofa", "fields": {"position": {"before": [2.5, 0, 0.48], "after": [3, 0, 1]}, "sources.position": {"after": {"kind": "agent"}}}}]}
        self.assertEqual(item_moves(patch), {"sofa": {"position": [3, 0, 1]}})
        known.apply_patch(patch)
        # Blender now shows the studio's pose: nothing to send back.
        self.assertEqual(edits_for(known, {"sofa": ItemPose((3, 0, 1), 0)}, {}, []), [])

    def test_anything_but_furniture_moves_rebuilds_the_scene(self):
        wall = {"entries": [{"op": "update", "collection": "walls", "id": "wall-1", "fields": {"end": {"before": [1, 0], "after": [2, 0]}}}]}
        self.assertIsNone(item_moves(wall))
        resize = {"entries": [{"op": "update", "collection": "items", "id": "sofa", "fields": {"size": {"before": [1, 1, 1], "after": [2, 1, 1]}}}]}
        self.assertIsNone(item_moves(resize))

    def test_created_and_deleted_items_are_tracked(self):
        known = KnownState.from_home(HOME)
        known.apply_patch({"entries": [{"op": "create", "collection": "items", "id": "lamp", "index": 1, "element": {"id": "lamp", "position": [1, 0, 1], "rotation": 45}}, {"op": "delete", "collection": "items", "id": "sofa", "index": 0, "element": {}}]})
        self.assertEqual(set(known.items), {"lamp"})


if __name__ == "__main__":
    unittest.main()
