const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// POST /api/auth/login — Login User
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body; // identifier bisa username atau email

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Username/email dan password wajib diisi.' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    
    // Query ke DB berdasarkan username atau email
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?',
      [cleanIdentifier, cleanIdentifier]
    );
    const user = rows[0];

    if (!user) {
      logAudit(req, 'LOGIN_FAILED', `Percobaan login gagal untuk: ${cleanIdentifier}`);
      return res.status(401).json({ success: false, error: 'Username/email atau password salah.' });
    }

    // Verifikasi domain email perusahaan
    const userDomain = user.email.split('@')[1] ? user.email.split('@')[1].toLowerCase() : '';
    if (!config.ALLOWED_EMAIL_DOMAINS.includes(userDomain)) {
      logAudit(req, 'LOGIN_BLOCKED_DOMAIN', `Akses ditolak untuk domain email: ${user.email}`);
      return res.status(403).json({ 
        success: false, 
        error: `Domain email @${userDomain} tidak memiliki izin akses ke sistem ini. Domain diizinkan: ${config.ALLOWED_EMAIL_DOMAINS.join(', ')}` 
      });
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      logAudit(req, 'LOGIN_FAILED', `Password salah untuk user: ${user.username}`);
      return res.status(401).json({ success: false, error: 'Username/email atau password salah.' });
    }

    // Generate JWT Token
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.display_name
    };

    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

    req.user = payload;
    logAudit(req, 'LOGIN_SUCCESS', `User '${user.username}' (${user.role}) berhasil login`);

    res.json({
      success: true,
      token,
      user: payload
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat login.' });
  }
});

// POST /api/auth/register — Registrasi Mandiri Karyawan (Auto-Verified Domain Email)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Username, email perusahaan, dan password wajib diisi.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanUsername.length < 3) {
      return res.status(400).json({ success: false, error: 'Username minimal 3 karakter.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ success: false, error: 'Password minimal 4 karakter.' });
    }

    // Verifikasi Domain Email Perusahaan
    const userDomain = cleanEmail.split('@')[1] ? cleanEmail.split('@')[1].toLowerCase() : '';
    if (!userDomain || !config.ALLOWED_EMAIL_DOMAINS.includes(userDomain)) {
      logAudit(req, 'REGISTER_BLOCKED_DOMAIN', `Registrasi ditolak untuk domain: @${userDomain || 'invalid'}`);
      return res.status(403).json({
        success: false,
        error: `Pendaftaran gagal! Hanya email perusahaan berdomain @${config.ALLOWED_EMAIL_DOMAINS.join(' atau @')} yang diizinkan.`
      });
    }

    // Cek keunikan username dan email
    const checkRes = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?',
      [cleanUsername, cleanEmail]
    );
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username atau email perusahaan sudah terdaftar.' });
    }

    // Buat akun baru dengan role default 'Operator'
    const passwordHash = bcrypt.hashSync(password, 10);
    const defaultRole = 'Operator';

    const insertRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, display_name, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [cleanUsername, cleanEmail, passwordHash, defaultRole, displayName || cleanUsername]
    );
    const newId = insertRes.insertId;

    const payload = {
      id: Number(newId),
      username: cleanUsername,
      email: cleanEmail,
      role: defaultRole,
      displayName: displayName || cleanUsername
    };

    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

    req.user = payload;
    logAudit(req, 'REGISTER_SUCCESS', `Karyawan baru terdaftar: '${cleanUsername}' (${cleanEmail})`);

    res.json({
      success: true,
      message: 'Registrasi berhasil! Selamat datang di Bekaert Capacitor Monitor.',
      token,
      user: payload
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat registrasi.' });
  }
});

// GET /api/auth/me — Dapatkan Profil User Aktif
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;
