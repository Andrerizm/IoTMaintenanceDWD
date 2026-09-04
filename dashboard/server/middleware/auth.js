const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token autentikasi tidak ditemukan.' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token tidak valid atau sudah kedaluwarsa.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Tidak terautentikasi.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: `Akses ditolak. Role '${req.user.role}' tidak memiliki izin untuk aksi ini.` });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole
};
