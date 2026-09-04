const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

const db = new DatabaseSync(config.DB_PATH);

// Enable WAL mode & busy timeout for high-concurrency disk I/O performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Inisialisasi Skema Tabel Database
function initDatabase() {
  // 1. Tabel Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Viewer',
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 2. Tabel Motors
  db.exec(`
    CREATE TABLE IF NOT EXISTS motors (
      id TEXT PRIMARY KEY,
      machine_id INTEGER NOT NULL,
      motor_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      nominal_cap REAL NOT NULL DEFAULT 2.0,
      current REAL NOT NULL,
      voltage REAL NOT NULL,
      capacitance REAL NOT NULL,
      power REAL NOT NULL DEFAULT 0,
      pf REAL NOT NULL DEFAULT 0,
      error REAL NOT NULL,
      motor_status TEXT NOT NULL DEFAULT 'ON',
      status TEXT NOT NULL DEFAULT 'NORMAL',
      updated_at TEXT NOT NULL
    );
  `);

  // 3. Tabel Telemetry History
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      motor_id TEXT NOT NULL,
      capacitance REAL NOT NULL,
      current REAL NOT NULL,
      voltage REAL NOT NULL,
      power REAL NOT NULL DEFAULT 0,
      pf REAL NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_motor_ts ON telemetry_history(motor_id, timestamp);
  `);

  // 4. Tabel Audit Logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT
    );
  `);

  // 5. Tabel Settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate existing tables
  try { db.exec('ALTER TABLE motors ADD COLUMN power REAL NOT NULL DEFAULT 0;'); } catch(e){}
  try { db.exec('ALTER TABLE motors ADD COLUMN pf REAL NOT NULL DEFAULT 0;'); } catch(e){}
  try { db.exec('ALTER TABLE motors ADD COLUMN esp_temp REAL DEFAULT 0.0;'); } catch(e){}
  try { db.exec('ALTER TABLE telemetry_history ADD COLUMN power REAL NOT NULL DEFAULT 0;'); } catch(e){}
  try { db.exec('ALTER TABLE telemetry_history ADD COLUMN pf REAL NOT NULL DEFAULT 0;'); } catch(e){}
  try { db.exec('ALTER TABLE telemetry_history ADD COLUMN esp_temp REAL DEFAULT 0.0;'); } catch(e){}

  seedDefaultUsers();
  seedDefaultMotors();
  seedDefaultSettings();
}

function seedDefaultSettings() {
  const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertStmt.run('warning_limit', '5.0');
  insertStmt.run('danger_limit', '10.0');
  insertStmt.run('esp_temp_warning', '70.0');
  insertStmt.run('esp_temp_danger', '80.0');
}

// Seed User Bekaert & Polban Default
function seedDefaultUsers() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM users');
  const result = countStmt.get();
  if (result.count > 0) return;

  const defaultUsers = [
    { username: 'admin', email: 'admin@polban.ac.id', pass: 'admin123', role: 'Admin', name: 'Administrator Polban' },
    { username: 'maint_shift', email: 'shift@polban.ac.id', pass: 'shift123', role: 'Maintenance Shift', name: 'Teknisi Maintenance Shift' },
    { username: 'maint_nonshift', email: 'nonshift@bekaert.com', pass: 'nonshift123', role: 'Maintenance Non Shift', name: 'Teknisi Maintenance Non-Shift' },
    { username: 'operator', email: 'operator@polban.ac.id', pass: 'op123', role: 'Operator', name: 'Operator Lapangan' },
    { username: 'supervisor', email: 'supervisor@bekaert.com', pass: 'spv123', role: 'Supervisor', name: 'Supervisor Maintenance' },
    { username: 'manajer', email: 'manager@bekaert.com', pass: 'mgr123', role: 'Manajer', name: 'Manajer Plant Bekaert' }
  ];

  const insertStmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, display_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const u of defaultUsers) {
    const hash = bcrypt.hashSync(u.pass, 10);
    insertStmt.run(u.username, u.email, hash, u.role, u.name, now);
  }
}

// Seed 30 Mesin x 10 Motor (300 Motor Kapasitor)
function seedDefaultMotors() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM motors');
  const result = countStmt.get();
  if (result.count > 0) return;

  const insertMotor = db.prepare(`
    INSERT INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, capacitance, power, pf, error, motor_status, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHistory = db.prepare(`
    INSERT INTO telemetry_history (motor_id, capacitance, current, voltage, power, pf, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  const MACHINE_COUNT = 1;
  const MOTORS_PER_MACHINE = 2;
  const NOMINAL = 2.0;
  const FREQ = 50;

  for (let m = 1; m <= MACHINE_COUNT; m++) {
    for (let i = 1; i <= MOTORS_PER_MACHINE; i++) {
      const id = `${m}-${i}`;
      const name = `MTR-${String(i).padStart(2, '0')}`;
      const voltage = 0;
      const current = 0;
      const estimatedCap = 0;
      const power = 0;
      const pf = 0;
      const error = 0;
      const motorStatus = 'OFF';
      
      let status = 'OFF';

      const timeStr = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
      insertMotor.run(id, m, i, name, NOMINAL, current, voltage, estimatedCap, power, pf, error, motorStatus, status, timeStr);

      // Tidak ada data historis awal, menunggu ESP32

    }
  }
}

// Migrasi: Tambah motor baru jika belum ada (untuk database yang sudah ada sebelumnya)
function migrateAddMissingMotors() {
  const MACHINE_COUNT = 1;
  const MOTORS_PER_MACHINE = 2;
  const NOMINAL = 2.0;
  const now = new Date();

  const insertMotor = db.prepare(`
    INSERT OR IGNORE INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, capacitance, power, pf, error, motor_status, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let m = 1; m <= MACHINE_COUNT; m++) {
    for (let i = 1; i <= MOTORS_PER_MACHINE; i++) {
      const id = `${m}-${i}`;
      const name = `MTR-${String(i).padStart(2, '0')}`;
      const timeStr = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
      insertMotor.run(id, m, i, name, NOMINAL, 0, 0, 0, 0, 0, 0, 'OFF', 'OFF', timeStr);
    }
  }
}

initDatabase();
migrateAddMissingMotors();

module.exports = db;
