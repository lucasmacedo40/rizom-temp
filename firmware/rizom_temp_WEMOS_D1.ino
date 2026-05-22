/*
 * Rizom Temp — Firmware v2.0
 * Hardware: Wemos D1 Mini (ESP8266)
 * Sensor:   DS18B20 no pino D5 (GPIO14)
 *
 * Pinagem:
 *   D5 (GPIO14) — DS18B20 DATA + pull-up 4.7kΩ para 3.3V
 *   D4 (GPIO2)  — LED interno (ativo em LOW)
 *   D3 (GPIO0)  — botão FLASH: segure 5s para apagar config
 *
 * Bibliotecas (instalar no Gerenciador de Bibliotecas):
 *   PubSubClient     (Nick O'Leary)    v2.8+
 *   OneWire          (Paul Stoffregen) v2.3+
 *   DallasTemperature (Miles Burton)  v3.9+
 *
 * Placa: "LOLIN(WEMOS) D1 R2 & mini"
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <EEPROM.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LittleFS.h>

// ─── Pinos ────────────────────────────────────────────────────
#define PIN_SENSOR  14   // D5
#define PIN_LED      2   // D4 — ativo em LOW
#define PIN_RESET    0   // D3 — botão FLASH

// ─── Constantes ───────────────────────────────────────────────
#define PROVISIONING_URL  "https://temp.rizom.com.br/provisioning/"
#define EEPROM_MAGIC      0xAC
#define EEPROM_SIZE       640
#define PORTAL_TIMEOUT_MS 300000UL
#define RESET_HOLD_MS     5000UL

// ─── Config persistida em EEPROM ──────────────────────────────
struct Config {
  uint8_t magic      = 0;
  char ssid[64]      = "";
  char pass[64]      = "";
  char mqttHost[128] = "";
  int  mqttPort      = 1883;
  char deviceId[32]  = "";
  int  intervalo     = 60;
  char codigo[7]     = "";
  char portalUser[32] = "admin";
  char portalPass[32] = "rizom";
  char deviceName[32] = "RizomTemp";
} cfg;

void salvarConfig() {
  cfg.magic = EEPROM_MAGIC;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
}

bool carregarConfig() {
  EEPROM.begin(EEPROM_SIZE);
  Config tmp;
  EEPROM.get(0, tmp);
  EEPROM.end();
  if (tmp.magic != EEPROM_MAGIC || tmp.ssid[0] == '\0') return false;
  cfg = tmp;
  return true;
}

void apagarConfig() {
  EEPROM.begin(EEPROM_SIZE);
  Config blank;
  EEPROM.put(0, blank);
  EEPROM.commit();
  EEPROM.end();
}

// ─── Objetos ──────────────────────────────────────────────────
OneWire           oneWire(PIN_SENSOR);
DallasTemperature ds(&oneWire);
ESP8266WebServer  portal(80);
WiFiClient        net;
PubSubClient      mqtt(net);

String deviceMac;
String sessionToken = "";


// ─── Histórico de temperatura em RAM ──────────────────────────
#define HIST_SIZE 20

struct Leitura { unsigned long ts; float t; };
Leitura historico[HIST_SIZE];
int histCount = 0, histHead = 0;

void pushLeitura(float temp) {
  historico[histHead] = {millis(), temp};
  histHead = (histHead + 1) % HIST_SIZE;
  if (histCount < HIST_SIZE) histCount++;
}

String histJson() {
  String j = "[";
  int start = (histCount < HIST_SIZE) ? 0 : histHead;
  for (int i = 0; i < histCount; i++) {
    int idx = (start + i) % HIST_SIZE;
    if (i > 0) j += ",";
    unsigned long age = (millis() - historico[idx].ts) / 1000;
    j += "{"age":" + String(age) + ","t":" + String(historico[idx].t, 2) + "}";
  }
  return j + "]";
}

// ─── Sessão e helpers do portal ───────────────────────────────
String gerarToken() {
  String t = "";
  for (int i = 0; i < 32; i++) t += String(random(16), HEX);
  return t;
}

void servirArquivo(const String& path, const String& ct) {
  if (!LittleFS.exists(path)) { portal.send(404, "text/plain", "Not found"); return; }
  File f = LittleFS.open(path, "r");
  portal.streamFile(f, ct);
  f.close();
}

bool verificarSessao() {
  if (sessionToken.length() == 0) {
    portal.sendHeader("Location", "/login");
    portal.send(302, "text/plain", "");
    return false;
  }
  String cookie = portal.header("Cookie");
  if (cookie.indexOf("sid=" + sessionToken) >= 0) return true;
  portal.sendHeader("Location", "/login");
  portal.send(302, "text/plain", "");
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS — parsing JSON simples (sem biblioteca externa)
// ═══════════════════════════════════════════════════════════════
String jsonStr(const String& json, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int i = json.indexOf(needle);
  if (i < 0) return "";
  i += needle.length();
  int j = json.indexOf('"', i);
  return (j < 0) ? "" : json.substring(i, j);
}

int jsonInt(const String& json, const char* key, int def) {
  String needle = String("\"") + key + "\":";
  int i = json.indexOf(needle);
  if (i < 0) return def;
  return json.substring(i + needle.length()).toInt();
}

// ═══════════════════════════════════════════════════════════════
//  LED
// ═══════════════════════════════════════════════════════════════
unsigned long tsLed = 0;
bool ledState = false;

void ledOn()  { digitalWrite(PIN_LED, LOW); }
void ledOff() { digitalWrite(PIN_LED, HIGH); }

void ledBlink(int ms) {
  if (millis() - tsLed >= (unsigned long)ms) {
    ledState = !ledState;
    digitalWrite(PIN_LED, ledState ? LOW : HIGH);
    tsLed = millis();
  }
}

// ═══════════════════════════════════════════════════════════════
//  CAPTIVE PORTAL
// ═══════════════════════════════════════════════════════════════
const char PORTAL_HTML[] PROGMEM = R"html(
<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rizom Temp</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#F5F7FA;min-height:100vh;display:flex;align-items:center;
       justify-content:center;padding:20px}
  .card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;
        padding:32px;width:100%;max-width:360px;
        box-shadow:0 4px 24px rgba(0,0,0,.08)}
  h1{font-size:18px;font-weight:700;color:#1A202C;margin-bottom:4px}
  h1 span{color:#2563EB}
  p{font-size:13px;color:#64748B;margin-bottom:24px}
  label{display:block;font-size:11px;font-weight:600;color:#475569;
        text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
  .field{margin-bottom:16px}
  input{width:100%;padding:11px 14px;border:1px solid #CBD5E1;border-radius:10px;
        font-size:15px;color:#1A202C;outline:none;transition:border-color .15s;
        background:#fff}
  input:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
  input[name=codigo]{font-size:24px;font-weight:700;letter-spacing:8px;
                     text-align:center;font-family:monospace}
  button{width:100%;padding:13px;background:#2563EB;color:#fff;border:none;
         border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;
         margin-top:4px;transition:background .15s}
  button:hover{background:#1D4ED8}
  .ok{display:none;margin-top:16px;padding:14px;background:#F0FDF4;
      border:1px solid #BBF7D0;border-radius:10px;color:#166534;
      font-size:14px;text-align:center}
  .note{font-size:11px;color:#94A3B8;text-align:center;margin-top:16px}
</style></head><body>
<div class="card">
  <h1>Rizom<span>Temp</span></h1>
  <p>Configure o dispositivo para começar a monitorar</p>
  <form id="f">
    <div class="field">
      <label>Rede Wi-Fi</label>
      <input name="ssid" placeholder="Nome da rede" required autocomplete="off">
    </div>
    <div class="field">
      <label>Senha</label>
      <input name="pass" type="password" placeholder="Senha do Wi-Fi">
    </div>
    <div class="field">
      <label>Código de pareamento</label>
      <input name="codigo" placeholder="000000" maxlength="6"
             pattern="\d{6}" required inputmode="numeric">
    </div>
    <button type="submit">Conectar</button>
  </form>
  <div class="ok" id="ok">✓ Salvo! Conectando ao servidor...</div>
  <p class="note">Wemos D1 Mini · Segure D3 por 5s para redefinir</p>
</div>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/save', {method:'POST', body: new URLSearchParams(new FormData(e.target))});
  if (r.ok) { e.target.style.display='none'; document.getElementById('ok').style.display='block'; }
});
</script>
</body></html>
)html";

void iniciarPortal() {
  String ap = "RizomTemp-" + deviceMac;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap.c_str());
  delay(100);
  Serial.printf("[Portal] AP: %s  IP: %s\n", ap.c_str(), WiFi.softAPIP().toString().c_str());

  portal.on("/", HTTP_GET, [] {
    portal.send_P(200, "text/html", PORTAL_HTML);
  });

  portal.onNotFound([] {
    portal.sendHeader("Location", "http://192.168.4.1/");
    portal.send(302, "text/plain", "");
  });

  portal.on("/save", HTTP_POST, [] {
    String ssid   = portal.arg("ssid");
    String pass   = portal.arg("pass");
    String codigo = portal.arg("codigo");

    if (ssid.isEmpty() || codigo.length() != 6) {
      portal.send(400, "text/plain", "Dados invalidos");
      return;
    }

    ssid.toCharArray(cfg.ssid, sizeof(cfg.ssid));
    pass.toCharArray(cfg.pass, sizeof(cfg.pass));
    codigo.toCharArray(cfg.codigo, sizeof(cfg.codigo));
    cfg.mqttHost[0] = '\0';
    cfg.deviceId[0] = '\0';
    cfg.mqttPort    = 1883;
    cfg.intervalo   = 60;

    salvarConfig();
    portal.send(200, "text/plain", "ok");
    delay(1500);
    ESP.restart();
  });

  portal.begin();
}

// ═══════════════════════════════════════════════════════════════
//  WI-FI
// ═══════════════════════════════════════════════════════════════
bool conectarWifi() {
  Serial.printf("[WiFi] Conectando em '%s'", cfg.ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid, cfg.pass);

  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    ledBlink(400);
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] OK  IP: %s  RSSI: %d dBm\n",
      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }
  Serial.println("[WiFi] Falha.");
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  PROVISIONAMENTO
// ═══════════════════════════════════════════════════════════════
bool provisionar() {
  BearSSL::WiFiClientSecure sc;
  sc.setInsecure();
  HTTPClient http;

  String url = String(PROVISIONING_URL) + cfg.codigo;
  Serial.printf("[Prov] GET %s\n", url.c_str());

  if (!http.begin(sc, url)) return false;
  http.setTimeout(10000);
  int code = http.GET();
  Serial.printf("[Prov] HTTP %d\n", code);
  if (code != 200) { http.end(); return false; }

  String body = http.getString();
  http.end();

  String devId   = jsonStr(body, "device_id");
  String mqttHost = jsonStr(body, "mqtt_host");
  int    mqttPort = jsonInt(body, "mqtt_port", 1883);
  int    intervalo = jsonInt(body, "intervalo_seg", 60);

  if (devId.isEmpty() || mqttHost.isEmpty()) {
    Serial.println("[Prov] Resposta incompleta.");
    return false;
  }

  devId.toCharArray(cfg.deviceId, sizeof(cfg.deviceId));
  mqttHost.toCharArray(cfg.mqttHost, sizeof(cfg.mqttHost));
  cfg.mqttPort  = mqttPort;
  cfg.intervalo = intervalo;
  cfg.codigo[0] = '\0';

  salvarConfig();
  Serial.printf("[Prov] OK  device_id=%s  mqtt=%s:%d  intervalo=%ds\n",
    cfg.deviceId, cfg.mqttHost, cfg.mqttPort, cfg.intervalo);
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  MQTT
// ═══════════════════════════════════════════════════════════════
void conectarMQTT() {
  mqtt.setServer(cfg.mqttHost, cfg.mqttPort);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);

  String clientId = "rizomtemp_d1_" + deviceMac;
  Serial.printf("[MQTT] Conectando em %s:%d...\n", cfg.mqttHost, cfg.mqttPort);

  for (int i = 0; i < 5 && !mqtt.connected(); i++) {
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("[MQTT] Conectado.");
      return;
    }
    Serial.printf("[MQTT] rc=%d — tentativa %d/5\n", mqtt.state(), i + 1);
    delay(3000);
  }
}

void publicarTemp(float t) {
  char buf[80];
  snprintf(buf, sizeof(buf), "{\"t\":%.2f,\"v\":\"2.0\",\"rssi\":%d}", t, WiFi.RSSI());
  String topico = "rizomtemp/" + String(cfg.deviceId) + "/temperatura";
  if (!mqtt.publish(topico.c_str(), buf, true))
    Serial.println("[MQTT] Falha ao publicar.");
  else
    Serial.printf("[Temp] %.2f°C publicado\n", t);
}

void publicarHeartbeat() {
  char buf[64];
  snprintf(buf, sizeof(buf), "{\"v\":\"2.0\",\"rssi\":%d,\"hw\":\"esp8266\"}", WiFi.RSSI());
  String topico = "rizomtemp/" + String(cfg.deviceId) + "/heartbeat";
  mqtt.publish(topico.c_str(), buf);
  Serial.printf("[HB] RSSI: %d dBm\n", WiFi.RSSI());
}

// ═══════════════════════════════════════════════════════════════
//  SENSOR
// ═══════════════════════════════════════════════════════════════
float lerTemp() {
  ds.requestTemperatures();
  float t = ds.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t == 85.0f || t < -55.0f || t > 125.0f) {
    Serial.printf("[Sensor] Leitura inválida: %.1f\n", t);
    return NAN;
  }
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  SETUP + LOOP
// ═══════════════════════════════════════════════════════════════
enum Estado { PORTAL_MODE, PROVISIONANDO, OPERANDO } estado;
unsigned long tsPortal = 0, tsLeitura = 0, tsHB = 0, tsReset = 0;
bool resetPressionado = false;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Rizom Temp v2.0 | Wemos D1 Mini ===");

  pinMode(PIN_LED,   OUTPUT); ledOff();
  pinMode(PIN_RESET, INPUT_PULLUP);

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[7];
  snprintf(buf, sizeof(buf), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceMac = buf;

  randomSeed(mac[3] * 65536UL + mac[4] * 256 + mac[5] + micros());

  if (!LittleFS.begin()) {
    Serial.println("[LittleFS] Falha — execute 'Upload Filesystem Image' antes do firmware.");
  } else {
    Serial.println("[LittleFS] OK");
  }

  ds.begin();
  Serial.printf("[DS18B20] %d sensor(es)\n", ds.getDeviceCount());

  if (!carregarConfig()) {
    Serial.println("[Config] Sem config — abrindo portal");
    iniciarPortal();
    estado = PORTAL_MODE;
    tsPortal = millis();
    return;
  }

  Serial.printf("[Config] SSID=%s  MQTT=%s:%d  ID=%s\n",
    cfg.ssid, cfg.mqttHost, cfg.mqttPort, cfg.deviceId);

  if (!conectarWifi()) { iniciarPortal(); estado = PORTAL_MODE; tsPortal = millis(); return; }

  if (cfg.codigo[0] != '\0') {
    estado = PROVISIONANDO;
  } else {
    conectarMQTT();
    publicarTemp(lerTemp());
    publicarHeartbeat();
    tsLeitura = tsHB = millis();
    estado = OPERANDO;
  }
}

void loop() {
  // ── Reset por botão longo ──────────────────────────────────
  if (digitalRead(PIN_RESET) == LOW) {
    if (!resetPressionado) { resetPressionado = true; tsReset = millis(); }
    else if (millis() - tsReset >= RESET_HOLD_MS) {
      Serial.println("[Reset] Apagando config...");
      apagarConfig(); delay(300); ESP.restart();
    }
  } else {
    resetPressionado = false;
  }

  unsigned long agora = millis();

  if (estado == PORTAL_MODE) {
    ledBlink(150);
    portal.handleClient();
    if (agora - tsPortal > PORTAL_TIMEOUT_MS) { Serial.println("[Portal] Timeout."); ESP.restart(); }
    return;
  }

  if (estado == PROVISIONANDO) {
    ledBlink(300);
    if (provisionar()) { delay(1500); ESP.restart(); }
    else { Serial.println("[Prov] Falha — abrindo portal."); delay(2000); iniciarPortal(); estado = PORTAL_MODE; tsPortal = agora; }
    return;
  }

  // OPERANDO
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Desconectado. Reconectando...");
    conectarWifi(); return;
  }
  if (!mqtt.connected()) conectarMQTT();
  mqtt.loop();
  ledOn();

  unsigned long intervaloMs = (unsigned long)cfg.intervalo * 1000UL;
  if (agora - tsLeitura >= intervaloMs) {
    float t = lerTemp();
    if (!isnan(t) && mqtt.connected()) publicarTemp(t);
    tsLeitura = agora;
  }
  if (agora - tsHB >= 120000UL) {
    if (mqtt.connected()) publicarHeartbeat();
    tsHB = agora;
  }
}
