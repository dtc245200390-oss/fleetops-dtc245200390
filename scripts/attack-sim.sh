#!/bin/sh
# Mô phỏng tấn công dò mật khẩu (brute-force) vào trang đăng nhập FleetOps để kiểm thử Rate Limit & Cảnh báo
HOST=${1:-https://localhost}
for i in $(seq 1 20); do
  CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X POST "$HOST/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"guess$i\"}")
  printf "lần %02d -> HTTP %s\n" "$i" "$CODE"
done
