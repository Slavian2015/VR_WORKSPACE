#!/usr/bin/env python3
"""The helper's ears: speech into text, on this PC (faster-whisper; ./setup-speech.sh installs it into .speech/).
Nothing of what is said leaves the PC, and the model is never asked for over the network.

server.js starts this with the first use of the helper's mode and keeps it, the model loaded (run by the Python of
.speech/venv). It is told on its standard input, a word a line, and tells on its standard output, a JSON line each:

  start    the microphone is recorded from now on    -> {"partial": "the words so far"}, again as more is said
  stop     the recording ends                        -> {"text": "all the words"}, "" if nothing was said
  cancel   the recording ends, nothing is told
  live     a talk with no key: the microphone is listened to until `cancel`, and every phrase is found by itself
           (it begins when somebody speaks, it ends when they have been silent for 0.8 s):
                                                     -> {"speech": true} when one begins, {"partial": ...} as it
                                                        goes, {"text": "its words", "live": true} when it has ended
  speaking / silent   the helper's own voice sounds now / no longer: while it does, only clearly louder and longer
           speech begins a phrase (the microphone hears that voice too)
  language ru         what is said is taken for this language from now on: en, ru or fr (English until told)

The microphone is the system's own (the phone's while it is the PC's microphone, see mic.py), recorded by `parec`.
At most a minute is kept. The words are taken for the language told; names from other languages come through as they sound.
"""
import array
import collections
import json
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('VR_SPEECH_MODEL', 'small')
RECORD = ['parec', '--format=s16le', '--rate=16000', '--channels=1', '--latency-msec=40']
SECOND = 32000  # bytes: 16000 samples of two bytes
FRAME = 960     # bytes: 30 ms, what a phrase is looked for by
# Words the recognizer should expect, in each language: it leans toward them where the sound is unclear
HINTS = {'en': 'VR Workspace, sphere, background, dimming, blur, sharpness, camera, video recording, window, Claude.',
         'ru': 'VR Workspace, сфера, фон, затемнение, размытие, резкость, камера, запись видео, окно, Claude.',
         'fr': 'VR Workspace, sphère, fond, assombrissement, flou, netteté, caméra, enregistrement vidéo, fenêtre, Claude.'}
LANGUAGE = ['en']  # what is said is taken for this one (told by `language`)
# What the model makes up out of silence and noise (it learnt from the subtitles of films): a second of silence and
# the start of a word came out as "Продолжение следует." or "Звезда." on the stand (2026-11-23). Such words alone
# are no words; and the model tells by itself how little it believes them: real phrases came with a chance of "no
# speech" of 0.01 and a mean log-probability of -0.03 to -0.14, the made-up ones with 0.53 to 0.7 and -0.8 to -1.4.
PHANTOMS = ('продолжение следует', 'субтитры', 'спасибо за просмотр', 'подписывайтесь на канал', 'thanks for watching', 'subtitles by', 'sous-titres', "merci d'avoir regardé")


def say(**what):
    print(json.dumps(what, ensure_ascii=False), flush=True)


def spoken(segments):
    """The words of what the model heard: without the parts it hardly believes itself, and none if they are only a phantom"""
    text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < 0.5 and s.avg_logprob > -1).strip()
    return '' if len(text) < 60 and any(p in text.lower() for p in PHANTOMS) else text


def whisper():
    from faster_whisper import WhisperModel  # here: the tests run without it
    return WhisperModel(MODEL, device='cpu', compute_type='int8', download_root=os.path.join(HERE, '.speech/models'), local_files_only=True)


def recognizer(model=whisper, tell=say):
    """transcribe(sound, quick) with the model loaded behind it: at once, so that the first words do not wait for it.
    A model that cannot be loaded (not set up, another one named) is told once, and then nothing is heard."""
    ready, held = threading.Event(), {}

    def load():
        try:
            held['model'] = model()
        except Exception as e:
            tell(error=f'the model "{MODEL}" cannot be loaded ({e}): run ./setup-speech.sh')
        ready.set()

    def transcribe(sound, quick):
        ready.wait()
        if 'model' not in held:
            return ''
        import numpy
        segments, _ = held['model'].transcribe(numpy.frombuffer(sound, numpy.int16).astype(numpy.float32) / 32768, language=LANGUAGE[0], beam_size=1 if quick else 5,
                                               vad_filter=True, condition_on_previous_text=False, initial_prompt=HINTS[LANGUAGE[0]], without_timestamps=True)
        return spoken(segments)

    threading.Thread(target=load, daemon=True).start()
    return transcribe


