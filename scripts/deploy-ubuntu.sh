#!/usr/bin/env bash
# =============================================================================
# FleetOps (Đề 30 – DTC245200390) – Triển khai trên VM Ubuntu
# Tự động: kiểm tra môi trường → tạo .env → tạo TLS cert (SAN gồm IP VM)
#          → build & chạy Docker Compose → chờ web healthy → in địa chỉ truy cập.
# Chạy:  bash scripts/deploy-ubuntu.sh
# =============================================================================
set -Eeuo pipefail
cd "$(dirname "$0")/.."

# Bảo đảm các script có quyền thực thi (hữu ích khi source được chép bằng scp/zip từ Windows).
chmod +x scripts/*.sh tests/*.sh 2>/dev/null || true

log()  { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# Không chạy bằng root: .env và khóa TLS sẽ thuộc root, nginx non-root không đọc được.
if [[ ${EUID} -eq 0 ]]; then
  die "Không chạy script bằng root/sudo. Hãy chạy: bash scripts/deploy-ubuntu.sh"
fi

# ---------- 1. Kiểm tra Docker ----------
if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
  warn "Dùng 'sudo docker' vì user hiện tại chưa thuộc group docker."
  warn "Nên chạy 'newgrp docker' hoặc đăng nhập lại SSH để dùng docker không cần sudo."
else
  die "Không truy cập được Docker. Chạy 'bash scripts/bootstrap-ubuntu.sh' rồi đăng nhập lại."
fi
DC=("${DOCKER[@]}" compose)

[[ -f docker-compose.yml ]] || die "Không tìm thấy docker-compose.yml. Hãy chạy script từ thư mục dự án."
"${DC[@]}" version >/dev/null 2>&1 || die "Thiếu Docker Compose plugin. Chạy 'bash scripts/bootstrap-ubuntu.sh'."

# ---------- 2. Kiểm tra tài nguyên ----------
RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
[[ "$RAM_MB" -ge 3500 ]] || warn "RAM ${RAM_MB} MB < 3.5 GB: 11 container có thể bị OOM, nên cấp ≥ 4 GB cho VM."

DISK_MB=$(df -Pm . | awk 'NR==2 {print $4}')
[[ "$DISK_MB" -ge 10240 ]] || warn "Dung lượng trống ${DISK_MB} MB < 10 GB: thiếu chỗ cho images và volumes."

# ---------- 3. Kiểm tra cổng 80/443 ----------
NGINX_RUNNING=0
if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx nginx; then
  NGINX_RUNNING=1
  log "fleetops-nginx đang chạy – bỏ qua kiểm tra cổng 80/443 (triển khai lại)."
fi
if [[ "$NGINX_RUNNING" -eq 0 ]] && command -v ss >/dev/null 2>&1; then
  for p in 80 443; do
    if ss -H -ltn "sport = :$p" 2>/dev/null | grep -q .; then
      die "Cổng ${p} đang bị chiếm. Dừng dịch vụ đang dùng (vd: sudo systemctl stop apache2) rồi chạy lại."
    fi
  done
fi

# ---------- 4. File .env ----------
if [[ ! -f .env ]]; then
  log "Tạo .env với mật khẩu mạnh ngẫu nhiên..."
  bash scripts/gen-env.sh
else
  log "Đã có .env – giữ nguyên mật khẩu hiện tại."
fi

# Nếu .env được chép từ Windows với CRLF, mật khẩu sẽ dính ký tự \r -> chuẩn hóa về LF.
if grep -q $'\r' .env 2>/dev/null; then
  log "Phát hiện CRLF trong .env – chuẩn hóa về LF..."
  sed -i 's/\r$//' .env
fi

# ---------- 5. Chứng chỉ TLS ----------
log "Kiểm tra / tạo chứng chỉ TLS tự ký (SAN gồm IP của VM)..."
CERT_BEFORE=""
if [[ -f nginx/certs/server.crt ]]; then
  CERT_BEFORE=$(sha256sum nginx/certs/server.crt | awk '{print $1}')
fi
bash scripts/gen-cert.sh
CERT_AFTER=""
if [[ -f nginx/certs/server.crt ]]; then
  CERT_AFTER=$(sha256sum nginx/certs/server.crt | awk '{print $1}')
fi
CERT_CHANGED=0
if [[ "$CERT_BEFORE" != "$CERT_AFTER" ]]; then
  CERT_CHANGED=1
fi

# Đồng bộ NGINX_UID/GID với chủ sở hữu khóa TLS để container non-root đọc được key 600.
OWNER_UID=$(stat -c '%u' nginx/certs/server.key 2>/dev/null || true)
OWNER_GID=$(stat -c '%g' nginx/certs/server.key 2>/dev/null || true)
if [[ -n "$OWNER_UID" && "$OWNER_UID" -eq 0 ]]; then
  warn "Khóa TLS thuộc root nên container nginx (non-root) không đọc được."
  warn "Chạy: sudo chown $(id -u):$(id -g) nginx/certs/server.key nginx/certs/server.crt"
  die "Dừng triển khai để tránh lỗi HTTPS."
fi
if [[ -n "$OWNER_UID" && "$OWNER_UID" -ne 0 ]]; then
  ENV_UID=$(awk -F= '/^NGINX_UID=/{print $2; exit}' .env)
  ENV_GID=$(awk -F= '/^NGINX_GID=/{print $2; exit}' .env)
  if [[ "$ENV_UID" != "$OWNER_UID" || "$ENV_GID" != "$OWNER_GID" ]]; then
    log "Đồng bộ NGINX_UID/GID trong .env theo khóa TLS (${OWNER_UID}:${OWNER_GID})..."
    cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
    sed -i "s/^NGINX_UID=.*/NGINX_UID=${OWNER_UID}/; s/^NGINX_GID=.*/NGINX_GID=${OWNER_GID}/" .env
  fi
