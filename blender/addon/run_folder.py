# SPDX-License-Identifier: GPL-3.0-or-later
# Finding the running studio. The studio writes its port to `server.json` and its access
# token to `token` in its run folder (~/.fullscale unless FULLSCALE_RUN says otherwise).
# Both are read again before every connection attempt, because a restarted studio may use
# a different port. The add-on only ever connects to 127.0.0.1, whatever the file says.
from __future__ import annotations

import json
import os
from typing import NamedTuple

DEFAULT_RUN_FOLDER = "~/.fullscale"
SERVER_FILE = "server.json"
TOKEN_FILE = "token"
STUDIO_HOST = "127.0.0.1"


class StudioAddress(NamedTuple):
    port: int
    token: str


class StudioNotFound(Exception):
    """The run folder does not describe a running studio."""


def expand(folder: str) -> str:
    return os.path.abspath(os.path.expanduser(folder.strip() or DEFAULT_RUN_FOLDER))


def read_studio_address(folder: str) -> StudioAddress:
    root = expand(folder)
    server_path = os.path.join(root, SERVER_FILE)
    token_path = os.path.join(root, TOKEN_FILE)
    try:
        with open(server_path, encoding="utf-8") as handle:
            server = json.load(handle)
    except FileNotFoundError as error:
        raise StudioNotFound(f'No studio is running: {server_path} does not exist. Start it with "fullscale serve".') from error
    except (OSError, ValueError) as error:
        raise StudioNotFound(f"Could not read {server_path}: {error}.") from error
    port = server.get("port") if isinstance(server, dict) else None
    if not isinstance(port, int) or isinstance(port, bool) or not 0 < port < 65536:
        raise StudioNotFound(f"{server_path} has no valid port. Restart the studio.")
    try:
        with open(token_path, encoding="utf-8") as handle:
            token = handle.read().strip()
    except OSError as error:
        raise StudioNotFound(f"Could not read the studio token at {token_path}: {error}.") from error
    if not token:
        raise StudioNotFound(f"The studio token file {token_path} is empty. Restart the studio.")
    return StudioAddress(port=port, token=token)
