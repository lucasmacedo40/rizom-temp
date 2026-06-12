/*
 * ╔══════════════════════════════════════════════════════╗
 * ║  Rizom Temp — Firmware v2.0                          ║
 * ║  Hardware: ESP32-C3 Super Mini                       ║
 * ║  Sensor:   DS18B20 (1-Wire)                          ║
 * ║  Display:  OLED 0.96" I2C (SSD1306 128x64)          ║
 * ║  Config:   Captive Portal Wi-Fi                      ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * PINAGEM — ESP32-C3 Super Mini:
 * ┌─────────────┬────────┬──────────────────────────────┐
 * │ Componente  │ Pino   │ Observação                   │
 * ├─────────────┼────────┼──────────────────────────────┤
 * │ DS18B20 DAT │ GPIO2  │ Pull-up 4.7kΩ para 3.3V      │
 * │ DS18B20 VCC │ 3.3V   │                              │
 * │ DS18B20 GND │ GND    │                              │
 * │ OLED SDA    │ GPIO8  │ I2C padrão do C3 Super Mini  │
 * │ OLED SCL    │ GPIO9  │                              │
 * │ OLED VCC    │ 3.3V   │                              │
 * │ OLED GND    │ GND    │                              │
 * └─────────────┴────────┴──────────────────────────────┘
 *
 * BIBLIOTECAS NECESSÁRIAS (Arduino IDE → Library Manager):
 *   - PubSubClient           (Nick O'Leary)        v2.8+
 *   - OneWire                (Paul Stoffregen)     v2.3+
 *   - DallasTemperature      (Miles Burton)        v3.9+
 *   - Adafruit SSD1306       (Adafruit)            v2.5+
 *   - Adafruit GFX Library   (Adafruit)            v1.11+
 *   - ArduinoJson            (Benoit Blanchon)     v7+
 *
 * CONFIGURAÇÃO DA PLACA (Arduino IDE):
 *   Boards Manager URL: https://raw.githubusercontent.com/espressif/
 *                       arduino-esp32/gh-pages/package_esp32_index.json
 *   Placa: "ESP32C3 Dev Module"
 *   USB CDC On Boot: Enabled  ← obrigatório para Serial funcionar
 *   Flash Size: 4MB
 *   Partition Scheme: Default 4MB with spiffs
 *
 * FLUXO DE PRIMEIRO USO:
 *   1. Grave o firmware no ESP32-C3
 *   2. LED pisca rápido → portal ativo
 *   3. Conecte no Wi-Fi "RizomTemp-XXXX" (sem senha)
 *   4. Acesse 192.168.4.1 no navegador
 *   5. Preencha as configurações e salve
 *   6. Dispositivo reinicia e conecta automaticamente
 *
 * RESET DE CONFIGURAÇÕES:
 *   Mantenha GPIO3 (botão BOOT do C3 Super Mini) pressionado
 *   por 5 segundos → configurações apagadas → portal reabre
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#define PROVISIONING_URL "https://temp.rizom.com.br/provisioning/"

// ─── Pinos ────────────────────────────────────────────────────
#define PIN_DS18B20   2    // DS18B20 data
#define PIN_SDA       8    // OLED SDA
#define PIN_SCL       9    // OLED SCL
#define PIN_LED       8    // LED interno do C3 Super Mini (ativo em LOW)
#define PIN_BOOT      9    // Botão BOOT para reset (GPIO9 no C3 Super Mini)

// ─── OLED ─────────────────────────────────────────────────────
#define OLED_W   128
#define OLED_H   64
#define OLED_ADDR 0x3C

// ─── Tempos ───────────────────────────────────────────────────
#define INTERVALO_LEITURA_MS   60000UL   // leitura a cada 60s
#define INTERVALO_HEARTBEAT_MS 120000UL  // heartbeat a cada 2min
#define INTERVALO_DISPLAY_MS   5000UL    // ciclo de tela a cada 5s
#define TIMEOUT_PORTAL_MS      300000UL  // portal fecha após 5min sem config
#define HOLD_RESET_MS          5000UL    // segurar 5s para resetar config

// ─── Objetos ──────────────────────────────────────────────────
OneWire           oneWire(PIN_DS18B20);
DallasTemperature sensors(&oneWire);
Adafruit_SSD1306  oled(OLED_W, OLED_H, &Wire, -1);
WebServer         portalServer(80);
WiFiClient        wifiClient;
PubSubClient      mqtt(wifiClient);
Preferences       prefs;

// ─── Configurações (salvas em NVS) ───────────────────────────
struct Config {
  char wifiSSID[64]     = "";
  char wifiSenha[64]    = "";
  char mqttHost[128]    = "";
  int  mqttPort         = 1883;
  char mqttUser[64]     = "";
  char mqttSenha[64]    = "";
  char deviceId[32]     = "";
  int  intervaloSeg     = 60;
  char codigo[7]        = "";
} cfg;

// ─── Estado ───────────────────────────────────────────────────
enum Estado { PORTAL, CONECTANDO, PROVISIONANDO, OPERANDO, ERRO };
Estado estado = PORTAL;

float     ultimaTemp        = NAN;
bool      sensorOk          = false;
bool      mqttConectado     = false;
int       errosConsecutivos = 0;
uint8_t   displayTela       = 0;

unsigned long tsUltimaLeitura   = 0;
unsigned long tsUltimoHeartbeat = 0;
unsigned long tsUltimoDisplay   = 0;
unsigned long tsInicioPortal    = 0;
unsigned long tsBootPressionado = 0;
bool          bootPressionado   = false;

String deviceMac;  // últimos 6 chars do MAC

// ═══════════════════════════════════════════════════════════════
//  PERSISTÊNCIA — NVS (Non-Volatile Storage)
// ═══════════════════════════════════════════════════════════════
void salvarConfig() {
  prefs.begin("rizom", false);
  prefs.putString("ssid",      cfg.wifiSSID);
  prefs.putString("pass",      cfg.wifiSenha);
  prefs.putString("mqttHost",  cfg.mqttHost);
  prefs.putInt   ("mqttPort",  cfg.mqttPort);
  prefs.putString("mqttUser",  cfg.mqttUser);
  prefs.putString("mqttPass",  cfg.mqttSenha);
  prefs.putString("deviceId",  cfg.deviceId);
  prefs.putInt   ("intervalo", cfg.intervaloSeg);
  prefs.putString("codigo",    cfg.codigo);
  prefs.end();
  Serial.println("[NVS] Config salva.");
}

bool carregarConfig() {
  prefs.begin("rizom", true);
  String ssid = prefs.getString("ssid", "");
  if (ssid.isEmpty()) { prefs.end(); return false; }
  ssid.toCharArray(cfg.wifiSSID, sizeof(cfg.wifiSSID));
  prefs.getString("pass",      "").toCharArray(cfg.wifiSenha, sizeof(cfg.wifiSenha));
  prefs.getString("mqttHost",  "").toCharArray(cfg.mqttHost,  sizeof(cfg.mqttHost));
  cfg.mqttPort = prefs.getInt("mqttPort", 1883);
  prefs.getString("mqttUser",  "").toCharArray(cfg.mqttUser,  sizeof(cfg.mqttUser));
  prefs.getString("mqttPass",  "").toCharArray(cfg.mqttSenha, sizeof(cfg.mqttSenha));
  prefs.getString("deviceId",  "").toCharArray(cfg.deviceId,  sizeof(cfg.deviceId));
  cfg.intervaloSeg = prefs.getInt("intervalo", 60);
  prefs.getString("codigo", "").toCharArray(cfg.codigo, sizeof(cfg.codigo));
  prefs.end();
  return true;
}

void apagarConfig() {
  prefs.begin("rizom", false);
  prefs.clear();
  prefs.end();
  Serial.println("[NVS] Config apagada — resetando...");
}

// ═══════════════════════════════════════════════════════════════
//  OLED — TELAS
// ═══════════════════════════════════════════════════════════════
void oledLimpar() { oled.clearDisplay(); }
void oledAtualizar() { oled.display(); }

void telaTemperatura() {
  oledLimpar();

  // Cabeçalho
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.print("RIZOM TEMP");
  oled.setCursor(80, 0);
  oled.print(mqttConectado ? "MQTT OK" : "sem MQTT");

  // Linha separadora
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  if (sensorOk && !isnan(ultimaTemp)) {
    // Temperatura grande
    oled.setTextSize(3);
    oled.setCursor(8, 16);
    if (ultimaTemp < 0) {
      oled.print(ultimaTemp, 1);
    } else {
      oled.print(" ");
      oled.print(ultimaTemp, 1);
    }
    // Unidade
    oled.setTextSize(2);
    oled.setCursor(100, 18);
    oled.print("*C");
  } else {
    oled.setTextSize(2);
    oled.setCursor(16, 22);
    oled.print("SEM SENSOR");
  }

  // Rodapé
  oled.drawLine(0, 53, 127, 53, SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 56);
  oled.print(cfg.deviceId[0] ? cfg.deviceId : deviceMac.c_str());

  oledAtualizar();
}

void telaStatus() {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);

  oled.setCursor(0, 0);  oled.print("STATUS DO SISTEMA");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  oled.setCursor(0, 14);
  oled.print("Wi-Fi: ");
  oled.print(WiFi.status() == WL_CONNECTED ? WiFi.SSID().substring(0,14) : "offline");

  oled.setCursor(0, 24);
  oled.print("MQTT:  ");
  oled.print(mqttConectado ? "conectado" : "desconectado");

  oled.setCursor(0, 34);
  oled.print("Sensor:");
  oled.print(sensorOk ? " OK" : " FALHA");

  oled.setCursor(0, 44);
  oled.print("Erros: ");
  oled.print(errosConsecutivos);

  oled.setCursor(0, 54);
  char ipBuf[20];
  WiFi.localIP().toString().toCharArray(ipBuf, sizeof(ipBuf));
  oled.print(ipBuf);

  oledAtualizar();
}

void telaPortal(String ssidPortal) {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);

  oled.setCursor(0, 0);   oled.print("CONFIGURACAO");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 14);  oled.print("Wi-Fi:");
  oled.setCursor(0, 24);  oled.print(ssidPortal);
  oled.setCursor(0, 36);  oled.print("Acesse:");
  oled.setCursor(0, 46);  oled.print("192.168.4.1");

  oledAtualizar();
}

void telaConectando() {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(28, 20);
  oled.print("Conectando...");
  oled.setCursor(0, 36);
  oled.print(cfg.wifiSSID);
  oledAtualizar();
}

void telaErro(const char* msg) {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);   oled.print("! ERRO !");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 16);  oled.print(msg);
  oledAtualizar();
}

void telaProvisionando() {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);   oled.print("PROVISIONANDO");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 18);  oled.print("Buscando config");
  oled.setCursor(0, 28);  oled.print("no servidor...");
  oledAtualizar();
}

// ═══════════════════════════════════════════════════════════════
//  CAPTIVE PORTAL — HTML
// ═══════════════════════════════════════════════════════════════
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rizom Temp — Configuração</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0D1526;color:#EDF2FF;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#111827;border:1px solid rgba(26,110,255,.2);border-radius:20px;padding:28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.logo{font-size:20px;font-weight:800;margin-bottom:6px}
.logo span{color:#4F8EF7}
.sub{font-size:13px;color:#6B7A9F;margin-bottom:24px}
.group{margin-bottom:16px}
label{display:block;font-size:11px;color:#6B7A9F;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.8px}
input{width:100%;padding:12px 14px;background:#1a2235;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#EDF2FF;font-size:15px;outline:none;transition:border-color .2s}
input:focus{border-color:#1A6EFF}
input[name=codigo]{font-size:22px;font-weight:800;letter-spacing:6px;text-align:center;font-family:monospace}
.btn{width:100%;padding:14px;background:#1A6EFF;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px}
.btn:hover{opacity:.85}
.ok{display:none;background:rgba(5,150,105,.1);border:1px solid rgba(5,150,105,.3);border-radius:12px;padding:16px;text-align:center;color:#059669;font-size:14px;margin-top:16px}
.note{font-size:11px;color:#2A3354;text-align:center;margin-top:14px;line-height:1.6}
</style></head><body>
<div class="card">
  <div class="logo">Rizom<span>Temp</span></div>
  <div class="sub">Configure o dispositivo em 3 passos</div>
  <form id="f">
    <div class="group">
      <label>Nome da rede Wi-Fi</label>
      <input name="ssid" placeholder="MinhaRede" required autocomplete="off">
    </div>
    <div class="group">
      <label>Senha do Wi-Fi</label>
      <input name="pass" type="password" placeholder="••••••••">
    </div>
    <div class="group">
      <label>Código do dashboard</label>
      <input name="codigo" placeholder="000000" maxlength="6" pattern="\d{6}" required inputmode="numeric">
    </div>
    <button class="btn" type="submit">Conectar</button>
  </form>
  <div class="ok" id="ok">✓ Conectando e buscando configuração...</div>
  <p class="note">Rizom Temp v2.0 · ESP32-C3<br>Segure BOOT 5s para redefinir</p>
</div>
<script>
document.getElementById('f').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(e.target));
  const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  if(r.ok){document.getElementById('f').style.opacity='.3';document.getElementById('ok').style.display='block';}
});
</script>
</body></html>
)rawliteral";

// ═══════════════════════════════════════════════════════════════
//  CAPTIVE PORTAL — SERVIDOR
// ═══════════════════════════════════════════════════════════════
void iniciarPortal() {
  String ssidPortal = "RizomTemp-" + deviceMac;

  WiFi.mode(WIFI_AP);
  WiFi.softAP(ssidPortal.c_str());
  delay(100);

  Serial.printf("[Portal] AP: %s | IP: %s\n",
    ssidPortal.c_str(),
    WiFi.softAPIP().toString().c_str()
  );

  // Rota principal
  portalServer.on("/", HTTP_GET, []() {
    portalServer.send_P(200, "text/html", PORTAL_HTML);
  });

  // Captura qualquer URL para redirecionar ao portal (captive)
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "");
  });

  // Salvar configurações
  portalServer.on("/save", HTTP_POST, []() {
    if (!portalServer.hasArg("plain")) {
      portalServer.send(400, "application/json", "{\"erro\":\"sem dados\"}");
      return;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, portalServer.arg("plain"));
    if (err) {
      portalServer.send(400, "application/json", "{\"erro\":\"json invalido\"}");
      return;
    }

    // Preenche config
    strlcpy(cfg.wifiSSID,  doc["ssid"]    | "", sizeof(cfg.wifiSSID));
    strlcpy(cfg.wifiSenha, doc["pass"]    | "", sizeof(cfg.wifiSenha));
    strlcpy(cfg.codigo,    doc["codigo"]  | "", sizeof(cfg.codigo));
    // Limpa campos que serão preenchidos pelo provisionamento
    cfg.mqttHost[0]  = '\0';
    cfg.deviceId[0]  = '\0';
    cfg.mqttPort     = 1883;
    cfg.intervaloSeg = 60;

    salvarConfig();
    portalServer.send(200, "application/json", "{\"ok\":true}");

    Serial.println("[Portal] Config salva via portal. Reiniciando...");
    delay(1500);
    ESP.restart();
  });

  portalServer.begin();
  estado = PORTAL;
  tsInicioPortal = millis();
  telaPortal(ssidPortal);
}

// ═══════════════════════════════════════════════════════════════
//  WI-FI
// ═══════════════════════════════════════════════════════════════
bool conectarWifi() {
  Serial.printf("[WiFi] Conectando em '%s'...\n", cfg.wifiSSID);
  telaConectando();

  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifiSSID, cfg.wifiSenha);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 40) {
    delay(500);
    tentativas++;
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] OK — IP: %s | RSSI: %d dBm\n",
      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }

  Serial.println("[WiFi] Falha na conexão.");
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  MQTT
// ═══════════════════════════════════════════════════════════════
String topicoTemp()      { return "rizomtemp/" + String(cfg.deviceId) + "/temperatura"; }
String topicoHeartbeat() { return "rizomtemp/" + String(cfg.deviceId) + "/heartbeat"; }

bool conectarMQTT() {
  if (mqtt.connected()) return true;

  mqtt.setServer(cfg.mqttHost, cfg.mqttPort);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);

  String clientId = "rizomtemp_c3_" + deviceMac;

  Serial.printf("[MQTT] Conectando em %s:%d...\n", cfg.mqttHost, cfg.mqttPort);

  bool ok = (strlen(cfg.mqttUser) > 0)
    ? mqtt.connect(clientId.c_str(), cfg.mqttUser, cfg.mqttSenha)
    : mqtt.connect(clientId.c_str());

  mqttConectado = ok;

  if (ok) {
    Serial.println("[MQTT] Conectado.");
  } else {
    Serial.printf("[MQTT] Falha (rc=%d)\n", mqtt.state());
  }
  return ok;
}

void publicarTemperatura(float temp) {
  // Payload compacto: {"t":-17.2,"v":"2.0","rssi":-65}
  char payload[80];
  snprintf(payload, sizeof(payload),
    "{\"t\":%.2f,\"v\":\"2.0\",\"rssi\":%d}",
    temp, WiFi.RSSI()
  );

  if (mqtt.publish(topicoTemp().c_str(), payload, true)) {
    Serial.printf("[MQTT] Publicado: %s\n", payload);
  } else {
    Serial.println("[MQTT] Falha ao publicar temperatura.");
    mqttConectado = false;
  }
}

void publicarHeartbeat() {
  char payload[64];
  snprintf(payload, sizeof(payload),
    "{\"v\":\"2.0\",\"rssi\":%d,\"hw\":\"esp32c3\"}",
    WiFi.RSSI()
  );
  mqtt.publish(topicoHeartbeat().c_str(), payload);
  Serial.printf("[HB] RSSI: %d dBm\n", WiFi.RSSI());
}

// ═══════════════════════════════════════════════════════════════
//  SENSOR DS18B20
// ═══════════════════════════════════════════════════════════════
float lerTemperatura() {
  sensors.requestTemperatures();
  float t = sensors.getTempCByIndex(0);

  // Valores inválidos do DS18B20
  if (t == DEVICE_DISCONNECTED_C || t == 85.0f || t < -55.0f || t > 125.0f) {
    sensorOk = false;
    errosConsecutivos++;
    Serial.printf("[Sensor] Leitura inválida: %.1f — erro #%d\n", t, errosConsecutivos);
    return NAN;
  }

  sensorOk = true;
  errosConsecutivos = 0;
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  LED STATUS (built-in, ativo em LOW no C3 Super Mini)
// ═══════════════════════════════════════════════════════════════
void ledOn()  { digitalWrite(PIN_LED, LOW); }
void ledOff() { digitalWrite(PIN_LED, HIGH); }

unsigned long tsLed = 0;
bool ledState = false;

void ledBlink(int intervaloMs = 200) {
  if (millis() - tsLed >= (unsigned long)intervaloMs) {
    ledState = !ledState;
    digitalWrite(PIN_LED, ledState ? LOW : HIGH);
    tsLed = millis();
  }
}

// ═══════════════════════════════════════════════════════════════
//  BOTÃO BOOT — RESET LONGO
// ═══════════════════════════════════════════════════════════════
void verificarBotaoReset() {
  bool pressionado = (digitalRead(PIN_BOOT) == LOW);

  if (pressionado && !bootPressionado) {
    bootPressionado = true;
    tsBootPressionado = millis();
  } else if (!pressionado) {
    bootPressionado = false;
  }

  if (bootPressionado && (millis() - tsBootPressionado >= HOLD_RESET_MS)) {
    telaErro("Resetando config...");
    delay(1000);
    apagarConfig();
    delay(500);
    ESP.restart();
  }
}

// ═══════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== Rizom Temp v2.0 | ESP32-C3 Super Mini ===");

  // Pinos
  pinMode(PIN_LED,  OUTPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  ledOff();

  // MAC para ID único — usando API Arduino (compatível com todos os cores ESP32)
  uint8_t mac[6];
  WiFi.macAddress(mac);  // preenche mac[0..5] com o MAC da STA
  char macStr[7];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceMac = String(macStr);
  Serial.printf("[Info] MAC suffix: %s\n", macStr);

  // I2C e OLED
  Wire.begin(PIN_SDA, PIN_SCL);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] Falha ao inicializar — verifique os pinos I2C.");
    // Continua sem OLED
  } else {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(24, 20); oled.print("Rizom Temp v2");
    oled.setCursor(28, 36); oled.print("Iniciando...");
    oled.display();
    Serial.println("[OLED] OK.");
  }
  delay(1200);

  // Sensor DS18B20
  sensors.begin();
  int numSensores = sensors.getDeviceCount();
  Serial.printf("[DS18B20] %d sensor(es) encontrado(s).\n", numSensores);
  if (numSensores == 0) {
    Serial.println("[DS18B20] AVISO: Nenhum sensor detectado. Verifique a fiação e o pull-up de 4.7kΩ.");
  }

  // Carrega config salva
  if (carregarConfig()) {
    Serial.printf("[NVS] Config carregada: SSID='%s' | MQTT='%s:%d' | ID='%s'\n",
      cfg.wifiSSID, cfg.mqttHost, cfg.mqttPort, cfg.deviceId);
    estado = CONECTANDO;
  } else {
    Serial.println("[NVS] Sem config salva. Iniciando portal...");
    iniciarPortal();
  }
}

// ═══════════════════════════════════════════════════════════════
//  PROVISIONAMENTO
// ═══════════════════════════════════════════════════════════════
bool buscarConfigRemota() {
  if (strlen(cfg.codigo) != 6) {
    Serial.println("[Prov] Código ausente ou inválido.");
    return false;
  }

  telaProvisionando();

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;

  String url = String(PROVISIONING_URL) + String(cfg.codigo);
  Serial.printf("[Prov] GET %s\n", url.c_str());

  http.begin(secureClient, url);
  http.setTimeout(10000);
  int httpCode = http.GET();

  Serial.printf("[Prov] HTTP %d\n", httpCode);

  if (httpCode != 200) {
    Serial.printf("[Prov] Falha: HTTP %d\n", httpCode);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.println("[Prov] JSON inválido.");
    return false;
  }

  strlcpy(cfg.deviceId,  doc["device_id"] | "", sizeof(cfg.deviceId));
  strlcpy(cfg.mqttHost,  doc["mqtt_host"] | "", sizeof(cfg.mqttHost));
  cfg.mqttPort     = doc["mqtt_port"]     | 1883;
  cfg.intervaloSeg = doc["intervalo_seg"] | 60;
  cfg.codigo[0]    = '\0';

  if (strlen(cfg.deviceId) == 0 || strlen(cfg.mqttHost) == 0) {
    Serial.println("[Prov] Config incompleta recebida.");
    return false;
  }

  salvarConfig();
  Serial.printf("[Prov] OK — device_id: %s | mqtt: %s:%d\n",
    cfg.deviceId, cfg.mqttHost, cfg.mqttPort);
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════════════
void loop() {
  verificarBotaoReset();
  unsigned long agora = millis();

  // ── MODO PORTAL ─────────────────────────────────────────────
  if (estado == PORTAL) {
    ledBlink(150);          // pisca rápido no portal
    portalServer.handleClient();

    // Timeout do portal
    if (agora - tsInicioPortal > TIMEOUT_PORTAL_MS) {
      Serial.println("[Portal] Timeout. Reiniciando...");
      ESP.restart();
    }
    return;
  }

  // ── MODO CONECTANDO ─────────────────────────────────────────
  if (estado == CONECTANDO) {
    ledBlink(500);
    if (conectarWifi()) {
      delay(1500); // aguarda TCP stack estabilizar
      if (strlen(cfg.codigo) == 6) {
        estado = PROVISIONANDO;
      } else {
        estado = OPERANDO;
      }
    } else {
      Serial.println("[WiFi] Não conseguiu conectar. Abrindo portal...");
      iniciarPortal();
    }
    return;
  }

  // ── MODO PROVISIONANDO ───────────────────────────────────────
  if (estado == PROVISIONANDO) {
    ledBlink(300);
    if (buscarConfigRemota()) {
      oledLimpar();
      oled.setTextSize(1);
      oled.setTextColor(SSD1306_WHITE);
      oled.setCursor(16, 20); oled.print("Config recebida!");
      oled.setCursor(28, 36); oled.print("Reiniciando...");
      oledAtualizar();
      delay(2000);
      ESP.restart();
    } else {
      telaErro("Codigo invalido\nou expirado.\nAbrindo portal...");
      delay(3000);
      iniciarPortal();
    }
    return;
  }

  // ── MODO OPERANDO ────────────────────────────────────────────
  if (estado == OPERANDO) {

    // Verifica Wi-Fi
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Desconectado. Reconectando...");
      mqttConectado = false;
      ledBlink(300);
      conectarWifi();
      return;
    }

    // Tenta conectar/manter MQTT
    if (!mqtt.connected()) {
      mqttConectado = false;
      conectarMQTT();
    }
    mqtt.loop();

    ledOn(); // LED fixo quando operando normalmente

    // ── Leitura de temperatura ──────────────────────────────
    unsigned long intervaloMs = (unsigned long)cfg.intervaloSeg * 1000UL;
    if (agora - tsUltimaLeitura >= intervaloMs || tsUltimaLeitura == 0) {
      float temp = lerTemperatura();
      ultimaTemp = temp;
      tsUltimaLeitura = agora;

      if (!isnan(temp)) {
        Serial.printf("[Temp] %.2f°C\n", temp);
        if (mqtt.connected()) {
          publicarTemperatura(temp);
        }
      } else {
        Serial.println("[Temp] Leitura inválida — não publicado.");
        if (errosConsecutivos >= 5) {
          telaErro("Sensor desconectado!");
        }
      }
    }

    // ── Heartbeat ────────────────────────────────────────────
    if (agora - tsUltimoHeartbeat >= INTERVALO_HEARTBEAT_MS || tsUltimoHeartbeat == 0) {
      if (mqtt.connected()) {
        publicarHeartbeat();
      }
      tsUltimoHeartbeat = agora;
    }

    // ── Ciclo de display ──────────────────────────────────────
    if (agora - tsUltimoDisplay >= INTERVALO_DISPLAY_MS) {
      displayTela = (displayTela + 1) % 2;
      tsUltimoDisplay = agora;
    }

    if (displayTela == 0) {
      telaTemperatura();
    } else {
      telaStatus();
    }
  }
}
