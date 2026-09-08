const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

let pool = null;

// Helper konversi parameter query PostgreSQL ($1, $2, ...) ke MySQL (?) dan escape reserved keyword
function normalizeQuery(sql, params = []) {
  let finalSql = sql;

  // Escape nama kolom 'key' pada tabel settings jika belum di-backticks
  finalSql = finalSql
    .replace(/\bSELECT\s+key\b/gi, 'SELECT `key`')
    .replace(/\b,\s*key\b/gi, ', `key`')
    .replace(/\bsettings\s*\(\s*key\b/gi, 'settings (`key`')
    .replace(/\bkey\s*=/gi, '`key` =');

  let finalParams = params || [];
  if (/\$\d+/.test(finalSql) && params && params.length > 0) {
    finalParams = [];
    finalSql = finalSql.replace(/\$(\d+)/g, (match, p1) => {
      const idx = parseInt(p1, 10) - 1;
      finalParams.push(params[idx] !== undefined ? params[idx] : null);
      return '?';
    });
  }

  return { sql: finalSql, params: finalParams };
}

// Helper wrapper query untuk kompatibilitas seragam ({ rows, rowCount, insertId })
const db = {
  get pool() {
    return pool;
  },

  query: async (text, params = []) => {
    if (!pool) {
      throw new Error('[MySQL] Pool database belum diinisialisasi atau koneksi gagal.');
    }
    const { sql: finalSql, params: finalParams } = normalizeQuery(text, params);
    const [res] = await pool.query(finalSql, finalParams);

    if (Array.isArray(res)) {
      return {
        rows: res,
        rowCount: res.length,
        insertId: 0
      };
    }

    return {
      rows: [],
      rowCount: res.affectedRows || 0,
      insertId: res.insertId || 0
    };
  }
};

// Inisialisasi & Verifikasi Skema Tabel & Data Awal
async function initDatabase() {
  try {
    // 1. Pastikan Database MySQL ada (buat otomatis jika belum ada)
    const bootstrapConn = await mysql.createConnection({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD
    });

    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await bootstrapConn.end();

    // 2. Buat Connection Pool utama ke database yang sudah dipastikan ada
    pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      decimalNumbers: true,
      timezone: '+00:00'
    });

    // Wrapper connect() untuk mendukung transaksi (misal: settingsRoutes & simulator)
    pool.connect = async () => {
      const conn = await pool.getConnection();
      return {
        query: async (text, params = []) => {
          const { sql: finalSql, params: finalParams } = normalizeQuery(text, params);
          const [res] = await conn.query(finalSql, finalParams);
          if (Array.isArray(res)) {
            return { rows: res, rowCount: res.length, insertId: 0 };
          }
          return { rows: [], rowCount: res.affectedRows || 0, insertId: res.insertId || 0 };
        },
        release: () => conn.release()
      };
    };

    const [testRows] = await pool.query('SELECT DATABASE() AS db_name, CURRENT_USER() AS db_user;');
    console.log(`[MySQL] Terhubung ke database "${testRows[0].db_name}" sebagai user "${testRows[0].db_user}"`);

    // 3. Pastikan Tabel Ada
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Viewer',
        display_name VARCHAR(150) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS motors (
        id VARCHAR(50) PRIMARY KEY,
        machine_id INT NOT NULL,
        motor_number INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        nominal_cap DOUBLE NOT NULL DEFAULT 2.0,
        current DOUBLE NOT NULL DEFAULT 0.0,
        voltage DOUBLE NOT NULL DEFAULT 0.0,
        capacitance DOUBLE NOT NULL DEFAULT 0.0,
        power DOUBLE NOT NULL DEFAULT 0.0,
        pf DOUBLE NOT NULL DEFAULT 0.0,
        error DOUBLE NOT NULL DEFAULT 0.0,
        esp_temp DOUBLE DEFAULT 0.0,
        motor_status VARCHAR(20) NOT NULL DEFAULT 'OFF',
        status VARCHAR(20) NOT NULL DEFAULT 'OFF',
        updated_at VARCHAR(100) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS telemetry_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        motor_id VARCHAR(50) NOT NULL,
        capacitance DOUBLE NOT NULL,
        current DOUBLE NOT NULL,
        voltage DOUBLE NOT NULL,
        power DOUBLE NOT NULL DEFAULT 0.0,
        pf DOUBLE NOT NULL DEFAULT 0.0,
        esp_temp DOUBLE DEFAULT 0.0,
        timestamp VARCHAR(100) NOT NULL,
        INDEX idx_telemetry_motor_ts (motor_id, timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(100) PRIMARY KEY,
        timestamp VARCHAR(100) NOT NULL,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Seed Default Settings
    await pool.query(`
      INSERT IGNORE INTO settings (\`key\`, value) VALUES
        ('warning_limit', '5.0'),
        ('danger_limit', '10.0'),
        ('esp_temp_warning', '70.0'),
        ('esp_temp_danger', '80.0');
    `);

    // 5. Seed Default Users
    const [userCountRows] = await pool.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(userCountRows[0].count, 10) === 0) {
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
          `INSERT IGNORE INTO users (username, email, password_hash, role, display_name, created_at)
           VALUES (?, ?, ?, ?, ?, NOW());`,
          [u.username, u.email, hash, u.role, u.name]
        );
      }
      console.log('[MySQL] Seed default users selesai (admin, operator, dll).');
    }

    // 6. Seed Default Motors (1 Mesin x 2 Motor)
    const [motorCountRows] = await pool.query('SELECT COUNT(*) as count FROM motors');
    if (parseInt(motorCountRows[0].count, 10) === 0) {
      const now = new Date();
      const timeStr = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });

      for (let i = 1; i <= 2; i++) {
        const id = `1-${i}`;
        const name = `MTR-${String(i).padStart(2, '0')}`;
        await pool.query(
          `INSERT IGNORE INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, capacitance, power, pf, error, motor_status, status, updated_at)
           VALUES (?, ?, ?, ?, 2.0, 0, 0, 0, 0, 0, 0, 'OFF', 'OFF', ?);`,
          [id, 1, i, name, timeStr]
        );
      }
      console.log('[MySQL] Seed default motors selesai (MTR-01, MTR-02).');
    }

  } catch (err) {
    console.error('[MySQL] Gagal inisialisasi database:', err.message);
  }
}

// Inisialisasi saat pertama di-load
initDatabase();

db.initDatabase = initDatabase;
module.exports = db;
