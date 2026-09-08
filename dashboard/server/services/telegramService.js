const config = require('../config');
const db = require('../database');

// Melacak status alert terakhir & waktu kirim per motor agar tidak spam
const alertState = {};
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 Menit cooldown untuk status abnormal yang sama

let isPolling = false;
let pollingOffset = 0;

/**
 * Mengirim pesan format HTML ke Telegram Bot
 */
async function sendTelegramMessage(text, options = {}) {
  const chatId = options.chatId || config.TELEGRAM_CHAT_ID;
  if (!config.TELEGRAM_BOT_TOKEN || !chatId) {
    console.warn('[Telegram] Token atau Chat ID belum dikonfigurasi di file .env');
    return { success: false, error: 'Telegram credentials missing' };
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  };

  if (options.reply_markup) {
    payload.reply_markup = options.reply_markup;
  }

  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram] API Error:', data.description);
      return { success: false, error: data.description };
    }

    return { success: true, result: data.result };
  } catch (err) {
    console.error('[Telegram] Network Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Menjawab callback query (tombol interaktif) agar spinner hilang
 */
async function answerCallbackQuery(callbackQueryId, text = '') {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    });
  } catch (e) {}
}

/**
 * Evaluasi Logika Anti-Alarm Palsu berdasarkan 4 Parameter:
 * 1. Arus (I)
 * 2. Daya Aktif (P)
 * 3. Power Factor (PF)
 * 4. Suhu ESP32 (Suhu internal chip mikrokontroler)
 */
function evaluateMotorHealth({ current, power, pf, espTemp, motorStatus, thresholds = {} }) {
  const tempWarn = thresholds.espTempWarning || 70.0;
  const tempDang = thresholds.espTempDanger || 80.0;
  
  const HIGH_CURRENT_THRESHOLD = thresholds.highCurrent || 0.60;
  const JAMMED_CURRENT_THRESHOLD = thresholds.jammedCurrent || 1.00;

  if (motorStatus === 'SENSOR_DISCONNECTED') {
    return { status: 'DISCONNECTED', severity: 'WARNING', reasons: ['Kabel sensor PZEM-004T terputus dari ESP32'] };
  }
  if (motorStatus === 'ESP_OFFLINE' || motorStatus === 'DISCONNECTED') {
    return { status: 'OFFLINE', severity: 'WARNING', reasons: ['ESP32 kehilangan koneksi WiFi / Offline'] };
  }
  if (motorStatus === 'OFF' || current < 0.05) {
    return { status: 'OFF', severity: 'NORMAL', reasons: [] };
  }

  const reasons = [];
  let evaluatedStatus = 'NORMAL';
  let severity = 'NORMAL';

  // 1. Suhu ESP32
  let isTempDanger = false;
  let isTempWarning = false;
  if (espTemp >= tempDang) {
    isTempDanger = true;
    reasons.push(`Suhu internal chip ESP32 kritis (<b>${espTemp}°C</b> ≥ ${tempDang}°C)`);
  } else if (espTemp >= tempWarn) {
    isTempWarning = true;
    reasons.push(`Suhu internal chip ESP32 tinggi (<b>${espTemp}°C</b> ≥ ${tempWarn}°C)`);
  }

  // 2. Korelasi Silang Arus vs PF
  if (current >= JAMMED_CURRENT_THRESHOLD && pf < 0.60) {
    evaluatedStatus = 'DANGER';
    severity = 'DANGER';
    reasons.push(`Indikasi <b>Rotor Macet / Jammed</b>: Arus melonjak (${current.toFixed(3)} A) dengan PF anjlok (${pf.toFixed(2)})`);
  } else if (current >= HIGH_CURRENT_THRESHOLD && pf < 0.80) {
    evaluatedStatus = 'WARNING';
    severity = 'WARNING';
    reasons.push(`Indikasi <b>Anomali Elektrik / PF Rendah</b>: Arus naik (${current.toFixed(3)} A) dengan PF buruk (${pf.toFixed(2)} &lt; 0.80)`);
  } else if (current >= HIGH_CURRENT_THRESHOLD && pf >= 0.88) {
    evaluatedStatus = 'NORMAL';
  }

  if (isTempDanger) {
    evaluatedStatus = 'DANGER';
    severity = 'DANGER';
  } else if (isTempWarning && evaluatedStatus !== 'DANGER') {
    evaluatedStatus = 'WARNING';
    severity = 'WARNING';
  }

  return { status: evaluatedStatus, severity, reasons };
}

