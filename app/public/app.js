let token = sessionStorage.getItem('t');
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const num = v => v == null || v === '' ? '0' : Number(v).toLocaleString('vi-VN');
const money = v => v == null || v === '' ? '0 ₫' : Number(v).toLocaleString('vi-VN') + ' ₫';
const dt = v => v ? new Date(v).toLocaleString('vi-VN', { hour12: false, dateStyle: 'short', timeStyle: 'short' }) : '';
const dOnly = v => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—';

let toastTimer;
function toast(m, bad) {
  const t = $('#toast');
  t.textContent = m;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) {
    clearSession();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  if (!r.ok) {
    let m = 'Lỗi ' + r.status;
    try { m = (await r.json()).error || m; } catch (_) {}
    throw new Error(m);
  }
  return r.status === 204 ? null : r.json();
}

let L = { vehicles: [], drivers: [], schedules: [], maintenances: [] };
const byId = (list, id) => list.find(i => String(i.id) === String(id));
const badge = (v, map) => `<span class="badge ${map[v] || 'b-gray'}">${esc(v)}</span>`;

const VEH_ST = { 'Sẵn sàng': 'b-green', 'Đang chạy': 'b-blue', 'Bảo dưỡng': 'b-yellow', 'Ngừng hoạt động': 'b-gray' };
const DRV_ST = { 'Sẵn sàng': 'b-green', 'Đang chạy': 'b-blue', 'Nghỉ phép': 'b-yellow' };
const TRP_ST = { 'Đã lên lịch': 'b-yellow', 'Đang chạy': 'b-blue', 'Hoàn thành': 'b-green', 'Đã hủy': 'b-red' };
const MNT_ST = { 'Kế hoạch': 'b-yellow', 'Đang tại xưởng': 'b-blue', 'Hoàn tất': 'b-green' };

function plateBadge(plate, type) {
  if (!plate) return '<span class="sub">—</span>';
  const isWhite = type && (type.includes('bán tải') || type.includes('khách'));
  return `<span class="plate ${isWhite ? 'white' : ''}">${esc(plate)}</span>`;
}

function odoBar(curKm, nextKm) {
  const c = Number(curKm || 0);
  const n = Math.max(1, Number(nextKm || 10000));
  const rem = n - c;
  const pct = Math.min(100, Math.max(8, Math.round((c / n) * 100)));
  const cls = rem <= 0 ? 'over' : rem <= 1500 ? 'warn' : 'ok';
  const note = rem <= 0 ? `Quá hạn ${num(Math.abs(rem))} km` : `Còn ${num(rem)} km`;
  return `<div class="odo-cell">
    <div class="odo-meta"><span class="mono"><b>${num(c)}</b> / ${num(n)} km</span><span class="mono">${note}</span></div>
    <div class="odo-track"><div class="odo-fill ${cls}" style="width:${pct}%"></div></div>
  </div>`;
}

