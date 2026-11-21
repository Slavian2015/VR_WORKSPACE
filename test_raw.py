import unittest

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst

import raw


class Cut(unittest.TestCase):
    def test_the_wanted_corner_is_the_top_left_of_a_picture_stored_bottom_up(self):
        Gst.init(None)
        pixels = bytes(range(24))  # 3 wide, 2 high, 4 bytes a pixel: the bottom row is 0..11, the top row 12..23
        sample = Gst.Sample.new(Gst.Buffer.new_wrapped(pixels), Gst.Caps.from_string('video/x-raw,format=RGBx,width=3,height=2'), None, None)
        raw.wanted = None
        self.assertEqual(raw.cut(sample), (3, 2, pixels))
        raw.wanted = (2, 1)
        self.assertEqual(raw.cut(sample), (2, 1, bytes(range(12, 20))))
        raw.wanted = (9, 9)  # more than there is: all of it
        self.assertEqual(raw.cut(sample), (3, 2, pixels))