/**
 * Pengecekan otomatis saat data masuk dari ESP32
 */
async function checkAndSendAlert({
  motorId,
  motorName = `Motor Stirrer ${motorId}`,
  motorStatus = 'ON',
  voltage = 0,
  current = 0,
  power = 0,
  pf = 0,
  espTemp = 0,
  thresholds = {}
}) {
  const now = Date.now();
  const evaluation = evaluateMotorHealth({ current, power, pf, espTemp, motorStatus, thresholds });
  const { status, severity, reasons } = evaluation;

  const state = alertState[motorId] || { status: 'NORMAL', lastSentAt: 0, wasAbnormal: false };
  const isCurrentlyAbnormal = severity === 'WARNING' || severity === 'DANGER';

  if (!isCurrentlyAbnormal && state.wasAbnormal) {
    alertState[motorId] = { status: 'NORMAL', lastSentAt: now, wasAbnormal: false };

    const recoveryMsg = `
✅ <b>STATUS SISTEM PULIH — PT BEKAERT INDONESIA</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Unit Motor :</b> ${motorName} (ID: <code>${motorId}</code>)
<b>Status Terkini :</b> <code>NORMAL OPERATIONAL</code>

<b>Parameter Terpantau:</b>
• Arus Listrik : <b>${Number(current).toFixed(3)} A</b>
• Daya Aktif   : <b>${Number(power).toFixed(1)} W</b>
• Power Factor : <b>${Number(pf).toFixed(2)}</b>
• Tegangan     : ${Number(voltage).toFixed(1)} V
• Suhu ESP32   : <b>${Number(espTemp).toFixed(1)} °C</b> (Aman)

<i>Waktu Pulih: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Sistem Monitoring Motor Stirrer & Mikrokontroler IoT</i>
    `.trim();

    return sendTelegramMessage(recoveryMsg);
  }

  if (!isCurrentlyAbnormal) return;

  const statusChanged = state.status !== status;
  const cooldownExpired = (now - state.lastSentAt) > ALERT_COOLDOWN_MS;

  if (!statusChanged && !cooldownExpired) return;

  const icon = severity === 'DANGER' ? '🚨' : '⚠️';
  const severityHeader = severity === 'DANGER' ? 'BAHAYA (CRITICAL ALARM)' : 'PERINGATAN (WARNING ALARM)';

  const message = `
${icon} <b>${severityHeader} — PT BEKAERT INDONESIA</b> ${icon}
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Unit Motor :</b> ${motorName} (ID: <code>${motorId}</code>)
<b>Kondisi    :</b> <code>${status}</code>

<b>Diagnosa / Indikasi:</b>
${reasons.map(r => `• ${r}`).join('\n')}

<b>Parameter Kelistrikan & Fisik Terpantau:</b>
• Arus Listrik : <b>${Number(current).toFixed(3)} A</b>
• Daya Aktif   : <b>${Number(power).toFixed(1)} W</b>
• Power Factor : <b>${Number(pf).toFixed(2)}</b>
• Tegangan     : ${Number(voltage).toFixed(1)} V
• Suhu ESP32   : <b>${Number(espTemp).toFixed(1)} °C</b>

<i>Waktu Kejadian: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Mohon tim teknisi maintenance melakukan pengecekan pada unit terkait.</i>
  `.trim();

  alertState[motorId] = {
    status,
    lastSentAt: now,
    wasAbnormal: true
  };

  return sendTelegramMessage(message);
}

// =========================================================================
// 🤖 FITUR DUA ARAH: INTERACTIVE COMMAND LISTENER TELEGRAM
// =========================================================================

/**
 * Format kartu detail data real-time motor stirrer
 */
