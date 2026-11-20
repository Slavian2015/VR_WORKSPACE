#!/usr/bin/env bash
# One-time setup (safe to re-run): MediaMTX, three.js, TLS certs for the phone, phone-sized backgrounds, the GNOME extension.
set -euo pipefail
cd "$(dirname "$0")"
MTX=v1.21.3

if [ ! -x bin/mediamtx ]; then
  mkdir -p bin
  curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/$MTX/mediamtx_${MTX}_linux_amd64.tar.gz" | tar -xz -C bin mediamtx
fi

npm install --no-fund --no-audit

# Local CA: created once, installed once on the phone. Server cert (cert.sh) is re-issued on every run because the LAN IP may change.
mkdir -p certs
if [ ! -f certs/ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=VR Workspace local CA" \
    -keyout certs/ca.key -out certs/ca.crt \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" 2>/dev/null
fi
[ -f certs/token ] || openssl rand -hex 16 > certs/token  # key that other devices need to see the desktop
# The address on the internet, if one was set in the settings window, stays in the certificate.
./cert.sh "$(python3 -c "import json; print(json.load(open('params.json')).get('publicHost', ''))" 2>/dev/null || true)"

# The 360 backgrounds are made once, when app/bg does not exist yet: later runs leave the folder alone, so that
# what was deleted in the gallery stays deleted. (To get the set again, delete app/bg and run this script.)
if [ ! -d app/bg ]; then
  mkdir -p app/bg
  # The sources are 8192x4096 PNGs of ~35 MB; the headset shows ~12 px/deg, so 4096x2048 JPEG loses nothing visible.
  for f in app/assets/*.png app/assets/*.jpg; do
    [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=/ "$f" | awk -F/ '{print ($1 == 2 * $2)}')" = 1 ] || continue
    ffmpeg -v error -y -i "$f" -vf scale=4096:2048 -q:v 3 "app/bg/$(basename "${f%.*}").jpg"
  done
  # A panorama with a grid in degrees, to read the field of view inside the headset.
  ./test_grid.py
  # A sample video panorama to try video backgrounds with: the first photo with slowly cycling colours, a seamless 10 s loop.
  ffmpeg -v error -y -loop 1 -i app/bg/old_field.jpg -t 10 -r 30 -vf "scale=3840:1920,hue=h=36*t" \
    -c:v libx264 -preset fast -crf 24 -pix_fmt yuv420p -movflags +faststart app/bg/video_test.mp4
fi

echo
gnome-extension/install.sh
echo "Then switch VR Workspace on in the menu of that icon and open Settings there: the code for the phone is on the first page."
echo "Without the icon:  npm start   and   http://localhost:8080/control.html"
