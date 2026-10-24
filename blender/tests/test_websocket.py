# SPDX-License-Identifier: GPL-3.0-or-later
import struct
import unittest

from addon.websocket import (
    OPCODE_CONTINUATION,
    OPCODE_PING,
    OPCODE_TEXT,
    FrameDecoder,
    WebSocketError,
    accept_for,
    check_handshake_response,
    close_payload,
    encode_frame,
)


class Handshake(unittest.TestCase):
    def test_accept_value_matches_the_rfc_example(self):
        # RFC 6455 section 1.3 gives this key and answer.
        self.assertEqual(accept_for("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_a_refused_upgrade_says_so(self):
        with self.assertRaisesRegex(WebSocketError, "HTTP 403"):
            check_handshake_response(b"HTTP/1.1 403 Forbidden", "key")


class Frames(unittest.TestCase):
    def test_short_medium_and_long_lengths_round_trip(self):
        for size in (5, 300, 70_000):
            text = "x" * size
            frame = encode_frame(OPCODE_TEXT, text.encode(), mask_key=b"abcd")
            self.assertEqual(FrameDecoder(allow_masked=True).feed(frame), [("text", text)], size)

    def test_the_length_forms_are_the_ones_the_rfc_asks_for(self):
        self.assertEqual(encode_frame(OPCODE_TEXT, b"x" * 125)[1], 125)
        self.assertEqual(encode_frame(OPCODE_TEXT, b"x" * 126)[1], 126)
        self.assertEqual(struct.unpack("!H", encode_frame(OPCODE_TEXT, b"x" * 126)[2:4])[0], 126)
        self.assertEqual(encode_frame(OPCODE_TEXT, b"x" * 65_536)[1], 127)

    def test_frames_split_across_reads_wait_until_whole(self):
        frame = encode_frame(OPCODE_TEXT, b"hello")
        decoder = FrameDecoder()
        self.assertEqual(decoder.feed(frame[:3]), [])
        self.assertEqual(decoder.feed(frame[3:]), [("text", "hello")])

    def test_a_message_in_pieces_with_a_ping_between(self):
        word = "café".encode()  # é is two bytes; split it between the pieces
        pieces = encode_frame(OPCODE_TEXT, word[:4], fin=False) + encode_frame(OPCODE_PING, b"!") + encode_frame(OPCODE_CONTINUATION, word[4:])
        self.assertEqual(FrameDecoder().feed(pieces), [("ping", b"!"), ("text", "café")])

    def test_servers_must_not_mask(self):
        with self.assertRaises(WebSocketError):
            FrameDecoder().feed(encode_frame(OPCODE_TEXT, b"x", mask_key=b"abcd"))

    def test_oversize_messages_are_refused(self):
        with self.assertRaisesRegex(WebSocketError, "too large"):
            FrameDecoder(max_message_bytes=10).feed(encode_frame(OPCODE_TEXT, b"x" * 11))

    def test_close_frames_carry_code_and_reason(self):
        self.assertEqual(FrameDecoder().feed(encode_frame(0x8, close_payload(4401, "Unauthorized"))), [("close", 4401, "Unauthorized")])


if __name__ == "__main__":
    unittest.main()
