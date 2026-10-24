# SPDX-License-Identifier: GPL-3.0-or-later
import json
import os
import re
import unittest

from addon.protocol import ADDON_VERSION, PROTOCOL_VERSION, ProtocolError, combine_ops, decode, hello_message, ops_message, update_item_op

HERE = os.path.dirname(__file__)


class Messages(unittest.TestCase):
    def test_hello_names_the_client_and_actor(self):
        hello = hello_message("t" * 64)
        self.assertEqual(hello, {"type": "hello", "protocol": PROTOCOL_VERSION, "client": "blender", "token": "t" * 64, "actor": "blender", "version": ADDON_VERSION})

    def test_labels_are_kept_within_the_studio_limit(self):
        message = ops_message("r1", update_item_op("sofa", rotation=90), label="x" * 300)
        self.assertEqual(len(message["label"]), 120)

    def test_one_edit_is_sent_as_is_and_several_as_one_batch(self):
        one = update_item_op("a", rotation=1)
        self.assertIs(combine_ops([one], "x"), one)
        self.assertEqual(combine_ops([one, one], "Move")["op"], "batch")

    def test_the_manifest_and_the_code_agree_on_the_version(self):
        with open(os.path.join(HERE, "..", "addon", "blender_manifest.toml"), encoding="utf-8") as handle:
            version = re.search(r'^version = "([^"]+)"', handle.read(), re.M).group(1)
        self.assertEqual(version, ADDON_VERSION)


class Reading(unittest.TestCase):
    def test_a_welcome_is_accepted(self):
        text = json.dumps({"type": "welcome", "protocol": 1, "actor": "blender", "rev": 3, "home": {}, "undo": {}, "server": {}})
        self.assertEqual(decode(text)["rev"], 3)

    def test_a_revision_that_is_not_a_number_is_refused(self):
        with self.assertRaises(ProtocolError):
            decode(json.dumps({"type": "changed", "rev": True, "actor": "a", "label": "x", "patch": {"entries": []}, "undo": {}}))

    def test_unknown_messages_point_at_an_old_add_on(self):
        with self.assertRaisesRegex(ProtocolError, "out of date"):
            decode('{"type": "teleport"}')


if __name__ == "__main__":
    unittest.main()
