#!/bin/sh
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
[ ! -f .env ] || { echo '.env đã tồn tại; không ghi đè'; exit 0; }
command -v openssl >/dev/null || { echo 'Yêu cầu openssl'; exit 1; }
randpass() { printf '%sAa1' "$(openssl rand -hex 12)"; }
UID_VAL=$(id -u 2>/dev/null || echo 101)
GID_VAL=$(id -g 2>/dev/null || echo 101)
if [ "$UID_VAL" -eq 0 ] || [ "$UID_VAL" -gt 65534 ]; then
  UID_VAL=101
  GID_VAL=101
fi
umask 077
cat > .env <<EOV
DB_NAME=fleetops
DB_USER=fleet_app
DB_PASSWORD=$(randpass)
DB_ADMIN_PASSWORD=$(randpass)
MONITOR_DB_USER=fleet_monitor
MONITOR_DB_PASSWORD=$(randpass)
ADMIN_USER=admin
ADMIN_PASSWORD=$(randpass)
PGADMIN_EMAIL=linhtt.dtc245200390@ictu.edu.vn
PGADMIN_PASSWORD=$(randpass)
GRAFANA_USER=admin
GRAFANA_PASSWORD=$(randpass)
NGINX_UID=$UID_VAL
NGINX_GID=$GID_VAL
EOV
chmod 600 .env
printf '%s\n' 'Đã tạo .env (quyền 600); KHÔNG commit file này lên GitHub.'
