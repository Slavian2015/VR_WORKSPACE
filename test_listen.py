"""The helper's ears (listen.py) without a microphone or a model: a command that prints bytes stands for the
recorder, and the recognizer tells how much sound it was given. Its voice (speak.py) without a voice or a sound
output, the same way."""
import sys
import time
import unittest

from collections import namedtuple

import array
import os
import tempfile

from listen import Ears, FRAME, Phrases, SECOND, recognizer, spoken
from speak import Mouth, plain


class EarsTest(unittest.TestCase):
    def setUp(self):
        self.told = []
        heard = lambda sound, quick: f'{len(sound) / SECOND:g} s{" so far" if quick else ""}'
        # two and a half seconds of sound at once, then the recorder goes on in silence
        record = [sys.executable, '-c', f'import sys, time; sys.stdout.buffer.write(bytes({SECOND * 5 // 2})); sys.stdout.flush(); time.sleep(30)']
        self.ears = Ears(heard, record, lambda **what: self.told.append(what))

    def tearDown(self):
        self.ears.cancel()

    def wait(self, what):
        for _ in range(60):
            if what():
                return
            time.sleep(0.1)
        self.fail(f'not in time: {self.told}')

    def test_the_words_so_far_and_then_all_of_them(self):
        self.ears.start()
        self.wait(lambda: self.told)
        self.assertEqual(self.told, [{'partial': '2.5 s so far'}])  # told once: no more was said since
        self.ears.stop()
        self.assertEqual(self.told[-1], {'text': '2.5 s'})

    def test_given_up_or_never_started_tells_no_words(self):
        self.ears.start()
        self.wait(lambda: self.told)
        self.ears.cancel()
        self.ears.stop()  # nothing is being recorded
        self.assertEqual(self.told[1:], [{'text': ''}])

    def test_a_recorder_that_is_not_there_is_told_as_an_error(self):
        ears = Ears(lambda sound, quick: 'x', ['/no/such/recorder'], lambda **what: self.told.append(what))
        ears.start()
        self.assertIn('cannot be recorded', self.told[0]['error'])
        ears.stop()
        self.assertEqual(self.told[-1], {'text': ''})


class RecognizerTest(unittest.TestCase):
    def test_what_the_model_makes_up_out_of_silence_is_no_words(self):
        Part = namedtuple('Part', 'text no_speech_prob avg_logprob')
        self.assertEqual(spoken([Part(' Сделай фон темнее.', 0.01, -0.08)]), 'Сделай фон темнее.')
        self.assertEqual(spoken([Part(' Продолжение следует.', 0.3, -0.5)]), '')  # by its words
        self.assertEqual(spoken([Part(' Субтитры сделал DimaTorzok', 0.1, -0.2)]), '')
        self.assertEqual(spoken([Part(' Звезда.', 0.53, -1.3)]), '')  # by how little the model believes it: as the stand gave it
        self.assertEqual(spoken([Part(' шум', 0.2, -1.4), Part(' Включи камеру.', 0.05, -0.1)]), 'Включи камеру.')
        self.assertEqual(spoken([]), '')

    def test_a_model_that_cannot_be_loaded_is_told_once_and_hears_nothing(self):
        told = []

        def no_model():
            raise FileNotFoundError('no model here')

        transcribe = recognizer(no_model, lambda **what: told.append(what))
        self.assertEqual([transcribe(bytes(SECOND), False), transcribe(bytes(SECOND), True)], ['', ''])  # and does not wait for ever
        self.assertEqual(len(told), 1)
        self.assertIn('cannot be loaded', told[0]['error'])


if __name__ == '__main__':
    unittest.main()


