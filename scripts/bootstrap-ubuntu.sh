#!/usr/bin/env bash
# =============================================================================
# FleetOps (Đề 30 – DTC245200390) – Bootstrap Ubuntu VM 22.04 / 24.04
# Cài Docker Engine + Docker Compose plugin, thêm user vào group docker,
# mở firewall cho SSH / HTTP / HTTPS.
# Chạy 1 lần trên VM:  bash scripts/bootstrap-ubuntu.sh
# =============================================================================
set -Eeuo pipefail

log()  { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ ${EUID} -eq 0 ]]; then
  SUDO=""
  TARGET_USER="${SUDO_USER:-root}"
else
  SUDO="sudo"
  TARGET_USER="${SUDO_USER:-$USER}"
fi
[[ "$TARGET_USER" == "root" ]] && die "Hãy chạy bằng user thường (ví dụ 'ubuntu'), không chạy trực tiếp bằng root."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
if [[ "${ID:-}" != "ubuntu" ]]; then
  warn "Script được thiết kế cho Ubuntu; phát hiện: ${PRETTY_NAME:-không rõ}."
fi
case "${VERSION_ID:-}" in
  20.04|22.04|24.04) log "Ubuntu ${VERSION_ID} – phiên bản được hỗ trợ." ;;
  *) warn "Chỉ kiểm thử trên Ubuntu 20.04/22.04/24.04 (hiện tại: ${VERSION_ID:-?})." ;;
esac

log "Cập nhật apt và cài gói nền..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq ca-certificates curl gnupg ufw

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker Engine và Compose plugin đã có sẵn."
else
  log "Thêm kho Docker chính thức..."
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -qq
  log "Cài Docker Engine + Compose plugin..."
  $SUDO apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

$SUDO systemctl enable --now docker

NEED_RELOGIN=0
if ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx docker; then
  $SUDO usermod -aG docker "$TARGET_USER"
  NEED_RELOGIN=1
fi

if command -v ufw >/dev/null 2>&1; then
  log "Cấu hình UFW: cho phép SSH, 80/tcp, 443/tcp..."
  $SUDO ufw allow OpenSSH >/dev/null 2>&1 || true
  $SUDO ufw allow 80/tcp  >/dev/null 2>&1 || true
  $SUDO ufw allow 443/tcp >/dev/null 2>&1 || true
  if $SUDO ufw status | grep -q '^Status: active'; then
    log "UFW đang bật – đã mở cổng 22/80/443."
  else
    warn "UFW chưa bật. Bật bằng: sudo ufw enable  (luôn giữ rule OpenSSH trước khi bật)"
  fi
fi

echo
log "Phiên bản đã cài:"
$SUDO docker --version
$SUDO docker compose version

echo
if [[ "$NEED_RELOGIN" -eq 1 ]]; then
  warn "Đã thêm '${TARGET_USER}' vào group docker."
  echo "  → Đăng xuất rồi đăng nhập lại SSH, hoặc chạy: newgrp docker"
fi
echo "Bootstrap hoàn tất. Bước tiếp theo:"
echo "  cd <thư-mục-dự-án> && bash scripts/deploy-ubuntu.sh"