const M = {
  dashboard: {
    t: 'Trung tâm Điều độ Đội xe',
    s: 'Giám sát phương tiện, tiến độ lịch trình, định mức ODO và cảnh báo bảo dưỡng kỹ thuật',
    i: 'dashboard'
  },
  vehicles: {
    t: 'Quản lý Đội xe',
    s: 'Hồ sơ phương tiện, tải trọng, chỉ số công-tơ-mét (ODO) và hạn đăng kiểm',
    i: 'truck',
    add: 'Thêm phương tiện',
    filters: ['Tất cả', 'Sẵn sàng', 'Đang chạy', 'Bảo dưỡng', 'Sắp/Quá hạn ODO'],
    matchFilter: (r, flt) => {
      if (flt === 'Tất cả') return true;
      if (flt === 'Sắp/Quá hạn ODO') return (Number(r.next_service_km) - Number(r.odometer_km)) <= 1500;
      return r.status === flt;
    },
    f: [
      ['plate_number', 'Biển kiểm soát (VD: 20C-184.52)', 'text', 1],
      ['vehicle_type', 'Loại phương tiện', 'select', 1, ['Xe tải thùng', 'Đầu kéo Container', 'Xe tải đông lạnh', 'Xe khách 16 chỗ', 'Xe bán tải']],
      ['brand_model', 'Nhãn hiệu / Dòng xe', 'text', 1],
      ['capacity_tons', 'Tải trọng (tấn)', 'number', 1],
      ['odometer_km', 'Số ODO hiện tại (km)', 'number', 1],
      ['next_service_km', 'Mốc ODO bảo dưỡng kế tiếp (km)', 'number', 1],
      ['inspection_due', 'Hạn đăng kiểm', 'date', 0],
      ['status', 'Trạng thái vận hành', 'select', 0, ['Sẵn sàng', 'Đang chạy', 'Bảo dưỡng', 'Ngừng hoạt động']]
    ],
    cols: [
      ['Biển số', r => plateBadge(r.plate_number, r.vehicle_type)],
      ['Phương tiện & Nhãn hiệu', r => `<div><b>${esc(r.brand_model)}</b><div class="route-sub">${esc(r.vehicle_type)}</div></div>`],
      ['Tải trọng', r => `<span class="mono">${num(r.capacity_tons)} tấn</span>`],
      ['Chỉ số ODO / Định mức bảo dưỡng', r => odoBar(r.odometer_km, r.next_service_km)],
      ['Hạn đăng kiểm', r => `<span class="mono">${dOnly(r.inspection_due)}</span>`],
      ['Trạng thái', r => badge(r.status, VEH_ST)]
    ]
  },
  schedules: {
    t: 'Lịch trình & Điều phối Chuyến',
    s: 'Phân công phương tiện & tài xế theo tuyến, tự động cộng dồn số km vào ODO khi hoàn thành chuyến',
    i: 'route',
    add: 'Lập lịch trình mới',
    filters: ['Tất cả', 'Đang chạy', 'Đã lên lịch', 'Hoàn thành', 'Đã hủy'],
    matchFilter: (r, flt) => flt === 'Tất cả' || r.status === flt,
    f: [
      ['trip_code', 'Mã chuyến (VD: TRP-2610-06)', 'text', 1],
      ['depart_time', 'Thời gian khởi hành', 'datetime-local', 1],
      ['vehicle_id', 'Phương tiện đảm nhận', 'ref', 'vehicles', 1],
      ['driver_id', 'Tài xế điều khiển', 'ref', 'drivers', 1],
      ['origin', 'Điểm xuất phát', 'text', 1],
      ['destination', 'Điểm đến / Giao hàng', 'text', 1],
      ['distance_km', 'Quãng đường (km)', 'number', 1],
      ['status', 'Trạng thái chuyến', 'select', 0, ['Đã lên lịch', 'Đang chạy', 'Hoàn thành', 'Đã hủy']],
      ['cargo_note', 'Hàng hóa vận chuyển / Ghi chú điều độ', 'textarea', 0]
    ],
    cols: [
      ['Mã chuyến & Xuất bến', r => `<div><b class="mono">${esc(r.trip_code)}</b><div class="route-sub mono">${dt(r.depart_time)}</div></div>`],
      ['Phương tiện', r => { const v = byId(L.vehicles, r.vehicle_id); return v ? plateBadge(v.plate_number, v.vehicle_type) : '—'; }],
      ['Tài xế', r => { const d = byId(L.drivers, r.driver_id); return d ? `<div><b>${esc(d.full_name)}</b><div class="route-sub">Hạng ${esc(d.license_class)} · ${esc(d.phone)}</div></div>` : '—'; }],
      ['Lộ trình & Hàng hóa', r => `<div class="route-cell"><div class="route-path"><span>${esc(r.origin)}</span><span class="route-arrow">→</span><span>${esc(r.destination)}</span></div><div class="route-sub">${esc(r.cargo_note || 'Vận chuyển theo lệnh điều xe')}</div></div>`],
      ['Cự ly', r => `<span class="mono"><b>${num(r.distance_km)}</b> km</span>`],
      ['Trạng thái', r => badge(r.status, TRP_ST)]
    ]
  },
  maintenances: {
    t: 'Bảo dưỡng & Sửa chữa Kỹ thuật',
    s: 'Quản lý phiếu bảo dưỡng định kỳ, đăng kiểm, tự động nâng mốc ODO chu kỳ mới khi hoàn tất',
    i: 'wrench',
    add: 'Lập phiếu bảo dưỡng',
    filters: ['Tất cả', 'Đang tại xưởng', 'Kế hoạch', 'Hoàn tất'],
    matchFilter: (r, flt) => flt === 'Tất cả' || r.status === flt,
    f: [
      ['vehicle_id', 'Phương tiện bảo dưỡng', 'ref', 'vehicles', 1],
      ['service_type', 'Hạng mục kỹ thuật', 'select', 1, ['Bảo dưỡng định kỳ', 'Thay dầu & lọc', 'Sửa phanh / lốp', 'Đăng kiểm & bảo hiểm', 'Sửa chữa đột xuất']],
      ['service_date', 'Ngày thực hiện', 'date', 1],
      ['odometer_km', 'Số ODO lúc vào xưởng (km)', 'number', 1],
      ['cost_vnd', 'Chi phí quyết toán (VNĐ)', 'number', 1],
      ['workshop', 'Đơn vị thực hiện / Gara', 'text', 1],
      ['status', 'Trạng thái phiếu', 'select', 0, ['Kế hoạch', 'Đang tại xưởng', 'Hoàn tất']],
      ['note', 'Chi tiết phụ tùng thay thế & công việc', 'textarea', 0]
    ],
    cols: [
      ['Ngày & Hạng mục', r => `<div><b>${esc(r.service_type)}</b><div class="route-sub mono">${dOnly(r.service_date)}</div></div>`],
      ['Phương tiện', r => { const v = byId(L.vehicles, r.vehicle_id); return v ? plateBadge(v.plate_number, v.vehicle_type) : '—'; }],
      ['Mốc ODO', r => `<span class="mono">${num(r.odometer_km)} km</span>`],
      ['Đơn vị / Nội dung kỹ thuật', r => `<div><b>${esc(r.workshop || 'Xưởng dịch vụ nội bộ')}</b><div class="route-sub">${esc(r.note || '')}</div></div>`],
      ['Chi phí', r => `<b class="mono">${money(r.cost_vnd)}</b>`],
      ['Trạng thái', r => badge(r.status, MNT_ST)]
    ]
  },
  drivers: {
    t: 'Hồ sơ Đội ngũ Tài xế',
    s: 'Quản lý thông tin liên hệ, hạng giấy phép lái xe (GPLX), thời hạn bằng và lịch trực',
    i: 'users',
    add: 'Thêm tài xế',
    filters: ['Tất cả', 'Sẵn sàng', 'Đang chạy', 'Nghỉ phép'],
    matchFilter: (r, flt) => flt === 'Tất cả' || r.status === flt,
    f: [
      ['driver_code', 'Mã tài xế (VD: DRV-006)', 'text', 1],
      ['full_name', 'Họ và tên tài xế', 'text', 1],
      ['phone', 'Số điện thoại liên hệ', 'tel', 1],
      ['license_class', 'Hạng GPLX', 'select', 1, ['B2', 'C', 'D', 'E', 'FC']],
      ['license_no', 'Số Giấy phép lái xe', 'text', 0],
      ['license_expiry', 'Ngày hết hạn GPLX', 'date', 0],
      ['status', 'Trạng thái công tác', 'select', 0, ['Sẵn sàng', 'Đang chạy', 'Nghỉ phép']]
    ],
    cols: [
      ['Mã TX', r => `<span class="mono"><b>${esc(r.driver_code)}</b></span>`],
      ['Họ và tên tài xế', r => `<b>${esc(r.full_name)}</b>`],
      ['Điện thoại', r => `<span class="mono">${esc(r.phone)}</span>`],
      ['Hạng & Số GPLX', r => `<div><span class="lic-badge">Hạng ${esc(r.license_class)}</span> <span class="mono route-sub">${esc(r.license_no || '')}</span></div>`],
      ['Hạn GPLX', r => `<span class="mono">${dOnly(r.license_expiry)}</span>`],
      ['Trạng thái', r => badge(r.status, DRV_ST)]
    ]
  }
};

