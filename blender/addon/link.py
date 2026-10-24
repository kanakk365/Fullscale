# SPDX-License-Identifier: GPL-3.0-or-later
# The connection to the studio, on a background thread.
#
# The thread only does network work and never touches Blender (bpy is not safe to use off
# the main thread). It puts what arrives on `inbox`, sends what it finds on its outbox, and
# downloads the home's 3D file when asked. Blender's main thread, in one timer, does the
# rest. When the connection drops, the thread waits a little longer each time before
# trying again, and reads the run folder afresh, since a restarted studio may have moved.
from __future__ import annotations

import http.client
import os
import queue
import tempfile
import threading
from typing import Any, Optional, Tuple

from .protocol import SOCKET_PATH, Message, ProtocolError, decode, encode, hello_message
from .run_folder import STUDIO_HOST, StudioAddress, StudioNotFound, read_studio_address
from .websocket import ConnectionClosed, WebSocketConnection, WebSocketError

# Seconds to wait before reconnecting: quick at first, then every ten seconds.
BACKOFF = (0.5, 1.0, 2.0, 5.0, 10.0)
# How long one wait for data lasts, which is also how quickly queued messages go out.
POLL_SECONDS = 0.05

# What the thread puts on the inbox, as (kind, value):
#   ("connected", None), ("message", dict), ("glb", (path, rev)),
#   ("lost", reason), ("problem", reason)
Event = Tuple[str, Any]


class StudioLink:
    def __init__(self, run_folder: str) -> None:
        self.run_folder = run_folder
        self.inbox: "queue.Queue[Event]" = queue.Queue()
        self._outbox: "queue.Queue[Message]" = queue.Queue()
        self._glb_wanted = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="fullscale-link", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self._thread = None
        for q in (self.inbox, self._outbox):
            while True:
                try:
                    q.get_nowait()
                except queue.Empty:
                    break

    def send(self, message: Message) -> None:
        self._outbox.put(message)

    def request_glb(self) -> None:
        """Ask for the home's 3D file; it arrives on the inbox as ("glb", (path, rev))."""
        self._glb_wanted.set()

    # ---------- the thread ----------

    def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            try:
                address = read_studio_address(self.run_folder)
                connection = WebSocketConnection.open(STUDIO_HOST, address.port, SOCKET_PATH)
            except StudioNotFound as error:
                self.inbox.put(("lost", str(error)))
            except (OSError, WebSocketError) as error:
                self.inbox.put(("lost", f"Can't reach the studio: {error}"))
            else:
                attempt = 0
                try:
                    connection.send_text(encode(hello_message(address.token)))
                    self.inbox.put(("connected", None))
                    self._pump(connection, address)
                except (OSError, WebSocketError) as error:
                    self.inbox.put(("lost", f"The connection to the studio was lost: {error}"))
                finally:
                    connection.close()
            if self._stop.is_set():
                break
            self._stop.wait(BACKOFF[min(attempt, len(BACKOFF) - 1)])
            attempt += 1

    def _pump(self, connection: WebSocketConnection, address: StudioAddress) -> None:
        while not self._stop.is_set():
            while True:
                try:
                    message = self._outbox.get_nowait()
                except queue.Empty:
                    break
                connection.send_text(encode(message))
            if self._glb_wanted.is_set():
                self._glb_wanted.clear()
                self._download(address)
            for event in connection.receive(POLL_SECONDS):
                if event[0] == "text":
                    try:
                        self.inbox.put(("message", decode(str(event[1]))))
                    except ProtocolError as error:
                        self.inbox.put(("problem", str(error)))
                elif event[0] == "close":
                    reason = event[2] or f"code {event[1]}"
                    raise ConnectionClosed(f"The studio closed the connection ({reason}).")

    def _download(self, address: StudioAddress) -> None:
        try:
            path, rev = fetch_glb(address)
        except (OSError, http.client.HTTPException, ValueError) as error:
            self.inbox.put(("problem", f"Could not get the home's 3D file: {error}"))
            return
        self.inbox.put(("glb", (path, rev)))


def fetch_glb(address: StudioAddress, ceilings: bool = False) -> Tuple[str, int]:
    """Download the home as GLB to a temporary file. Returns its path and the revision it
    was built from."""
    connection = http.client.HTTPConnection(STUDIO_HOST, address.port, timeout=30)
    try:
        connection.request("GET", "/api/home.glb" + ("?ceilings=1" if ceilings else ""), headers={"Authorization": f"Bearer {address.token}"})
        response = connection.getresponse()
        body = response.read()
        if response.status != 200:
            raise ValueError(f"the studio answered HTTP {response.status}")
        rev = int(response.getheader("x-fullscale-rev", "-1"))
    finally:
        connection.close()
    handle, path = tempfile.mkstemp(prefix="fullscale-home-", suffix=".glb")
    with os.fdopen(handle, "wb") as out:
        out.write(body)
    return path, rev
