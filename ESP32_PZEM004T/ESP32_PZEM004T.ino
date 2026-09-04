#include <PZEM004Tv30.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <time.h>

// =========================================================================
// ⚙️ KONFIGURASI DEFAULT (BISA DIUBAH DARI PORTAL WEB HP / BROWSER)
// =========================================================================
#define DEFAULT_MESIN_NO  1    // Nomor Mesin Default
#define DEFAULT_MOTOR_NO  1    // Nomor Motor Default

const char* defaultSSID      = "Andre";       // Nama WiFi Default
const char* defaultPassword  = "tehmanis";    // Password WiFi Default
const char* defaultServerUrl = "http://172.20.10.7:3000/api/telemetry/ingest";
const char* defaultApiKey    = "bekaert_pzem004t_ingest_key_8923";

// --- Pin Hardware ESP32 (Serial2 & Status LED) ---
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
#define PZEM_SERIAL Serial2

#ifndef LED_BUILTIN
#define LED_BUILTIN 2 // Internal LED bawaan ESP32 DevKit v1 (GPIO 2)
#endif
// =========================================================================

// --- Status Diagnostics LED Flags & Duty Cycle ---
bool isOTAUpdating = false;
bool isSensorError = false;
bool isOverheating = false;
bool isStandbyPhase = false;

// --- NTP Real-Time Clock Config (WIB GMT+7) ---
const char* ntpServer1 = "pool.ntp.org";
const char* ntpServer2 = "id.pool.ntp.org";
const long gmtOffset_sec = 7 * 3600; // GMT+7 (WIB)
const int daylightOffset_sec = 0;
bool isTimeSynced = false;

const unsigned long DUTY_CYCLE_TOTAL_MS  = 3600000UL; // 1 Jam (3.600.000 ms)
const unsigned long DUTY_CYCLE_ACTIVE_MS = 1800000UL; // 30 Menit (1.800.000 ms)
unsigned long lastLEDBlinkMillis = 0;
bool ledState = LOW;

// --- Variabel Terimpan (NVS Flash Memory) ---
Preferences pref;
String cfgSSID;
String cfgPassword;
String cfgServerUrl;
String cfgApiKey;
int cfgMesinNo;
int cfgMotorNo;

String motorId;
String deviceLabel;

PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);

WebServer webServer(80);
DNSServer dnsServer;
bool isPortalActive = false;

unsigned long previousMillis = 0;
const long interval = 1000; // Interval kirim telemetry (1 detik)

unsigned long lastWifiCheckMillis = 0;
const long wifiCheckInterval = 5000; // Reconnect WiFi interval (5 detik)

const char* bufferFilePath = "/offline_telemetry.txt";
const int maxBufferLines = 200;

// Prototype fungsi
void loadConfig();
void saveConfig(String ssid, String pass, String url, String key, int mesin, int motor);
void startConfigPortal();
void handlePortalRoot();
void handlePortalSave();
void initOTA();
void initLittleFS();
void saveOfflineData(const String& payload);
void flushOfflineData();
void handleLEDStatus();

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Inisialisasi Status LED (GPIO 2)
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.println("\n=================================================");
  Serial.println("🚀 MEMULAI ESP32 PZEM-004T ADVANCED SYSTEM");
  Serial.println("=================================================");

  // 1. Inisialisasi LittleFS (Offline Buffer Storage)
  initLittleFS();

  // 2. Load Konfigurasi dari Flash (Preferences)
  loadConfig();

  // Otomatis membentuk Motor ID dan Label Logging
  motorId     = String(cfgMesinNo) + "-" + String(cfgMotorNo);
  deviceLabel = "[Mesin " + String(cfgMesinNo) + " - Motor " + String(cfgMotorNo) + "]";

  Serial.print("📌 Device Target : "); Serial.println(deviceLabel);
  Serial.print("📌 Motor ID      : "); Serial.println(motorId);
  Serial.print("🌐 WiFi Target   : "); Serial.println(cfgSSID);
  Serial.print("🌐 Server URL    : "); Serial.println(cfgServerUrl);
  Serial.println("-------------------------------------------------");

  // 3. Menghubungkan ke WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSSID.c_str(), cfgPassword.c_str());

  Serial.print("Menghubungkan ke WiFi ");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) { // Coba 10 detik
    delay(500);
    Serial.print(".");
    attempts++;
  }

  // Jika gagal tersambung dalam 10 detik, aktifkan Web Config Portal
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n❌ Gagal terhubung ke WiFi!");
    startConfigPortal();
  } else {
    Serial.println("\n✔ WiFi Terhubung!");
    Serial.print("IP Address ESP32: ");
    Serial.println(WiFi.localIP());

    // 4. Inisialisasi NTP Time Synchronization (WIB GMT+7)
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer1, ntpServer2);
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 3000)) {
      isTimeSynced = true;
      char tBuf[32];
      strftime(tBuf, sizeof(tBuf), "%Y-%m-%d %H:%M:%S", &timeinfo);
      Serial.print("🕒 Real-Time Clock Berhasil Disinkronkan (WIB GMT+7): ");
      Serial.println(tBuf);
    } else {
      Serial.println("⚠️ NTP Time Sync belum merespons, menggunakan waktu fallback.");
    }

    // 5. Inisialisasi OTA Update
    initOTA();

    // 6. Coba flush data offline jika ada
    flushOfflineData();
  }

  // Tes awal sensor PZEM
  Serial.println("\nMencoba membaca data dari sensor PZEM...");
  float testVoltage = pzem.voltage();
  if (!isnan(testVoltage)) {
    Serial.println("Status: PZEM BERHASIL TERHUBUNG! ✔");
    isSensorError = false;
  } else {
    Serial.println("Status: PZEM GAGAL KOMUNIKASI ❌ (Pastikan 5V DC & kabel RX/TX terpasang)");
    isSensorError = true;
  }

  Serial.println("=================================================\n");
}

