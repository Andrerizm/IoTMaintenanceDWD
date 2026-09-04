const express = require('express');
const router = express.Router();
const db = require('../database');
const config = require('../config');
const { broadcastSSE } = require('../services/simulator');

// POST /api/telemetry/ingest — Receiving Endpoint dari Hardware Sensor PZEM-004T (ESP32 / IoT Node)
router.post('/ingest', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (apiKey !== config.HARDWARE_API_KEY) {
    return res.status(401).json({ success: false, error: 'API Key hardware tidak valid.' });
  }

  const { motorId, voltage, current, power = 0, pf = 0, frequency = 50, motorStatus = 'ON', espTemp = 0.0 } = req.body;

  if (!motorId || voltage === undefined || current === undefined) {
    return res.status(400).json({ success: false, error: 'Parameter motorId, voltage, dan current wajib dikirim.' });
  }

  // Hitung estimasi kapasitansi & error
  const NOMINAL = 2.0; // 2 µF
  let estimatedCap = 0;
  if (voltage > 0 && current > 0) {
    estimatedCap = (current / (2 * Math.PI * frequency * voltage)) * 1000000;
  }
  const error = (estimatedCap < NOMINAL && NOMINAL > 0) ? ((NOMINAL - estimatedCap) / NOMINAL) * 100 : 0;

  let warningLimit = 5.0;
  let dangerLimit = 10.0;
  try {
    const sRows = db.prepare('SELECT key, value FROM settings').all();
    sRows.forEach(r => {
      if (r.key === 'warning_limit') warningLimit = parseFloat(r.value) || 5.0;
      else if (r.key === 'danger_limit') dangerLimit = parseFloat(r.value) || 10.0;
    });
  } catch (e) {}

  let status = 'NORMAL';
  if (motorStatus === 'SENSOR_DISCONNECTED') status = 'SENSOR_DISCONNECTED';
  else if (motorStatus === 'ESP_OFFLINE' || motorStatus === 'DISCONNECTED') status = 'ESP_OFFLINE';
  else if (motorStatus === 'OFF') status = 'OFF';
  else if (error >= dangerLimit) status = 'DANGER';
  else if (error >= warningLimit) status = 'WARNING';

  const updatedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
  const timestampIso = new Date().toISOString();

  // Update tabel motors
  const updateStmt = db.prepare(`
    UPDATE motors
    SET current = ?, voltage = ?, capacitance = ?, power = ?, pf = ?, error = ?, esp_temp = ?, motor_status = ?, status = ?, updated_at = ?
    WHERE id = ?
  `);
  const result = updateStmt.run(current, voltage, estimatedCap, power, pf, error, espTemp, motorStatus, status, updatedAt, motorId);

  if (result.changes === 0) {
    const parseMatch = String(motorId).match(/^(\d+)-(\d+)$/);
    const machineId = parseMatch ? parseInt(parseMatch[1]) : 1;
    const motorNo = parseMatch ? parseInt(parseMatch[2]) : 1;
    const defaultName = `Motor Stirrer ${String(motorNo).padStart(2, '0')}`;

    const insertStmt = db.prepare(`
      INSERT INTO motors (id, machine_id, name, nominal, current, voltage, power, pf, capacitance, error, esp_temp, motor_status, status, updated_at)
      VALUES (?, ?, ?, 2.0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(motorId, machineId, defaultName, current, voltage, power, pf, estimatedCap, error, espTemp, motorStatus, status, updatedAt);
  }

  // Insert ke telemetry history
  const historyStmt = db.prepare(`
    INSERT INTO telemetry_history (motor_id, capacitance, current, voltage, power, pf, esp_temp, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  historyStmt.run(motorId, Number(estimatedCap.toFixed(2)), Number(current.toFixed(3)), Number(voltage.toFixed(1)), Number(power.toFixed(2)), Number(pf.toFixed(2)), Number(espTemp.toFixed(1)), timestampIso);

  // Broadcast data baru ke semua browser via SSE
  const updateData = {
    motorId,
    voltage,
    current,
    capacitance: estimatedCap,
    power,
    pf,
    error,
    espTemp: Number(espTemp.toFixed(1)),
    motorStatus,
    status,
    updatedAt
  };

  broadcastSSE('telemetry_update', updateData);

  res.json({
    success: true,
    message: `Data telemetry motor ${motorId} berhasil diterima & diperbarui.`,
    data: updateData
  });
});

// GET /api/telemetry/stream — Server-Sent Events (SSE) Live Stream Endpoint
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('retry: 3000\n\n');

  // Simpan client connection
  const clients = require('../services/simulator').sseClients;
  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

module.exports = router;
