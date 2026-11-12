#!/usr/bin/env bash
# One-time setup (safe to re-run): MediaMTX, three.js, TLS certs for the phone, phone-sized backgrounds.
set -euo pipefail
cd "$(dirname "$0")"
MTX=v1.21.3

if [ ! -x bin/mediamtx ]; then
  mkdir -p bin
  curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/$MTX/mediamtx_${MTX}_linux_amd64.tar.gz" | tar -xz -C bin mediamtx
fi

npm install --no-fund --no-audit

# Local CA: created once, installed once on the phone. Server cert is re-issued on every run because the LAN IP may change.
mkdir -p certs
if [ ! -f certs/ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=VR Workspace local CA" \
    -keyout certs/ca.key -out certs/ca.crt \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" 2>/dev/null
fi
[ -f certs/token ] || openssl rand -hex 6 > certs/token  # key that other devices need to see the desktop
IP=$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+')
HOST="$(hostname).local"
openssl req -newkey rsa:2048 -nodes -subj "/CN=$HOST" -keyout certs/server.key -out certs/server.csr 2>/dev/null
# iOS requires SAN, serverAuth and validity <= 825 days
openssl x509 -req -in certs/server.csr -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial -days 800 -out certs/server.crt \
  -extfile <(printf 'subjectAltName=DNS:%s,DNS:localhost,IP:%s,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$HOST" "$IP") 2>/dev/null

# The 360 sources are 8192x4096 PNGs of ~35 MB; the headset shows ~12 px/deg, so 4096x2048 JPEG loses nothing visible.
mkdir -p app/bg
for f in app/assets/*.png app/assets/*.jpg; do
  out="app/bg/$(basename "${f%.*}").jpg"
  [ -f "$out" ] && continue
  [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=/ "$f" | awk -F/ '{print ($1 == 2 * $2)}')" = 1 ] || continue
  ffmpeg -v error -y -i "$f" -vf scale=4096:2048 -q:v 3 "$out"
done

# A sample video panorama to try video backgrounds with: the first photo with slowly cycling colours, a seamless 10 s loop.
if [ ! -f app/bg/video_test.mp4 ]; then
  ffmpeg -v error -y -loop 1 -i app/bg/old_field.jpg -t 10 -r 30 -vf "scale=3840:1920,hue=h=36*t" \
    -c:v libx264 -preset fast -crf 24 -pix_fmt yuv420p -movflags +faststart app/bg/video_test.mp4
fi

echo
echo "Ready. Start with:  npm start"
echo "Phone, once:        http://$IP:8080/ca.crt   (install the profile, then trust it)"
echo "Phone, every time:  https://$IP:8443/?k=$(cat certs/token)   (or the same with $HOST)"