void loop() {
  // Update status indikator LED internal secara non-blocking
  handleLEDStatus();

  // 1. Jika Portal Web Config Aktif, layani client hotspot
  if (isPortalActive) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    return;
  }

  // 2. Layani request Over-The-Air (OTA Update)
  ArduinoOTA.handle();

  // 3. Auto-Reconnect WiFi Non-Blocking
  unsigned long currentMillis = millis();
  if (currentMillis - lastWifiCheckMillis >= wifiCheckInterval) {
    lastWifiCheckMillis = currentMillis;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("⚠️ Jaringan WiFi Terputus! Merekam data ke buffer & mencoba reconnecting...");
      WiFi.reconnect();
    }
  }

  // 4. Mode Duty Cycle Berdasarkan Waktu Jam Dinding Nyata (NTP Sync / WIB GMT+7)
  struct tm timeinfo;
  bool timeValid = getLocalTime(&timeinfo, 10);
  if (timeValid) {
    // Tepat Menit 00..29 = DETEKSI AKTIF, Menit 30..59 = STANDBY ISTIRAHAT
    isStandbyPhase = (timeinfo.tm_min >= 30);
  } else {
    // Fallback jika belum tersinkronisasi NTP: gunakan millis
    unsigned long cycleTime = currentMillis % DUTY_CYCLE_TOTAL_MS;
    isStandbyPhase = (cycleTime >= DUTY_CYCLE_ACTIVE_MS);
  }

  if (isStandbyPhase) {
    static unsigned long lastStandbyLogMillis = 0;
    if (currentMillis - lastStandbyLogMillis >= 60000) { // Log tiap 1 menit
      lastStandbyLogMillis = currentMillis;
      int remainingMins = timeValid ? (60 - timeinfo.tm_min) : (int)((DUTY_CYCLE_TOTAL_MS - (currentMillis % DUTY_CYCLE_TOTAL_MS)) / 60000);
      Serial.print(deviceLabel);
      Serial.print(" 💤 Mode Standby Duty Cycle Jam Nyata. Deteksi berikutnya dalam ");
      Serial.print(remainingMins);
      Serial.println(" menit (Menit 00 Jam Berikutnya).");
    }
    return; // Fast return saat fase standby
  }

  // 5. Baca Sensor & Kirim Telemetry setiap 1 detik
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    float voltage   = pzem.voltage();
    float current   = pzem.current();
    float power     = pzem.power();
    float frequency = pzem.frequency();
    float pf        = pzem.pf();

    // 🌡️ Baca Suhu Internal Chip ESP32 & set status Overheating
    float espTemp   = temperatureRead();
    if (isnan(espTemp)) espTemp = 25.0;
    isOverheating   = (espTemp >= 80.0);

    String motorStatus;

    // A. Skenario Komunikasi Sensor Terputus
    if (isnan(voltage) || isnan(current)) {
      voltage = 0.0;
      current = 0.0;
      power = 0.0;
      pf = 0.0;
      frequency = 50.0;
      motorStatus = "SENSOR_DISCONNECTED";
      isSensorError = true;

      Serial.print(deviceLabel);
      Serial.println(" ERROR: Kabel Sensor PZEM Terputus dari ESP32! Status: SENSOR_DISCONNECTED.");
    }
    // B. Skenario Tegangan AC 0V / Motor OFF
    else if (voltage < 10.0 || current <= 0.05) {
      if (isnan(power)) power = 0.0;
      if (isnan(pf)) pf = 0.0;
      if (isnan(frequency)) frequency = 50.0;
      motorStatus = "OFF";
      isSensorError = false;

      Serial.print(deviceLabel); Serial.print(" V: "); Serial.print(voltage); Serial.print("V | ");
      Serial.print("I: "); Serial.print(current, 3); Serial.print("A | ");
      Serial.print("Suhu ESP32: "); Serial.print(espTemp, 1); Serial.print("°C | ");
      Serial.println("Status Motor: OFF");
    }
    // C. Skenario Normal (Motor ON)
    else {
      if (isnan(power)) power = 0.0;
      if (isnan(pf)) pf = 0.0;
      if (isnan(frequency)) frequency = 50.0;
      motorStatus = "ON";

      Serial.print(deviceLabel); Serial.print(" V: "); Serial.print(voltage); Serial.print("V | ");
      Serial.print("I: "); Serial.print(current, 3); Serial.print("A | ");
      Serial.print("P: "); Serial.print(power); Serial.print("W | ");
      Serial.print("PF: "); Serial.print(pf); Serial.print(" | ");
      Serial.print("Suhu ESP32: "); Serial.print(espTemp, 1); Serial.print("°C | ");
      Serial.println("Status Motor: ON");
    }

    char timestampStr[32] = "";
    if (timeValid) {
      strftime(timestampStr, sizeof(timestampStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
    } else {
      snprintf(timestampStr, sizeof(timestampStr), "NO_NTP_SYNC");
    }

    // Bentuk JSON Payload (Termasuk espTemp & real-time timestamp WIB)
    String jsonPayload = "{";
    jsonPayload += "\"motorId\":\"" + String(motorId) + "\",";
    jsonPayload += "\"voltage\":" + String(voltage) + ",";
    jsonPayload += "\"current\":" + String(current, 3) + ",";
    jsonPayload += "\"power\":" + String(power, 2) + ",";
    jsonPayload += "\"pf\":" + String(pf, 2) + ",";
    jsonPayload += "\"frequency\":" + String(frequency) + ",";
    jsonPayload += "\"espTemp\":" + String(espTemp, 1) + ",";
    jsonPayload += "\"timestamp\":\"" + String(timestampStr) + "\",";
    jsonPayload += "\"motorStatus\":\"" + motorStatus + "\"";
    jsonPayload += "}";

    // Pengiriman Data ke Backend atau Buffering Offline
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(cfgServerUrl);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-api-key", cfgApiKey);

      int httpResponseCode = http.POST(jsonPayload);

      if (httpResponseCode > 0) {
        Serial.print(deviceLabel); Serial.print(" Kirim Server Sukses! Code: ");
        Serial.println(httpResponseCode);

        // Jika berhasil terhubung, flush data offline yang tertunda jika ada
        flushOfflineData();
      } else {
        Serial.print(deviceLabel); Serial.print(" Server Gagal (Code: "); Serial.print(httpResponseCode); Serial.println("). Menyimpan ke LittleFS...");
        saveOfflineData(jsonPayload);
      }
      http.end();
    } else {
      // WiFi Mati -> Simpan data ke Offline Storage (LittleFS)
      saveOfflineData(jsonPayload);
    }
  }
}

