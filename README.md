# Đề 30: Hệ thống Quản lý Đội xe / Fleet – FleetOps

Báo cáo Bài tập lớn học phần **Triển khai và Quản trị Hệ thống Phần mềm** – Khoa Công nghệ Thông tin, Trường Đại học Công nghệ Thông tin và Truyền thông (ICTU).

- **Sinh viên thực hiện:** Thân Tuấn Linh
- **Mã số sinh viên (MSSV):** DTC245200390
- **Ngày sinh:** 10/07/2006
- **Lớp / Khóa:** CNTT K23C
- **Đề tài:** Đề 30 – Hệ thống Quản lý Đội xe / Fleet (FleetOps)
- **Kho mã nguồn GitHub:** <https://github.com/dtc245200390-oss/fleetops-dtc245200390>

Hệ thống quản lý phương tiện đội xe, điều phối lịch trình vận chuyển, hồ sơ tài xế và kế hoạch bảo dưỡng kỹ thuật được đóng gói toàn bộ bằng **Docker Compose**, bảo vệ bởi **Nginx Reverse Proxy (HTTPS/TLS + Security Headers + Rate Limiting)**, giám sát tài nguyên với **Prometheus + Grafana**, thu thập và truy vấn nhật ký tập trung bằng **Loki + Promtail (LogQL)**, tự động phát hiện tấn công dò mật khẩu qua **Grafana Alerting** và áp dụng đầy đủ 8 biện pháp **Hardening** theo tiêu chuẩn bảo mật.

---

## 1. Sơ đồ kiến trúc tổng thể

```
                         [ Người dùng / Điều độ viên ]
                                  │
                     HTTP :80 ────┼──── HTTPS :443 (TLS 1.2 / 1.3)
                     (301 Redirect)     (HSTS, CSP, Rate Limit 6r/m)
                                  ▼
                ┌──────────────────────────────────┐
                │   nginx (nginx-unprivileged)     │  ◄── stub_status :8081 ──► nginx-exporter :9113
                │   non-root, read_only, cap_drop  │
                └─────────────────┬────────────────┘
                                  │  mạng frontend
                                  ▼
                ┌──────────────────────────────────┐
                │   webapp (Node.js 20 / Express)  │  ◄── /metrics :3000 ─────► prometheus :9090
                │   non-root (node), read_only     │  ◄── /internal/alert ────► grafana :3000
                └─────────────────┬────────────────┘
                                  │  mạng backend (internal: true, cô lập hoàn toàn)
                                  ▼
                ┌──────────────────────────────────┐
                │   db (PostgreSQL 16 Alpine)      │  ◄── pg_monitor ─────────► postgres-exporter :9187
                │   Roles: fleet_app / monitor     │  ◄── quản trị CSDL ──────► pgadmin :5050 (127.0.0.1)
                └──────────────────────────────────┘

   [Docker container logs] ──► promtail ──► loki :3100 ──► grafana :3000 (Explore LogQL & Alerting)
   [Docker cgroups/engine] ──► cadvisor :8080 ───────────► prometheus :9090 ──► grafana :3000
```

### Phân tách mạng Docker (3 vùng mạng độc lập)
| Mạng | Thuộc tính | Các dịch vụ tham gia | Mục đích bảo mật |
|---|---|---|---|
| `frontend` | Bridge | `nginx`, `webapp`, `pgadmin`, `grafana` | Tiếp nhận kết nối qua Reverse Proxy, cách ly hoàn toàn tầng CSDL |
| `backend` | `internal: true` | `db`, `webapp`, `pgadmin`, `postgres-exporter` | Cô lập hoàn toàn PostgreSQL khỏi Internet và khỏi tầng Reverse Proxy |
| `monitoring` | Bridge | `prometheus`, `grafana`, `loki`, `promtail`, `cadvisor`, `nginx-exporter`, `postgres-exporter`, `webapp`, `nginx` | Thu thập metrics, tập trung log và truyền cảnh báo nội bộ |

---

## 2. Cấu trúc thư mục dự án

