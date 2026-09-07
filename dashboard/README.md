# IoT Maintenance DWD — Motor Stirrer Health Monitoring System
### www.IoTMaintenceDWD.co.id

An Industrial Motor Stirrer Health Monitoring System built on **Node.js, Express, SQLite, and Server-Sent Events (SSE)** for **IoT Maintenance DWD** (PT Bekaert Indonesia & POLBAN).

The system monitors **30 Machine Units (300 Electric Motors)** equipped with **PZEM-004T** electrical power and current sensors. It features server-side corporate domain authentication, persistent database audit trails, and hardware telemetry ingestion endpoints designed for ESP32 edge devices.

---

## 🚀 Key Enterprise Features

1. **Node.js + Express Backend Server**:
   - Runs on Port `3000`.
   - Utilizes embedded, persistent **SQLite (`database.sqlite`)** with no separate database server installation required.
2. **Server-Side JWT Authentication & Domain Whitelisting**:
   - Secure login validated via **JWT Tokens**.
   - **Domain Lockout**: Restricts registration and access to approved corporate email domains (e.g., `@polban.ac.id` and `@bekaert.com`).
   - Role-Based Access Control (RBAC): **Admin**, **Engineer**, and **Viewer**.
3. **Hardware Telemetry Ingestion API (`POST /api/telemetry/ingest`)**:
   - Ready to receive telemetry payloads from microcontrollers (ESP32/Arduino) via HTTP POST authenticated with an `X-API-Key` header.
4. **Live Telemetry Stream (SSE - Server-Sent Events)**:
   - Dashboard UI updates visual cards, status indicators, and charts in real-time as edge sensors stream incoming data.
5. **Persistent SQLite Audit Logging**:
   - Automatically records user activities (Login, Logout, Navigation, PDF Exports, Settings Changes, and User Management actions).
6. **Automated Industrial PDF Export**:
   - Generates official inspection reports featuring company branding for machine units and individual motors.

---

## 🔑 Default System Accounts

| Username | Email | Password | Role | Access Permissions |
|----------|-------|----------|------|---------------------|
| `admin` | `admin@polban.ac.id` | `admin123` | **Admin** | Full Access + Audit Logs + User Management |
| `engineer` | `engineer@polban.ac.id` | `eng123` | **Engineer** | Full Access + PDF Reports Export |
| `viewer` | `viewer@polban.ac.id` | `view123` | **Viewer** | Read-Only Monitoring (No PDF Export) |
| `admin_bekaert` | `admin@bekaert.com` | `bekaert123` | **Admin** | Bekaert Administrative Full Access |

---

## 🛠️ How to Run the System

### 1. Launch the Backend Server
Open a terminal in the project directory and execute:

```bash
# Start server (runs on http://localhost:3000)
npm start
```

Or for development mode with automatic restart on file changes:
```bash
npm run dev
```

### 2. Open the Dashboard in Your Browser
Open any modern web browser and navigate to:
👉 **`http://localhost:3000`**

---

## 🔌 Hardware API Endpoint Documentation (ESP32 / PZEM-004T)

To stream data from hardware sensors (ESP32 / Arduino) to this server:

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

## ⚙️ Environment Configuration (`server/config.js` / `.env`)

You can configure the server port, secret keys, authorized email domains, and hardware API key in `server/config.js`:

```javascript
module.exports = {
  PORT: 3000,
  JWT_SECRET: 'bekaert_super_secret_jwt_key_2026_industrial',
  ALLOWED_EMAIL_DOMAINS: ['polban.ac.id', 'bekaert.com'],
  HARDWARE_API_KEY: 'bekaert_pzem004t_ingest_key_8923'
};
```
