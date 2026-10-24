# SPDX-License-Identifier: GPL-3.0-or-later
# The add-on's link against a real studio: start the studio with the sample flat in a
# throwaway folder, connect, receive the home, download its 3D file and move the sofa.
# Run with FULLSCALE_LIVE_TEST=1 (it needs Node and the repo's packages installed).
import os
import queue
import shutil
import subprocess
import tempfile
import time
import unittest

from addon.link import StudioLink
from addon.protocol import RequestIds, ops_message, update_item_op

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


@unittest.skipUnless(os.environ.get("FULLSCALE_LIVE_TEST") == "1", "set FULLSCALE_LIVE_TEST=1 to run against a real studio")
class LiveStudio(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix="fullscale-live-")
        env = {**os.environ, "FULLSCALE_RUN": os.path.join(self.folder, "run"), "FULLSCALE_DATA": self.folder}
        self.studio = subprocess.Popen(
            ["npx", "tsx", "apps/server/src/cli.ts", "serve", "--sample", "--port", "0", "--quiet", "--home", os.path.join(self.folder, "home")],
            cwd=REPO,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.link = StudioLink(env["FULLSCALE_RUN"])

    def tearDown(self):
        self.link.stop()
        self.studio.terminate()
        self.studio.wait(timeout=10)
        shutil.rmtree(self.folder, ignore_errors=True)

    def next_event(self, kind, timeout=20.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                event = self.link.inbox.get(timeout=0.2)
            except queue.Empty:
                continue
            if event[0] == kind or (kind != "message" and event[0] == "message" and event[1]["type"] == kind):
                return event[1]
        self.fail(f"No {kind} from the studio within {timeout} s")

    def test_receive_the_home_download_it_and_move_the_sofa(self):
        self.link.start()
        welcome = self.next_event("welcome")
        self.assertEqual(welcome["rev"], 0)
        self.link.request_glb()
        path, rev = self.next_event("glb")
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(4), b"glTF")
        os.remove(path)
        self.assertEqual(rev, 0)
        sofa = next(i for i in welcome["home"]["items"] if i["catalog"] == "sofa-3")
        self.link.send(ops_message(RequestIds().next(), update_item_op(sofa["id"], position=[2.0, 0, 1.0], rotation=15), label="Move the sofa in Blender"))
        changed = self.next_event("changed")
        self.assertEqual(changed["actor"], "blender")
        result = self.next_event("result")
        self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()
