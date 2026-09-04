# IoT Motor Capacitor Monitoring System
### PT Bekaert Indonesia & Politeknik Negeri Bandung (POLBAN)

Sistem Pemantauan Kesehatan Kapasitor Motor Listrik secara *real-time* berbasis IoT untuk mesin drawing/stirrer di lini produksi industri. Sistem ini mengintegrasikan mikrokontroler **ESP32**, modul sensor daya **PZEM-004T**, dan **Web Dashboard Fullstack (Node.js + Express + SQLite + Server-Sent Events)**.

---

## 📂 Struktur Repositori

```text
├── ESP32_PZEM004T/          # Firmware ESP32 (Arduino C++)
│   └── ESP32_PZEM004T.ino   # Program sensor PZEM-004T, LittleFS buffer, NTP, thermal monitor
├── dashboard/               # Aplikasi Web Monitoring (Fullstack)
│   ├── index.html           # Tampilan antarmuka Dashboard
│   ├── app.js               # Logika klien & visualisasi Chart.js
│   ├── style.css            # Desain UI / Dark & Industrial theme
│   ├── auth.js & audit.js   # Autentikasi JWT & audit logger klien
│   ├── package.json         # Dependensi Node.js
│   └── server/              # Backend Express & SQLite database engine
├── Blok Diagram.vsdx        # Diagram blok arsitektur sistem
├── Wiring Diagram.vsdx      # Diagram pengkabelan sensor PZEM-004T & ESP32
├── Flowchart/               # Diagram alir logika sistem & firmware
├── Ladder Diagram/          # Diagram kontrol PLC/Ladder pendukung
├── PPT/                     # Materi presentasi proyek
└── Proposal & RAB/          # Dokumen proposal teknis dan rancangan anggaran
```

---

## 🚀 Fitur Utama

1. **Monitoring Real-time Multi-Motor**: Memantau tegangan ($V$), arus ($I$), daya ($P$), power factor ($PF$), frekuensi ($Hz$), serta estimasi nilai kapasitansi ($\mu\text{F}$) dan persentase error.
2. **Kesehatan Internal ESP32**: Pemantauan suhu internal chip ESP32 dengan ambang batas peringatan (*overheating protection*).
3. **Ketahanan Jaringan (Offline Buffer)**: Penyimpanan lokal di flash ESP32 (LittleFS) saat koneksi WiFi putus, dengan pengiriman otomatis (*auto-flush*) saat kembali online.
4. **Duty Cycle Berbasis Jam Nyata**: Sinkronisasi waktu NTP (WIB) dengan siklus 30 menit deteksi aktif dan 30 menit standby.
5. **Live Data Streaming (SSE)**: Dashboard browser diperbarui secara instan via Server-Sent Events tanpa *page refresh*.
6. **Autentikasi & Keamanan Enterprise**: Pembatasan domain email resmi perusahaan, proteksi JWT, dan pencatatan audit log di SQLite.
7. **Ekspor Laporan PDF**: Pembuatan laporan kondisi mesin dan motor secara otomatis dalam format PDF resmi berlogo perusahaan.

---

## 🛠️ Panduan Memulai

### 1. Menjalankan Dashboard Web

Masuk ke folder `dashboard`:
```bash
cd dashboard
npm install
npm start
```
Buka browser di: `http://localhost:3000`

### 2. Memprogram ESP32

1. Buka file `ESP32_PZEM004T/ESP32_PZEM004T.ino` menggunakan Arduino IDE atau VS Code (PlatformIO).
2. Pasang library yang dibutuhkan:
   - `PZEM004Tv30`
   - `ArduinoJson`
   - `LittleFS`
3. Sesuaikan konfigurasi SSID WiFi dan IP server pada file `.ino`.
4. Unggah (*flash*) ke modul ESP32.

---

## 📜 Lisensi & Hak Cipta
Dikembangkan untuk proyek monitoring industri PT Bekaert Indonesia bekerjasama dengan Politeknik Negeri Bandung.
