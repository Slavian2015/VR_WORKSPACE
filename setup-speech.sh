#!/usr/bin/env bash
# The helper's ears and voice: speech into text and text into speech on this PC (assist.js, listen.py, speak.py).
# Run once: makes the folder .speech/ here with the recognizer (faster-whisper) and its model, and the voice (piper)
# with its Russian voice, in a Python environment of their own, about 0.9 GB together. No sudo. After that nothing
# of it asks the network again, and neither what is said nor what is answered leaves this PC for them.
#
#   ./setup-speech.sh            the model "small" (0.5 GB): a short phrase in about a second
#   ./setup-speech.sh medium     a larger model, more exact and slower; then VR_SPEECH_MODEL=medium for the server
# The voice put in is Irina's, the Russian one the helper has until another is chosen in the settings (the block
# "AI помощник" in the sphere, the page "Helper" of the settings window): those are downloaded when chosen.
set -eu
cd "$(dirname "$0")"
MODEL=${1:-small}
[ -x .speech/venv/bin/python ] || python3 -m venv .speech/venv
.speech/venv/bin/pip install --quiet --upgrade pip
.speech/venv/bin/pip install --quiet 'faster-whisper>=1.2,<2' 'piper-tts>=1.8,<2' # listen.py and speak.py are written for these
VOICE=ru_RU-irina-medium
[ -f ".speech/voices/$VOICE.onnx" ] || { mkdir -p .speech/voices && .speech/venv/bin/python -m piper.download_voices "$VOICE" --data-dir .speech/voices; }
echo "The voice \"$VOICE\" is in .speech/voices"
.speech/venv/bin/python - "$MODEL" <<'PY'
import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device='cpu', compute_type='int8', download_root='.speech/models')
print(f'The model "{sys.argv[1]}" is in .speech/models')
PY
