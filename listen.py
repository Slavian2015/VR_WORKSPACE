#!/usr/bin/env python3
"""The helper's ears: speech into text, on this PC (faster-whisper; ./setup-speech.sh installs it into .speech/).
Nothing of what is said leaves the PC, and the model is never asked for over the network.

server.js starts this with the first use of the helper's mode and keeps it, the model loaded (run by the Python of
.speech/venv). It is told on its standard input, a word a line, and tells on its standard output, a JSON line each:

  start    the microphone is recorded from now on    -> {"partial": "the words so far"}, again as more is said
  stop     the recording ends                        -> {"text": "all the words"}, "" if nothing was said
  cancel   the recording ends, nothing is told

The microphone is the system's own (the phone's while it is the PC's microphone, see mic.py), recorded by `parec`.
At most a minute is kept. The words are taken for Russian; names from other languages come through as they sound.
"""
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
# Words the recognizer should expect: it leans toward them where the sound is unclear
HINT = 'VR Workspace, сфера, фон, затемнение, размытие, резкость, камера, запись видео, окно, Claude.'
# What the model makes up out of silence and noise (it learnt from the subtitles of films): a second of silence and
# the start of a word came out as "Продолжение следует." or "Звезда." on the stand (2026-11-23). Such words alone
# are no words; and the model tells by itself how little it believes them: real phrases came with a chance of "no
# speech" of 0.01 and a mean log-probability of -0.03 to -0.14, the made-up ones with 0.53 to 0.7 and -0.8 to -1.4.
PHANTOMS = ('продолжение следует', 'субтитры', 'спасибо за просмотр', 'подписывайтесь на канал')


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
        segments, _ = held['model'].transcribe(numpy.frombuffer(sound, numpy.int16).astype(numpy.float32) / 32768, language='ru', beam_size=1 if quick else 5,
                                               vad_filter=True, condition_on_previous_text=False, initial_prompt=HINT, without_timestamps=True)
        return spoken(segments)

    threading.Thread(target=load, daemon=True).start()
    return transcribe


class Ears:
    def __init__(self, transcribe, record=RECORD, tell=say):
        self.transcribe, self.record, self.tell = transcribe, record, tell
        self.lock, self.busy = threading.Lock(), threading.Lock()  # lock: the sound; busy: one recognition at a time
        self.child, self.sound, self.run = None, bytearray(), 0

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


if __name__ == '__main__':
    ears = Ears(recognizer())
    for line in sys.stdin:
        act = {'start': ears.start, 'stop': ears.stop, 'cancel': ears.cancel}.get(line.strip())
        if act:
            act()
    ears.cancel()