let cur = location.hash.slice(1) in M ? location.hash.slice(1) : 'dashboard';
let curFilter = 'Tất cả';
let rows = [];
let editing = null;
let lastFocus = null;

function clearSession() {
  sessionStorage.removeItem('t');
  token = null;
  show();
}

function logout() {
  const oldToken = token;
  clearSession();
  if (oldToken) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + oldToken } }).catch(() => {});
}

function show() {
  $('#login').hidden = !!token;
  $('#main').hidden = !token;
  if (token) {
    nav();
    load();
  }
}

function nav() {
  const counts = {
    vehicles: L.vehicles.length,
    schedules: L.schedules.filter(s => s.status === 'Đang chạy' || s.status === 'Đã lên lịch').length,
    maintenances: L.maintenances.filter(m => m.status !== 'Hoàn tất').length,
    drivers: L.drivers.length
  };
  $('#nav').innerHTML = Object.entries(M).map(([k, m]) => {
    const cnt = k in counts && counts[k] ? `<span class="nav-count">${counts[k]}</span>` : '';
    return `<a href="#${k}" ${k === cur ? 'aria-current="page"' : ''}><span class="nav-left">${icon(m.i)}<span>${m.t.replace('Quản lý ', '').replace('Hồ sơ Đội ngũ ', '')}</span></span>${cnt}</a>`;
  }).join('');
}

