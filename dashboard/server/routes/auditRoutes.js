const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/audit-logs — Admin Only
router.get('/', authenticateToken, requireRole('Admin'), (req, res) => {
  const { action, username, limit = 100 } = req.query;

  let query = 'SELECT * FROM audit_logs';
  const params = [];
  const conditions = [];

  if (action) {
    conditions.push('LOWER(action) LIKE ?');
    params.push(`%${action.toLowerCase()}%`);
  }
  if (username) {
    conditions.push('LOWER(username) LIKE ?');
    params.push(`%${username.toLowerCase()}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Number(limit));

  const stmt = db.prepare(query);
  const logs = stmt.all(...params);

  res.json({
    success: true,
    logs
  });
});

// DELETE /api/audit-logs — Admin Only
router.delete('/', authenticateToken, requireRole('Admin'), (req, res) => {
  logAudit(req, 'AUDIT_CLEAR', 'Semua audit log dihapus oleh Admin');
  db.exec('DELETE FROM audit_logs');

  res.json({
    success: true,
    message: 'Semua audit log berhasil dihapus.'
  });
});

module.exports = router;