function formatMotorDetailMessage(m) {
  const current = Number(m.current || 0);
  const voltage = Number(m.voltage || 0);
  const power = Number(m.power || 0);
  const pf = Number(m.pf || 0);
  const espTemp = Number(m.esp_temp || 0);
  const cap = Number(m.capacitance || 0);
  const nominal = Number(m.nominal_cap || 2.0);

  let statusIcon = '🟢';
  if (m.status === 'WARNING') statusIcon = '⚠️';
  else if (m.status === 'DANGER') statusIcon = '🚨';
  else if (m.motor_status === 'OFF') statusIcon = '⚪';
  else if (m.motor_status === 'SENSOR_DISCONNECTED') statusIcon = '🔌';

  let pfNote = '🟢 (Prima)';
  if (pf < 0.60 && current > 0.5) pfNote = '🚨 (Kritis/Jammed)';
  else if (pf < 0.80) pfNote = '⚠️ (Rendah)';

  let tempNote = '🟢 (Aman)';
  if (espTemp >= 80) tempNote = '🚨 (Overheat Kritis)';
  else if (espTemp >= 70) tempNote = '⚠️ (Tinggi)';

  return `
📊 <b>DATA REAL-TIME MOTOR STIRRER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Mesin / Motor :</b> Mesin ${m.machine_id} - Motor ${m.motor_number}
<b>Nama Unit     :</b> <b>${m.name}</b> (ID: <code>${m.id}</code>)
<b>Status Kerja  :</b> ${m.motor_status === 'ON' ? '🟢 ON (Berputar)' : '⚪ OFF / Standby'}
<b>Kondisi Sistem:</b> ${statusIcon} <code>${m.status}</code>

<b>Parameter Kelistrikan:</b>
• Arus Listrik  : <b>${current.toFixed(3)} A</b>
• Daya Aktif    : <b>${power.toFixed(1)} W</b>
• Power Factor  : <b>${pf.toFixed(2)}</b> ${pfNote}
• Tegangan      : <b>${voltage.toFixed(1)} V</b>

<b>Status Perangkat Fisik:</b>
• Suhu ESP32    : <b>${espTemp.toFixed(1)} °C</b> ${tempNote}
• Kapasitansi C : ${cap.toFixed(2)} µF (Nominal: ${nominal.toFixed(1)} µF)

<i>Update Terakhir : ${m.updated_at || 'Baru Saja'}</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Sistem Monitoring PT Bekaert Indonesia & POLBAN</i>
  `.trim();
}

/**
 * Handle perintah pengecekan motor spesifik
 */
async function handleCekMotor(chatId, machineId, motorNo) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM motors 
       WHERE (machine_id = $1 AND motor_number = $2) 
          OR id = $3 
          OR id = $4
       ORDER BY id LIMIT 1`,
      [machineId, motorNo, `${machineId}-${motorNo}`, `${machineId}-${String(motorNo).padStart(2, '0')}`]
    );

    if (rows.length === 0) {
      const notFoundMsg = `
❌ <b>Motor Tidak Ditemukan!</b>
Tidak ada data untuk <b>Mesin ${machineId} - Motor ${motorNo}</b>.

Silakan periksa nomor mesin dan motor Anda, atau ketik <code>/semua</code> untuk melihat seluruh daftar motor yang terdaftar di sistem.
      `.trim();
      return sendTelegramMessage(notFoundMsg, { chatId });
    }

    const m = rows[0];
    const message = formatMotorDetailMessage(m);

    // Tombol refresh cepat
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: `🔄 Segarkan Data (${m.id})`, callback_data: `cek:${m.machine_id}:${m.motor_number}` },
          { text: '📋 Semua Motor', callback_data: 'action:semua' }
        ]
      ]
    };

    return sendTelegramMessage(message, { chatId, reply_markup: replyMarkup });
  } catch (err) {
    console.error('[Telegram] Query error:', err.message);
    return sendTelegramMessage(`❌ Terjadi kesalahan database: ${err.message}`, { chatId });
  }
}

/**
 * Handle perintah menampilkan semua motor
 */
async function handleListAllMotors(chatId) {
  try {
    const { rows } = await db.query('SELECT * FROM motors ORDER BY machine_id ASC, motor_number ASC');
    if (rows.length === 0) {
      return sendTelegramMessage('ℹ️ Belum ada data motor yang terdaftar di database.', { chatId });
    }

    let listText = `
