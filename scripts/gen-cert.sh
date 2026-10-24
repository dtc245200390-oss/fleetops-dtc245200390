#!/bin/sh
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
mkdir -p nginx/certs

FORCE_CERT="${FORCE_CERT:-0}"
if [ "${1:-}" = "--force" ]; then
  FORCE_CERT=1
fi

# Thu thập IP LAN của máy để đưa vào SAN (bỏ qua interface Docker/loopback).
# Nhờ đó truy cập từ máy host qua https://<IP-VM> vẫn khớp tên chứng chỉ.
IPS=$(ip -4 -o addr show scope global 2>/dev/null \
  | awk '$2 !~ /^(docker|br-|veth|cni|flannel|virbr)/ {sub(/\/.*/, "", $4); print $4}' \
  | grep -E '^[0-9]+(\.[0-9]+){3}$' \
  | grep -v '^127\.' \
  | sort -u || true)
if [ -z "$IPS" ]; then
  IPS=$(hostname -I 2>/dev/null \
    | tr ' ' '\n' \
    | grep -E '^[0-9]+(\.[0-9]+){3}$' \
    | grep -v '^127\.' \
    | sort -u || true)
fi
HN=$(hostname 2>/dev/null || true)

SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "$HN" ]; then
  SAN="$SAN,DNS:$HN"
fi
for ip in $IPS; do
  SAN="$SAN,IP:$ip"
done

# Bổ sung thủ công nếu cần: CERT_HOSTS="10.0.0.5,fleetops.local" sh scripts/gen-cert.sh
OLD_IFS=$IFS
IFS=','
for h in ${CERT_HOSTS:-}; do
  h=$(printf '%s' "$h" | tr -d ' ')
  [ -n "$h" ] || continue
  case "$h" in
    *[!0-9.]*) SAN="$SAN,DNS:$h" ;;
    *) SAN="$SAN,IP:$h" ;;
  esac
done
IFS=$OLD_IFS

REGEN=0
[ -f nginx/certs/server.key ] && [ -f nginx/certs/server.crt ] || REGEN=1
if [ "$FORCE_CERT" = "1" ]; then
  REGEN=1
fi

# Nếu IP hiện tại của VM chưa có trong SAN (ví dụ chứng chỉ tạo trước đó trên
# máy Windows chỉ có localhost), tự động tạo lại để trình duyệt không báo sai tên.
if [ "$REGEN" -eq 0 ]; then
  CURRENT_SAN=$(openssl x509 -in nginx/certs/server.crt -noout -ext subjectAltName 2>/dev/null || true)
  for ip in $IPS; do
    case "$CURRENT_SAN" in
      *"IP Address:$ip"*) : ;;
      *) REGEN=1 ;;
    esac
  done
fi

if [ "$REGEN" -eq 0 ]; then
  chmod 600 nginx/certs/server.key 2>/dev/null || true
  chmod 644 nginx/certs/server.crt 2>/dev/null || true
  echo 'Chứng chỉ đã tồn tại và đã bao gồm IP hiện tại; đã kiểm tra quyền khóa riêng (600).'
  exit 0
fi

if [ -f nginx/certs/server.key ] && [ ! -w nginx/certs/server.key ]; then
  echo 'Không ghi được nginx/certs/server.key (có thể do file thuộc root).' >&2
  echo "Hãy chạy: sudo chown $(id -u):$(id -g) nginx/certs/server.key nginx/certs/server.crt" >&2
  exit 1
fi

umask 077
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj '/C=VN/ST=Thai Nguyen/O=ICTU/OU=CNTT-K23C/CN=localhost' \
  -addext "subjectAltName=$SAN"
chmod 600 nginx/certs/server.key 2>/dev/null || true
chmod 644 nginx/certs/server.crt 2>/dev/null || true
echo "Đã sinh chứng chỉ TLS tự ký (RSA 2048-bit, 365 ngày)."
echo "  SAN: $SAN"
echo '  Khóa riêng server.key có quyền 600.'
