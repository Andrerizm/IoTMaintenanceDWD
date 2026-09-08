const db = require('../database');

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

let simulationInterval = null;
let intervalSeconds = 6;

function startSimulation(seconds = 6) {
  if (simulationInterval) clearInterval(simulationInterval);
  intervalSeconds = seconds;

  simulationInterval = setInterval(() => {
    simulateCycle().catch(err => console.error('[Simulator] Error:', err.message));
  }, intervalSeconds * 1000);
}

function setSimulationInterval(seconds) {
  startSimulation(seconds);
}

async function simulateCycle() {
  const { rows: motors } = await db.query('SELECT * FROM motors');
  if (motors.length === 0) return;

  const NOMINAL = 2.0;
  const FREQ = 50;
  const now = new Date();
  const timeStr = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
  const timestampIso = now.toISOString();

  let warningLimit = 5.0;
  let dangerLimit = 10.0;
  try {
    const { rows: sRows } = await db.query('SELECT key, value FROM settings');
    sRows.forEach(r => {
      if (r.key === 'warning_limit') warningLimit = parseFloat(r.value) || 5.0;
      else if (r.key === 'danger_limit') dangerLimit = parseFloat(r.value) || 10.0;
    });
  } catch(e){}

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const m of motors) {
      const motorStatus = Math.random() < 0.12 ? 'OFF' : 'ON';
      let current, voltage, capacitance, error, status, pf, power;
      const espTemp = Number((42.0 + Math.random() * 12.0).toFixed(1)); // 42.0 - 54.0 °C

      if (motorStatus === 'OFF') {
        current = 0;
        voltage = m.voltage;
        capacitance = m.capacitance;
        error = m.error;
        pf = 0;
        power = 0;
        status = 'OFF';
      } else {
        capacitance = Math.max(NOMINAL * 0.55, m.capacitance * (1 - Math.random() * 0.004));
        voltage = 215 + Math.random() * 37;
        const expectedCurrent = 2 * Math.PI * FREQ * (capacitance / 1000000) * voltage;
        current = expectedCurrent * (0.975 + Math.random() * 0.05);
        const measuredCap = (current / (2 * Math.PI * FREQ * voltage)) * 1000000;
        error = (measuredCap < NOMINAL) ? ((NOMINAL - measuredCap) / NOMINAL) * 100 : 0;
        pf = Number((0.92 + Math.random() * 0.06).toFixed(2));
        power = Number((voltage * current * pf).toFixed(1));

        if (error >= dangerLimit) status = 'DANGER';
        else if (error >= warningLimit) status = 'WARNING';
        else status = 'NORMAL';

        capacitance = measuredCap;
      }

      await client.query(`
        UPDATE motors
        SET current = $1, voltage = $2, capacitance = $3, power = $4, pf = $5, error = $6, esp_temp = $7, motor_status = $8, status = $9, updated_at = $10
        WHERE id = $11
      `, [current, voltage, capacitance, power, pf, error, espTemp, motorStatus, status, timeStr, m.id]);

      await client.query(`
        INSERT INTO telemetry_history (motor_id, capacitance, current, voltage, power, pf, esp_temp, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [m.id, Number(capacitance.toFixed(2)), Number(current.toFixed(3)), Number(voltage.toFixed(1)), power, pf, espTemp, timestampIso]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during simulation cycle:', err);
  } finally {
    client.release();
  }

  // Broadcast event cycle_complete to all SSE clients
  broadcastSSE('telemetry_tick', { timestamp: timestampIso });
}

module.exports = {
  sseClients,
  broadcastSSE,
  startSimulation,
  setSimulationInterval
};
