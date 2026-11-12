import unittest

import capture

FHD, WIDE = (1920, 1080), (3440, 1440)


def overlap(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def touch(a, b):  # share a piece of an edge
    side = (a[0] + a[2] == b[0] or b[0] + b[2] == a[0]) and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
    above = (a[1] + a[3] == b[1] or b[1] + b[3] == a[1]) and a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
    return side or above


class LowMemoryGuard(unittest.TestCase):
    def test_capture_stops_only_when_memory_runs_out(self):
        self.assertIsNone(capture.memory_action(capture.LOW_MEMORY_MB + 1, capturing=True))
        self.assertEqual(capture.memory_action(capture.LOW_MEMORY_MB - 1, capturing=True), 'stop')

    def test_stopped_capture_comes_back_only_with_room_to_spare(self):
        self.assertIsNone(capture.memory_action(capture.LOW_MEMORY_MB + 1, capturing=False))  # would stop again at once
        self.assertEqual(capture.memory_action(2 * capture.LOW_MEMORY_MB + 1, capturing=False), 'leave')


class SystemLayout(unittest.TestCase):
    def test_monitor_seen_on_the_right_stands_on_the_right_centred(self):
        layout = capture.system_layout([('real', *FHD, 0, 0), ('wide', *WIDE, 90, 0)])
        self.assertEqual(layout, {'real': (0, 180), 'wide': (1920, 0)})

    def test_monitor_seen_below_stands_below(self):  # the arrangement the user asked for: one above the other
        layout = capture.system_layout([('real', *FHD, 5, 39), ('wide', *WIDE, 8, -9)])
        self.assertEqual(layout, {'real': (760, 0), 'wide': (0, 1080)})

    def test_left_and_above(self):
        self.assertEqual(capture.system_layout([('a', *FHD, 0, 0), ('b', *FHD, -95, 0)]), {'a': (1920, 0), 'b': (0, 0)})
        self.assertEqual(capture.system_layout([('a', *FHD, 0, 0), ('b', *FHD, 10, 40)]), {'a': (0, 1080), 'b': (0, 0)})

    def test_yaw_is_compared_the_short_way_round(self):
        layout = capture.system_layout([('a', *FHD, 170, 0), ('b', *FHD, -170, 0)])  # b is 20 degrees to the right of a
        self.assertEqual(layout, {'a': (0, 0), 'b': (1920, 0)})

    def test_any_four_monitors_touch_and_never_overlap(self):
        for yaws, pitches in [((0, 95, -95, 190), (0, 0, 0, 0)), ((0, 50, 30, 31), (0, 0, 10, 12)), ((0, 0, 0, 0), (0, 0, 0, 0)), ((0, 3, -4, 60), (0, 40, -40, 5))]:
            sizes = [FHD, WIDE, FHD, WIDE]
            layout = capture.system_layout([(str(i), *sizes[i], yaws[i], pitches[i]) for i in range(4)])
            boxes = [(*layout[str(i)], *sizes[i]) for i in range(4)]
            self.assertEqual((min(b[0] for b in boxes), min(b[1] for b in boxes)), (0, 0))
            for i, a in enumerate(boxes):
                self.assertFalse(any(overlap(a, b) for b in boxes[i + 1:]), (yaws, pitches, boxes))
                self.assertTrue(any(touch(a, b) for j, b in enumerate(boxes) if j != i), (yaws, pitches, boxes))