class Phrases:
    """Finds the phrases in the sound of a microphone, frame by frame (30 ms each), by its loudness. A phrase begins
    when 5 of the last 8 frames were louder than the room (three times its noise, and never under LEAST); it ends after 0.8 s with no loud frame, or at `most` seconds. With `strict` (the helper's own
    voice sounds): three times louder still, and 6 of the last 9 frames. feed() answers 'start' or 'end' when one
    begins or has ended; `sound` is the phrase so far, with a third of a second from before its beginning."""
    LEAST = 300  # of 32768: a quiet room through a webcam's microphone is 50 to 200, speech from an arm's length 1000 and more

    def __init__(self, most=30):
        self.most, self.strict, self.inside = most, False, False
        self.floor, self.quiet, self.sound = 0.0, 0, bytearray()
        self.before, self.loud = collections.deque(maxlen=12), collections.deque(maxlen=16)

    def feed(self, frame):
        samples = array.array('h', frame[:len(frame) // 2 * 2])
        level = (sum(x * x for x in samples) / max(1, len(samples))) ** 0.5
        voiced = level > max(self.LEAST, 3 * self.floor) * (3 if self.strict else 1)
        if self.inside:
            self.sound += frame
            self.quiet = 0 if voiced else self.quiet + 1
            if not self.strict:
                self.floor += (level - self.floor) * (0.001 if voiced else 0.05)
            if self.quiet < 27 and len(self.sound) < self.most * SECOND:
                return None
            self.inside = False
            self.loud.clear()
            self.before.clear()
            return 'end'
        # The room's noise: followed at once while it is quiet, and very slowly up through what is loud, so that a
        # fan switched on stops counting as speech after some ten seconds, and a long phrase stays one. Not while
        # the helper's own voice sounds: that is no noise of the room.
        if not self.strict:
            self.floor += (level - self.floor) * (0.001 if voiced else 0.05)
        self.before.append(frame)
        self.loud.append(voiced)
        need, of = (6, 9) if self.strict else (5, 8)  # a short "стоп" has 0.15 to 0.2 s of loud sound (the stand, 2026-11-23): it must get through
        if sum(list(self.loud)[-of:]) < need:
            return None
        self.inside, self.quiet, self.sound = True, 0, bytearray(b''.join(self.before))
        return 'start'


class Ears:
    def __init__(self, transcribe, record=RECORD, tell=say):
        self.transcribe, self.record, self.tell = transcribe, record, tell
        self.lock, self.busy = threading.Lock(), threading.Lock()  # lock: the sound; busy: one recognition at a time
        self.child, self.sound, self.run = None, bytearray(), 0
        self.strict = False  # the helper's own voice sounds (told by `speaking` and `silent`)

    def start(self):
        self.cancel()
        self.sound, self.run = bytearray(), self.run + 1
        try:
            self.child = subprocess.Popen(self.record, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as e:
            return self.tell(error=f'the microphone cannot be recorded: {e}')
        self.reader = threading.Thread(target=self._read, args=(self.child, self.run), daemon=True)
        self.reader.start()
        threading.Thread(target=self._partials, args=(self.run,), daemon=True).start()

    def _read(self, child, run):
        while chunk := child.stdout.read(SECOND // 10):
            with self.lock:
                if run == self.run and len(self.sound) < 60 * SECOND:
                    self.sound += chunk

    def _partials(self, run):  # the words so far, whenever a second more has been said
        told = 0
        while run == self.run and self.child:
            time.sleep(0.3)
            with self.lock:
                sound = bytes(self.sound)
            if len(sound) - told < SECOND:
                continue
            told = len(sound)
            with self.busy:
                text = self.transcribe(sound, True) if run == self.run and self.child else ''
            if text and run == self.run and self.child:
                self.tell(partial=text)

    def _end(self):
        child, self.child = self.child, None
        if child:
            child.terminate()
            self.reader.join(2)  # what was already recorded is read to its end
        with self.lock:
            sound = bytes(self.sound)
        self.run += 1
        return sound if child else b''

    def stop(self):
        sound = self._end()
        with self.busy:
            self.tell(text=self.transcribe(sound, False) if len(sound) > SECOND // 4 else '')

    def cancel(self):
        self._end()

    def live(self):
        self.cancel()
        self.sound, self.run = bytearray(), self.run + 1
        try:
            self.child = subprocess.Popen(self.record, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as e:
            return self.tell(error=f'the microphone cannot be recorded: {e}')
        self.reader = threading.Thread(target=self._live, args=(self.child, self.run), daemon=True)
        self.reader.start()

    def _live(self, child, run):
        # The microphone is read on and on, also while words are being made out: a phrase said meanwhile is not
        # missed, and its beginning is told at once (that is what stops the helper's own voice).
        phrases, told = Phrases(most=60), 0
        while (frame := child.stdout.read(FRAME)) and run == self.run:
            phrases.strict = self.strict
            what = phrases.feed(frame)
            if what == 'start':
                told = len(phrases.sound)
                self.tell(speech=True)
            elif what == 'end':
                threading.Thread(target=self._words, args=(bytes(phrases.sound), run, False), daemon=True).start()
            elif phrases.inside and len(phrases.sound) - told >= SECOND and not self.busy.locked():
                told = len(phrases.sound)
                threading.Thread(target=self._words, args=(bytes(phrases.sound), run, True), daemon=True).start()
        if run == self.run:  # not ended by us: the recorder stopped (the sound server went, or it never started)
            self.tell(error='the microphone stopped')

    def _words(self, sound, run, partial):
        with self.busy:
            text = self.transcribe(sound, partial) if run == self.run else ''
        if run != self.run:
            return
        if not partial:
            self.tell(text=text, live=True)  # also when there were no words (a cough, a door): the phrase is over
        elif text:
            self.tell(partial=text)


if __name__ == '__main__':
    ears = Ears(recognizer())
    for line in sys.stdin:
        word = line.strip()
        if word in ('speaking', 'silent'):
            ears.strict = word == 'speaking'
        if word.startswith('language ') and word[9:] in HINTS:
            LANGUAGE[0] = word[9:]
        act = {'start': ears.start, 'stop': ears.stop, 'cancel': ears.cancel, 'live': ears.live}.get(word)
        if act:
            act()
    ears.cancel()