def sound(level, seconds):
    """Sound of that loudness (of 32768), as the frames a microphone gives"""
    samples = array.array('h', [level, -level] * (FRAME // 4)).tobytes()
    return [samples] * round(seconds * SECOND / FRAME)


class PhrasesTest(unittest.TestCase):
    def heard(self, phrases, frames):
        """What the frames made of it: [(what, at which second of them)]"""
        return [(what, round(i * FRAME / SECOND, 1)) for i, frame in enumerate(frames) if (what := phrases.feed(frame))]

    def test_a_phrase_begins_when_somebody_speaks_and_ends_when_they_are_silent(self):
        phrases = Phrases()
        self.assertEqual(self.heard(phrases, sound(100, 1)), [])                        # the room
        self.assertEqual(self.heard(phrases, sound(2000, 1.5)), [('start', 0.1)])
        self.assertEqual(self.heard(phrases, sound(100, 1)), [('end', 0.8)])
        self.assertAlmostEqual(len(phrases.sound) / SECOND, 0.36 - 0.15 + 1.5 + 0.81, delta=0.1)  # with a moment from before it
        self.assertEqual(self.heard(phrases, sound(100, 1)), [])
        self.assertEqual(self.heard(phrases, sound(2000, 0.5) + sound(100, 1)), [('start', 0.1), ('end', 1.3)])  # and the next one

    def test_a_click_or_a_cough_begins_none_and_a_pause_inside_does_not_end_one(self):
        phrases = Phrases()
        self.assertEqual(self.heard(phrases, sound(100, 0.5) + sound(5000, 0.1) + sound(100, 1)), [])
        self.assertEqual(self.heard(phrases, sound(2000, 1) + sound(100, 0.5) + sound(2000, 1) + sound(100, 1)), [('start', 0.1), ('end', 3.3)])

    def test_a_phrase_has_an_end_even_if_the_noise_never_stops(self):
        self.assertEqual(self.heard(Phrases(most=5), sound(3000, 8)), [('start', 0.1), ('end', 5.0), ('start', 5.1)])

    def test_a_room_that_turns_noisy_is_learnt(self):
        phrases = Phrases()
        events = self.heard(phrases, sound(100, 1) + sound(400, 20))   # a fan is switched on: taken for speech first
        self.assertEqual([what for what, _ in events], ['start', 'end'])
        self.assertLess(events[1][1], 16)
        self.assertEqual(self.heard(phrases, sound(400, 5)), [])        # then no longer
        self.assertEqual(self.heard(phrases, sound(3000, 1)), [('start', 0.1)])  # speech over it still is

    def test_while_the_helper_speaks_only_clearly_louder_speech_begins_a_phrase(self):
        phrases = Phrases()
        phrases.strict = True
        self.assertEqual(self.heard(phrases, sound(100, 1) + sound(700, 2)), [])   # its own voice through the microphone
        self.assertEqual(self.heard(phrases, sound(3000, 0.2) + sound(100, 1)), [('start', 0.1), ('end', 1.0)])  # a short "стоп" gets through


class LiveTest(unittest.TestCase):
    def test_a_talk_with_no_key_tells_each_phrase_by_itself(self):
        told, file = [], tempfile.mktemp()
        with open(file, 'wb') as f:
            f.write(b''.join(sound(100, 0.5) + sound(2000, 1.5) + sound(100, 1.2) + sound(2500, 0.6) + sound(100, 1.2)))
        record = [sys.executable, '-c', f'import sys, time; sys.stdout.buffer.write(open({file!r}, "rb").read()); sys.stdout.flush(); time.sleep(30)']
        ears = Ears(lambda sound, quick: f'{len(sound) / SECOND:.1f} s{" so far" if quick else ""}', record, lambda **what: told.append(what))
        ears.live()
        try:
            for _ in range(60):
                if sum('live' in t for t in told) == 2:
                    break
                time.sleep(0.1)
            whole = [t for t in told if 'partial' not in t]
            self.assertEqual(whole, [{'speech': True}, {'text': '2.5 s', 'live': True}, {'speech': True}, {'text': '1.6 s', 'live': True}])
        finally:
            ears.cancel()
            os.remove(file)


class MicrophoneTest(unittest.TestCase):
    def test_a_recorder_that_stops_is_told_and_what_was_being_said_is_dropped(self):
        told = []
        ears = Ears(lambda sound, quick: 'x', [sys.executable, '-c', 'pass'], lambda **what: told.append(what))  # it ends at once: the sound server is gone
        ears.live()
        for _ in range(40):
            if told:
                break
            time.sleep(0.05)
        self.assertEqual(told, [{'error': 'the microphone stopped'}])
        ears.cancel()


class MouthTest(unittest.TestCase):
    def setUp(self):
        self.told, self.file = [], tempfile.mktemp()
        self.said = []  # what the voice was asked for: (its name, the speaker, how much slower)
        self.voice = lambda name: ((lambda text, speaker, slower: self.said.append((name, speaker, round(slower, 3))) or [text.encode(), b'.']), 22050)

    def tearDown(self):
        if os.path.exists(self.file):
            os.remove(self.file)

    def wait(self, what):
        for _ in range(60):
            if what():
                return
            time.sleep(0.1)
        self.fail(f'not in time: {self.told}')

    def test_what_is_said_sounds_and_then_it_is_silent(self):
        play = [sys.executable, '-c', f'import sys; open({self.file!r}, "ab").write(sys.stdin.buffer.read())']
        mouth = Mouth(self.voice, play, lambda **what: self.told.append(what))
        mouth.say('Фон **затемнён** до `40`.')
        self.wait(lambda: self.told[-1:] == [{'speaking': False}])
        self.assertEqual(self.told, [{'speaking': True}, {'speaking': False}])
        self.assertEqual(open(self.file, 'rb').read().decode(), 'Фон затемнён до 40..')  # without the signs a voice would stumble on
        self.assertEqual(self.said, [('ru_RU-irina-medium', '', 1.0)])

    def test_another_voice_its_speaker_speed_and_timbre(self):
        # the player's arguments are written to the file: the rate it is given shows the timbre
        play = [sys.executable, '-c', f'import sys; open({self.file!r}, "a").write(sys.argv[-1]); sys.stdin.buffer.read()']
        mouth = Mouth(self.voice, play, lambda **what: self.told.append(what))
        mouth.say('x', 'fr_FR-upmc-medium#pierre', speed=1.25, pitch=0.9)
        self.wait(lambda: self.told[-1:] == [{'speaking': False}])
        self.assertEqual(self.said, [('fr_FR-upmc-medium', 'pierre', 0.72)])  # 0.9 slower for the timbre, 1.25 faster as asked
        self.assertEqual(open(self.file).read(), '--rate=19845')                          # and played 0.9 as fast: deeper
        mouth.say('y', 'ru_RU-irina-medium', speed=9, pitch=9)                             # out of range: brought into it
        self.wait(lambda: len(self.said) == 2)
        self.assertEqual(self.said[1], ('ru_RU-irina-medium', '', 0.7))

    def test_stopped_it_falls_silent_at_once_and_forgets_the_rest(self):
        play = [sys.executable, '-c', f'import sys, time; open({self.file!r}, "ab").write(sys.stdin.buffer.read()); time.sleep(30)']  # a sound that lasts
        mouth = Mouth(self.voice, play, lambda **what: self.told.append(what))
        mouth.say('one')
        mouth.say('two')
        self.wait(lambda: self.told == [{'speaking': True}])
        mouth.stop()
        self.wait(lambda: self.told[-1:] == [{'speaking': False}])
        time.sleep(0.3)
        self.assertEqual(self.told, [{'speaking': True}, {'speaking': False}])  # "two" was never begun
        mouth.say('three')  # and it speaks again when asked
        self.wait(lambda: len(self.told) == 3)
        self.assertEqual(self.told[-1], {'speaking': True})
        mouth.stop()

    def test_a_voice_that_is_not_set_up_is_told_once(self):
        def none(name):
            raise FileNotFoundError('no voice')
        mouth = Mouth(none, ['true'], lambda **what: self.told.append(what))
        mouth.say('x')
        self.wait(lambda: self.told)
        self.assertIn('cannot be loaded', self.told[0]['error'])
        self.assertEqual(plain('  a  *b* «c»\n[d] '), 'a b c d')

    def test_whatever_fails_while_a_thing_is_spoken_it_ends_as_silence_and_the_next_is_spoken(self):
        def broken(name):
            def sounds(text, speaker, slower):
                if text == 'bad':
                    raise ValueError('no such sound')
                return [text.encode()]
            return sounds, 22050
        play = [sys.executable, '-c', f'import sys; open({self.file!r}, "ab").write(sys.stdin.buffer.read())']
        mouth = Mouth(broken, play, lambda **what: self.told.append(what))
        mouth.say('bad')
        self.wait(lambda: {'speaking': False} in self.told)
        self.assertIn('the voice failed', next(t['error'] for t in self.told if 'error' in t))
        mouth.say('good')
        self.wait(lambda: self.told.count({'speaking': False}) == 2)
        self.assertEqual(open(self.file, 'rb').read(), b'good')
        mouth2 = Mouth(self.voice, ['/no/such/player'], lambda **what: self.told.append(what))  # a player that is not there
        mouth2.say('x')
        self.wait(lambda: any('cannot be played' in t.get('error', '') for t in self.told))
