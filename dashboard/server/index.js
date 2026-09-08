const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { startSimulation } = require('./services/simulator');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (html, css, js, assets)
app.use(express.static(path.join(__dirname, '../')));

// Routes API
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api', require('./routes/motorRoutes'));
app.use('/api/telemetry', require('./routes/telemetryRoutes'));
app.use('/api/audit-logs', require('./routes/auditRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));

// Fallback route ke index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Start Background Simulator
// startSimulation(6); // Dimatikan agar menerima data asli dari ESP32

const { startTelegramBotListener } = require('./services/telegramService');

// Start Server
app.listen(config.PORT, () => {
  console.log('============================================================');
  console.log(`🚀 IoT MAINTENANCE DWD — BACKEND SERVER STARTED`);
  console.log(`🌐 URL Server   : http://localhost:${config.PORT}`);
  console.log(`🌐 Website      : www.IoTMaintenceDWD.co.id`);
  console.log(`🔒 Domain Email : ${config.ALLOWED_EMAIL_DOMAINS.map(d => '@' + d).join(', ')}`);
  console.log(`🔑 Hardware Key : ${config.HARDWARE_API_KEY}`);
  console.log('============================================================');

  // Aktifkan bot interaktif dua arah (menerima perintah chat Telegram)
  startTelegramBotListener();
});
