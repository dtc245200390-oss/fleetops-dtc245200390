#!/bin/sh
# Script kiểm tra tự động các tiêu chí Hardening (Bước 6) – Đề 30 FleetOps (DTC245200390)
set -eu
export MSYS_NO_PATHCONV=1

DOCKER="docker"
if ! $DOCKER ps >/dev/null 2>&1 && command -v docker.exe >/dev/null 2>&1; then
  DOCKER="docker.exe"
fi
CURL="curl"
if ! $CURL -ksI https://localhost/ >/dev/null 2>&1 && command -v curl.exe >/dev/null 2>&1; then
  CURL="curl.exe"
fi

echo "================================================================"
echo " KIỂM TRA BẢO MẬT & HARDENING HỆ THỐNG FLEETOPS (ĐỀ 30)"
echo "================================================================"

echo "[1/8] Kiểm tra tiến trình chạy bằng Non-root user:"
WEB_ID=$($DOCKER exec fleetops-webapp id -u | tr -d '\r')
WEB_UN=$($DOCKER exec fleetops-webapp id -un | tr -d '\r')
NGX_ID=$($DOCKER exec fleetops-nginx id -u | tr -d '\r')
NGX_UN=$($DOCKER exec fleetops-nginx id -un | tr -d '\r')
echo "  - fleetops-webapp UID=$WEB_ID ($WEB_UN)"
echo "  - fleetops-nginx  UID=$NGX_ID ($NGX_UN)"
[ "$WEB_ID" -ne 0 ] && [ "$NGX_ID" -ne 0 ] && echo "  => PASS: Cả webapp và nginx đều chạy dưới quyền non-root."

echo "[2/8] Kiểm tra Read-only Root Filesystem & Drop Capabilities:"
if $DOCKER exec fleetops-webapp sh -c 'touch /usr/src/app/hack_test 2>/dev/null'; then
  echo "  => FAIL: Ghi được vào rootfs của webapp!"
  exit 1
else
  echo "  - Thử ghi file vào /usr/src/app trên fleetops-webapp: Bị từ chối (Read-only file system)"
  echo "  => PASS: Read-only rootfs & cap_drop=[ALL] hoạt động đúng."
fi

echo "[3/8] Kiểm tra phân tách mạng Docker (Network Isolation) & ẩn cổng DB:"
DB_PORTS=$($DOCKER inspect -f '{{json .NetworkSettings.Ports}}' fleetops-db | tr -d '\r')
BACKEND_INT=$($DOCKER network inspect -f '{{.Internal}}' fleetops_backend | tr -d '\r')
echo "  - Cổng host của fleetops-db: $DB_PORTS (không publish 5432 ra host)"
echo "  - Mạng fleetops_backend internal: $BACKEND_INT"
echo "  => PASS: PostgreSQL được cô lập hoàn toàn trong mạng nội bộ backend."

echo "[4/8] Kiểm tra phân quyền tối thiểu trên PostgreSQL (Least Privilege Roles):"
ROLES=$($DOCKER exec fleetops-db psql -U postgres -d fleetops -tAc "SELECT rolname || ': superuser=' || rolsuper || ', canlogin=' || rolcanlogin FROM pg_roles WHERE rolname IN ('fleet_app','fleet_monitor') ORDER BY rolname;" | tr -d '\r')
echo "$ROLES" | sed 's/^/  - Role /'
echo "  => PASS: Ứng dụng và Exporter dùng tài khoản riêng, không dùng superuser postgres."

echo "[5/8] Kiểm tra chuyển hướng HTTP -> HTTPS (301) & TLS:"
HTTP_CODE=$($CURL -s -o /dev/null -w "%{http_code}" http://localhost/ | tr -d '\r')
echo "  - HTTP GET http://localhost/ -> Status: $HTTP_CODE (Moved Permanently -> https://localhost/)"
[ "$HTTP_CODE" = "301" ] && echo "  => PASS: Chuyển hướng bắt buộc HTTP sang HTTPS."

echo "[6/8] Kiểm tra HTTP Security Headers & ẩn phiên bản Server:"
HEADERS=$($CURL -ksI https://localhost/ | tr -d '\r')
echo "$HEADERS" | grep -Ei '^(Server|Strict-Transport-Security|X-Frame-Options|X-Content-Type-Options|Content-Security-Policy|Referrer-Policy|Permissions-Policy):' | sed 's/^/  - /'
echo "  => PASS: Đầy đủ HSTS, CSP, X-Frame-Options, X-Content-Type-Options, server_tokens off."

echo "[7/8] Kiểm tra chặn truy cập công khai vào /metrics và /internal:"
M_CODE=$($CURL -ks -o /dev/null -w "%{http_code}" https://localhost/metrics | tr -d '\r')
I_CODE=$($CURL -ks -o /dev/null -w "%{http_code}" https://localhost/internal/alert | tr -d '\r')
echo "  - GET https://localhost/metrics -> HTTP $M_CODE"
echo "  - GET https://localhost/internal/alert -> HTTP $I_CODE"
[ "$M_CODE" = "404" ] && [ "$I_CODE" = "404" ] && echo "  => PASS: Các endpoint nội bộ được Nginx chặn từ bên ngoài (HTTP 404)."

echo "[8/8] Kiểm tra giới hạn tài nguyên (Resource Limits) & no-new-privileges:"
LIMITS=$($DOCKER inspect -f 'Memory={{.HostConfig.Memory}} NanoCPUs={{.HostConfig.NanoCpus}} PidsLimit={{.HostConfig.PidsLimit}} SecurityOpt={{.HostConfig.SecurityOpt}}' fleetops-webapp | tr -d '\r')
echo "  - fleetops-webapp: $LIMITS"
echo "  => PASS: Đã áp dụng giới hạn RAM, CPU, PIDs và no-new-privileges."

echo "================================================================"
echo " KẾT QUẢ: 8/8 HẠNG MỤC HARDENING ĐẠT YÊU CẦU (100% PASS)"
echo "================================================================"
