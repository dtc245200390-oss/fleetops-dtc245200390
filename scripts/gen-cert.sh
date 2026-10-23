#!/bin/sh
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
mkdir -p nginx/certs
if [ -f "nginx/certs/server.key" ] && [ -f "nginx/certs/server.crt" ]; then
  chmod 600 nginx/certs/server.key 2>/dev/null || true
  chmod 644 nginx/certs/server.crt 2>/dev/null || true
  echo 'Chứng chỉ đã tồn tại; đã kiểm tra quyền khóa riêng (600).'
  exit 0
fi
umask 077
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj '/C=VN/ST=Thai Nguyen/O=ICTU/OU=CNTT-K23C/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
chmod 600 nginx/certs/server.key 2>/dev/null || true
chmod 644 nginx/certs/server.crt 2>/dev/null || true
echo 'Đã sinh chứng chỉ TLS tự ký (RSA 2048-bit, SAN localhost/127.0.0.1); khóa riêng có quyền 600.'
