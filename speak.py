#!/usr/bin/env python3
"""The helper's voice: text into speech, on this PC (piper; ./setup-speech.sh installs it and a voice into .speech/).
Nothing of what is spoken leaves the PC.

server.js starts this with the first answer of a live talk and keeps it, the voice loaded (run by the Python of
.speech/venv). It is told on its standard input, a JSON line each, and tells on its standard output the same way:

  {"say": "text"}   speaks it, after what it is still speaking   -> {"speaking": true} as the sound begins,
                                                                    {"speaking": false} when all is said
                    with it may come "voice" (a name of piper's, "#name" behind it for one speaker of a voice
                    with several), "speed" (1: as the voice speaks; 1.2: faster) and "pitch" (1: its own timbre;
                    lower: deeper, higher: lighter)
  {"stop": true}    falls silent at once and forgets the rest    -> {"speaking": false}

The sound goes to the system's output (`pacat`), which VR Workspace sends on to the headset. A voice is loaded when
first used and kept. The timbre: the sound is made that much slower and played that much faster (a tape played
fast), so the speed stays as asked.
"""
import json
import os
import queue
import re
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = 'ru_RU-irina-medium'  # when none is named
PLAY = ['pacat', '--format=s16le', '--channels=1', '--latency-msec=60']  # and the voice's rate: --rate=22050


def say(**what):
    print(json.dumps(what, ensure_ascii=False), flush=True)


def piper(name):
    """A voice of piper's by its name: sounds(text, speaker, slower), which gives the sound sentence by sentence, and its rate"""
    from piper import PiperVoice  # here: the tests run without it
    from piper.config import SynthesisConfig
    voice = PiperVoice.load(os.path.join(HERE, '.speech/voices', name + '.onnx'))

    def sounds(text, speaker, slower):
        config = SynthesisConfig(speaker_id=(voice.config.speaker_id_map or {}).get(speaker), length_scale=(voice.config.length_scale or 1.0) * slower)
        return (chunk.audio_int16_bytes for chunk in voice.synthesize(text, config))
    return sounds, voice.config.sample_rate


def plain(text):
    """Text as it is spoken: without the signs a voice would read out or stumble on"""
    text = re.sub(r'https?://(?:www\.)?([^/\s]+)\S*', r'\1', text)  # of a web address only the site's name
    return re.sub(r'\s+([.,!?;:])', r'\1', re.sub(r'\s+', ' ', re.sub(r'[`*_#«»"()\[\]{}<>|~^]', ' ', text))).strip()


class Mouth:
    def __init__(self, load=piper, play=PLAY, tell=say):
        self.load, self.play, self.tell = load, play, tell
        self.waiting, self.turn, self.player, self.lock = queue.Queue(), 0, None, threading.Lock()
        self.voices, self.failed = {}, set()  # name -> (sounds, rate); those that could not be loaded (told once, tried again next time)
        threading.Thread(target=self._speak, daemon=True).start()

    def say(self, text, voice=VOICE, speed=1.0, pitch=1.0):
        within = lambda value, least, most: min(most, max(least, float(value)))
        self.waiting.put((self.turn, plain(text), str(voice), within(speed, 0.5, 2), within(pitch, 0.7, 1.4)))

    def _voice(self, name):
        if name not in self.voices:
            try:
                self.voices[name] = self.load(name)
            except Exception as e:  # not set up, or not downloaded whole yet
                if name not in self.failed:
                    self.tell(error=f'the voice "{name}" cannot be loaded ({e}): run ./setup-speech.sh')
                self.failed.add(name)
        return self.voices.get(name)

    def stop(self):
        with self.lock:
            self.turn += 1  # what waits and what sounds belong to an earlier turn now
            if self.player:
                self.player.kill()

    def _speak(self):
        while True:
            turn, text, voice, speed, pitch = self.waiting.get()
            name, _, speaker = voice.partition('#')
            loaded = self._voice(name) if text and turn == self.turn else None
            if not loaded:
                continue
            sounds, rate = loaded
            with self.lock:
                if turn != self.turn:
                    continue
                try:
                    self.player = subprocess.Popen(self.play + [f'--rate={round(rate * pitch)}'], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
                except OSError as e:
                    self.tell(error=f'the sound cannot be played: {e}')
                    continue
            self.tell(speaking=True)
            try:
                for sound in sounds(text, speaker, pitch / speed):  # a sentence at a time: the first sounds while the next is made
                    if turn != self.turn:
                        break
                    self.player.stdin.write(sound)
                self.player.stdin.close()
            except OSError:
                pass  # stopped: the player is gone
            except Exception as e:  # the voice failed on this text: silence, and the next thing is spoken
                self.tell(error=f'the voice failed: {e}')
                self.player.kill()
            self.player.wait()  # until the last of it has sounded
            with self.lock:
                self.player = None
            if self.waiting.empty() or turn != self.turn:
                self.tell(speaking=False)


if __name__ == '__main__':
    mouth = Mouth()
    for line in sys.stdin:
        try:
            told = json.loads(line)
        except ValueError:
            continue
        if told.get('stop'):
            mouth.stop()
        elif isinstance(told.get('say'), str):
            try:
                mouth.say(told['say'], told.get('voice', VOICE), told.get('speed', 1), told.get('pitch', 1))
            except (TypeError, ValueError):
                pass  # a speed or timbre that is no number
