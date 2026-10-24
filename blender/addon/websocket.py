# SPDX-License-Identifier: GPL-3.0-or-later
# A small WebSocket client (RFC 6455) using only the Python standard library, because
# Blender extensions should not depend on extra packages. It covers what the studio needs:
# the opening handshake, masked client frames, text messages split over continuation
# frames, ping/pong and the closing handshake. No extensions (compression) are offered,
# so every frame arrives exactly as the server wrote it.
from __future__ import annotations

import base64
import hashlib
import os
import socket
import struct
from typing import List, Optional, Tuple, Union

OPCODE_CONTINUATION = 0x0
OPCODE_TEXT = 0x1
OPCODE_BINARY = 0x2
OPCODE_CLOSE = 0x8
OPCODE_PING = 0x9
OPCODE_PONG = 0xA

CLOSE_NORMAL = 1000
CLOSE_PROTOCOL_ERROR = 1002

# Fixed by RFC 6455 section 1.3: proves the server understood the WebSocket handshake.
HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# A welcome message carries the whole home, which can be several megabytes. The limit
# stops a broken server from making Blender use unbounded memory.
MAX_MESSAGE_BYTES = 64 * 1024 * 1024
MAX_HEADER_BYTES = 16 * 1024

# Events produced by the decoder: ("text", str), ("binary", bytes), ("ping", bytes),
# ("pong", bytes) or ("close", code or None, reason).
Event = Tuple[Union[str, int, bytes, None], ...]


class WebSocketError(Exception):
    """The connection broke the protocol or could not be opened."""


class ConnectionClosed(WebSocketError):
    """The other side closed the TCP connection."""


def make_key() -> str:
    return base64.b64encode(os.urandom(16)).decode("ascii")


def accept_for(key: str) -> str:
    digest = hashlib.sha1((key + HANDSHAKE_GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def handshake_request(host: str, port: int, path: str, key: str) -> bytes:
    # The studio checks that Host names this computer and its port, and refuses requests
    # that carry an Origin header unless it is its own page, so we send Host and no Origin.
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}:{port}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
        "User-Agent: fullscale-blender",
        "",
        "",
    ]
    return "\r\n".join(lines).encode("ascii")


def check_handshake_response(head: bytes, key: str) -> None:
    """Raise WebSocketError unless `head` (the response up to the blank line) accepts
    the upgrade for `key`."""
    text = head.decode("iso-8859-1")
    lines = text.split("\r\n")
    status = lines[0].split(" ", 2)
    if len(status) < 2 or not status[0].startswith("HTTP/"):
        raise WebSocketError("The studio did not answer like a web server.")
    if status[1] != "101":
        raise WebSocketError(
            f"The studio refused the live connection (HTTP {status[1]}). "
            "Check that the run folder belongs to the studio that is running."
        )
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    if headers.get("upgrade", "").lower() != "websocket":
        raise WebSocketError("The studio did not switch to WebSocket.")
    if "upgrade" not in [part.strip().lower() for part in headers.get("connection", "").split(",")]:
        raise WebSocketError("The studio did not switch to WebSocket.")
    if headers.get("sec-websocket-accept") != accept_for(key):
        raise WebSocketError("The studio's WebSocket handshake did not match our key.")


