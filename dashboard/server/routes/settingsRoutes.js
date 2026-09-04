const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// Helper to fetch settings object
function getSettingsObj() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
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
router.get('/', authenticateToken, (req, res) => {
  try {
    const settings = getSettingsObj();
    res.json({
      success: true,
      settings
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings — Admin & Supervisor Only
router.post('/', authenticateToken, requireRole('Admin', 'Supervisor'), (req, res) => {
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

  try {
    const upsertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    db.exec('BEGIN TRANSACTION;');
    upsertStmt.run('warning_limit', String(wLimit));
    upsertStmt.run('danger_limit', String(dLimit));
    upsertStmt.run('esp_temp_warning', String(tWarn));
    upsertStmt.run('esp_temp_danger', String(tDang));
    db.exec('COMMIT;');

    logAudit(req, 'SETTINGS_UPDATE', `Ambang batas diperbarui: Error (Warn: ${wLimit}%, Dang: ${dLimit}%), Temp (Warn: ${tWarn}°C, Dang: ${tDang}°C)`);

    const updatedSettings = getSettingsObj();
    res.json({
      success: true,
      message: 'Ambang batas alarm berhasil diperbarui.',
      settings: updatedSettings
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
