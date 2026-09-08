const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'bekaert_super_secret_jwt_key_2026_industrial',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  
  // Domain email yang diizinkan untuk login & registrasi di perusahaan
  ALLOWED_EMAIL_DOMAINS: (process.env.ALLOWED_EMAIL_DOMAINS || 'polban.ac.id,bekaert.com').split(',').map(d => d.trim().toLowerCase()),
  
  // API Key khusus untuk pengiriman data dari hardware (ESP32 / PZEM-004T)
  HARDWARE_API_KEY: process.env.HARDWARE_API_KEY || 'bekaert_pzem004t_ingest_key_8923',

  // Path database SQLite (legacy backup)
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../database.sqlite'),

  // Konfigurasi PostgreSQL
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_NAME: process.env.DB_NAME || 'iot_maintenance_dwd',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || '',

  // Konfigurasi Telegram Bot Alert
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || ''
};