📋 <b>RINGKASAN SELURUH MOTOR STIRRER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Terdaftar: <b>${rows.length} Unit Motor</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    const inlineKeyboard = [];
    let rowBtns = [];

    rows.forEach((m, idx) => {
      let icon = '🟢';
      if (m.status === 'WARNING') icon = '⚠️';
      else if (m.status === 'DANGER') icon = '🚨';
      else if (m.motor_status === 'OFF') icon = '⚪';
      else if (m.motor_status === 'SENSOR_DISCONNECTED') icon = '🔌';

      listText += `${icon} <b>Mesin ${m.machine_id} - Motor ${m.motor_number}</b> (${m.name})\n`;
      listText += `   └ Arus: <b>${Number(m.current || 0).toFixed(3)}A</b> | PF: <b>${Number(m.pf || 0).toFixed(2)}</b> | Suhu: <b>${Number(m.esp_temp || 0).toFixed(1)}°C</b>\n\n`;

      rowBtns.push({
        text: `M${m.machine_id}-${m.motor_number}`,
        callback_data: `cek:${m.machine_id}:${m.motor_number}`
      });

      if (rowBtns.length === 3 || idx === rows.length - 1) {
        inlineKeyboard.push(rowBtns);
        rowBtns = [];
      }
    });

    listText += `<i>Ketik <code>/cek [mesin] [motor]</code> atau klik tombol di bawah untuk melihat rincian lengkap.</i>`;

    return sendTelegramMessage(listText.trim(), {
      chatId,
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (err) {
    return sendTelegramMessage(`❌ Gagal mengambil daftar motor: ${err.message}`, { chatId });
  }
}

/**
 * Handle perintah suhu seluruh box panel ESP32
 */
async function handleSuhuESP(chatId) {
  try {
    const { rows } = await db.query('SELECT machine_id, motor_number, name, esp_temp, updated_at FROM motors ORDER BY machine_id, motor_number');
    if (rows.length === 0) {
      return sendTelegramMessage('ℹ️ Belum ada data motor.', { chatId });
    }

    let text = `
🌡️ <b>MONITORING SUHU CHIP ESP32 PANEL</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    rows.forEach(m => {
      const temp = Number(m.esp_temp || 0);
      let icon = '🟢';
      let statusLabel = 'Aman';
      if (temp >= 80) { icon = '🚨'; statusLabel = 'OVERHEAT KRITIS'; }
      else if (temp >= 70) { icon = '⚠️'; statusLabel = 'Tinggi / Waspada'; }

      text += `${icon} <b>Mesin ${m.machine_id} (Motor ${m.motor_number})</b>: <b>${temp.toFixed(1)} °C</b> — <i>${statusLabel}</i>\n`;
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n<i>Batas Normal: &lt; 70°C | Warning: ≥ 70°C | Danger: ≥ 80°C</i>`;
    return sendTelegramMessage(text.trim(), { chatId });
  } catch (err) {
    return sendTelegramMessage(`❌ Gagal mengambil data suhu: ${err.message}`, { chatId });
  }
}

/**
 * Menu Bantuan & Perintah
 */
async function sendHelpMenu(chatId, senderName = 'Teknisi') {
  const menuText = `
👋 Halo <b>${senderName}</b>!
Selamat datang di <b>Bot Asisten IoT Maintenance DWD</b> (PT Bekaert Indonesia & POLBAN).

Anda dapat meminta data pengukuran motor stirrer kapan saja menggunakan perintah:

🔹 <b>Cek Motor Tertentu:</b>
• <code>/cek 1 1</code> <i>(Cek Mesin 1, Motor 1)</i>
• <code>/cek 1 2</code> <i>(Cek Mesin 1, Motor 2)</i>
• Atau langsung ketik angkanya: <code>1 1</code> atau <code>1-1</code>

🔹 <b>Cek Ringkasan Keseluruhan:</b>
• <code>/semua</code> atau <code>/list</code> : Ringkasan semua motor
• <code>/suhu</code> : Cek suhu seluruh chip ESP32 panel

Silakan pilih menu cepat di bawah ini:
  `.trim();

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🔍 Cek Motor 1-1', callback_data: 'cek:1:1' },
        { text: '🔍 Cek Motor 1-2', callback_data: 'cek:1:2' }
      ],
      [
        { text: '📋 Status Semua Motor', callback_data: 'action:semua' },
        { text: '🌡️ Cek Suhu ESP32', callback_data: 'action:suhu' }
      ]
    ]
  };

  return sendTelegramMessage(menuText, { chatId, reply_markup: replyMarkup });
}

/**
 * Router Pengolah Pesan Masuk (Incoming Messages)
 */
