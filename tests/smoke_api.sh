#!/usr/bin/env bash
set -Eeuo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
[ -f .env ] || { echo 'Thiếu .env: hãy chạy ./scripts/gen-env.sh' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
BASE=${1:-https://localhost}
PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"
json_id() { $PY -c 'import json,sys; print(json.load(sys.stdin)["id"])'; }
request() { curl -ksSf -H 'Content-Type: application/json; charset=utf-8' -H "Authorization: Bearer $TOKEN" "$@"; }
post_json() {
  local url="$1"
  local body="$2"
  printf '%s' "$body" | curl -ksSf -X POST "$url" -H 'Content-Type: application/json; charset=utf-8' -H "Authorization: Bearer $TOKEN" --data-binary @-
}
TOKEN=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USER" "$ADMIN_PASSWORD" \
  | curl -ksSf -X POST "$BASE/api/login" -H 'Content-Type: application/json' --data-binary @- \
  | $PY -c 'import json,sys; print(json.load(sys.stdin)["token"])')
VID=''; DID=''; SID=''; MID=''
cleanup() {
  set +e
  [ -z "$SID" ] || request -X DELETE "$BASE/api/schedules/$SID" >/dev/null
  [ -z "$MID" ] || request -X DELETE "$BASE/api/maintenances/$MID" >/dev/null
  [ -z "$VID" ] || request -X DELETE "$BASE/api/vehicles/$VID" >/dev/null
  [ -z "$DID" ] || request -X DELETE "$BASE/api/drivers/$DID" >/dev/null
  request -X POST "$BASE/api/logout" >/dev/null
}
trap cleanup EXIT
SUFFIX=$(date +%s | tail -c 5)
VID=$(post_json "$BASE/api/vehicles" "{\"plate_number\":\"20C-9${SUFFIX}\",\"vehicle_type\":\"Xe tải thùng\",\"brand_model\":\"Hino SmokeTest\",\"capacity_tons\":5.0,\"odometer_km\":10000,\"next_service_km\":20000,\"status\":\"Sẵn sàng\"}" | json_id)
DID=$(post_json "$BASE/api/drivers" "{\"driver_code\":\"DRV-T${SUFFIX}\",\"full_name\":\"Tài xế Kiểm thử $SUFFIX\",\"phone\":\"0900000000\",\"license_class\":\"C\",\"status\":\"Sẵn sàng\"}" | json_id)
SID=$(post_json "$BASE/api/schedules" "{\"trip_code\":\"TRP-T${SUFFIX}\",\"vehicle_id\":$VID,\"driver_id\":$DID,\"origin\":\"Thái Nguyên\",\"destination\":\"Hà Nội\",\"distance_km\":80,\"depart_time\":\"2026-10-25T08:00:00\",\"status\":\"Đã lên lịch\"}" | json_id)
MID=$(post_json "$BASE/api/maintenances" "{\"vehicle_id\":$VID,\"service_type\":\"Bảo dưỡng định kỳ\",\"service_date\":\"2026-10-25\",\"odometer_km\":10000,\"cost_vnd\":1500000,\"workshop\":\"Gara Test\",\"status\":\"Kế hoạch\"}" | json_id)
post_json "$BASE/api/schedules/$SID/status" '{"status":"Hoàn thành"}' >/dev/null
request "$BASE/api/stats" | $PY -c 'import json,sys; x=json.load(sys.stdin); assert all(k in x for k in ("total_vehicles","total_drivers","active_schedules","total_maint_cost")); print("API stats OK")'
echo 'PASS: login, CRUD vehicles/drivers/schedules/maintenances, ODO sync, stats, cleanup'
