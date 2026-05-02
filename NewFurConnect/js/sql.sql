CREATE DATABASE IF NOT EXISTS furconnect_db;
USE furconnect_db;

-- =========================
-- USERS / LOGIN
-- =========================

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'staff', 'patient') NOT NULL DEFAULT 'staff',
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default admin account
-- username: admin
-- password: admin123

INSERT INTO users (username, password_hash, role, full_name, email, is_active)
VALUES (
  'admin',
  '$2y$12$KoNR7zZ9Dwhn.T/Z6zuK4e2UoXiBzXE1Eoh5qdrxi4/78t8yQY38e',
  'admin',
  'System Administrator',
  'admin@furconnect.local',
  1
);

-- =========================
-- EMPLOYEES
-- Optional muna ito, pero ready kapag binalik ninyo Employees module
-- =========================

CREATE TABLE employees (
  employee_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  employee_no VARCHAR(50) UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  position VARCHAR(100),
  contact_number VARCHAR(30),
  email VARCHAR(150),
  address TEXT,
  status ENUM('Active', 'Inactive', 'Archived') DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_employees_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- =========================
-- PATIENT / PET RECORDS
-- Main table for Pet Records + QR mobile
-- =========================

CREATE TABLE patient_records (
  patient_id INT AUTO_INCREMENT PRIMARY KEY,

  -- ito yung pwede mong ipakita as P-0001 / P-12345
  record_code VARCHAR(50) UNIQUE,

  pet_name VARCHAR(100) NOT NULL,
  pet_species VARCHAR(100) NOT NULL,
  breed VARCHAR(100),
  age VARCHAR(20),
  age_unit ENUM('Days', 'Weeks', 'Months', 'Years') DEFAULT 'Years',
  gender ENUM('Male', 'Female') NULL,
  weight DECIMAL(10,2),

  owner_name VARCHAR(150) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  email VARCHAR(150),

  notes TEXT,
  pet_image LONGTEXT,

  -- QR mobile token
  -- ito ang ilalagay sa QR URL imbes na direct ID
  qr_token VARCHAR(64) UNIQUE,

  -- optional patient login for QR mobile account
  patient_username VARCHAR(80) UNIQUE,
  patient_password_hash VARCHAR(255),

  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  archived_at DATETIME NULL,

  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_patient_created_by
    FOREIGN KEY (created_by)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- Auto-generate record_code and qr_token kapag walang nilagay
DELIMITER $$

CREATE TRIGGER trg_patient_records_before_insert
BEFORE INSERT ON patient_records
FOR EACH ROW
BEGIN
  IF NEW.qr_token IS NULL OR NEW.qr_token = '' THEN
    SET NEW.qr_token = REPLACE(UUID(), '-', '');
  END IF;

  IF NEW.record_code IS NULL OR NEW.record_code = '' THEN
    SET NEW.record_code = CONCAT('P-', LPAD((SELECT AUTO_INCREMENT
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'patient_records'), 5, '0'));
  END IF;
END$$

DELIMITER ;

-- =========================
-- APPOINTMENTS
-- For registration, appointments page, appointment logs, dashboard upcoming
-- =========================

CREATE TABLE appointments (
  appointment_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,

  appointment_type ENUM(
    'Grooming',
    'Vaccination',
    'Deworming',
    'Surgery',
    'Check-up',
    'Consultation',
    'Others'
  ) NOT NULL,

  appointment_date DATE NOT NULL,

  -- Pwede single time: 09:00
  -- Pwede multiple slot string: 09:00,09:30,10:00
  appointment_time VARCHAR(100) NOT NULL,

  appointment_status ENUM(
    'Pending',
    'Confirmed',
    'Completed',
    'Cancelled',
    'Rebooked',
    'Archived'
  ) NOT NULL DEFAULT 'Pending',

  notes TEXT,

  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  archived_at DATETIME NULL,

  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_appointments_patient
    FOREIGN KEY (patient_id)
    REFERENCES patient_records(patient_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_appointments_created_by
    FOREIGN KEY (created_by)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- =========================
-- ONLINE / REBOOKING REQUESTS
-- For dashboard patient rebooking requests
-- =========================

CREATE TABLE appointment_requests (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,

  request_type ENUM('New Appointment', 'Rebooking', 'Cancellation') DEFAULT 'New Appointment',
  requested_date DATE,
  requested_time VARCHAR(100),
  requested_service VARCHAR(100),

  message TEXT,
  request_status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') DEFAULT 'Pending',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_requests_patient
    FOREIGN KEY (patient_id)
    REFERENCES patient_records(patient_id)
    ON DELETE CASCADE
);

-- =========================
-- INVENTORY
-- For inventory page + low stock dashboard
-- =========================

CREATE TABLE inventory_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  item_name VARCHAR(150) NOT NULL,
  item_description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,

  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(50) NOT NULL,

  expiration_date DATE NULL,

  status ENUM('In Stock', 'Low Stock', 'Out of Stock') DEFAULT 'In Stock',
  low_stock_limit DECIMAL(10,2) NOT NULL DEFAULT 5,

  is_archived TINYINT(1) NOT NULL DEFAULT 0,

  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_inventory_created_by
    FOREIGN KEY (created_by)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- Auto-update inventory status based on quantity
DELIMITER $$

CREATE TRIGGER trg_inventory_before_insert
BEFORE INSERT ON inventory_items
FOR EACH ROW
BEGIN
  IF NEW.quantity <= 0 THEN
    SET NEW.status = 'Out of Stock';
  ELSEIF NEW.quantity <= NEW.low_stock_limit THEN
    SET NEW.status = 'Low Stock';
  ELSE
    SET NEW.status = 'In Stock';
  END IF;
END$$

CREATE TRIGGER trg_inventory_before_update
BEFORE UPDATE ON inventory_items
FOR EACH ROW
BEGIN
  IF NEW.quantity <= 0 THEN
    SET NEW.status = 'Out of Stock';
  ELSEIF NEW.quantity <= NEW.low_stock_limit THEN
    SET NEW.status = 'Low Stock';
  ELSE
    SET NEW.status = 'In Stock';
  END IF;
END$$

DELIMITER ;

-- =========================
-- INVENTORY LOGS
-- For tracking add/remove/update stock
-- =========================

CREATE TABLE inventory_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  action_type ENUM('Added', 'Updated', 'Removed', 'Restocked', 'Used') NOT NULL,
  quantity_before DECIMAL(10,2),
  quantity_after DECIMAL(10,2),
  remarks TEXT,
  performed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_inventory_logs_item
    FOREIGN KEY (item_id)
    REFERENCES inventory_items(item_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_inventory_logs_user
    FOREIGN KEY (performed_by)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- =========================
-- QR ACCESS LOGS
-- Para makita kung kailan na-scan yung QR
-- =========================

CREATE TABLE qr_access_logs (
  qr_log_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  qr_token VARCHAR(64) NOT NULL,
  ip_address VARCHAR(50),
  device_info TEXT,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_qr_logs_patient
    FOREIGN KEY (patient_id)
    REFERENCES patient_records(patient_id)
    ON DELETE CASCADE
);

-- =========================
-- ACTIVITY LOGS
-- For dashboard recent activity
-- =========================

CREATE TABLE activity_logs (
  activity_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  module_name VARCHAR(100) NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_activity_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

-- =========================
-- DASHBOARD VIEWS
-- =========================

CREATE VIEW view_upcoming_appointments AS
SELECT
  a.appointment_id,
  p.patient_id,
  p.record_code,
  p.pet_name,
  p.owner_name,
  p.contact_number,
  a.appointment_type,
  a.appointment_date,
  a.appointment_time,
  a.appointment_status,
  a.notes
FROM appointments a
INNER JOIN patient_records p
  ON a.patient_id = p.patient_id
WHERE
  a.is_archived = 0
  AND p.is_archived = 0
  AND a.appointment_status IN ('Pending', 'Confirmed', 'Rebooked')
ORDER BY a.appointment_date ASC, a.appointment_time ASC;

CREATE VIEW view_low_stock_inventory AS
SELECT
  item_id,
  item_name,
  category,
  quantity,
  unit,
  expiration_date,
  status
FROM inventory_items
WHERE
  is_archived = 0
  AND status IN ('Low Stock', 'Out of Stock')
ORDER BY quantity ASC;

-- =========================
-- SAMPLE DATA OPTIONAL
-- Pwede mo i-delete ito kung ayaw mo ng sample
-- =========================

INSERT INTO patient_records (
  pet_name,
  pet_species,
  breed,
  age,
  age_unit,
  gender,
  weight,
  owner_name,
  contact_number,
  email,
  notes,
  created_by
)
VALUES (
  'Browny',
  'Dog',
  'Aspin',
  '2',
  'Years',
  'Male',
  12.50,
  'Juan Dela Cruz',
  '09123456789',
  'juan@example.com',
  'No medical notes yet.',
  1
);

INSERT INTO appointments (
  patient_id,
  appointment_type,
  appointment_date,
  appointment_time,
  appointment_status,
  notes,
  created_by
)
VALUES (
  1,
  'Grooming',
  CURDATE(),
  '09:00,09:30,10:00',
  'Confirmed',
  'Sample appointment only.',
  1
);

INSERT INTO inventory_items (
  item_name,
  item_description,
  category,
  quantity,
  unit,
  expiration_date,
  created_by
)
VALUES
(
  'Anti-Rabies Vaccine',
  'Vaccine for rabies prevention',
  'Vaccine',
  4,
  'vials',
  '2026-12-31',
  1
),
(
  'Pet Shampoo',
  'Grooming shampoo for dogs and cats',
  'Grooming',
  12,
  'bottles',
  '2027-01-31',
  1
);