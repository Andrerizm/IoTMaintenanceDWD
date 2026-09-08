const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/machines — Summary Mesin & Overall Status Count
router.get('/machines', authenticateToken, async (req, res) => {
  try {
    const { rows: motors } = await db.query('SELECT * FROM motors ORDER BY machine_id ASC, motor_number ASC');

    const summary = {
      total: motors.length,
      normal: motors.filter(m => m.status === 'NORMAL').length,
      warning: motors.filter(m => m.status === 'WARNING').length,
      danger: motors.filter(m => m.status === 'DANGER').length,
      off: motors.filter(m => m.status === 'OFF').length,
      disconnected: motors.filter(m => m.status === 'DISCONNECTED' || m.status === 'ESP_OFFLINE' || m.status === 'SENSOR_DISCONNECTED').length
    };

    // Group by machine dynamically based on db data
    const machineIds = [...new Set(motors.map(m => m.machine_id))];
    const machines = [];
    for (const m of machineIds) {
      const machineMotors = motors.filter(mtr => mtr.machine_id === m);
      const dangerCount = machineMotors.filter(mtr => mtr.status === 'DANGER').length;
      const warningCount = machineMotors.filter(mtr => mtr.status === 'WARNING').length;
      const offCount = machineMotors.filter(mtr => mtr.status === 'OFF').length;

      machines.push({
        machineId: m,
        motorCount: machineMotors.length,
        dangerCount,
        warningCount,
        offCount,
        hasAnomaly: dangerCount > 0 || warningCount > 0
      });
    }

    res.json({
      success: true,
      summary,
      machines
    });
  } catch (err) {
    console.error('Get machines error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data mesin.' });
  }
});

// GET /api/machines/:machineId/motors
router.get('/machines/:machineId/motors', authenticateToken, async (req, res) => {
  try {
    const machineId = Number(req.params.machineId);
    const { rows: motors } = await db.query(
      'SELECT * FROM motors WHERE machine_id = $1 ORDER BY motor_number ASC',
      [machineId]
    );

    res.json({
      success: true,
      machineId,
      motors: motors.map(m => ({
        id: m.id,
        machineId: m.machine_id,
        motorId: m.motor_number,
        name: m.name,
        nominal: m.nominal_cap,
        current: m.current,
        voltage: m.voltage,
        capacitance: m.capacitance,
        power: m.power,
        pf: m.pf,
        error: m.error,
        espTemp: m.esp_temp || 0,
        motorStatus: m.motor_status,
        status: m.status,
        updatedAt: m.updated_at
      }))
    });
  } catch (err) {
    console.error('Get machine motors error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data motor mesin.' });
  }
});

// GET /api/motors/:id
router.get('/motors/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM motors WHERE id = $1', [req.params.id]);
    const m = rows[0];

    if (!m) {
      return res.status(404).json({ success: false, error: 'Motor tidak ditemukan.' });
    }

    res.json({
      success: true,
      motor: {
        id: m.id,
        machineId: m.machine_id,
        motorId: m.motor_number,
        name: m.name,
        nominal: m.nominal_cap,
        current: m.current,
        voltage: m.voltage,
        capacitance: m.capacitance,
        power: m.power,
        pf: m.pf,
        error: m.error,
        espTemp: m.esp_temp || 0,
        motorStatus: m.motor_status,
        status: m.status,
        updatedAt: m.updated_at
      }
    });
  } catch (err) {
    console.error('Get motor detail error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil detail motor.' });
  }
});

// GET /api/motors/:id/history
router.get('/motors/:id/history', authenticateToken, async (req, res) => {
  try {
    const motorId = req.params.id;
    const { from, to } = req.query;
    const MAX_POINTS = 500;

    const conditions = ['motor_id = $1'];
    const params = [motorId];

    if (from) {
      params.push(from);
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`timestamp <= $${params.length}`);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Ambil data terbaru (DESC) lalu balik urutannya (ASC) agar grafik kronologis
    const query = `SELECT * FROM (
      SELECT * FROM telemetry_history ${whereClause}
      ORDER BY timestamp DESC LIMIT ${MAX_POINTS}
    ) sub ORDER BY timestamp ASC`;

    const { rows: history } = await db.query(query, params);

    res.json({
      success: true,
      motorId,
      count: history.length,
      history: history.map(h => ({
        timestamp: h.timestamp,
        capacitance: h.capacitance,
        current: h.current,
        voltage: h.voltage,
        power: h.power,
        pf: h.pf,
        espTemp: h.esp_temp || 0
      }))
    });
  } catch (err) {
    console.error('Get motor history error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil riwayat telemetri motor.' });
  }
});

// POST /api/motors — Admin & Supervisor Only
router.post('/motors', authenticateToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const { machineId, motorNo, name, nominal } = req.body;

  if (!machineId || !motorNo) {
    return res.status(400).json({ success: false, error: 'Nomor Mesin dan Nomor Motor wajib diisi.' });
  }

  const mId = parseInt(machineId, 10);
  const mNo = parseInt(motorNo, 10);
  const id = `${mId}-${mNo}`;
  const motorName = name || `Motor Stirrer ${String(mNo).padStart(2, '0')}`;
  const nomCap = parseFloat(nominal) || 2.0;
  const updatedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });

  try {
    await db.query(
      `INSERT INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, power, pf, capacitance, error, esp_temp, motor_status, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, $6, 0, 25.0, 'OFF', 'OFF', $7)`,
      [id, mId, mNo, motorName, nomCap, nomCap, updatedAt]
    );

    logAudit(req, 'MOTOR_CREATE', `Menambahkan motor baru: ${motorName} (ID: ${id})`);

    res.json({
      success: true,
      message: `Motor ${motorName} (ID: ${id}) berhasil ditambahkan.`,
      motor: { id, machineId: mId, motorNo: mNo, name: motorName, nominal: nomCap }
    });
  } catch (err) {
    if (err.code === '23505' || err.message.includes('unique') || err.message.includes('duplicate')) {
      return res.status(400).json({ success: false, error: `Motor dengan ID '${id}' sudah ada di database.` });
    }
    console.error('Create motor error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/motors/:id — Admin Only
router.delete('/motors/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  const motorId = req.params.id;
  try {
    const result = await db.query('DELETE FROM motors WHERE id = $1', [motorId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: `Motor ID '${motorId}' tidak ditemukan.` });
    }

    logAudit(req, 'MOTOR_DELETE', `Menghapus motor ID: ${motorId}`);
    res.json({ success: true, message: `Motor '${motorId}' berhasil dihapus.` });
  } catch (err) {
    console.error('Delete motor error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
