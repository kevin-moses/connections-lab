#!/bin/sh
# Self-signed cert so phones on the same Wi-Fi get HTTPS, which motion sensors require.
set -e
mkdir -p certs
LAN=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
SAN="DNS:localhost,IP:127.0.0.1"
[ -n "$LAN" ] && SAN="$SAN,IP:$LAN"
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout certs/key.pem -out certs/cert.pem \
    -subj "/CN=breathe-local" -addext "subjectAltName=$SAN"
echo "wrote certs/ for $SAN. Restart the server."
