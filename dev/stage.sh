#!/usr/bin/env bash
# Makes a copy of the project that can run next to the real one: spare ports (18080 pages, 18443 HTTPS, 11935 and
# 18554 the streams, 18889 and 18189 WebRTC, 18700 and up the plain pictures for a headset on a cable), a test sound output, no sound capture, its own settings.
#
#   dev/stage.sh <folder>       then, for example:  cd <folder> && node server.js
#
# Run its server inside the session of iso.sh, so that it records that shell and not your desktop.
set -eu
P=$(cd "$(dirname "$0")/.." && pwd); D=$1
mkdir -p "$D"; cd "$D"
for f in app node_modules bin package.json orders.js assist.js assist-tools.js cert.sh raw.py; do ln -sfn "$P/$f" "$f"; done
rm -rf certs; cp -r "$P/certs" certs # a copy: the server may make a new certificate and key, the real ones must stay
# The helper there looks for code and for files only in the folders of the settings assistCode and assistFolders:
# never in those your VS Code has open, nor in your documents (what is found goes to Claude).
sed -e 's/listen(8080/listen(18080/' -e 's/listen(8443)/listen(18443)/' -e 's/127.0.0.1:8889/127.0.0.1:18889/' -e 's/RAW_PORT = 8700/RAW_PORT = 18700/' \
  -e "s|codeFolders(os.homedir(), params.assistCode)|codeFolders('/nowhere', params.assistCode)|" \
  -e "s|fileNamed(wish.file, os.homedir(), userFolders(os.homedir(), params.assistFolders))|fileNamed(wish.file, '/nowhere', userFolders('/nowhere', params.assistFolders))|" "$P/server.js" > server.js
grep -q "codeFolders('/nowhere', params.assistCode)" server.js && grep -q "fileNamed(wish.file, '/nowhere'" server.js \
  || { echo "stage.sh: server.js has changed, cannot keep its test copy out of your code folders and files" >&2; exit 1; }
sed -e 's/:8554/:18554/' -e 's/:8889/:18889/' -e 's/:8189/:18189/' -e 's/:1935/:11935/' "$P/mediamtx.yml" > mediamtx.yml
# The encoders on the processor (x264): the GPU's video engine can hang, and a hang there freezes the real desktop
# too (2026-11-21). Every replacement must take place: one that silently did not would let a test use that engine.
SOFT='video/x-raw,format=NV12 ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=4000 key-int-max=30'
/usr/bin/python3 - "$P/windows.py" "$SOFT" > windows.py <<'PY'
import sys
s, old = open(sys.argv[1]).read().replace(':1935', ':11935'), 'vaapih264enc rate-control=vbr bitrate=12000 keyframe-period=30 max-bframes=0'
assert s.count(old) == 1 and s.count('vaapih264enc') == 1, 'stage.sh: windows.py has changed, cannot take the GPU encoder out of its test copy'
print(s.replace(old, sys.argv[2]), end='')
PY
# the capture without sound: that session has no sound server, and the test must not touch the real one
/usr/bin/python3 - "$P/capture.py" "$SOFT" > capture.py <<'PY'
import sys
s = open(sys.argv[1]).read().replace(':8554', ':18554').replace(':1935', ':11935').replace(':8080', ':18080').replace("SINK = 'vr_headset'", "SINK = 'vr_test'")
old = 'vaapih264enc rate-control=vbr bitrate=20000 keyframe-period=60 max-bframes=0'
assert s.count(old) == 1 and s.count('vaapih264enc ') == 1, 'stage.sh: capture.py has changed, cannot take the GPU encoder out of its test copy'
s = s.replace(old, sys.argv[2])
i = s.index("    spawn(f'ffmpeg -hide_banner"); j = s.index('\n\n', i)
print(s[:i] + "    spawn('sleep 100000')  # staged copy: no sound" + s[j:], end='')
PY
# the microphone into test devices, and never made the system's microphone. Every replacement must take place: one
# that silently did not (mic.py changed) would let the test switch the real microphone.
/usr/bin/python3 - "$P/mic.py" > mic.py <<'PY'
import sys
s = open(sys.argv[1]).read()
def swap(old, new):
    global s
    assert s.count(old) == 1, f'stage.sh: mic.py has changed, cannot make its test copy safely: {old!r}'
    s = s.replace(old, new)
swap(':8554', ':18554')
swap("'vr_mic_feed'", "'vr_test_mic_feed'")
swap("'vr_microphone'", "'vr_test_microphone'")
# the real sound server, also from inside iso.sh (whose session has none): only the test devices above are made there
swap('import signal, subprocess, sys\n', "import os, signal, subprocess, sys\nos.environ.setdefault('PULSE_SERVER', f'unix:/run/user/{os.getuid()}/pulse/native')\n")
swap("        pactl('set-default-source', SOURCE)\n", '')
swap("            pactl('set-default-source', usual)\n", '            pass\n')
assert 'set-default-source' not in s.replace("'get-default-source'", ''), 'stage.sh: mic.py still switches the microphone'
print(s, end='')
PY
# The helper's ears hear a sound file there (VR_TEST_SPEECH in the server's environment), never the microphone.
# The replacement must take place: one that silently did not (listen.py changed) would record the real microphone.
/usr/bin/python3 - "$P/listen.py" > listen.py <<'PY'
import sys
s, old = open(sys.argv[1]).read(), "RECORD = ['parec', '--format=s16le', '--rate=16000', '--channels=1', '--latency-msec=40']"
assert s.count(old) == 1 and s.count("'parec'") == 1, 'stage.sh: listen.py has changed, cannot take the microphone out of its test copy'
# (a named pipe: raw sound as its writer gives it, for a talk whose phrases come when the test decides)
print(s.replace(old, '''RECORD = ['sh', '-c', 'if [ -p "$VR_TEST_SPEECH" ]; then exec cat "$VR_TEST_SPEECH"; else exec ffmpeg -v quiet -re -i "${VR_TEST_SPEECH:-/dev/null}" -f s16le -ar 16000 -ac 1 -; fi']'''), end='')
PY
# Its voice sounds nowhere there: each thing spoken becomes a sound file in the folder VR_TEST_SPOKEN, written at
# the speed it would be heard at (so that speaking can be interrupted). Never the real sound output.
/usr/bin/python3 - "$P/speak.py" > speak.py <<'PY'
import sys
s, old = open(sys.argv[1]).read(), "PLAY = ['pacat', '--format=s16le', '--channels=1', '--latency-msec=60']"
assert s.count(old) == 1 and s.count("'pacat'") == 1, 'stage.sh: speak.py has changed, cannot take the sound output out of its test copy'
print(s.replace(old, '''PLAY = ['sh', '-c', 'exec ffmpeg -v quiet -re -f s16le -ac 1 -ar "${1#--rate=}" -i - -y "${VR_TEST_SPOKEN:-/tmp}/$(date +%s%N).wav"', 'play']'''), end='')
PY
[ -d "$P/.speech" ] && ln -sfn "$P/.speech" .speech
chmod +x capture.py windows.py mic.py speak.py
[ -f params.json ] || echo '{"virtual": 0}' > params.json
