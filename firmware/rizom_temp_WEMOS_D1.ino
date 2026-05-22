/*
 * ╔══════════════════════════════════════════════════════╗
 * ║  Rizom Temp — Firmware v2.0                          ║
 * ║  Hardware: Wemos D1 Mini (ESP8266)                   ║
 * ║  Sensor:   DS18B20 (1-Wire)                          ║
 * ║  Config:   Captive Portal Wi-Fi                      ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * PINAGEM — Wemos D1 Mini:
 * ┌─────────────┬────────┬──────────────────────────────┐
 * │ Componente  │ Pino   │ Observação                   │
 * ├─────────────┼────────┼──────────────────────────────┤
 * │ DS18B20 DAT │ D5     │ GPIO14 — Pull-up 4.7kΩ/3.3V  │
 * │ DS18B20 VCC │ 3.3V   │                              │
 * │ DS18B20 GND │ GND    │                              │
 * │ LED interno │ D4     │ GPIO2 — ativo em LOW         │
 * │ Botão reset │ D3     │ GPIO0 — botão FLASH (BOOT)   │
 * └─────────────┴────────┴──────────────────────────────┘
 *
 * BIBLIOTECAS NECESSÁRIAS (Gerenciador de Bibliotecas Arduino):
 *   - PubSubClient           (Nick O'Leary)        v2.8+
 *   - OneWire                (Paul Stoffregen)     v2.3+
 *   - DallasTemperature      (Miles Burton)        v3.9+
 *   - ArduinoJson            (Benoit Blanchon)     v6.x (NÃO v7)
 *   (EEPROM é built-in no core ESP8266 — não precisa instalar)
 *
 * PLACA: "LOLIN(WEMOS) D1 R2 & mini" — em Arduino IDE
 * ou "d1_mini" — em PlatformIO (platform = espressif8266)
 *
 * FLUXO DE PRIMEIRO USO:
 *   1. Grave o firmware via USB
 *   2. LED pisca rápido → portal ativo
 *   3. Conecte no Wi-Fi "RizomTemp-XXXX" (sem senha)
 *   4. Acesse 192.168.4.1 no navegador
 *   5. Preencha as configurações e salve
 *   6. Dispositivo reinicia e conecta automaticamente
 *
 * RESET DE CONFIGURAÇÕES:
 *   Mantenha D3 (botão FLASH) pressionado por 5 segundos
 *   → configurações apagadas → portal reabre
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <EEPROM.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>

#define PROVISIONING_URL "https://temp.rizom.com.br/provisioning/"

// ─── Pinos ────────────────────────────────────────────────────
#define PIN_DS18B20   14   // D5 — DS18B20 data
#define PIN_LED        2   // D4 — LED interno (ativo em LOW)
#define PIN_BOOT       0   // D3 — botão FLASH para reset

// ─── Tempos ───────────────────────────────────────────────────
#define INTERVALO_LEITURA_MS   60000UL
#define INTERVALO_HEARTBEAT_MS 120000UL
#define TIMEOUT_PORTAL_MS      300000UL
#define HOLD_RESET_MS          5000UL

// ─── Objetos ──────────────────────────────────────────────────
OneWire           oneWire(PIN_DS18B20);
DallasTemperature sensors(&oneWire);
ESP8266WebServer  portalServer(80);
WiFiClient        wifiClient;
PubSubClient      mqtt(wifiClient);

// ─── Configurações (salvas em EEPROM) ────────────────────────
#define EEPROM_MAGIC   0xAB
#define EEPROM_SIZE    512

struct Config {
  uint8_t magic      = 0;
  char wifiSSID[64]  = "";
  char wifiSenha[64] = "";
  char mqttHost[128] = "";
  int  mqttPort      = 1883;
  char mqttUser[64]  = "";
  char mqttSenha[64] = "";
  char deviceId[32]  = "";
  int  intervaloSeg  = 60;
  char codigo[7]     = "";
} cfg;

// ─── Estado ───────────────────────────────────────────────────
enum Estado { PORTAL, CONECTANDO, PROVISIONANDO, OPERANDO };
Estado estado = PORTAL;

float  ultimaTemp        = NAN;
bool   sensorOk          = false;
bool   mqttConectado     = false;
int    errosConsecutivos = 0;

unsigned long tsUltimaLeitura   = 0;
unsigned long tsUltimoHeartbeat = 0;
unsigned long tsInicioPortal    = 0;
unsigned long tsBootPressionado = 0;
bool          bootPressionado   = false;

unsigned long tsLed   = 0;
bool          ledState = false;

String deviceMac;

// ═══════════════════════════════════════════════════════════════
//  PERSISTÊNCIA — EEPROM
// ═══════════════════════════════════════════════════════════════
void salvarConfig() {
  cfg.magic = EEPROM_MAGIC;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("[EEPROM] Config salva.");
}

bool carregarConfig() {
  EEPROM.begin(EEPROM_SIZE);
  Config loaded;
  EEPROM.get(0, loaded);
  EEPROM.end();

  if (loaded.magic != EEPROM_MAGIC || strlen(loaded.wifiSSID) == 0) return false;

  cfg = loaded;
  return true;
}

void apagarConfig() {
  EEPROM.begin(EEPROM_SIZE);
  Config blank;
  EEPROM.put(0, blank);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("[EEPROM] Config apagada.");
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
  <p class="note">Rizom Temp v2.0 · Wemos D1 Mini<br>Segure D3 (FLASH) 5s para redefinir</p>
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
//  LED STATUS
// ═══════════════════════════════════════════════════════════════
void ledOn()  { digitalWrite(PIN_LED, LOW); }
void ledOff() { digitalWrite(PIN_LED, HIGH); }

void ledBlink(int intervaloMs = 200) {
  if (millis() - tsLed >= (unsigned long)intervaloMs) {
    ledState = !ledState;
    digitalWrite(PIN_LED, ledState ? LOW : HIGH);
    tsLed = millis();
  }
}

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

  portalServer.on("/", HTTP_GET, []() {
    portalServer.send_P(200, "text/html", PORTAL_HTML);
  });

  // Redireciona qualquer URL para o portal (captive portal)
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "");
  });

  portalServer.on("/save", HTTP_POST, []() {
    if (!portalServer.hasArg("plain")) {
      portalServer.send(400, "application/json", "{\"erro\":\"sem dados\"}");
      return;
    }

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, portalServer.arg("plain"));
    if (err) {
      portalServer.send(400, "application/json", "{\"erro\":\"json invalido\"}");
      return;
    }

    strlcpy(cfg.wifiSSID,  doc["ssid"]   | "", sizeof(cfg.wifiSSID));
    strlcpy(cfg.wifiSenha, doc["pass"]   | "", sizeof(cfg.wifiSenha));
    strlcpy(cfg.codigo,    doc["codigo"] | "", sizeof(cfg.codigo));
    cfg.mqttHost[0]  = '\0';
    cfg.deviceId[0]  = '\0';
    cfg.mqttPort     = 1883;
    cfg.intervaloSeg = 60;

    salvarConfig();
    portalServer.send(200, "application/json", "{\"ok\":true}");

    Serial.println("[Portal] Config salva. Reiniciando...");
    delay(1500);
    ESP.restart();
  });

  portalServer.begin();
  estado = PORTAL;
  tsInicioPortal = millis();
}

// ═══════════════════════════════════════════════════════════════
//  WI-FI
// ═══════════════════════════════════════════════════════════════
bool conectarWifi() {
  Serial.printf("[WiFi] Conectando em '%s'...\n", cfg.wifiSSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifiSSID, cfg.wifiSenha);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 40) {
    ledBlink(300);
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

  String clientId = "rizomtemp_d1_" + deviceMac;

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
    "{\"v\":\"2.0\",\"rssi\":%d,\"hw\":\"esp8266\"}",
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
//  BOTÃO D3 — RESET LONGO
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
    Serial.println("[Reset] Apagando config e reiniciando...");
    apagarConfig();
    delay(500);
    ESP.restart();
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

  Serial.println("[Prov] Buscando configuração no servidor...");

  BearSSL::WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;

  String url = String(PROVISIONING_URL) + String(cfg.codigo);
  Serial.printf("[Prov] GET %s\n", url.c_str());

  if (!http.begin(secureClient, url)) {
    Serial.println("[Prov] Falha ao iniciar HTTP.");
    return false;
  }

  http.setTimeout(10000);
  int httpCode = http.GET();
  Serial.printf("[Prov] HTTP %d\n", httpCode);

  if (httpCode != 200) {
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<256> doc;
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
  Serial.printf("[Prov] OK — device_id: %s | mqtt: %s:%d | intervalo: %ds\n",
    cfg.deviceId, cfg.mqttHost, cfg.mqttPort, cfg.intervaloSeg);
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== Rizom Temp v2.0 | Wemos D1 Mini ===");

  pinMode(PIN_LED,  OUTPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  ledOff();

  // MAC — últimos 6 chars para ID único do AP
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[7];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceMac = String(macStr);
  Serial.printf("[Info] MAC suffix: %s\n", macStr);

  // DS18B20
  sensors.begin();
  int numSensores = sensors.getDeviceCount();
  Serial.printf("[DS18B20] %d sensor(es) encontrado(s).\n", numSensores);
  if (numSensores == 0) {
    Serial.println("[DS18B20] AVISO: Nenhum sensor. Verifique fiação e pull-up 4.7kΩ em D5.");
  }

  // Carrega config
  if (carregarConfig() && strlen(cfg.wifiSSID) > 0) {
    Serial.printf("[FS] Config: SSID='%s' | MQTT='%s:%d' | ID='%s'\n",
      cfg.wifiSSID, cfg.mqttHost, cfg.mqttPort, cfg.deviceId);
    estado = CONECTANDO;
  } else {
    Serial.println("[FS] Sem config. Iniciando portal...");
    iniciarPortal();
  }
}

// ═══════════════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════════════
void loop() {
  verificarBotaoReset();
  unsigned long agora = millis();

  // ── MODO PORTAL ─────────────────────────────────────────────
  if (estado == PORTAL) {
    ledBlink(150);
    portalServer.handleClient();

    if (agora - tsInicioPortal > TIMEOUT_PORTAL_MS) {
      Serial.println("[Portal] Timeout. Reiniciando...");
      ESP.restart();
    }
    return;
  }

  // ── MODO CONECTANDO ─────────────────────────────────────────
  if (estado == CONECTANDO) {
    if (conectarWifi()) {
      delay(1000);
      estado = (strlen(cfg.codigo) == 6) ? PROVISIONANDO : OPERANDO;
    } else {
      Serial.println("[WiFi] Não conectou. Abrindo portal...");
      iniciarPortal();
    }
    return;
  }

  // ── MODO PROVISIONANDO ───────────────────────────────────────
  if (estado == PROVISIONANDO) {
    ledBlink(300);
    if (buscarConfigRemota()) {
      Serial.println("[Prov] Sucesso. Reiniciando...");
      delay(2000);
      ESP.restart();
    } else {
      Serial.println("[Prov] Falha. Abrindo portal...");
      delay(3000);
      iniciarPortal();
    }
    return;
  }

  // ── MODO OPERANDO ────────────────────────────────────────────
  if (estado == OPERANDO) {

    // Reconecta Wi-Fi se necessário
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Desconectado. Reconectando...");
      mqttConectado = false;
      ledBlink(300);
      conectarWifi();
      return;
    }

    // Mantém conexão MQTT
    if (!mqtt.connected()) {
      mqttConectado = false;
      conectarMQTT();
    }
    mqtt.loop();

    ledOn();

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
      }
    }

    // ── Heartbeat ────────────────────────────────────────────
    if (agora - tsUltimoHeartbeat >= INTERVALO_HEARTBEAT_MS || tsUltimoHeartbeat == 0) {
      if (mqtt.connected()) {
        publicarHeartbeat();
      }
      tsUltimoHeartbeat = agora;
    }
  }
}
