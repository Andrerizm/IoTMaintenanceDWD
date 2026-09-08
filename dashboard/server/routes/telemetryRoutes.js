const express = require('express');
const router = express.Router();
const db = require('../database');
const config = require('../config');
const { broadcastSSE } = require('../services/simulator');
const { checkAndSendAlert, sendTelegramMessage } = require('../services/telegramService');

// POST /api/telemetry/ingest — Receiving Endpoint dari Hardware Sensor PZEM-004T (ESP32 / IoT Node)
router.post('/ingest', async (req, res) => {
  try {
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
    let espTempWarning = 70.0;
    let espTempDanger = 80.0;
    try {
      const { rows: sRows } = await db.query('SELECT key, value FROM settings');
      sRows.forEach(r => {
        if (r.key === 'warning_limit') warningLimit = parseFloat(r.value) || 5.0;
        else if (r.key === 'danger_limit') dangerLimit = parseFloat(r.value) || 10.0;
        else if (r.key === 'esp_temp_warning') espTempWarning = parseFloat(r.value) || 70.0;
        else if (r.key === 'esp_temp_danger') espTempDanger = parseFloat(r.value) || 80.0;
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
    const updateRes = await db.query(`
      UPDATE motors
      SET current = $1, voltage = $2, capacitance = $3, power = $4, pf = $5, error = $6, esp_temp = $7, motor_status = $8, status = $9, updated_at = $10
      WHERE id = $11
    `, [current, voltage, estimatedCap, power, pf, error, espTemp, motorStatus, status, updatedAt, motorId]);

    if (updateRes.rowCount === 0) {
      const parseMatch = String(motorId).match(/^(\d+)-(\d+)$/);
      const machineId = parseMatch ? parseInt(parseMatch[1], 10) : 1;
      const motorNo = parseMatch ? parseInt(parseMatch[2], 10) : 1;
      const defaultName = `Motor Stirrer ${String(motorNo).padStart(2, '0')}`;

      await db.query(`
        INSERT INTO motors (id, machine_id, motor_number, name, nominal_cap, current, voltage, power, pf, capacitance, error, esp_temp, motor_status, status, updated_at)
        VALUES ($1, $2, $3, $4, 2.0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO NOTHING
      `, [motorId, machineId, motorNo, defaultName, current, voltage, power, pf, estimatedCap, error, espTemp, motorStatus, status, updatedAt]);
    }

    // Insert ke telemetry history
    await db.query(`
      INSERT INTO telemetry_history (motor_id, capacitance, current, voltage, power, pf, esp_temp, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [motorId, Number(estimatedCap.toFixed(2)), Number(current.toFixed(3)), Number(voltage.toFixed(1)), Number(power.toFixed(2)), Number(pf.toFixed(2)), Number(espTemp.toFixed(1)), timestampIso]);

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

    // Kirim notifikasi Telegram secara asinkron jika terjadi anomali (Warning/Danger/Overheat/Disconnect)
    checkAndSendAlert({
      motorId,
      motorName: `Motor Stirrer ${motorId}`,
      status,
      motorStatus,
      voltage,
      current,
      capacitance: estimatedCap,
      error,
      power,
      pf,
      espTemp,
      thresholds: { warningLimit, dangerLimit, espTempWarning, espTempDanger }
    }).catch(err => console.error('[Telegram] Alert error:', err.message));

    res.json({
      success: true,
      message: `Data telemetry motor ${motorId} berhasil diterima & diperbarui.`,
      data: updateData
    });
  } catch (err) {
    console.error('Ingest telemetry error:', err);
    res.status(500).json({ success: false, error: 'Gagal memproses data telemetri.' });
  }
});

// POST /api/telemetry/test-telegram — Tes kirim notifikasi manual ke Telegram
router.post('/test-telegram', async (req, res) => {
  const testMsg = `
🔔 <b>TES NOTIFIKASI SISTEM IOT BEKAERT</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Halo <b>Andre Rizkyna</b>, bot Telegram berhasil terhubung dan siap mengirimkan peringatan dini (*early warning*) untuk motor stirrer & kapasitor.

• Status Bot : <b>Aktif & Siap</b>
• Waktu Tes  : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>PT Bekaert Indonesia & Politeknik Negeri Bandung</i>
  `.trim();

  const result = await sendTelegramMessage(testMsg);
  if (result.success) {
    return res.json({ success: true, message: 'Pesan tes berhasil dikirim ke Telegram!' });
  } else {
    return res.status(500).json({
      success: false,
      error: result.error,
      hint: 'Pastikan Anda telah membuka bot di Telegram dan menekan tombol START (/start).'
    });
  }
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