```
.
├── app/                                # Ứng dụng Web Node.js/Express (FleetOps Dispatch Console)
│   ├── Dockerfile                      # Image node:20-alpine, chạy bằng user non-root "node"
│   ├── package.json
│   ├── server.js                       # REST API 4 bảng, tự động đồng bộ ODO & trạng thái, /metrics, /health
│   └── public/                         # Giao diện SPA Quản lý Đội xe (Be Vietnam Pro & JetBrains Mono offline)
├── db/
│   ├── 00-create-roles.sh              # Khởi tạo tài khoản phân quyền tối thiểu (fleet_app, fleet_monitor)
│   ├── init.sql                        # Schema 4 bảng (vehicles, drivers, schedules, maintenances) & dữ liệu mẫu
│   ├── 20-grant-roles.sh               # Cấp quyền DML tối thiểu cho fleet_app
│   └── pgadmin-servers.json            # Tự động nạp sẵn cấu hình kết nối PostgreSQL vào pgAdmin 4
├── nginx/
│   ├── default.conf                    # Reverse proxy, chuyển hướng 80->443, TLS 1.2/1.3, Security Headers, Rate Limit
│   ├── proxy_params.conf               # Header chuyển tiếp IP thực (X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)
│   └── certs/                          # Chứng chỉ số tự ký server.crt & khóa riêng server.key (mode 600)
├── prometheus/
│   └── prometheus.yml                  # Cấu hình thu thập 5 targets: prometheus, webapp, cadvisor, nginx, postgres
├── loki/
│   └── loki-config.yaml                # Cấu hình lưu trữ log tập trung (TSDB v13, retention 168h)
├── promtail/
│   └── promtail-config.yaml            # Tự động thu thập log từ Docker containers và gắn nhãn job, container
├── grafana/
│   ├── dashboards/fleetops.json        # Dashboard giám sát CPU, RAM, Nginx, PostgreSQL, Webapp, Log bảo mật
│   ├── dashboards/fleetops-security.json # Dashboard chuyên sâu Nhật ký & An toàn thông tin
│   └── provisioning/                   # Tự động nạp Datasources (Prometheus, Loki), Dashboards và Alert Rule
├── scripts/
│   ├── bootstrap-ubuntu.sh              # Cài Docker Engine + Compose plugin, cấu hình UFW cho VM Ubuntu
│   ├── deploy-ubuntu.sh                 # Triển khai 1 lệnh trên VM: .env → TLS cert → build → health check
│   ├── gen-env.sh                       # Sinh file .env với mật khẩu mạnh ngẫu nhiên và phân quyền 600
│   ├── gen-cert.sh                      # Sinh chứng chỉ TLS tự ký RSA 2048-bit, SAN gồm localhost + IP của VM
│   ├── attack-sim.sh                    # Script mô phỏng tấn công Brute-force vào /api/login
│   └── verify-hardening.sh              # Script kiểm tra tự động 8 hạng mục Hardening (Bước 6)
├── tests/
│   ├── smoke_api.sh                    # Kiểm thử tự động toàn bộ luồng đăng nhập & CRUD 4 bảng đội xe
│   └── check_logql.sh                  # Kiểm thử tự động luồng Promtail -> Loki -> Grafana Alerting
├── .env.example                        # Mẫu cấu hình biến môi trường (không chứa mật khẩu thật)
├── .gitignore                          # Loại trừ .env, *.key, *.crt, node_modules khỏi Git
└── docker-compose.yml                  # Định nghĩa toàn bộ 11 containers, 3 networks và 5 persistent volumes
```

---

## 3. Hướng dẫn cài đặt và khởi chạy từ đầu

### Bước 1: Clone kho mã nguồn
```bash
git clone https://github.com/dtc245200390-oss/fleetops-dtc245200390.git
cd fleetops-dtc245200390
```

### Bước 2: Khởi tạo biến môi trường `.env` và chứng chỉ số SSL/TLS tự ký
```bash
sh ./scripts/gen-env.sh
sh ./scripts/gen-cert.sh
```

### Bước 3: Khởi chạy toàn bộ hệ thống bằng Docker Compose
```bash
docker compose up -d --build
docker compose ps
```

