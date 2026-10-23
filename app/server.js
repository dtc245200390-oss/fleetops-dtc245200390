const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

// Bắt lỗi bất đồng bộ của các route để không treo request
const wrap = fn => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
['get', 'post', 'put', 'delete'].forEach(m => { const o = app[m].bind(app); app[m] = (p, ...h) => h.length ? o(p, ...h.map(wrap)) : o(p); });

// ---------- Log có cấu trúc (stdout -> Promtail -> Loki) ----------
function log(level, event, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}
// Dòng log dạng text dễ truy vấn bằng LogQL: level=WARN event=LOGIN_FAILED ip=...
function logText(level, event, extra = {}) {
  const kv = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`${new Date().toISOString()} level=${level} event=${event} ${kv}`);
}

// ---------- Prometheus Metrics ----------
client.collectDefaultMetrics();
const loginFailed = new client.Counter({
  name: 'fleetops_login_failed_total',
  help: 'Tong so lan dang nhap that bai vao he thong quan ly doi xe'
});
const httpDur = new client.Histogram({
  name: 'fleetops_http_request_duration_seconds',
  help: 'Thoi gian xu ly HTTP request (giay)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3]
});
const vehicleGauge = new client.Gauge({
  name: 'fleetops_vehicles_count',
  help: 'So luong phuong tien theo trang thai',
  labelNames: ['status']
});
const maintenanceCostGauge = new client.Gauge({
  name: 'fleetops_maintenance_cost_vnd_total',
  help: 'Tong chi phi bao duong doi xe (VND)'
});

app.use((req, res, next) => {
  const end = httpDur.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route ? req.route.path : req.path, status: res.statusCode }));
  next();
});

// ---------- Database ----------
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});
const q = (text, params) => pool.query(text, params);

// ---------- Xác thực quản trị ----------
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
const tokens = new Map();
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const t = crypto.randomBytes(24).toString('hex');
    tokens.set(t, Date.now() + TOKEN_TTL_MS);
    logText('INFO', 'LOGIN_SUCCESS', { user: username, ip });
    return res.json({ token: t, username });
  }
  loginFailed.inc();
  logText('WARN', 'LOGIN_FAILED', { user: username || 'unknown', ip });
  res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
});

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const expiry = tokens.get(t);
  if (!expiry || expiry <= Date.now()) {
    tokens.delete(t);
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' });
  }
  next();
}

app.post('/api/logout', auth, (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  tokens.delete(t);
  res.status(204).end();
});

// ---------- Kiểm tra ràng buộc nghiệp vụ Đội xe ----------
async function validateSchedule(body) {
  if (!body || !body.trip_code || !body.vehicle_id || !body.driver_id || !body.origin || !body.destination || !body.depart_time) {
    return 'Vui lòng nhập đủ mã chuyến, phương tiện, tài xế, điểm đi, điểm đến và giờ khởi hành';
  }
  if (Number.isNaN(Date.parse(body.depart_time))) {
    return 'Thời gian khởi hành không hợp lệ';
  }
  const vRes = await q('SELECT plate_number, status FROM vehicles WHERE id=$1', [body.vehicle_id]);
  if (!vRes.rows.length) return 'Phương tiện được chọn không tồn tại';
  const dRes = await q('SELECT full_name, status FROM drivers WHERE id=$1', [body.driver_id]);
  if (!dRes.rows.length) return 'Tài xế được chọn không tồn tại';

  if (body.status === 'Đang chạy') {
    if (vRes.rows[0].status === 'Bảo dưỡng' || vRes.rows[0].status === 'Ngừng hoạt động') {
      return `Xe ${vRes.rows[0].plate_number} đang ở trạng thái "${vRes.rows[0].status}", không thể xuất bến`;
    }
    if (dRes.rows[0].status === 'Nghỉ phép') {
      return `Tài xế ${dRes.rows[0].full_name} đang nghỉ phép, không thể phân công chạy ngay`;
    }
  }
  return null;
}