window.addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (token && k in M && k !== cur) {
    cur = k;
    curFilter = 'Tất cả';
    $('#q').value = '';
    nav();
    load();
  }
});

async function lookups() {
  const [v, d, s, m] = await Promise.all([api('vehicles'), api('drivers'), api('schedules'), api('maintenances')]);
  L = { vehicles: v, drivers: d, schedules: s, maintenances: m };
  nav();
}

async function load() {
  const m = M[cur];
  $('#title').textContent = m.t;
  $('#subtitle').textContent = m.s;
  document.title = m.t + ' – FleetOps (DTC245200390)';
  const isD = cur === 'dashboard';
  $('#add').hidden = isD;
  $('#search-box').hidden = isD;
  $('#filters').hidden = isD;
  if (!isD) $('#addt').textContent = m.add;
  $('#view').innerHTML = '<div class="panel"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  try {
    await lookups();
    if (isD) return await renderDashboard();
    rows = L[cur] || [];
    renderFilters();
    renderTable();
  } catch (e) {
    if (e.message !== 'Phiên đăng nhập đã hết hạn') {
      $('#view').innerHTML = `<div class="panel empty">Không tải được dữ liệu: ${esc(e.message)}</div>`;
    }
  }
}

function renderFilters() {
  const m = M[cur];
  if (!m.filters) {
    $('#filters').hidden = true;
    return;
  }
  $('#filters').hidden = false;
  $('#filters').innerHTML = m.filters.map(flt => {
    const c = rows.filter(r => m.matchFilter(r, flt)).length;
    return `<button type="button" class="pill-btn ${curFilter === flt ? 'active' : ''}" data-flt="${esc(flt)}"><span>${esc(flt)}</span><span class="p-cnt">${c}</span></button>`;
  }).join('');
  $('#filters').querySelectorAll('[data-flt]').forEach(b => {
    b.onclick = () => {
      curFilter = b.dataset.flt;
      renderFilters();
      renderTable();
    };
  });
}

async function quickTripStatus(id, status) {
  try {
    await api(`schedules/${id}/status`, 'POST', { status });
    toast(status === 'Đang chạy' ? 'Đã xuất bến & cập nhật trạng thái Xe / Tài xế' : 'Đã hoàn thành chuyến & cộng dồn km vào ODO xe');
    load();
  } catch (e) {
    toast(e.message, 1);
  }
}

async function quickMaintStatus(id, status) {
  try {
    await api(`maintenances/${id}/status`, 'POST', { status });
    toast(status === 'Đang tại xưởng' ? 'Đã chuyển xe vào xưởng bảo dưỡng' : 'Đã hoàn tất bảo dưỡng & nâng mốc ODO định kỳ mới (+10.000 km)');
    load();
  } catch (e) {
    toast(e.message, 1);
  }
}

