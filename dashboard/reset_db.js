const db = require('./server/database');

async function reset() {
  try {
    await db.query('DELETE FROM telemetry_history;');
    await db.query(`
      UPDATE motors 
      SET current = 0, voltage = 0, capacitance = 0, power = 0, pf = 0, error = 0, motor_status = 'OFF', status = 'OFF';
    `);
    console.log('[MySQL] Database reset to empty telemetry state successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[MySQL] Error resetting database:', err.message);
    process.exit(1);
  }
}

// Berikan jeda inisialisasi pool
setTimeout(reset, 1200);
