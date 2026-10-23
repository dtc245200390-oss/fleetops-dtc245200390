-- Lược đồ Cơ sở dữ liệu Hệ thống Quản lý Đội xe (FleetOps) – Đề 30 (DTC245200390)

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate_number VARCHAR(20) NOT NULL UNIQUE,
  vehicle_type VARCHAR(50) NOT NULL,
  brand_model VARCHAR(100) NOT NULL,
  capacity_tons NUMERIC(5,1) DEFAULT 0 CHECK (capacity_tons >= 0),
  odometer_km INT NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  next_service_km INT NOT NULL DEFAULT 10000 CHECK (next_service_km >= 0),
  inspection_due DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'Sẵn sàng'
    CHECK (status IN ('Sẵn sàng','Đang chạy','Bảo dưỡng','Ngừng hoạt động'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  driver_code VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  license_class VARCHAR(10) NOT NULL CHECK (license_class IN ('B2','C','D','E','FC')),
  license_no VARCHAR(30),
  license_expiry DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'Sẵn sàng'
    CHECK (status IN ('Sẵn sàng','Đang chạy','Nghỉ phép'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  trip_code VARCHAR(30) NOT NULL UNIQUE,
  vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id INT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  origin VARCHAR(120) NOT NULL,
  destination VARCHAR(120) NOT NULL,
  cargo_note VARCHAR(200),
  distance_km INT NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  depart_time TIMESTAMP NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Đã lên lịch'
    CHECK (status IN ('Đã lên lịch','Đang chạy','Hoàn thành','Đã hủy'))
);

CREATE TABLE IF NOT EXISTS maintenances (
  id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  service_type VARCHAR(80) NOT NULL,
  service_date DATE NOT NULL,
  odometer_km INT NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  cost_vnd NUMERIC(14,0) NOT NULL DEFAULT 0 CHECK (cost_vnd >= 0),
  workshop VARCHAR(140),
  status VARCHAR(30) NOT NULL DEFAULT 'Kế hoạch'
    CHECK (status IN ('Kế hoạch','Đang tại xưởng','Hoàn tất')),
  note TEXT
);

INSERT INTO vehicles (plate_number, vehicle_type, brand_model, capacity_tons, odometer_km, next_service_km, inspection_due, status) VALUES
  ('20C-184.52', 'Xe tải thùng', 'Hino 500 Series FG8JP7A', 8.0, 44200, 50000, '2027-04-15', 'Đang chạy'),
  ('29H-709.18', 'Đầu kéo Container', 'Hyundai Xcient GT 440HP', 32.0, 89150, 90000, '2026-12-20', 'Sẵn sàng'),
  ('20C-219.05', 'Xe tải đông lạnh', 'Isuzu NQR75LE4', 5.0, 31400, 35000, '2027-06-10', 'Sẵn sàng'),
  ('99C-451.88', 'Xe tải thùng', 'Thaco Ollin S720', 7.2, 60350, 60000, '2026-11-05', 'Bảo dưỡng'),
  ('20B-038.66', 'Xe khách 16 chỗ', 'Ford Transit Luxury', 1.5, 22800, 30000, '2027-08-30', 'Sẵn sàng'),
  ('29C-562.90', 'Xe bán tải', 'Toyota Hilux 2.8G 4x4', 0.9, 18900, 20000, '2027-05-12', 'Sẵn sàng');

INSERT INTO drivers (driver_code, full_name, phone, license_class, license_no, license_expiry, status) VALUES
  ('DRV-001', 'Nguyễn Văn Hùng', '0912384510', 'C', '190148209112', '2028-09-15', 'Đang chạy'),
  ('DRV-002', 'Trần Quốc Tuấn', '0984512309', 'FC', '010239481023', '2027-11-20', 'Sẵn sàng'),
  ('DRV-003', 'Phạm Minh Đức', '0973109482', 'C', '190283746519', '2028-03-10', 'Sẵn sàng'),
  ('DRV-004', 'Lê Hoàng Nam', '0904817263', 'D', '190394857104', '2026-11-12', 'Sẵn sàng'),
  ('DRV-005', 'Vũ Đình Khoa', '0968452107', 'B2', '010847261905', '2029-05-01', 'Nghỉ phép');

INSERT INTO schedules (trip_code, vehicle_id, driver_id, origin, destination, cargo_note, distance_km, depart_time, status) VALUES
  ('TRP-2610-01', 1, 1, 'KCN Điềm Thụy (Thái Nguyên)', 'KCN Yên Phong (Bắc Ninh)', 'Linh kiện điện tử đóng pallet', 78, now() - interval '2 hours', 'Đang chạy'),
  ('TRP-2610-02', 2, 2, 'Cảng Đình Vũ (Hải Phòng)', 'KCN Sông Công (Thái Nguyên)', 'Container 40ft hạt nhựa công nghiệp', 165, now() + interval '3 hours', 'Đã lên lịch'),
  ('TRP-2610-03', 3, 3, 'Kho lạnh Đông Anh (Hà Nội)', 'Siêu thị GO! Thái Nguyên', 'Thực phẩm đông lạnh bảo quản -18°C', 68, now() + interval '6 hours', 'Đã lên lịch'),
  ('TRP-2610-04', 5, 4, 'Trụ sở Công ty (TP. Thái Nguyên)', 'Sân bay Nội Bài (Hà Nội)', 'Đưa đón đoàn chuyên gia kỹ thuật', 62, now() - interval '1 day', 'Hoàn thành'),
  ('TRP-2610-05', 6, 3, 'Kho trung chuyển Phổ Yên', 'KCN Quang Châu (Bắc Giang)', 'Phụ tùng cơ khí chính xác', 54, now() - interval '2 days', 'Hoàn thành');

INSERT INTO maintenances (vehicle_id, service_type, service_date, odometer_km, cost_vnd, workshop, status, note) VALUES
  (4, 'Bảo dưỡng định kỳ', CURRENT_DATE, 60350, 4850000, 'Gara Ô tô Trường Hải (Thái Nguyên)', 'Đang tại xưởng', 'Bảo dưỡng mốc 60.000 km: thay dầu động cơ, lọc dầu, lọc nhiên liệu và căn chỉnh má phanh'),
  (2, 'Thay dầu & lọc', CURRENT_DATE + 3, 89150, 3200000, 'Trạm dịch vụ Hyundai Bắc Việt', 'Kế hoạch', 'Đặt lịch thay dầu máy tổng hợp và kiểm tra áp suất lốp đầu kéo mốc 90.000 km'),
  (1, 'Đăng kiểm & bảo hiểm', CURRENT_DATE - 15, 42800, 2650000, 'Trung tâm Đăng kiểm 20-01S', 'Hoàn tất', 'Gia hạn kiểm định an toàn kỹ thuật và phí bảo trì đường bộ 12 tháng'),
  (3, 'Sửa phanh / lốp', CURRENT_DATE - 28, 29900, 3800000, 'Gara Bridgestone Gia Lâm', 'Hoàn tất', 'Thay 02 lốp sau chịu tải và cân bằng động trục sau');