### Bước 4: Truy cập các giao diện của hệ thống
| Dịch vụ | Địa chỉ truy cập | Tài khoản đăng nhập |
|---|---|---|
| **Website Quản lý Đội xe FleetOps (HTTPS)** | `https://localhost` *(HTTP `:80` tự động chuyển hướng `301`)* | `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env` |
| **pgAdmin 4 (Quản trị PostgreSQL 16)** | `http://localhost:5050` *(chỉ lắng nghe `127.0.0.1`)* | `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` trong `.env` |
| **Grafana (Dashboard, Explore, Alerting)** | `http://localhost:3000` *(chỉ lắng nghe `127.0.0.1`)* | `GRAFANA_USER` / `GRAFANA_PASSWORD` trong `.env` |
| **Prometheus (Targets & Metrics)** | `http://localhost:9090` *(chỉ lắng nghe `127.0.0.1`)* | Truy cập nội bộ tại `127.0.0.1` |

*(Server `FleetOps – Quản lý Đội xe (PostgreSQL 16)` đã được nạp tự động trong pgAdmin 4 với Host: `db`, Port: `5432`, Database: `fleetops`, Username: `postgres`, Password: giá trị `DB_ADMIN_PASSWORD` trong `.env`).*

### Bước 5: Triển khai trên VM Ubuntu 20.04 / 22.04 / 24.04

Yêu cầu VM: **2 vCPU, tối thiểu 4 GB RAM (khuyến nghị 6 GB), ≥ 20 GB ổ đĩa**, có Internet để tải Docker images. Nếu chưa có mã nguồn trên VM, hãy `git clone` repository hoặc dùng `scp`/WinSCP chép thư mục dự án lên VM trước khi chạy các bước dưới.

**5.1. Cài Docker Engine + Compose plugin và mở firewall (chạy 1 lần)**
```bash
bash scripts/bootstrap-ubuntu.sh
# Script thêm user vào group docker -> đăng xuất/đăng nhập lại SSH, hoặc chạy:
newgrp docker
sudo ufw enable        # chỉ bật nếu UFW chưa active; script đã mở sẵn cổng 22/80/443
```

**5.2. Triển khai toàn bộ hệ thống bằng 1 lệnh**
```bash
bash scripts/deploy-ubuntu.sh
```

Script tự động thực hiện:
- Kiểm tra Docker, RAM, dung lượng đĩa và cổng `80/443` có bị chiếm không;
- Sinh `.env` với mật khẩu mạnh ngẫu nhiên (quyền `600`) nếu chưa có;
- Sinh chứng chỉ TLS tự ký với **SAN gồm IP LAN của VM**, nhờ đó `https://<IP-VM>` không báo sai tên;
- Đồng bộ `NGINX_UID/GID` trong `.env` theo chủ sở hữu `nginx/certs/server.key` để container nginx non-root đọc được khóa `600`;
- Chạy `docker compose up -d --build`, chờ web trả `HTTP 200` rồi in bảng địa chỉ và tài khoản truy cập.

**5.3. Truy cập từ máy host**
- Website: `https://<IP-VM>/` (chấp nhận cảnh báo chứng chỉ tự ký) hoặc `http://<IP-VM>/` → tự chuyển `301` sang HTTPS.
- Grafana / Prometheus / pgAdmin chỉ lắng nghe `127.0.0.1` trên VM. Mở SSH tunnel từ máy host:
```bash
ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 5050:127.0.0.1:5050 <user>@<IP-VM>
```
Sau đó mở `http://localhost:3000`, `http://localhost:9090`, `http://localhost:5050` trên máy host.

**5.4. Kiểm thử sau triển khai**
```bash
bash tests/smoke_api.sh https://localhost
bash scripts/verify-hardening.sh
sh ./scripts/attack-sim.sh https://localhost
```

**5.5. Xử lý sự cố thường gặp**

| Hiện tượng | Cách xử lý |
|---|---|
| `permission denied ... docker.sock` | Chạy `newgrp docker` hoặc đăng xuất/đăng nhập lại SSH |
| `port is already allocated` (80/443) | `sudo ss -ltnp 'sport = :80'` → dừng `apache2`/`nginx` hệ thống đang chiếm cổng |
| Web trả `502 Bad Gateway` | `docker compose logs --tail=100 webapp nginx`; chờ `fleetops-db` healthy |
| Trình duyệt cảnh báo chứng chỉ | Bình thường với chứng chỉ tự ký; kiểm tra SAN: `openssl x509 -in nginx/certs/server.crt -noout -ext subjectAltName` |
| VM đổi IP nên chứng chỉ sai tên | `FORCE_CERT=1 bash scripts/gen-cert.sh && docker compose restart nginx` |
| Container bị kill do thiếu RAM | Tăng RAM VM lên ≥ 4 GB; theo dõi bằng `docker stats` |
| Muốn triển khai lại từ đầu | `docker compose down -v` (CẢNH BÁO: xóa toàn bộ dữ liệu PostgreSQL, Grafana, Loki) |


