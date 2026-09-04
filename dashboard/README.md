# IoT Maintenance DWD — Motor Capacitor Health Monitoring System
### www.IoTMaintenceDWD.co.id

Sistem Monitoring Kesehatan Kapasitor Motor Listrik berbasis **Node.js, Express, SQLite, dan Server-Sent Events (SSE)** untuk **IoT Maintenance DWD** (Bekaert Indonesia & Polban).

Sistem ini memonitor **30 Unit Mesin (300 Motor Listrik)** dengan sensor arus & tegangan **PZEM-004T**, dilengkapi dengan autentikasi server-side berbasis domain email perusahaan, audit logging persisten di database, serta API ingestion untuk perangkat IoT/hardware ESP32.

---

## 🚀 Fitur Utama Enterprise

1. **Backend Server Node.js + Express**:
   - Berjalan pada Port `3000`.
   - Menggunakan database **SQLite persisten (`database.sqlite`)** built-in tanpa perlu install server database terpisah.
2. **Autentikasi Server-side (JWT) dengan Batasan Domain Email Perusahaan**:
   - Login divalidasi oleh server menggunakan **Token JWT**.
   - **Domain Email Lockout**: Hanya mengizinkan akun berdomain resmi (misal: `@polban.ac.id` dan `@bekaert.com`).
   - Role-Based Access Control (RBAC): **Admin**, **Engineer**, **Viewer**.
3. **API Telemetry Ingestion untuk Sensor Hardware Nyata (`POST /api/telemetry/ingest`)**:
   - Siap menerima data langsung dari hardware mikrokontroler (ESP32/Arduino) via HTTP POST dengan atribut `X-API-Key`.
4. **Live Telemetry Stream (SSE - Server Sent Events)**:
   - Dashboard memperbarui indikator visual, segment bar, dan grafik secara real-time saat sensor di lapangan mengirimkan pembacaan data baru.
5. **Audit Logging di Database SQLite**:
   - Mencatat aktivitas pengguna (Login, Logout, Navigasi, Ekspor PDF, Perubahan Konfigurasi, User Management) secara otomatis di database.
6. **Ekspor Laporan PDF Kertas & Laporan Mesin**:
   - Menghasilkan file PDF resmi berlogo Bekaert untuk unit mesin maupun spesifik motor.

---

## 🔑 Akun Default Sistem

| Username | Email | Password | Role | Akses |
|----------|-------|----------|------|-------|
| `admin` | `admin@polban.ac.id` | `admin123` | **Admin** | Akses Penuh + Audit Log + User Management |
| `engineer` | `engineer@polban.ac.id` | `eng123` | **Engineer** | Akses Penuh + Ekspor PDF |
| `viewer` | `viewer@polban.ac.id` | `view123` | **Viewer** | Monitoring Read-Only (Tanpa Ekspor PDF) |
| `admin_bekaert` | `admin@bekaert.com` | `bekaert123` | **Admin** | Akses Penuh Bekaert |

---

## 🛠️ Cara Menjalankan System

### 1. Jalankan Backend Server
Buka terminal di folder project dan jalankan:

```bash
# Jalankan server (Server berjalan di http://localhost:3000)
npm start
```

Atau untuk mode pengembangan (*auto reload*):
```bash
npm run dev
```

### 2. Buka Dashboard di Browser
Buka browser dan navigasi ke:
👉 **`http://localhost:3000`**

---

## 🔌 Dokumentasi Endpoint API Hardware (ESP32 / PZEM-004T)

Untuk menghubungkan sensor hardware (ESP32 / Arduino) ke sistem ini:

- **Endpoint**: `POST http://localhost:3000/api/telemetry/ingest`
- **Header**: `X-API-Key: bekaert_pzem004t_ingest_key_8923`
- **Content-Type**: `application/json`

### Payload Request (JSON):
```json
{
  "motorId": "1-1",
  "voltage": 224.5,
  "current": 0.145,
  "frequency": 50,
  "motorStatus": "ON"
}
```

---

## ⚙️ Konfigurasi Environment (`server/config.js` / `.env`)

Anda dapat mengubah domain email yang diizinkan, port, dan API key hardware pada file `server/config.js`:

```javascript
module.exports = {
  PORT: 3000,
  JWT_SECRET: 'bekaert_super_secret_jwt_key_2026_industrial',
  ALLOWED_EMAIL_DOMAINS: ['polban.ac.id', 'bekaert.com'],
  HARDWARE_API_KEY: 'bekaert_pzem004t_ingest_key_8923'
};
```
