"""The helper's ears (listen.py) without a microphone or a model: a command that prints bytes stands for the
recorder, and the recognizer tells how much sound it was given."""
import sys
import time
import unittest

from collections import namedtuple

from listen import Ears, SECOND, recognizer, spoken


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
