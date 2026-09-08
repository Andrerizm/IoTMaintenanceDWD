const db = require('../database');

function logAudit(req, action, details) {
  const username = req && req.user ? req.user.username : 'system';
  const role = req && req.user ? req.user.role : 'system';
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : '127.0.0.1';
  
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
  const timestamp = new Date().toISOString();

  db.query(
    `INSERT INTO audit_logs (id, timestamp, username, role, action, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, timestamp, username, role, action, details || '', String(ip)]
  ).then(() => {
    // Trim audit logs jika lebih dari 1000 baris
    return db.query(`
      DELETE FROM audit_logs WHERE id NOT IN (
        SELECT id FROM audit_logs ORDER BY timestamp DESC LIMIT 1000
      )
    `);
  }).catch(err => {
    console.error('[Audit Log] Error:', err.message);
  });
}

module.exports = { logAudit };