async function renderDashboard() {
  const s = await api('stats');
  const kpi = (ic, val, label, sub, tone) => `
    <div class="cardx">
      <div class="ico ${tone}">${icon(ic)}</div>
      <div class="cardx-body">
        <div class="cardx-label">${label}</div>
        <b class="cardx-val">${val}</b>
        <div class="cardx-sub">${sub}</div>
      </div>
    </div>`;

  const activeTrips = L.schedules
    .filter(x => x.status === 'Đang chạy' || x.status === 'Đã lên lịch')
    .sort((a, b) => (a.status === 'Đang chạy' ? -1 : 1) || new Date(a.depart_time) - new Date(b.depart_time))
    .slice(0, 6);

  const sortedVehicles = [...L.vehicles].sort((a, b) => (a.next_service_km - a.odometer_km) - (b.next_service_km - b.odometer_km));

  $('#view').innerHTML = `
    <div class="cards">
      ${kpi('truck', `${s.ready_vehicles}/${s.total_vehicles} xe`, 'Đội xe sẵn sàng', `<span>Đang chạy: <b>${s.running_vehicles}</b></span><span>Tại xưởng: <b>${s.maint_vehicles}</b></span>`, 't-blue')}
      ${kpi('route', `${s.active_schedules} chuyến`, 'Lịch trình điều độ', `<span>Đang trên tuyến: <b>${s.running_schedules}</b></span><span>Đã đi: <b>${num(s.completed_km)} km</b></span>`, 't-green')}
      ${kpi('users', `${s.ready_drivers}/${s.total_drivers} TX`, 'Tài xế trực chiến', `<span>Đang lái: <b>${s.on_trip_drivers}</b></span><span>Bằng B2/C/D/FC</span>`, 't-blue')}
      ${kpi('wrench', `${s.due_service_vehicles} xe`, 'Cảnh báo ODO & Bảo dưỡng', `<span>Phiếu mở: <b>${s.open_maintenances}</b></span><span>Chi phí: <b>${money(s.total_maint_cost)}</b></span>`, s.due_service_vehicles > 0 ? 't-orange' : 't-green')}
    </div>

    <div class="two">
      <div class="panel">
        <div class="panel-head">
          <h3>Lịch trình đang chạy &amp; chuẩn bị xuất bến</h3>
          <a href="#schedules" class="btn sm">Xem tất cả (${L.schedules.length})</a>
        </div>
        ${activeTrips.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>Chuyến</th><th>Xe &amp; Tài xế</th><th>Lộ trình vận chuyển</th><th>Trạng thái</th><th>Điều độ nhanh</th></tr></thead>
          <tbody>${activeTrips.map(t => {
            const v = byId(L.vehicles, t.vehicle_id);
            const d = byId(L.drivers, t.driver_id);
            const quickBtn = t.status === 'Đã lên lịch'
              ? `<button class="btn sm accent" data-qtrip="${t.id}" data-qst="Đang chạy">${icon('play')}Xuất bến</button>`
              : `<button class="btn sm success" data-qtrip="${t.id}" data-qst="Hoàn thành">${icon('check')}Hoàn thành</button>`;
            return `<tr>
              <td><b class="mono">${esc(t.trip_code)}</b><div class="route-sub mono">${dt(t.depart_time)}</div></td>
              <td>${v ? plateBadge(v.plate_number, v.vehicle_type) : '—'}<div class="route-sub">${d ? esc(d.full_name) : ''}</div></td>
              <td><div class="route-path"><span>${esc(t.origin)}</span><span class="route-arrow">→</span><span>${esc(t.destination)}</span></div><div class="route-sub">${esc(t.cargo_note || '')} · <b class="mono">${num(t.distance_km)} km</b></div></td>
              <td>${badge(t.status, TRP_ST)}</td>
              <td class="act">${quickBtn}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : `<div class="empty">${icon('route')}<div>Hiện không có chuyến xe nào đang chờ điều phối</div></div>`}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Giám sát định mức ODO &amp; Bảo dưỡng đội xe</h3>
          <a href="#maintenances" class="btn sm">Phiếu bảo dưỡng</a>
        </div>
        <div class="panel-pad">
          <div class="odo-list">
            ${sortedVehicles.map(v => {
              const rem = Number(v.next_service_km) - Number(v.odometer_km);
              const pct = Math.min(100, Math.max(8, Math.round((Number(v.odometer_km) / Math.max(1, Number(v.next_service_km))) * 100)));
              const cls = rem <= 0 ? 'over' : rem <= 1500 ? 'warn' : 'ok';
              const tag = rem <= 0
                ? `<span class="badge b-red">Quá hạn ${num(Math.abs(rem))} km</span>`
                : rem <= 1500
                  ? `<span class="badge b-yellow">Còn ${num(rem)} km</span>`
                  : `<span class="badge b-green">Còn ${num(rem)} km</span>`;
              return `<div class="odo-item">
                <div class="odo-top">
                  <div>${plateBadge(v.plate_number, v.vehicle_type)} <strong style="margin-left:6px">${esc(v.brand_model)}</strong></div>
                  ${tag}
                </div>
                <div class="odo-meta">
                  <span>Trạng thái: <b>${esc(v.status)}</b></span>
                  <span class="mono">ODO: <b>${num(v.odometer_km)}</b> / ${num(v.next_service_km)} km (${pct}%)</span>
                </div>
                <div class="odo-track"><div class="odo-fill ${cls}" style="width:${pct}%"></div></div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>`;

  $('#view').querySelectorAll('[data-qtrip]').forEach(b => {
    b.onclick = () => quickTripStatus(b.dataset.qtrip, b.dataset.qst);
  });
}

function rowQuickAction(r) {
  if (cur === 'schedules') {
    if (r.status === 'Đã lên lịch') return `<button class="btn sm accent" data-qtrip="${r.id}" data-qst="Đang chạy">${icon('play')}Xuất bến</button>`;
    if (r.status === 'Đang chạy') return `<button class="btn sm success" data-qtrip="${r.id}" data-qst="Hoàn thành">${icon('check')}Hoàn thành</button>`;
  }
  if (cur === 'maintenances') {
    if (r.status === 'Kế hoạch') return `<button class="btn sm accent" data-qmnt="${r.id}" data-qst="Đang tại xưởng">${icon('wrench')}Vào xưởng</button>`;
    if (r.status === 'Đang tại xưởng') return `<button class="btn sm success" data-qmnt="${r.id}" data-qst="Hoàn tất">${icon('check')}Hoàn tất</button>`;
  }
  return '';
}

function renderTable() {
  const m = M[cur];
  const q = $('#q').value.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (m.matchFilter && !m.matchFilter(r, curFilter)) return false;
    if (!q) return true;
    return m.cols.some(([, f]) => f(r).replace(/<[^>]+>/g, ' ').toLowerCase().includes(q));
  });

  $('#view').innerHTML = `<div class="panel">${
    filtered.length
      ? `<div class="tbl-wrap"><table>
          <thead><tr>${m.cols.map(([h]) => `<th>${h}</th>`).join('')}<th style="text-align:right">Thao tác điều độ</th></tr></thead>
          <tbody>${filtered.map(r => `<tr>
            ${m.cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}
            <td class="act">
              ${rowQuickAction(r)}
              <button class="btn sm" data-e="${r.id}" aria-label="Sửa">${icon('edit')}Sửa</button>
              <button class="btn sm danger" data-d="${r.id}" aria-label="Xóa">${icon('trash')}Xóa</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="foot-count">
          <span>Hiển thị <b>${filtered.length}</b> / ${rows.length} bản ghi (${esc(curFilter)})</span>
          <span class="mono">FleetOps · DTC245200390</span>
        </div>`
      : `<div class="empty">${icon(m.i)}<div>${q || curFilter !== 'Tất cả' ? 'Không tìm thấy bản ghi phù hợp với bộ lọc hiện tại' : 'Chưa có dữ liệu. Nhấn “' + m.add + '” để bắt đầu.'}</div></div>`
  }</div>`;

  $('#view').querySelectorAll('[data-e]').forEach(b => (b.onclick = () => openForm(rows.find(r => String(r.id) === b.dataset.e))));
  $('#view').querySelectorAll('[data-d]').forEach(b => (b.onclick = () => askDelete(b.dataset.d)));
  $('#view').querySelectorAll('[data-qtrip]').forEach(b => (b.onclick = () => quickTripStatus(b.dataset.qtrip, b.dataset.qst)));
  $('#view').querySelectorAll('[data-qmnt]').forEach(b => (b.onclick = () => quickMaintStatus(b.dataset.qmnt, b.dataset.qst)));
}

function askDelete(id) {
  lastFocus = document.activeElement;
  $('#cm').textContent = 'Bản ghi sẽ bị xóa khỏi cơ sở dữ liệu PostgreSQL (nếu không có lịch trình/bảo dưỡng đang tham chiếu).';
  $('#confirm').hidden = false;
  $('#cn').focus();
  $('#cy').onclick = async () => {
    $('#confirm').hidden = true;
    try {
      await api(cur + '/' + id, 'DELETE');
      toast('Đã xóa bản ghi thành công');
      load();
    } catch (e) {
      toast(e.message, 1);
    }
  };
}

function field([k, label, type, a, b], v) {
  const req = (type === 'ref' ? b : a) ? 'required' : '';
  const full = type === 'textarea' ? 'full' : '';
  let input;
  if (type === 'select') {
    input = `<select id="f-${k}" name="${k}" ${req}>${b.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  } else if (type === 'ref') {
    const opts = L[a].map(o => {
      const text = a === 'vehicles' ? `${o.plate_number} – ${o.brand_model} (${o.status})` : `${o.driver_code} – ${o.full_name} (Hạng ${o.license_class})`;
      return `<option value="${o.id}" ${String(o.id) === String(v) ? 'selected' : ''}>${esc(text)}</option>`;
    }).join('');
    input = `<select id="f-${k}" name="${k}" ${req}><option value="">— Chọn —</option>${opts}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="f-${k}" name="${k}" rows="2">${esc(v)}</textarea>`;
  } else {
    let val = v ?? '';
    if (type === 'datetime-local' && val) val = String(val).slice(0, 16);
    if (type === 'date' && val) val = String(val).slice(0, 10);
    input = `<input id="f-${k}" name="${k}" type="${type}" value="${esc(val)}" ${req} ${type === 'number' ? 'step="any" min="0"' : ''}>`;
  }
  return `<label class="${full}" for="f-${k}"><span>${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</span>${input}</label>`;
}

function openForm(r) {
  lastFocus = document.activeElement;
  editing = r || null;
  const m = M[cur];
  $('#mt').textContent = (r ? 'Cập nhật ' : 'Thêm mới ') + m.t.toLowerCase();
  $('#mb').innerHTML = m.f.map(f => {
    let defVal = r ? r[f[0]] : '';
    if (!r && f[2] === 'select') defVal = f[4][0];
    if (!r && f[2] === 'date') defVal = new Date().toISOString().slice(0, 10);
    if (!r && f[2] === 'datetime-local') defVal = new Date().toISOString().slice(0, 16);
    return field(f, defVal);
  }).join('');
  $('#modal').hidden = false;
  const first = $('#mb').querySelector('input,select,textarea');
  if (first) first.focus();
}

function closeAll() {
  $('#modal').hidden = true;
  $('#confirm').hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

$('#add').onclick = () => openForm();
$('#mc').onclick = $('#mx').onclick = $('#cn').onclick = closeAll;
document.querySelectorAll('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeAll(); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (!$('#modal').hidden || !$('#confirm').hidden)) closeAll(); });

$('#mf').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#ms');
  btn.disabled = true;
  try {
    const o = Object.fromEntries(new FormData(e.target));
    if (editing) await api(cur + '/' + editing.id, 'PUT', o);
    else await api(cur, 'POST', o);
    $('#modal').hidden = true;
    toast(editing ? 'Đã lưu cập nhật thành công' : 'Đã thêm mới dữ liệu thành công');
    load();
  } catch (er) {
    toast(er.message, 1);
  } finally {
    btn.disabled = false;
  }
};

$('#q').oninput = renderTable;

$('#lf').onsubmit = async e => {
  e.preventDefault();
  const b = $('#lb');
  if (!$('#u').value || !$('#p').value) {
    $('#err').textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu';
    return;
  }
  b.disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#u').value, password: $('#p').value })
    });
    if (r.ok) {
      const data = await r.json();
      token = data.token;
      sessionStorage.setItem('t', token);
      $('#err').textContent = '';
      $('#p').value = '';
      show();
    } else {
      $('#err').textContent = r.status === 429
        ? 'Cảnh báo: Thử đăng nhập quá nhiều lần (HTTP 429 Rate Limit). Vui lòng đợi giây lát!'
        : 'Sai tên đăng nhập hoặc mật khẩu quản trị';
    }
  } catch (_) {
    $('#err').textContent = 'Không kết nối được máy chủ điều độ';
  } finally {
    b.disabled = false;
  }
};

$('#out').onclick = logout;
show();
