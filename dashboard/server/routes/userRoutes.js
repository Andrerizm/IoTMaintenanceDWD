const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// GET /api/users — Admin & Supervisor
router.get('/', authenticateToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, email, role, display_name, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      users: rows
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data user.' });
  }
});

// POST /api/users — Admin & Supervisor (Tambah User Baru)
router.post('/', authenticateToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  try {
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
    const checkRes = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2',
      [cleanUsername, cleanEmail]
    );
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username atau email sudah digunakan.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    await db.query(
      `INSERT INTO users (username, email, password_hash, role, display_name, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [cleanUsername, cleanEmail, passwordHash, role, displayName || cleanUsername]
    );

    logAudit(req, 'USER_MGMT_ADD', `User baru ditambahkan: ${cleanUsername} (${cleanEmail}, Role: ${role})`);

    res.json({
      success: true,
      message: `User '${cleanUsername}' berhasil ditambahkan.`
    });
  } catch (err) {
    console.error('Add user error:', err);
    res.status(500).json({ success: false, error: 'Gagal menambahkan user.' });
  }
});

// POST /api/users/:username/reset-password — Admin Only
router.post('/:username/reset-password', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    const username = req.params.username.toLowerCase();

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ success: false, error: 'Password minimal 4 karakter.' });
    }

    const userRes = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE LOWER(username) = $2', [passwordHash, username]);

    logAudit(req, 'USER_MGMT_RESET_PW', `Password direset untuk user: ${username}`);

    res.json({
      success: true,
      message: `Password untuk user '${username}' berhasil direset.`
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Gagal mereset password user.' });
  }
});

// POST /api/users/:username/role — Admin Only (Ubah Role User)
router.post('/:username/role', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const username = req.params.username.toLowerCase();

    const VALID_ROLES = ['Admin', 'Maintenance Shift', 'Maintenance Non Shift', 'Operator', 'Supervisor', 'Manajer'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Role harus salah satu dari: ${VALID_ROLES.join(', ')}` });
    }

    if (req.user.username.toLowerCase() === username) {
      return res.status(400).json({ success: false, error: 'Tidak dapat mengubah role akun sendiri.' });
    }

    const updateRes = await db.query('UPDATE users SET role = $1 WHERE LOWER(username) = $2', [role, username]);

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    logAudit(req, 'USER_MGMT_ROLE', `Role user ${username} diubah menjadi ${role}`);

    res.json({
      success: true,
      message: `Role untuk user '${username}' berhasil diubah menjadi ${role}.`
    });
  } catch (err) {
    console.error('Change role error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengubah role user.' });
  }
});

// DELETE /api/users/:username — Admin Only
router.delete('/:username', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();

    if (req.user.username.toLowerCase() === username) {
      return res.status(400).json({ success: false, error: 'Tidak dapat menghapus akun sendiri.' });
    }

    const delRes = await db.query('DELETE FROM users WHERE LOWER(username) = $1', [username]);

    if (delRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    logAudit(req, 'USER_MGMT_DELETE', `User dihapus: ${username}`);

    res.json({
      success: true,
      message: `User '${username}' berhasil dihapus.`
    });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, error: 'Gagal menghapus user.' });
  }
});

module.exports = router;
