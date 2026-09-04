const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/machines — Summary 30 Mesin & Overall Status Count
router.get('/machines', authenticateToken, (req, res) => {
  const motorsStmt = db.prepare('SELECT * FROM motors ORDER BY machine_id ASC, motor_number ASC');
  const motors = motorsStmt.all();

  const summary = {
    total: motors.length,
    normal: motors.filter(m => m.status === 'NORMAL').length,
    warning: motors.filter(m => m.status === 'WARNING').length,
    danger: motors.filter(m => m.status === 'DANGER').length,
    off: motors.filter(m => m.status === 'OFF').length,
    disconnected: motors.filter(m => m.status === 'DISCONNECTED').length
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
});

// GET /api/machines/:machineId/motors
router.get('/machines/:machineId/motors', authenticateToken, (req, res) => {
  const machineId = Number(req.params.machineId);
  const stmt = db.prepare('SELECT * FROM motors WHERE machine_id = ? ORDER BY motor_number ASC');
  const motors = stmt.all(machineId);

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
      motorStatus: m.motor_status,
      status: m.status,
      updatedAt: m.updated_at
    }))
  });
});

// GET /api/motors/:id
router.get('/motors/:id', authenticateToken, (req, res) => {
  const stmt = db.prepare('SELECT * FROM motors WHERE id = ?');
  const m = stmt.get(req.params.id);

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
      motorStatus: m.motor_status,
      status: m.status,
      updatedAt: m.updated_at
    }
  });
});

// GET /api/motors/:id/history
router.get('/motors/:id/history', authenticateToken, (req, res) => {
  const motorId = req.params.id;
  const { from, to } = req.query;
  const MAX_POINTS = 500;

  let whereClause = 'WHERE motor_id = ?';
  const params = [motorId];

  if (from) {
    whereClause += ' AND timestamp >= ?';
    params.push(from);
  }
  if (to) {
    whereClause += ' AND timestamp <= ?';
    params.push(to);
  }

  // Ambil data terbaru (DESC) lalu balik urutannya (ASC) agar grafik kronologis
  const query = `SELECT * FROM (
    SELECT * FROM telemetry_history ${whereClause}
    ORDER BY timestamp DESC LIMIT ${MAX_POINTS}
  ) sub ORDER BY timestamp ASC`;

  const stmt = db.prepare(query);
  const history = stmt.all(...params);

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
});

// POST /api/motors — Admin & Supervisor Only
router.post('/motors', authenticateToken, requireRole('Admin', 'Supervisor'), (req, res) => {
  const { machineId, motorNo, name, nominal } = req.body;

  if (!machineId || !motorNo) {
    return res.status(400).json({ success: false, error: 'Nomor Mesin dan Nomor Motor wajib diisi.' });
  }

  const mId = parseInt(machineId);
  const mNo = parseInt(motorNo);
  const id = `${mId}-${mNo}`;
  const motorName = name || `Motor Stirrer ${String(mNo).padStart(2, '0')}`;
  const nomCap = parseFloat(nominal) || 2.0;
  const updatedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });

  try {
    const insertStmt = db.prepare(`
      INSERT INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, power, pf, capacitance, error, esp_temp, motor_status, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 0, 25.0, 'OFF', 'OFF', ?)
    `);
    insertStmt.run(id, mId, mNo, motorName, nomCap, nomCap, updatedAt);

    logAudit(req, 'MOTOR_CREATE', `Menambahkan motor baru: ${motorName} (ID: ${id})`);

    res.json({
      success: true,
      message: `Motor ${motorName} (ID: ${id}) berhasil ditambahkan.`,
      motor: { id, machineId: mId, motorNo: mNo, name: motorName, nominal: nomCap }
    });
  } catch (err) {
    if (err.message.includes('UNIQUE') || err.message.includes('PRIMARY')) {
      return res.status(400).json({ success: false, error: `Motor dengan ID '${id}' sudah ada di database.` });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/motors/:id — Admin Only
router.delete('/motors/:id', authenticateToken, requireRole('Admin'), (req, res) => {
  const motorId = req.params.id;
  try {
    const deleteStmt = db.prepare('DELETE FROM motors WHERE id = ?');
    const result = deleteStmt.run(motorId);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: `Motor ID '${motorId}' tidak ditemukan.` });
    }

    logAudit(req, 'MOTOR_DELETE', `Menghapus motor ID: ${motorId}`);
    res.json({ success: true, message: `Motor '${motorId}' berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