async function syncScheduleEffects(scheduleRow, prevStatus) {
  if (!scheduleRow) return;
  const { vehicle_id, driver_id, distance_km, status } = scheduleRow;
  if (status === 'Đang chạy') {
    await q("UPDATE vehicles SET status='Đang chạy' WHERE id=$1 AND status NOT IN ('Bảo dưỡng','Ngừng hoạt động')", [vehicle_id]);
    await q("UPDATE drivers SET status='Đang chạy' WHERE id=$1", [driver_id]);
  } else if (status === 'Hoàn thành' && prevStatus !== 'Hoàn thành') {
    const addKm = Math.max(0, parseInt(distance_km || 0, 10));
    await q("UPDATE vehicles SET odometer_km = odometer_km + $1, status = CASE WHEN status='Đang chạy' THEN 'Sẵn sàng' ELSE status END WHERE id=$2", [addKm, vehicle_id]);
    await q("UPDATE drivers SET status = CASE WHEN status='Đang chạy' THEN 'Sẵn sàng' ELSE status END WHERE id=$1", [driver_id]);
  } else if (status === 'Đã hủy' && prevStatus === 'Đang chạy') {
    await q("UPDATE vehicles SET status='Sẵn sàng' WHERE id=$1 AND status='Đang chạy'", [vehicle_id]);
    await q("UPDATE drivers SET status='Sẵn sàng' WHERE id=$1 AND status='Đang chạy'", [driver_id]);
  }
}

async function syncMaintenanceEffects(maintRow, prevStatus) {
  if (!maintRow) return;
  const { vehicle_id, odometer_km, status } = maintRow;
  if (status === 'Đang tại xưởng') {
    await q("UPDATE vehicles SET status='Bảo dưỡng' WHERE id=$1", [vehicle_id]);
  } else if (status === 'Hoàn tất' && prevStatus !== 'Hoàn tất') {
    const baseKm = Math.max(0, parseInt(odometer_km || 0, 10));
    await q(
      `UPDATE vehicles
       SET odometer_km = GREATEST(odometer_km, $1),
           next_service_km = GREATEST(next_service_km, GREATEST(odometer_km, $1) + 10000),
           status = 'Sẵn sàng'
       WHERE id = $2`,
      [baseKm, vehicle_id]
    );
  }
}

