#!/usr/bin/env bash
# The certificate the phone checks this PC by, signed by our own CA (made by setup.sh and trusted on the phone once,
# so a new certificate needs nothing on the phone). It names this PC on the Wi-Fi at home and, when given, by its
# address on the internet (an IPv4 address or a name), for the phone's link from outside the home.
#
#   ./cert.sh [address on the internet]        run by setup.sh, and by server.js when that address is new
set -euo pipefail
cd "$(dirname "$0")"
IP=$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+')
HOST="$(hostname).local"
NAMES="DNS:$HOST,DNS:localhost,IP:$IP,IP:127.0.0.1"
OUTSIDE=${1:-}
if [[ $OUTSIDE =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then NAMES+=",IP:$OUTSIDE"
elif [[ $OUTSIDE =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then NAMES+=",DNS:$OUTSIDE"
elif [ -n "$OUTSIDE" ]; then echo "not an address: $OUTSIDE" >&2; exit 1
fi
# Made aside and then put in place, both: a key without its certificate would leave the server unable to start.
openssl req -newkey rsa:2048 -nodes -subj "/CN=$HOST" -keyout certs/server.key.new -out certs/server.csr 2>/dev/null
# iOS requires SAN, serverAuth and validity <= 825 days
openssl x509 -req -in certs/server.csr -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial -days 800 -out certs/server.crt.new \
  -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$NAMES") 2>/dev/null
mv certs/server.key.new certs/server.key
mv certs/server.crt.new certs/server.crt
