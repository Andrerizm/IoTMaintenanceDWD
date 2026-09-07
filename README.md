# IoT Motor Stirrer Monitoring System
### PT Bekaert Indonesia & Politeknik Negeri Bandung (POLBAN)

A real-time IoT-based Industrial Motor Stirrer Monitoring System designed for wire drawing / stirrer machinery across industrial production lines. This system integrates an **ESP32** microcontroller, **PZEM-004T** electrical power sensor modules, and a **Fullstack Web Dashboard (Node.js + Express + SQLite + Server-Sent Events)**.

---

## 📂 Repository Structure

```text
├── ESP32_PZEM004T/          # ESP32 Firmware (Arduino C++)
│   └── ESP32_PZEM004T.ino   # PZEM-004T sensor program, LittleFS offline buffer, NTP, thermal monitor
├── dashboard/               # Monitoring Web Application (Fullstack)
│   ├── index.html           # Dashboard UI interface
│   ├── app.js               # Client-side logic & Chart.js visualization
│   ├── style.css            # UI Design / Dark & Industrial theme
│   ├── auth.js & audit.js   # JWT Authentication & Client audit logger
│   ├── package.json         # Node.js dependencies
│   └── server/              # Express backend & SQLite database engine
├── Blok Diagram.vsdx        # System architecture block diagram
├── Wiring Diagram.vsdx      # PZEM-004T sensor & ESP32 wiring diagram
├── Flowchart/               # System & firmware logic flowchart
├── Ladder Diagram/          # Supporting PLC / Ladder control diagrams
├── PPT/                     # Project presentation materials
└── Proposal & RAB/          # Technical project proposal and budget plan
```

---

## 🚀 Key Features

1. **Real-Time Multi-Motor Monitoring**: Monitors voltage ($V$), current ($A$), active power ($W$), power factor ($PF$), frequency ($Hz$), operational status, and health metrics across industrial motors.
2. **ESP32 Internal Health Diagnostics**: Real-time internal chip temperature monitoring with automated overheating alert thresholds.
3. **Network Resilience (Offline Flash Buffer)**: Local data persistence on ESP32 flash memory (LittleFS) during network outages, featuring automated batch synchronization (auto-flush) upon reconnection.
4. **Real-Time Clock & Duty Cycle Synchronization**: NTP-synchronized duty cycle management (e.g., 30-minute active inspection cycle per 1-hour interval).
5. **Live Data Streaming (SSE)**: Instant browser dashboard updates via Server-Sent Events without requiring manual page reloads.
6. **Enterprise Authentication & Security**: Company email domain whitelist restrictions, robust JWT token protection, and persistent SQLite audit trails.
7. **Automated PDF Export**: Generates official industrial report documents with corporate branding for machines and motor units.

---

## 🛠️ Getting Started

### 1. Running the Web Dashboard

Navigate to the `dashboard` directory:
```bash
cd dashboard
npm install
npm start
```
Open your browser and visit: `http://localhost:3000`

### 2. Flashing the ESP32 Firmware

1. Open `ESP32_PZEM004T/ESP32_PZEM004T.ino` in Arduino IDE or VS Code (PlatformIO).
2. Install the required libraries:
   - `PZEM004Tv30`
   - `ArduinoJson`
   - `LittleFS`
3. Configure your WiFi credentials (SSID & password) and server ingestion endpoint in the `.ino` file or via the on-board Captive Portal.
4. Compile and flash the code to the ESP32 module.

---

## 📜 License & Intellectual Property
Developed for the industrial monitoring initiative at PT Bekaert Indonesia in collaboration with Politeknik Negeri Bandung (POLBAN).
