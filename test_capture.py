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


def boxes_of(monitors):
    layout = capture.system_layout(tuple(monitors))
    return {name: (*layout[name], w, h) for name, w, h, *_ in monitors}


def right_of(a, b):  # b stands against the right edge of a, and they share a piece of it
    return a[0] + a[2] == b[0] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def above(a, b):  # b stands on top of a
    return b[1] + b[3] == a[1] and a[0] < b[0] + b[2] and b[0] < a[0] + a[2]


class SystemLayout(unittest.TestCase):
    def test_monitor_seen_on_the_right_stands_on_the_right_centred(self):
        layout = capture.system_layout((('real', *FHD, 0, 0, 70), ('wide', *WIDE, 90, 0, 100)))
        self.assertEqual(layout, {'real': (0, 180), 'wide': (1920, 0)})

    def test_monitor_seen_below_stands_below(self):  # the arrangement the user asked for: one above the other
        b = boxes_of([('real', *FHD, 5, 39, 70), ('wide', *WIDE, 8, -9, 100)])
        self.assertTrue(above(b['wide'], b['real']), b)

    def test_left_and_above(self):
        self.assertEqual(capture.system_layout((('a', *FHD, 0, 0, 70), ('b', *FHD, -95, 0, 70))), {'a': (1920, 0), 'b': (0, 0)})
        b = boxes_of([('a', *FHD, 0, 0, 70), ('b', *FHD, 10, 40, 70)])
        self.assertTrue(above(b['a'], b['b']), b)

    def test_yaw_is_compared_the_short_way_round(self):
        layout = capture.system_layout((('a', *FHD, 170, 0, 70), ('b', *FHD, -170, 0, 70)))  # b is 20 degrees to the right of a
        self.assertEqual(layout, {'a': (0, 0), 'b': (1920, 0)})

    def test_two_side_by_side_and_one_above_between_them(self):
        # The user's monitors on 2026-11-13: the second was seen on the right of the first but stood under it,
        # because the third, above, was a little nearer to it and it was put against that one.
        virtual = (2560, 1440)
        b = boxes_of([('first', *FHD, -38, -3, 70 * 1.5 / 1.6), ('second', *virtual, 29, -3, 76), ('third', *virtual, -5, 38, 76)])
        self.assertTrue(right_of(b['first'], b['second']), b)
        self.assertTrue(above(b['first'], b['third']), b)
        self.assertTrue(above(b['second'], b['third']), b)  # the pointer reaches the top one from both

    def test_a_row_of_three_and_a_square_of_four(self):
        b = boxes_of([('m', *FHD, 0, 0, 70), ('r', *FHD, 75, 0, 70), ('l', *FHD, -75, 0, 70)])
        self.assertTrue(right_of(b['l'], b['m']) and right_of(b['m'], b['r']), b)
        b = boxes_of([('a', *FHD, -35, -20, 60), ('b', *FHD, 35, -20, 60), ('c', *FHD, -35, 20, 60), ('d', *FHD, 35, 20, 60)])
        self.assertTrue(right_of(b['a'], b['b']) and right_of(b['c'], b['d']) and above(b['a'], b['c']) and above(b['b'], b['d']), b)

    def test_any_four_monitors_touch_and_never_overlap(self):
        for yaws, pitches in [((0, 95, -95, 190), (0, 0, 0, 0)), ((0, 50, 30, 31), (0, 0, 10, 12)), ((0, 0, 0, 0), (0, 0, 0, 0)), ((0, 3, -4, 60), (0, 40, -40, 5))]:
            sizes = [FHD, WIDE, FHD, WIDE]
            layout = capture.system_layout(tuple((str(i), *sizes[i], yaws[i], pitches[i], 80) for i in range(4)))
            boxes = [(*layout[str(i)], *sizes[i]) for i in range(4)]
            self.assertEqual((min(b[0] for b in boxes), min(b[1] for b in boxes)), (0, 0))
            for i, a in enumerate(boxes):
                self.assertFalse(any(overlap(a, b) for b in boxes[i + 1:]), (yaws, pitches, boxes))
                self.assertTrue(any(touch(a, b) for j, b in enumerate(boxes) if j != i), (yaws, pitches, boxes))

    def test_each_virtual_monitor_has_its_size_and_only_listed_sizes_pass(self):
        saved = {'virtualSize': '2560x1440', 'm1.size': '3440x1440', 'm3.size': '9999x1; rm -rf ~'}
        self.assertEqual(capture.virtual_size(saved, 1), ['3440', '1440'])
        self.assertEqual(capture.virtual_size(saved, 2), ['2560', '1440'])  # none of its own: the one for all
        self.assertEqual(capture.virtual_size(saved, 3), ['2560', '1440'])  # not a listed size
        self.assertEqual(capture.virtual_size({}, 1), capture.VIRTUAL_SIZES[0].split('x'))

    def test_place_comes_from_the_settings_with_defaults_for_what_is_missing_or_broken(self):
        saved = {'dist': 1.7, 'm0.yaw': -38, 'm0.pitch': -3, 'm0.span': 70, 'm0.dist': 1.6, 'm1.yaw': 29, 'm1.span': 76, 'm2.yaw': 'x'}
        self.assertEqual(capture.place_in_sphere(saved, 0), (-38, -3, 70 * 1.5 / 1.6))
        self.assertEqual(capture.place_in_sphere(saved, 1), (29, 0, 76 * 1.5 / 1.7))  # no distance of its own: the old shared one
        self.assertEqual(capture.place_in_sphere(saved, 2), (capture.SLOT_YAW[2], 0, 90))
        self.assertEqual(capture.place_in_sphere({}, 3), (capture.SLOT_YAW[3], 0, 90))