---

## 4. Hướng dẫn kiểm thử Giám sát, Truy vấn LogQL, Cảnh báo & Hardening

### 4.1. Kiểm thử API & Nghiệp vụ Đội xe tự động
```bash
bash ./tests/smoke_api.sh
```

### 4.2. Các câu truy vấn LogQL trên Grafana Explore (Datasource: `Loki`)
1. **Truy vấn các lần đăng nhập thất bại (dấu hiệu dò mật khẩu):**
   ```logql
   {job="webapp"} |= "LOGIN_FAILED"
   ```
2. **Truy vấn sự kiện bảo mật và cảnh báo nhận từ Grafana Webhook:**
   ```logql
   {job="webapp"} |~ "LOGIN_FAILED|ALERT_RECEIVED|ERROR"
   ```
3. **Truy vấn log truy cập Nginx tại đường dẫn đăng nhập:**
   ```logql
   {job="nginx"} |= "POST /api/login"
   ```
4. **Thống kê số lần đăng nhập sai mỗi phút (dùng cho quy tắc cảnh báo Brute-force):**
   ```logql
   sum(count_over_time({job="webapp"} |= "LOGIN_FAILED" [1m]))
   ```

### 4.3. Mô phỏng tấn công Brute-force để kích hoạt Rate Limit & Cảnh báo Grafana
```bash
sh ./scripts/attack-sim.sh https://localhost
```
- 7 request đầu tiên trả về `HTTP 401` và ghi nhận sự kiện `LOGIN_FAILED` vào Loki cùng bộ đếm `fleetops_login_failed_total` trên Prometheus.
- Từ request thứ 8 trở đi, khi tốc độ vượt ngưỡng `rate=6r/m, burst=6`, Nginx lập tức chặn đứng bằng mã `HTTP 429 Too Many Requests`.
- Khi tổng số lần `LOGIN_FAILED` trong 1 phút vượt quá 5 lần (`sum(count_over_time({job="webapp"} |= "LOGIN_FAILED" [1m])) > 5`), quy tắc cảnh báo **Brute-force đăng nhập (>5 lần thất bại / 1 phút)** trên Grafana chuyển sang trạng thái **Firing** và bắn webhook nội bộ về `http://webapp:3000/internal/alert`.

### 4.4. Kiểm tra tự động các biện pháp Hardening (Bước 6)
```bash
sh ./scripts/verify-hardening.sh
```
Script tự động xác minh 8 hạng mục bảo mật:
1. **Non-root Container User:** `fleetops-webapp` chạy dưới quyền user `node` (`UID 1000`), `fleetops-nginx` chạy dưới quyền user non-root `NGINX_UID` trong `.env` (`101` trên Docker Desktop, thường `1000` trên VM Ubuntu – trùng chủ sở hữu khóa TLS).
2. **Read-only Root Filesystem & Capability Drop:** `read_only: true`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`.
3. **Network Isolation:** CSDL `fleetops-db` nằm trong mạng `backend` (`internal: true`), không mở cổng `5432` ra máy chủ host.
4. **Least-Privilege Database Roles:** Ứng dụng kết nối bằng `fleet_app` (chỉ có quyền `SELECT, INSERT, UPDATE, DELETE`), Exporter kết nối bằng `fleet_monitor` (`pg_monitor`), không dùng tài khoản quản trị `postgres`.
5. **HTTPS & TLS Hardening:** Chuyển hướng `HTTP 80 -> HTTPS 443 (301)`, chỉ cho phép `TLSv1.2` và `TLSv1.3` với bộ mã hóa ECDHE.
6. **HTTP Security Headers:** Đầy đủ `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, ẩn phiên bản bằng `server_tokens off`.
7. **Ẩn đường dẫn nội bộ:** Nginx trả về `HTTP 404` đối với mọi truy cập từ bên ngoài vào `/metrics` và `/internal`.
8. **Giới hạn tài nguyên (Resource Limits):** Thiết lập `mem_limit`, `cpus`, `pids_limit` cho các dịch vụ nhằm chống tấn công cạn kiệt tài nguyên (DoS/Fork bomb).

