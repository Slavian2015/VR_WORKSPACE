#!/usr/bin/env bash
# Makes a copy of the project that can run next to the real one: spare ports (18080 pages, 18443 HTTPS, 11935 and
# 18554 the streams, 18889 and 18189 WebRTC), a test sound output, no sound capture, its own settings.
#
#   dev/stage.sh <folder>       then, for example:  cd <folder> && node server.js
#
# Run its server inside the session of iso.sh, so that it records that shell and not your desktop.
set -eu
P=$(cd "$(dirname "$0")/.." && pwd); D=$1
mkdir -p "$D"; cd "$D"
for f in app node_modules bin package.json orders.js cert.sh; do ln -sfn "$P/$f" "$f"; done
rm -rf certs; cp -r "$P/certs" certs # a copy: the server may make a new certificate and key, the real ones must stay
sed -e 's/listen(8080/listen(18080/' -e 's/listen(8443)/listen(18443)/' -e 's/127.0.0.1:8889/127.0.0.1:18889/' "$P/server.js" > server.js
sed -e 's/:8554/:18554/' -e 's/:8889/:18889/' -e 's/:8189/:18189/' -e 's/:1935/:11935/' "$P/mediamtx.yml" > mediamtx.yml
sed -e 's/:1935/:11935/' "$P/windows.py" > windows.py
# the capture without sound: that session has no sound server, and the test must not touch the real one
/usr/bin/python3 - "$P/capture.py" > capture.py <<'PY'
import sys
s = open(sys.argv[1]).read().replace(':8554', ':18554').replace(':1935', ':11935').replace(':8080', ':18080').replace("SINK = 'vr_headset'", "SINK = 'vr_test'")
i = s.index("    spawn(f'ffmpeg -hide_banner"); j = s.index('\n\n', i)
print(s[:i] + "    spawn('sleep 100000')  # staged copy: no sound" + s[j:], end='')
PY
chmod +x capture.py windows.py
[ -f params.json ] || echo '{"virtual": 0}' > params.json