// ---------- CRUD Tổng quát & Liên kết Nghiệp vụ ----------
function crud(name, table, cols) {
  app.get(`/api/${name}`, auth, async (req, res) => {
    const r = await q(`SELECT * FROM ${table} ORDER BY id DESC`);
    res.json(r.rows);
  });

  app.post(`/api/${name}`, auth, async (req, res) => {
    if (table === 'schedules') {
      const err = await validateSchedule(req.body);
      if (err) return res.status(400).json({ error: err });
    }
    const vals = cols.map(c => (req.body[c] === '' || req.body[c] === undefined ? null : req.body[c]));
    const r = await q(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      vals
    );
    const created = r.rows[0];
    if (table === 'schedules') await syncScheduleEffects(created, null);
    if (table === 'maintenances') await syncMaintenanceEffects(created, null);
    log('INFO', 'CREATE', { table, id: created.id });
    res.status(201).json(created);
  });

  app.put(`/api/${name}/:id`, auth, async (req, res) => {
    if (table === 'schedules') {
      const err = await validateSchedule(req.body);
      if (err) return res.status(400).json({ error: err });
    }
    const prevRes = await q(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
    const prev = prevRes.rows[0];
    if (!prev) return res.status(404).json({ error: 'Không tìm thấy bản ghi' });

    const vals = cols.map(c => (req.body[c] === '' || req.body[c] === undefined ? null : req.body[c]));
    const r = await q(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
      [...vals, req.params.id]
    );
    const updated = r.rows[0];
    if (table === 'schedules') await syncScheduleEffects(updated, prev.status);
    if (table === 'maintenances') await syncMaintenanceEffects(updated, prev.status);
    log('INFO', 'UPDATE', { table, id: req.params.id });
    res.json(updated || {});
  });

  app.delete(`/api/${name}/:id`, auth, async (req, res) => {
    await q(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
    log('INFO', 'DELETE', { table, id: req.params.id });
    res.status(204).end();
  });
}

crud('vehicles', 'vehicles', ['plate_number', 'vehicle_type', 'brand_model', 'capacity_tons', 'odometer_km', 'next_service_km', 'inspection_due', 'status']);
crud('drivers', 'drivers', ['driver_code', 'full_name', 'phone', 'license_class', 'license_no', 'license_expiry', 'status']);
crud('schedules', 'schedules', ['trip_code', 'vehicle_id', 'driver_id', 'origin', 'destination', 'cargo_note', 'distance_km', 'depart_time', 'status']);
crud('maintenances', 'maintenances', ['vehicle_id', 'service_type', 'service_date', 'odometer_km', 'cost_vnd', 'workshop', 'status', 'note']);

// Tác vụ nhanh 1-click trên Lịch trình (Xuất bến / Hoàn thành chuyến)
app.post('/api/schedules/:id/status', auth, async (req, res) => {
  const { status } = req.body || {};
  if (!['Đã lên lịch', 'Đang chạy', 'Hoàn thành', 'Đã hủy'].includes(status)) {
    return res.status(400).json({ error: 'Trạng thái lịch trình không hợp lệ' });
  }
  const prevRes = await q('SELECT * FROM schedules WHERE id=$1', [req.params.id]);
  const prev = prevRes.rows[0];
  if (!prev) return res.status(404).json({ error: 'Không tìm thấy lịch trình' });

  if (status === 'Đang chạy') {
    const err = await validateSchedule({ ...prev, status: 'Đang chạy' });
    if (err) return res.status(400).json({ error: err });
  }
  const r = await q('UPDATE schedules SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  const updated = r.rows[0];
  await syncScheduleEffects(updated, prev.status);
  log('INFO', 'TRIP_STATUS_CHANGE', { id: updated.id, trip_code: updated.trip_code, from: prev.status, to: status });
  res.json(updated);
});

// Tác vụ nhanh 1-click trên Phiếu bảo dưỡng (Vào xưởng / Hoàn tất bảo dưỡng)
app.post('/api/maintenances/:id/status', auth, async (req, res) => {
  const { status } = req.body || {};
  if (!['Kế hoạch', 'Đang tại xưởng', 'Hoàn tất'].includes(status)) {
    return res.status(400).json({ error: 'Trạng thái bảo dưỡng không hợp lệ' });
  }
  const prevRes = await q('SELECT * FROM maintenances WHERE id=$1', [req.params.id]);
  const prev = prevRes.rows[0];
  if (!prev) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo dưỡng' });

  const r = await q('UPDATE maintenances SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  const updated = r.rows[0];
  await syncMaintenanceEffects(updated, prev.status);
  log('INFO', 'MAINTENANCE_STATUS_CHANGE', { id: updated.id, vehicle_id: updated.vehicle_id, from: prev.status, to: status });
  res.json(updated);
});

// Thống kê tổng hợp Dashboard Điều độ
app.get('/api/stats', auth, async (req, res) => {
  const r = await q(`SELECT
    (SELECT count(*)::int FROM vehicles) AS total_vehicles,
    (SELECT count(*)::int FROM vehicles WHERE status='Sẵn sàng') AS ready_vehicles,
    (SELECT count(*)::int FROM vehicles WHERE status='Đang chạy') AS running_vehicles,
    (SELECT count(*)::int FROM vehicles WHERE status='Bảo dưỡng') AS maint_vehicles,
    (SELECT count(*)::int FROM vehicles WHERE (next_service_km - odometer_km) <= 1500) AS due_service_vehicles,
    (SELECT count(*)::int FROM drivers) AS total_drivers,
    (SELECT count(*)::int FROM drivers WHERE status='Sẵn sàng') AS ready_drivers,
    (SELECT count(*)::int FROM drivers WHERE status='Đang chạy') AS on_trip_drivers,
    (SELECT count(*)::int FROM schedules) AS total_schedules,
    (SELECT count(*)::int FROM schedules WHERE status IN ('Đã lên lịch','Đang chạy')) AS active_schedules,
    (SELECT count(*)::int FROM schedules WHERE status='Đang chạy') AS running_schedules,
    (SELECT COALESCE(sum(distance_km),0)::int FROM schedules WHERE status='Hoàn thành') AS completed_km,
    (SELECT count(*)::int FROM maintenances WHERE status IN ('Kế hoạch','Đang tại xưởng')) AS open_maintenances,
    (SELECT COALESCE(sum(cost_vnd),0)::bigint FROM maintenances) AS total_maint_cost`);
  res.json(r.rows[0]);
});

// ---------- Webhook nhận cảnh báo từ Grafana Alerting ----------
app.post('/internal/alert', (req, res) => {
  const alerts = (req.body && req.body.alerts) || [];
  for (const a of alerts) {
    logText('CRITICAL', 'ALERT_RECEIVED', {
      status: a.status,
      alertname: (a.labels || {}).alertname,
      summary: ((a.annotations || {}).summary || '').replace(/\s+/g, '_')
    });
  }
  res.json({ ok: true });
});

// ---------- Healthcheck & Prometheus /metrics ----------
app.get('/health', async (req, res) => {
  try {
    await q('SELECT 1');
    res.json({ status: 'ok', service: 'fleetops-webapp' });
  } catch (e) {
    logText('ERROR', 'DB_UNAVAILABLE', { msg: e.message });
    res.status(500).json({ status: 'db_error' });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const vStat = await q('SELECT status, count(*)::int AS c FROM vehicles GROUP BY status');
    vehicleGauge.reset();
    for (const row of vStat.rows) vehicleGauge.set({ status: row.status }, row.c);
    const mStat = await q('SELECT COALESCE(sum(cost_vnd),0)::numeric AS total FROM maintenances');
    maintenanceCostGauge.set(Number(mStat.rows[0].total || 0));
  } catch (_) {}
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.use(express.static(__dirname + '/public'));

app.use((err, req, res, next) => {
  if (err.code === '23505') {
    logText('WARN', 'UNIQUE_VIOLATION', { path: req.path });
    return res.status(400).json({ error: 'Mã hoặc biển số đã tồn tại trong hệ thống' });
  }
  if (err.code === '23503') {
    logText('WARN', 'FK_VIOLATION', { path: req.path });
    return res.status(400).json({ error: 'Không thể xóa hoặc liên kết vì dữ liệu đang được tham chiếu ở lịch trình/bảo dưỡng' });
  }
  if (err.code === '23514') {
    logText('WARN', 'CHECK_VIOLATION', { path: req.path });
    return res.status(400).json({ error: 'Giá trị hoặc trạng thái không hợp lệ' });
  }
  if (err.code === '22P02' || err.code === '22007') {
    return res.status(400).json({ error: 'Định dạng số hoặc ngày giờ không hợp lệ' });
  }
  if (err.code === '23502') {
    logText('WARN', 'MISSING_FIELD', { path: req.path });
    return res.status(400).json({ error: 'Thiếu trường thông tin bắt buộc' });
  }
  logText('ERROR', 'UNHANDLED', { msg: String(err.message).replace(/\s+/g, '_'), path: req.path });
  res.status(500).json({ error: 'Lỗi hệ thống nội bộ' });
});

app.listen(3000, () => logText('INFO', 'SERVER_STARTED', { port: 3000, app: 'fleetops' }));
