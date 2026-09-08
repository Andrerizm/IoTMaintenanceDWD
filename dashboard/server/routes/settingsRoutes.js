const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// Helper to fetch settings object
async function getSettingsObj() {
  const { rows } = await db.query('SELECT `key`, value FROM settings');
  const settings = {
    warningLimit: 5.0,
    dangerLimit: 10.0,
    espTempWarning: 70.0,
    espTempDanger: 80.0
  };

  rows.forEach(r => {
    const num = parseFloat(r.value);
    if (r.key === 'warning_limit') settings.warningLimit = num;
    else if (r.key === 'danger_limit') settings.dangerLimit = num;
    else if (r.key === 'esp_temp_warning') settings.espTempWarning = num;
    else if (r.key === 'esp_temp_danger') settings.espTempDanger = num;
  });

  return settings;
}

// GET /api/settings — Any Authenticated User
router.get('/', authenticateToken, async (req, res) => {
  try {
    const settings = await getSettingsObj();
    res.json({
      success: true,
      settings
    });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings — Admin & Supervisor Only
router.post('/', authenticateToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const { warningLimit, dangerLimit, espTempWarning, espTempDanger } = req.body;

  if (warningLimit === undefined || dangerLimit === undefined || espTempWarning === undefined || espTempDanger === undefined) {
    return res.status(400).json({ success: false, error: 'Seluruh parameter ambang batas wajib diisi.' });
  }

  const wLimit = parseFloat(warningLimit);
  const dLimit = parseFloat(dangerLimit);
  const tWarn = parseFloat(espTempWarning);
  const tDang = parseFloat(espTempDanger);

  if (isNaN(wLimit) || isNaN(dLimit) || isNaN(tWarn) || isNaN(tDang)) {
    return res.status(400).json({ success: false, error: 'Parameter ambang batas harus berupa angka yang valid.' });
  }

  if (wLimit >= dLimit) {
    return res.status(400).json({ success: false, error: 'Batas Warning Error % harus lebih kecil daripada Batas Danger Error %.' });
  }

  if (tWarn >= tDang) {
    return res.status(400).json({ success: false, error: 'Batas Warning Suhu ESP32 harus lebih kecil daripada Batas Danger Suhu.' });
  }

  const client = await db.pool.connect();
  try {
    const upsertQuery = 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)';

    await client.query('START TRANSACTION');
    await client.query(upsertQuery, ['warning_limit', String(wLimit)]);
    await client.query(upsertQuery, ['danger_limit', String(dLimit)]);
    await client.query(upsertQuery, ['esp_temp_warning', String(tWarn)]);
    await client.query(upsertQuery, ['esp_temp_danger', String(tDang)]);
    await client.query('COMMIT');

    logAudit(req, 'SETTINGS_UPDATE', `Ambang batas diperbarui: Error (Warn: ${wLimit}%, Dang: ${dLimit}%), Temp (Warn: ${tWarn}°C, Dang: ${tDang}°C)`);

    const updatedSettings = await getSettingsObj();
    res.json({
      success: true,
      message: 'Ambang batas alarm berhasil diperbarui.',
      settings: updatedSettings
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update settings error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
