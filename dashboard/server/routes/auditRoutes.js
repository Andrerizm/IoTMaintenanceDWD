const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/audit-logs — Admin Only
router.get('/', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const { action, username, limit = 100 } = req.query;

    let query = 'SELECT * FROM audit_logs';
    const params = [];
    const conditions = [];

    if (action) {
      params.push(`%${action.toLowerCase()}%`);
      conditions.push(`LOWER(action) LIKE $${params.length}`);
    }
    if (username) {
      params.push(`%${username.toLowerCase()}%`);
      conditions.push(`LOWER(username) LIKE $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    params.push(Number(limit));
    query += ` ORDER BY timestamp DESC LIMIT $${params.length}`;

    const { rows: logs } = await db.query(query, params);

    res.json({
      success: true,
      logs
    });
  } catch (err) {
    console.error('Get audit logs error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data audit log.' });
  }
});

// DELETE /api/audit-logs — Admin Only
router.delete('/', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    logAudit(req, 'AUDIT_CLEAR', 'Semua audit log dihapus oleh Admin');
    await db.query('DELETE FROM audit_logs');

    res.json({
      success: true,
      message: 'Semua audit log berhasil dihapus.'
    });
  } catch (err) {
    console.error('Clear audit logs error:', err);
    res.status(500).json({ success: false, error: 'Gagal menghapus audit log.' });
  }
});

module.exports = router;