// =========================================================================
// 📁 FUNGSI MEMORI & PREFERENCES
// =========================================================================
void loadConfig() {
  pref.begin("pzem_cfg", true);
  cfgSSID      = pref.getString("ssid", defaultSSID);
  cfgPassword  = pref.getString("pass", defaultPassword);
  cfgServerUrl = pref.getString("url", defaultServerUrl);
  cfgApiKey    = pref.getString("key", defaultApiKey);
  cfgMesinNo   = pref.getInt("mesin", DEFAULT_MESIN_NO);
  cfgMotorNo   = pref.getInt("motor", DEFAULT_MOTOR_NO);
  pref.end();
}

void saveConfig(String ssid, String pass, String url, String key, int mesin, int motor) {
  pref.begin("pzem_cfg", false);
  pref.putString("ssid", ssid);
  pref.putString("pass", pass);
  pref.putString("url", url);
  pref.putString("key", key);
  pref.putInt("mesin", mesin);
  pref.putInt("motor", motor);
  pref.end();
}

// =========================================================================
// 🌐 FUNGSI PORTAL CONFIGURASI WEB (HP / BROWSER)
// =========================================================================
void startConfigPortal() {
  isPortalActive = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESP32-PZEM-Setup");
  dnsServer.start(53, "*", WiFi.softAPIP());

  webServer.on("/", handlePortalRoot);
  webServer.on("/save", HTTP_POST, handlePortalSave);
  webServer.onNotFound(handlePortalRoot);
  webServer.begin();

  Serial.println("\n=================================================");
  Serial.println("🌐 PORTAL KONFIGURASI WIFI & SERVER AKTIF!");
  Serial.println("1. Connect ke WiFi Hotspot: ESP32-PZEM-Setup");
  Serial.println("2. Buka Browser & Akses: http://192.168.4.1");
  Serial.println("=================================================\n");
}