---

## 5. Minh chứng triển khai thực tế trên VM Ubuntu

Hệ thống đã được triển khai bằng Docker Compose trên VM **Ubuntu 20.04.6 LTS** tại địa chỉ `https://192.168.1.9/` (chứng chỉ TLS tự ký, có SAN cho IP LAN). Toàn bộ 11 container đều ở trạng thái `running/healthy`.

Ảnh minh chứng được lưu trong thư mục [`docs/screenshots`](docs/screenshots):

| # | Ảnh | Nội dung |
|---|-----|----------|
| 1 | [01-fleetops-dashboard.png](docs/screenshots/01-fleetops-dashboard.png) | Giao diện FleetOps sau đăng nhập: 6 xe, 3 chuyến, 5 tài xế và giám sát định mức ODO |
| 2 | [02-grafana-overview.png](docs/screenshots/02-grafana-overview.png) | Dashboard Grafana “Giám sát hệ thống”: CPU/RAM 11 container, Nginx, PostgreSQL, webapp và log |
| 3 | [03-grafana-security.png](docs/screenshots/03-grafana-security.png) | Dashboard “Nhật ký & An toàn thông tin”: 16 lần `LOGIN_FAILED`, 26 request bị chặn `429`, 6 cảnh báo webhook |
| 4 | [04-grafana-alert-firing.png](docs/screenshots/04-grafana-alert-firing.png) | Quy tắc `bruteforce-login` đang **Firing**, giá trị 7 vượt ngưỡng 5 |
| 5 | [05-grafana-explore-logql.png](docs/screenshots/05-grafana-explore-logql.png) | Grafana Explore truy vấn `{job="webapp"} |= "LOGIN_FAILED"` (52 dòng log) |
| 6 | [06-prometheus-targets.png](docs/screenshots/06-prometheus-targets.png) | Prometheus `/targets`: 5/5 job ở trạng thái **UP** |
| 7 | [07-pgadmin-tree.png](docs/screenshots/07-pgadmin-tree.png) | pgAdmin kết nối PostgreSQL, cây database `fleetops` với 4 bảng nghiệp vụ |
| 8 | [08-pgadmin-vehicles.png](docs/screenshots/08-pgadmin-vehicles.png) | Query Tool: `SELECT * FROM public.vehicles ORDER BY id ASC` trả về 6 dòng dữ liệu thật |

### Kết quả kiểm thử tự động

| Hạng mục | Lệnh kiểm thử | Kết quả |
|---|---|---|
| API nghiệp vụ | `bash tests/smoke_api.sh https://localhost` | **PASS** – đăng nhập, CRUD 4 bảng, đồng bộ ODO, thống kê |
| Hardening | `bash scripts/verify-hardening.sh` | **8/8 PASS** |
| Rate limit | `sh scripts/attack-sim.sh https://localhost` | 7 request `HTTP 401`, sau đó chuyển `HTTP 429` |
| LogQL + Alerting | `bash tests/check_logql.sh https://localhost` | **PASS** – 9 log `LOGIN_FAILED`, 34 log Nginx `POST /api/login`, webhook `ALERT_RECEIVED` |
| Prometheus targets | `GET /api/v1/targets` | 5/5 target **UP** (prometheus, webapp, cadvisor, nginx, postgres) |
| HTTPS & headers | `curl -kI https://192.168.1.9/` | `HTTP 200`, đầy đủ HSTS, CSP, X-Frame-Options, Referrer-Policy… |
| Chuyển hướng HTTP | `curl -I http://192.168.1.9/` | `301` → `https://192.168.1.9/` |

> Ghi chú: các ảnh Grafana/Prometheus/pgAdmin được chụp qua SSH tunnel `-L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 5050:127.0.0.1:5050`, vì các dịch vụ này chỉ lắng nghe trên `127.0.0.1` của VM.
