#!/usr/bin/env bash
# The helper's ears: speech into text on this PC (assist.js, listen.py). Run once: makes the folder .speech/ here
# with the recognizer (faster-whisper, in a Python environment of its own) and its model, about 0.7 GB together.
# No sudo. After that nothing of it asks the network again, and what is said never leaves this PC.
#
#   ./setup-speech.sh            the model "small" (0.5 GB): a short phrase in about a second
#   ./setup-speech.sh medium     a larger model, more exact and slower; then VR_SPEECH_MODEL=medium for the server
set -eu
cd "$(dirname "$0")"
MODEL=${1:-small}
[ -x .speech/venv/bin/python ] || python3 -m venv .speech/venv
.speech/venv/bin/pip install --quiet --upgrade pip
.speech/venv/bin/pip install --quiet 'faster-whisper>=1.2,<2' # listen.py is written for this one
.speech/venv/bin/python - "$MODEL" <<'PY'
import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device='cpu', compute_type='int8', download_root='.speech/models')
print(f'The model "{sys.argv[1]}" is in .speech/models')
PY