void handlePortalRoot() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<title>ESP32 PZEM Config</title><style>";
  html += "body{font-family:sans-serif;background:#ececec;padding:15px;color:#333}";
  html += ".card{background:#fff;border-radius:8px;padding:20px;max-width:400px;margin:auto;box-shadow:0 4px 10px rgba(0,0,0,0.1)}";
  html += "h2{color:#0046ad;margin-top:0}label{font-weight:bold;font-size:12px;display:block;margin-top:10px}";
  html += "input{width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}";
  html += "button{background:#0046ad;color:#fff;border:none;padding:12px;width:100%;margin-top:20px;border-radius:4px;font-weight:bold;cursor:pointer}";
  html += "</style></head><body><div class='card'>";
  html += "<h2>⚙️ IoT PZEM Config</h2>";
  html += "<form action='/save' method='POST'>";
  html += "<label>WiFi SSID:</label><input type='text' name='ssid' value='" + cfgSSID + "'>";
  html += "<label>WiFi Password:</label><input type='password' name='pass' value='" + cfgPassword + "'>";
  html += "<label>Server Ingest URL:</label><input type='text' name='url' value='" + cfgServerUrl + "'>";
  html += "<label>API Key:</label><input type='text' name='key' value='" + cfgApiKey + "'>";
  html += "<label>Nomor Mesin:</label><input type='number' name='mesin' value='" + String(cfgMesinNo) + "'>";
  html += "<label>Nomor Motor:</label><input type='number' name='motor' value='" + String(cfgMotorNo) + "'>";
  html += "<button type='submit'>💾 SIMPAN & RESTART</button>";
  html += "</form></div></body></html>";

  webServer.send(200, "text/html", html);
}

void handlePortalSave() {
  String newSSID  = webServer.arg("ssid");
  String newPass  = webServer.arg("pass");
  String newURL   = webServer.arg("url");
  String newKey   = webServer.arg("key");
  int newMesin    = webServer.arg("mesin").toInt();
  int newMotor    = webServer.arg("motor").toInt();

  saveConfig(newSSID, newPass, newURL, newKey, newMesin, newMotor);

  String html = "<html><body style='font-family:sans-serif;text-align:center;padding:50px;'>";
  html += "<h2>✔ Konfigurasi Berhasil Disimpan!</h2>";
  html += "<p>ESP32 sedang mrestart dan menghubungkan ke WiFi baru...</p></body></html>";

  webServer.send(200, "text/html", html);
  delay(2000);
  ESP.restart();
}

