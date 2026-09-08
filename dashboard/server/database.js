const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('./config');

const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20, // Max concurrent connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper query function
const db = {
  pool,
  query: (text, params) => pool.query(text, params),
};

// Inisialisasi & Verifikasi Skema Tabel & Data Awal
async function initDatabase() {
  try {
    const test = await pool.query('SELECT current_database(), current_user;');
    console.log(`[PostgreSQL] Terhubung ke database "${test.rows[0].current_database}" sebagai user "${test.rows[0].current_user}"`);

    // 1. Pastikan Tabel Ada
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Viewer',
        display_name VARCHAR(150) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS motors (
        id VARCHAR(50) PRIMARY KEY,
        machine_id INT NOT NULL,
        motor_number INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        nominal_cap DOUBLE PRECISION NOT NULL DEFAULT 2.0,
        current DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        voltage DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        capacitance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        power DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        pf DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        error DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        esp_temp DOUBLE PRECISION DEFAULT 0.0,
        motor_status VARCHAR(20) NOT NULL DEFAULT 'OFF',
        status VARCHAR(20) NOT NULL DEFAULT 'OFF',
        updated_at VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_history (
        id BIGSERIAL PRIMARY KEY,
        motor_id VARCHAR(50) NOT NULL,
        capacitance DOUBLE PRECISION NOT NULL,
        current DOUBLE PRECISION NOT NULL,
        voltage DOUBLE PRECISION NOT NULL,
        power DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        pf DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        esp_temp DOUBLE PRECISION DEFAULT 0.0,
        timestamp VARCHAR(100) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_motor_ts ON telemetry_history(motor_id, timestamp);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(100) PRIMARY KEY,
        timestamp VARCHAR(100) NOT NULL,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 2. Seed Default Settings
    await pool.query(`
      INSERT INTO settings (key, value) VALUES
        ('warning_limit', '5.0'),
        ('danger_limit', '10.0'),
        ('esp_temp_warning', '70.0'),
        ('esp_temp_danger', '80.0')
      ON CONFLICT (key) DO NOTHING;
    `);

    // 3. Seed Default Users
    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(userCount.rows[0].count, 10) === 0) {
      const defaultUsers = [
        { username: 'admin', email: 'admin@polban.ac.id', pass: 'admin123', role: 'Admin', name: 'Administrator Polban' },
        { username: 'maint_shift', email: 'shift@polban.ac.id', pass: 'shift123', role: 'Maintenance Shift', name: 'Teknisi Maintenance Shift' },
        { username: 'maint_nonshift', email: 'nonshift@bekaert.com', pass: 'nonshift123', role: 'Maintenance Non Shift', name: 'Teknisi Maintenance Non-Shift' },
        { username: 'operator', email: 'operator@polban.ac.id', pass: 'op123', role: 'Operator', name: 'Operator Lapangan' },
        { username: 'supervisor', email: 'supervisor@bekaert.com', pass: 'spv123', role: 'Supervisor', name: 'Supervisor Maintenance' },
        { username: 'manajer', email: 'manager@bekaert.com', pass: 'mgr123', role: 'Manajer', name: 'Manajer Plant Bekaert' }
      ];

      for (const u of defaultUsers) {
        const hash = bcrypt.hashSync(u.pass, 10);
        await pool.query(
          `INSERT INTO users (username, email, password_hash, role, display_name, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (username) DO NOTHING;`,
          [u.username, u.email, hash, u.role, u.name]
        );
      }
      console.log('[PostgreSQL] Seed default users selesai (admin, operator, dll).');
    }

    // 4. Seed Default Motors (1 Mesin x 2 Motor)
    const motorCount = await pool.query('SELECT COUNT(*) as count FROM motors');
    if (parseInt(motorCount.rows[0].count, 10) === 0) {
      const now = new Date();
      const timeStr = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });

      for (let i = 1; i <= 2; i++) {
        const id = `1-${i}`;
        const name = `MTR-${String(i).padStart(2, '0')}`;
        await pool.query(
          `INSERT INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, capacitance, power, pf, error, motor_status, status, updated_at)
           VALUES ($1, $2, $3, $4, 2.0, 0, 0, 0, 0, 0, 0, 'OFF', 'OFF', $5)
           ON CONFLICT (id) DO NOTHING;`,
          [id, 1, i, name, timeStr]
        );
      }
      console.log('[PostgreSQL] Seed default motors selesai (MTR-01, MTR-02).');
    }

  } catch (err) {
    console.error('[PostgreSQL] Gagal inisialisasi database:', err.message);
  }
}

// Inisialisasi saat pertama di-load
initDatabase();

db.initDatabase = initDatabase;
module.exports = db;