def apply_mask(data: bytes, mask_key: bytes) -> bytes:
    # XOR as one big integer: a byte-by-byte Python loop would take seconds on a
    # multi-megabyte message, and this stays linear and fast.
    length = len(data)
    if length == 0:
        return b""
    repeated = (mask_key * (length // 4 + 1))[:length]
    masked = int.from_bytes(data, "big") ^ int.from_bytes(repeated, "big")
    return masked.to_bytes(length, "big")


def encode_frame(opcode: int, payload: bytes, fin: bool = True, mask_key: Optional[bytes] = None) -> bytes:
    """One frame. Pass `mask_key` (4 bytes) for client frames: RFC 6455 requires every
    frame a client sends to be masked, and servers close the connection otherwise."""
    first = (0x80 if fin else 0) | opcode
    length = len(payload)
    mask_bit = 0x80 if mask_key is not None else 0
    if length < 126:
        header = struct.pack("!BB", first, mask_bit | length)
    elif length < 1 << 16:
        header = struct.pack("!BBH", first, mask_bit | 126, length)
    else:
        header = struct.pack("!BBQ", first, mask_bit | 127, length)
    if mask_key is None:
        return header + payload
    if len(mask_key) != 4:
        raise ValueError("A mask key is 4 bytes.")
    return header + mask_key + apply_mask(payload, mask_key)


def client_frame(opcode: int, payload: bytes) -> bytes:
    return encode_frame(opcode, payload, mask_key=os.urandom(4))


def close_payload(code: int, reason: str = "") -> bytes:
    return struct.pack("!H", code) + reason.encode("utf-8")[:123]


class FrameDecoder:
    """Turns received bytes into whole messages and control frames. Feed it any chunk of
    bytes; frames split across chunks are kept until they are complete."""

    def __init__(self, allow_masked: bool = False, max_message_bytes: int = MAX_MESSAGE_BYTES) -> None:
        # Servers never mask their frames (RFC 6455 section 5.1), so by default a masked
        # frame is an error. Tests decode client frames by allowing masks.
        self._allow_masked = allow_masked
        self._max_message_bytes = max_message_bytes
        self._buffer = bytearray()
        self._fragments: List[bytes] = []
        self._fragment_opcode: Optional[int] = None
        self._fragment_bytes = 0

    def feed(self, data: bytes) -> List[Event]:
        self._buffer.extend(data)
        events: List[Event] = []
        while True:
            frame = self._next_frame()
            if frame is None:
                return events
            event = self._handle(*frame)
            if event is not None:
                events.append(event)

    def _next_frame(self) -> Optional[Tuple[bool, int, bytes]]:
        buffer = self._buffer
        if len(buffer) < 2:
            return None
        first, second = buffer[0], buffer[1]
        if first & 0x70:
            raise WebSocketError("The studio sent a frame with reserved bits set.")
        fin = bool(first & 0x80)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        offset = 2
        if length == 126:
            if len(buffer) < 4:
                return None
            length = struct.unpack_from("!H", buffer, 2)[0]
            offset = 4
        elif length == 127:
            if len(buffer) < 10:
                return None
            length = struct.unpack_from("!Q", buffer, 2)[0]
            offset = 10
            if length >> 63:
                raise WebSocketError("The studio sent a frame with an impossible length.")
        if length > self._max_message_bytes:
            raise WebSocketError("The studio sent a message that is too large.")
        mask_key = b""
        if masked:
            if not self._allow_masked:
                raise WebSocketError("The studio sent a masked frame; servers must not mask.")
            if len(buffer) < offset + 4:
                return None
            mask_key = bytes(buffer[offset : offset + 4])
            offset += 4
        end = offset + length
        if len(buffer) < end:
            return None
        payload = bytes(buffer[offset:end])
        del buffer[:end]
        if masked:
            payload = apply_mask(payload, mask_key)
        return fin, opcode, payload

    def _handle(self, fin: bool, opcode: int, payload: bytes) -> Optional[Event]:
        if opcode >= 0x8:
            # Control frames may arrive between the pieces of a fragmented message.
            if not fin or len(payload) > 125:
                raise WebSocketError("The studio sent a broken control frame.")
            if opcode == OPCODE_PING:
                return ("ping", payload)
            if opcode == OPCODE_PONG:
                return ("pong", payload)
            if opcode == OPCODE_CLOSE:
                return _close_event(payload)
            raise WebSocketError(f"The studio sent an unknown control frame ({opcode}).")
        if opcode == OPCODE_CONTINUATION:
            if self._fragment_opcode is None:
                raise WebSocketError("The studio continued a message it never started.")
            return self._add_fragment(fin, payload)
        if opcode in (OPCODE_TEXT, OPCODE_BINARY):
            if self._fragment_opcode is not None:
                raise WebSocketError("The studio started a new message before finishing the last one.")
            self._fragment_opcode = opcode
            return self._add_fragment(fin, payload)
        raise WebSocketError(f"The studio sent an unknown frame type ({opcode}).")

    def _add_fragment(self, fin: bool, payload: bytes) -> Optional[Event]:
        self._fragment_bytes += len(payload)
        if self._fragment_bytes > self._max_message_bytes:
            raise WebSocketError("The studio sent a message that is too large.")
        self._fragments.append(payload)
        if not fin:
            return None
        opcode = self._fragment_opcode
        data = b"".join(self._fragments)
        self._fragments = []
        self._fragment_opcode = None
        self._fragment_bytes = 0
        if opcode == OPCODE_TEXT:
            # Decode only the whole message: a multi-byte character can be split
            # across two fragments.
            try:
                return ("text", data.decode("utf-8"))
            except UnicodeDecodeError as error:
                raise WebSocketError("The studio sent text that is not UTF-8.") from error
        return ("binary", data)


def _close_event(payload: bytes) -> Event:
    if len(payload) == 0:
        return ("close", None, "")
    if len(payload) == 1:
        raise WebSocketError("The studio sent a broken close frame.")
    code = struct.unpack("!H", payload[:2])[0]
    return ("close", code, payload[2:].decode("utf-8", errors="replace"))


class WebSocketConnection:
    """A client connection over a plain TCP socket. Not thread-safe: one thread owns it."""

    def __init__(self, sock: socket.socket, leftover: bytes = b"") -> None:
        self._sock = sock
        self._decoder = FrameDecoder()
        self._pending: List[Event] = self._decoder.feed(leftover) if leftover else []
        self._closing = False

    @classmethod
    def open(cls, host: str, port: int, path: str, timeout: float = 5.0) -> "WebSocketConnection":
        sock = socket.create_connection((host, port), timeout=timeout)
        try:
            key = make_key()
            sock.sendall(handshake_request(host, port, path, key))
            head, leftover = _read_head(sock)
            check_handshake_response(head, key)
        except BaseException:
            sock.close()
            raise
        return cls(sock, leftover)

    def send_text(self, text: str, timeout: float = 10.0) -> None:
        self._send(client_frame(OPCODE_TEXT, text.encode("utf-8")), timeout)

    def receive(self, timeout: float) -> List[Event]:
        """Wait up to `timeout` seconds for data and return the events it completes.
        Pings are answered here. Raises ConnectionClosed when the connection ends."""
        if self._pending:
            events, self._pending = self._pending, []
        else:
            self._sock.settimeout(timeout)
            try:
                data = self._sock.recv(65536)
            except socket.timeout:
                return []
            if not data:
                raise ConnectionClosed("The studio closed the connection.")
            events = self._decoder.feed(data)
        for event in events:
            if event[0] == "ping":
                self._send(client_frame(OPCODE_PONG, event[1]), 5.0)
            elif event[0] == "close" and not self._closing:
                # Echo the close so the server can finish its closing handshake.
                code = event[1] if isinstance(event[1], int) else CLOSE_NORMAL
                self._closing = True
                self._send(client_frame(OPCODE_CLOSE, close_payload(code)), 1.0)
        return events

    def close(self, code: int = CLOSE_NORMAL, reason: str = "") -> None:
        try:
            if not self._closing:
                self._closing = True
                self._send(client_frame(OPCODE_CLOSE, close_payload(code, reason)), 1.0)
        except OSError:
            pass  # The socket is already gone; closing it below is all that is left to do.
        finally:
            self._sock.close()

    def _send(self, frame: bytes, timeout: float) -> None:
        self._sock.settimeout(timeout)
        self._sock.sendall(frame)


def _read_head(sock: socket.socket) -> Tuple[bytes, bytes]:
    received = b""
    while b"\r\n\r\n" not in received:
        if len(received) > MAX_HEADER_BYTES:
            raise WebSocketError("The studio's handshake answer is too long.")
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionClosed("The studio closed the connection during the handshake.")
        received += chunk
    head, leftover = received.split(b"\r\n\r\n", 1)
    return head, leftover
