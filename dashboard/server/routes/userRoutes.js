const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/users — Admin & Supervisor
router.get('/', authenticateToken, requireRole('Admin', 'Supervisor'), (req, res) => {
  const stmt = db.prepare('SELECT id, username, email, role, display_name, created_at FROM users ORDER BY created_at DESC');
  const users = stmt.all();

  res.json({
    success: true,
    users
  });
});

// POST /api/users — Admin & Supervisor (Tambah User Baru)
router.post('/', authenticateToken, requireRole('Admin', 'Supervisor'), (req, res) => {
  const { username, email, password, role, displayName } = req.body;

  if (!username || !email || !password || !role) {
    return res.status(400).json({ success: false, error: 'Username, email, password, dan role wajib diisi.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  // Validate Email Domain
  const userDomain = cleanEmail.split('@')[1];
  if (!userDomain || !config.ALLOWED_EMAIL_DOMAINS.includes(userDomain)) {
    return res.status(400).json({ 
      success: false, 
      error: `Domain email @${userDomain} tidak diizinkan. Gunakan email perusahaan berdomain: ${config.ALLOWED_EMAIL_DOMAINS.join(', ')}` 
    });
  }

  const VALID_ROLES = ['Admin', 'Maintenance Shift', 'Maintenance Non Shift', 'Operator', 'Supervisor', 'Manajer'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `Role harus salah satu dari: ${VALID_ROLES.join(', ')}` });
  }

  // Check unique username / email
  const checkStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?');
  const existing = checkStmt.get(cleanUsername, cleanEmail);
  if (existing) {
    return res.status(400).json({ success: false, error: 'Username atau email sudah digunakan.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, display_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertStmt.run(cleanUsername, cleanEmail, passwordHash, role, displayName || cleanUsername, now);

  logAudit(req, 'USER_MGMT_ADD', `User baru ditambahkan: ${cleanUsername} (${cleanEmail}, Role: ${role})`);

  res.json({
    success: true,
    message: `User '${cleanUsername}' berhasil ditambahkan.`
  });
});

// POST /api/users/:username/reset-password — Admin Only
router.post('/:username/reset-password', authenticateToken, requireRole('Admin'), (req, res) => {
  const { newPassword } = req.body;
  const username = req.params.username.toLowerCase();

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, error: 'Password minimal 4 karakter.' });
  }

  const userStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?');
  const user = userStmt.get(username);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  const updateStmt = db.prepare('UPDATE users SET password_hash = ? WHERE LOWER(username) = ?');
  updateStmt.run(passwordHash, username);

  logAudit(req, 'USER_MGMT_RESET_PW', `Password direset untuk user: ${username}`);

  res.json({
    success: true,
    message: `Password untuk user '${username}' berhasil direset.`
  });
});

// POST /api/users/:username/role — Admin Only (Ubah Role User)
router.post('/:username/role', authenticateToken, requireRole('Admin'), (req, res) => {
  const { role } = req.body;
  const username = req.params.username.toLowerCase();

  const VALID_ROLES = ['Admin', 'Maintenance Shift', 'Maintenance Non Shift', 'Operator', 'Supervisor', 'Manajer'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `Role harus salah satu dari: ${VALID_ROLES.join(', ')}` });
  }

  if (req.user.username.toLowerCase() === username) {
    return res.status(400).json({ success: false, error: 'Tidak dapat mengubah role akun sendiri.' });
  }

  const updateStmt = db.prepare('UPDATE users SET role = ? WHERE LOWER(username) = ?');
  const result = updateStmt.run(role, username);

  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
  }

  logAudit(req, 'USER_MGMT_ROLE', `Role user ${username} diubah menjadi ${role}`);

  res.json({
    success: true,
    message: `Role untuk user '${username}' berhasil diubah menjadi ${role}.`
  });
});

// DELETE /api/users/:username — Admin Only
router.delete('/:username', authenticateToken, requireRole('Admin'), (req, res) => {
  const username = req.params.username.toLowerCase();

  if (req.user.username.toLowerCase() === username) {
    return res.status(400).json({ success: false, error: 'Tidak dapat menghapus akun sendiri.' });
  }

  const delStmt = db.prepare('DELETE FROM users WHERE LOWER(username) = ?');
  const result = delStmt.run(username);

  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
  }

  logAudit(req, 'USER_MGMT_DELETE', `User dihapus: ${username}`);

  res.json({
    success: true,
    message: `User '${username}' berhasil dihapus.`
  });
});

module.exports = router;