async function processIncomingMessage(message) {
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const rawText = (message.text || '').trim();
  const senderName = message.from ? (message.from.first_name || 'Teknisi') : 'Teknisi';

  if (!rawText) return;

  const text = rawText.toLowerCase();

  // 1. Perintah Start / Help / Menu
  if (text === '/start' || text === '/help' || text === '/menu' || text === 'menu' || text === 'bantuan') {
    return sendHelpMenu(chatId, senderName);
  }

  // 2. Perintah Semua Motor / List
  if (text === '/semua' || text === '/list' || text === 'semua' || text === 'list' || text === '/status') {
    return handleListAllMotors(chatId);
  }

  // 3. Perintah Cek Suhu
  if (text === '/suhu' || text === 'suhu' || text === '/temp') {
    return handleSuhuESP(chatId);
  }

  // 4. Perintah Cek Motor Spesifik:
  // Format didukung:
  // - "/cek 1 1" atau "/cek 1-1" atau "/cek 1,1" atau "/cek 1 01"
  // - "/motor 1 1"
  // - "1 1" atau "1-1" atau "1.1" atau "1-01"
  let match = rawText.match(/^\/(?:cek|motor|status)\s+(\d+)[\s\-_,:]+(\d+)$/i);
  if (!match) {
    match = rawText.match(/^(\d+)[\s\-_,:]+(\d+)$/);
  }

  if (match) {
    const machineId = parseInt(match[1], 10);
    const motorNo = parseInt(match[2], 10);
    return handleCekMotor(chatId, machineId, motorNo);
  }

  // Jika input berupa kata kunci seperti "mtr-01" atau "mtr-1"
  const nameMatch = rawText.match(/^(?:mtr|motor)[-_ ]*(\d+)[-_ ]*(\d+)$/i);
  if (nameMatch) {
    const machineId = parseInt(nameMatch[1], 10);
    const motorNo = parseInt(nameMatch[2], 10);
    return handleCekMotor(chatId, machineId, motorNo);
  }

  // Jika perintah tidak dikenali, kirim petunjuk
  const unknownMsg = `
❓ <b>Perintah tidak dikenali:</b> "<code>${rawText}</code>"

<b>Cara mengambil data motor:</b>
Ketik nomor mesin & motor, contoh:
• <code>/cek 1 1</code> (untuk Mesin 1 Motor 1)
• Atau cukup ketik: <code>1 1</code>

Ketik <code>/menu</code> untuk panduan lengkap atau <code>/semua</code> untuk daftar motor.
  `.trim();

  return sendTelegramMessage(unknownMsg, { chatId });
}

/**
 * Router Pengolah Callback Query (Klik Tombol Interaktif)
 */
async function processCallbackQuery(callbackQuery) {
  if (!callbackQuery || !callbackQuery.message) return;

  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data || '';

  if (data.startsWith('cek:')) {
    const parts = data.split(':');
    const machineId = parseInt(parts[1], 10);
    const motorNo = parseInt(parts[2], 10);
    await answerCallbackQuery(callbackId, `Mengambil data Mesin ${machineId} Motor ${motorNo}...`);
    return handleCekMotor(chatId, machineId, motorNo);
  }

  if (data === 'action:semua') {
    await answerCallbackQuery(callbackId, 'Memuat semua motor...');
    return handleListAllMotors(chatId);
  }

  if (data === 'action:suhu') {
    await answerCallbackQuery(callbackId, 'Memuat suhu ESP32...');
    return handleSuhuESP(chatId);
  }

  await answerCallbackQuery(callbackId);
}

/**
 * Long-polling loop untuk mendengarkan pesan masuk dari Telegram
 */
async function pollTelegramUpdates() {
  while (isPolling) {
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getUpdates`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: pollingOffset,
          timeout: 25 // Long-polling 25 detik
        })
      });

      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          pollingOffset = update.update_id + 1;

          if (update.message) {
            processIncomingMessage(update.message).catch(err => {
              console.error('[Telegram Bot] Error processing message:', err.message);
            });
          } else if (update.callback_query) {
            processCallbackQuery(update.callback_query).catch(err => {
              console.error('[Telegram Bot] Error processing callback:', err.message);
            });
          }
        }
      } else {
        // Jika terjadi error dari Telegram API
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      // Jeda jika ada gangguan jaringan sementara
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

/**
 * Menjalankan listener Telegram bot dua arah
 */
function startTelegramBotListener() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.log('[Telegram Bot] Bot token belum diset, listener dinonaktifkan.');
    return;
  }
  if (isPolling) return;
  isPolling = true;
  console.log('🤖 [Telegram Bot] Interactive Command Listener Aktif (Long Polling)!');
  pollTelegramUpdates();
}

/**
 * Menghentikan listener jika server shutdown
 */
function stopTelegramBotListener() {
  isPolling = false;
}

module.exports = {
  sendTelegramMessage,
  checkAndSendAlert,
  evaluateMotorHealth,
  startTelegramBotListener,
  stopTelegramBotListener,
  sendHelpMenu,
  handleCekMotor,
  handleListAllMotors
};