fi

# ---------- 6. Build & khởi chạy ----------
log "Build và khởi chạy toàn bộ hệ thống (11 container)..."
"${DC[@]}" up -d --build

# Nếu chứng chỉ vừa được tạo lại trong khi nginx đang chạy, nạp lại để dùng cert mới.
if [[ "$CERT_CHANGED" -eq 1 ]] && "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx nginx; then
  log "Chứng chỉ TLS vừa thay đổi – khởi động lại nginx để nạp chứng chỉ mới..."
  "${DC[@]}" restart nginx
fi

# ---------- 7. Chờ web sẵn sàng ----------
log "Chờ webapp healthy..."
READY=0
for _ in $(seq 1 60); do
  CODE=$(curl -ks -o /dev/null -w '%{http_code}' https://localhost/ 2>/dev/null || true)
  if [[ "$CODE" == "200" ]]; then
    READY=1
    break
  fi
  sleep 3
done
if [[ "$READY" -eq 1 ]]; then
  log "Web đã sẵn sàng (HTTP 200 qua HTTPS)."
else
  warn "Web chưa trả về HTTP 200 sau 180 giây."
  warn "Kiểm tra: ${DC[*]} ps  |  ${DC[*]} logs --tail=80 webapp nginx"
fi

echo
"${DC[@]}" ps

# ---------- 8. Thông tin truy cập ----------
VM_IP=$(ip -4 -o addr show scope global 2>/dev/null \
  | awk '$2 !~ /^(docker|br-|veth|cni|flannel|virbr)/ {sub(/\/.*/, "", $4); print $4}' \
  | grep -E '^[0-9]+(\.[0-9]+){3}$' \
  | grep -v '^127\.' \
  | head -n1 || true)
if [[ -z "${VM_IP:-}" ]]; then
  VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
[[ -n "${VM_IP:-}" ]] || VM_IP="<IP-VM>"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo
echo "============================================================"
echo "  FleetOps đã triển khai trên VM Ubuntu"
echo "============================================================"
echo "  Website (HTTPS)    : https://${VM_IP}/"
echo "  Website (HTTP→301) : http://${VM_IP}/"
echo "  Tài khoản web      : ${ADMIN_USER} / ${ADMIN_PASSWORD}"
echo
echo "  Dịch vụ nội bộ (chỉ 127.0.0.1 trên VM) – dùng SSH tunnel từ máy host:"
echo "    ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 5050:127.0.0.1:5050 <user>@${VM_IP}"
echo "      Grafana    : http://localhost:3000   (${GRAFANA_USER} / ${GRAFANA_PASSWORD})"
echo "      Prometheus : http://localhost:9090"
echo "      pgAdmin    : http://localhost:5050   (${PGADMIN_EMAIL} / ${PGADMIN_PASSWORD})"
echo
echo "  Kiểm thử API : bash tests/smoke_api.sh https://localhost"
echo "  Hardening    : bash scripts/verify-hardening.sh"
echo "  Dừng hệ thống: ${DC[*]} down"
echo "  Xoá dữ liệu  : ${DC[*]} down -v   (CẢNH BÁO: mất toàn bộ DB)"
echo "============================================================"