// =========================================================================
// 🚀 FUNGSI OVER-THE-AIR (OTA WIRELESS UPLOAD)
// =========================================================================
void initOTA() {
  String otaHost = "ESP32-PZEM-Mesin" + String(cfgMesinNo) + "-Motor" + String(cfgMotorNo);
  ArduinoOTA.setHostname(otaHost.c_str());

  ArduinoOTA.onStart([]() {
    isOTAUpdating = true;
    Serial.println("\n🚀 Memulai OTA Firmware Update...");
  });
  ArduinoOTA.onEnd([]() {
    isOTAUpdating = false;
    Serial.println("\n✔ OTA Update Selesai! Restarting ESP32...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("Progress OTA: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    isOTAUpdating = false;
    Serial.printf("Error OTA [%u]: ", error);
  });

  ArduinoOTA.begin();
  Serial.print("✔ OTA Status : Aktif (Hostname: ");
  Serial.print(otaHost);
  Serial.println(")");
}

// =========================================================================
// 💾 FUNGSI OFFLINE DATA BUFFERING (LITTLEFS)
// =========================================================================
void initLittleFS() {
  if (!LittleFS.begin(true)) {
    Serial.println("❌ LittleFS Gagal Di-mount!");
  } else {
    Serial.println("✔ LittleFS Offline Storage Siap!");
  }
}

void saveOfflineData(const String& payload) {
  int lineCount = 0;
  if (LittleFS.exists(bufferFilePath)) {
    File rFile = LittleFS.open(bufferFilePath, "r");
    while (rFile.available()) {
      if (rFile.read() == '\n') lineCount++;
    }
    rFile.close();
  }

  if (lineCount >= maxBufferLines) {
    Serial.println("⚠️ Buffer offline penuh (200 data). Menghindari akumulasi memori flash.");
    return;
  }

  File wFile = LittleFS.open(bufferFilePath, "a");
  if (wFile) {
    wFile.println(payload);
    wFile.close();
    Serial.println("[Offline Buffer] 💾 Data disimpan ke LittleFS Flash Memory.");
  }
}

void flushOfflineData() {
  if (!LittleFS.exists(bufferFilePath)) return;

  File file = LittleFS.open(bufferFilePath, "r");
  if (!file || file.size() == 0) {
    if (file) file.close();
    LittleFS.remove(bufferFilePath);
    return;
  }

  Serial.println("\n[Offline Buffer] 🔄 Memulai sinkronisasi data offline ke server...");

  String remainingData = "";
  int successCount = 0;

  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    HTTPClient http;
    http.begin(cfgServerUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-api-key", cfgApiKey);

    int code = http.POST(line);
    http.end();

    if (code > 0) {
      successCount++;
    } else {
      remainingData += line + "\n";
    }
    delay(50);
  }
  file.close();

  if (remainingData.length() > 0) {
    File wFile = LittleFS.open(bufferFilePath, "w");
    wFile.print(remainingData);
    wFile.close();
  } else {
    LittleFS.remove(bufferFilePath);
  }

  if (successCount > 0) {
    Serial.print("[Offline Buffer] ✔ Berhasil mengirim ");
    Serial.print(successCount);
    Serial.println(" data offline ke server backend!\n");
  }
}

// =========================================================================
// 💡 FUNGSI MANAGEMENT STATUS LED DIAGNOSTIK INTERNAL (GPIO 2)
// =========================================================================
void handleLEDStatus() {
  unsigned long now = millis();

  // 1. Mode OTA Firmware Updating -> Kedip Sangat Cepat (50ms)
  if (isOTAUpdating) {
    if (now - lastLEDBlinkMillis >= 50) {
      lastLEDBlinkMillis = now;
      ledState = !ledState;
      digitalWrite(LED_BUILTIN, ledState ? HIGH : LOW);
    }
    return;
  }

  // 2. Error Kritis (Sensor PZEM Disconnected ATAU Suhu Chip Overheating >= 80°C) -> SOLID ON
  if (isSensorError || isOverheating) {
    digitalWrite(LED_BUILTIN, HIGH);
    return;
  }

  // 3. Mode Web Config Portal Active (Hotspot Setup) -> Kedip Cepat (100ms)
  if (isPortalActive) {
    if (now - lastLEDBlinkMillis >= 100) {
      lastLEDBlinkMillis = now;
      ledState = !ledState;
      digitalWrite(LED_BUILTIN, ledState ? HIGH : LOW);
    }
    return;
  }

  // 4. Mode Offline / WiFi Terputus (LittleFS Buffering Active) -> Kedip Lambat (1000ms ON / 1000ms OFF)
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastLEDBlinkMillis >= 1000) {
      lastLEDBlinkMillis = now;
      ledState = !ledState;
      digitalWrite(LED_BUILTIN, ledState ? HIGH : LOW);
    }
    return;
  }

  // 5. Mode Standby Duty Cycle -> Pulse Lembut (100ms Nyala per 3 Detik)
  if (isStandbyPhase) {
    unsigned long cycle = now % 3000;
    digitalWrite(LED_BUILTIN, (cycle < 100) ? HIGH : LOW);
    return;
  }

  // 6. Mode Operasional Normal -> Heartbeat Blink (2x Kedip Singkat per 2 Detik)
  unsigned long cycle = now % 2000;
  if ((cycle >= 0 && cycle < 80) || (cycle >= 200 && cycle < 280)) {
    digitalWrite(LED_BUILTIN, HIGH);
  } else {
    digitalWrite(LED_BUILTIN, LOW);
  }
}
