/*
 * Rizom Temp — Firmware ESP-01 v2.0
 * Sensor DS18B20 → MQTT → VPS na nuvem
 * Self-configuring via Captive Portal (no hardcoded credentials)
 *
 * Hardware:
 *   ESP-01 / ESP-01S
 *   DS18B20 ligado no GPIO2 (pino DATA)
 *   Resistor pull-up 4.7kΩ entre DATA e 3.3V
 *
 * Bibliotecas necessárias:
 *   - PubSubClient (Nick O'Leary) v2.8+
 *   - OneWire (Paul Stoffregen) v2.3+
 *   - DallasTemperature v3.9+
 *   - ESP8266WiFi, ESP8266WebServer, EEPROM (built-in ESP8266 framework)
 *
 * Funcionamento:
 *   - Primeiro boot: abre AP "RizomTemp-XXXXXX" e serve portal em 192.168.4.1
 *   - Após configuração: conecta WiFi + MQTT e publica temperatura a cada 60s
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Constantes ───────────────────────────────────────────────────────────────
#define PINO_SENSOR         2
#define EEPROM_SIZE         384
#define MAGIC_BYTE          0xBE
#define PORTAL_TIMEOUT_MS   300000UL   // 5 minutos
#define INTERVALO_TEMP_MS   60000UL    // 60 segundos
#define INTERVALO_HB_MS     120000UL   // 2 minutos
#define MQTT_MAX_RETRIES    5

// ─── Config struct (stored in EEPROM) ────────────────────────────────────────
struct Config {
  uint8_t magic;
  char    ssid[64];
  char    pass[64];
  char    mqttHost[128];
  int     mqttPort;
  char    deviceId[32];
  int     intervalo;
};

Config cfg;

// ─── Estado ──────────────────────────────────────────────────────────────────
enum Estado { PORTAL, OPERANDO } estado;

// ─── Objetos globais ─────────────────────────────────────────────────────────
OneWire         oneWire(PINO_SENSOR);
DallasTemperature sensors(&oneWire);

WiFiClient      wifiClient;
PubSubClient    mqtt(wifiClient);

ESP8266WebServer portalServer(80);
DNSServer        dnsServer;

// ─── Timers ───────────────────────────────────────────────────────────────────
unsigned long ultimaLeitura    = 0;
unsigned long ultimoHeartbeat  = 0;
unsigned long portalInicio     = 0;

// ─── MAC (últimos 6 chars) ───────────────────────────────────────────────────
String deviceMac;

// ─── Portal HTML (PROGMEM, < 3KB) ────────────────────────────────────────────
static const char PORTAL_HTML[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RizomTemp Config</title>
<style>
body{font-family:Arial,sans-serif;background:#1a1a2e;color:#eee;display:flex;
justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#16213e;padding:2rem;border-radius:12px;width:100%;max-width:360px;
box-shadow:0 4px 20px rgba(0,0,0,.4)}
h2{margin:0 0 1.2rem;color:#0f9;font-size:1.3rem;text-align:center}
label{display:block;font-size:.8rem;color:#aaa;margin:.8rem 0 .2rem}
input{width:100%;padding:.5rem .6rem;border:1px solid #333;border-radius:6px;
background:#0d1117;color:#eee;box-sizing:border-box;font-size:.95rem}
input:focus{outline:none;border-color:#0f9}
button{width:100%;margin-top:1.4rem;padding:.65rem;background:#0f9;border:none;
border-radius:6px;color:#000;font-weight:bold;cursor:pointer;font-size:1rem}
button:hover{background:#0c7}
#msg{margin-top:1rem;text-align:center;font-size:.9rem;color:#0f9;display:none}
</style>
</head>
<body>
<div class="card">
<h2>RizomTemp &mdash; Configuração</h2>
<form id="f">
<label>Rede WiFi (SSID)</label>
<input name="ssid" required maxlength="63" placeholder="MinhaRede">
<label>Senha WiFi</label>
<input name="pass" type="password" maxlength="63" placeholder="••••••••">
<label>MQTT Host (IP ou hostname)</label>
<input name="host" required maxlength="127" placeholder="192.168.1.100">
<label>MQTT Porta</label>
<input name="port" type="number" value="1883" min="1" max="65535">
<label>Device ID (do dashboard)</label>
<input name="deviceId" required maxlength="31" placeholder="esp01_abc123">
<button type="submit">Salvar e reiniciar</button>
</form>
<div id="msg">Configuração salva! Reiniciando...</div>
</div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
e.preventDefault();
var fd=new URLSearchParams(new FormData(this));
fetch('/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()})
.then(function(r){if(r.ok){document.getElementById('f').style.display='none';
document.getElementById('msg').style.display='block';}});
});
</script>
</body>
</html>
)rawhtml";

// ─── Protótipos ───────────────────────────────────────────────────────────────
void lerEEPROM();
void salvarEEPROM();
bool carregarConfig();
void iniciarPortal();
void loopPortal();
void iniciarOperacao();
void loopOperacao();
void conectarWifi();
bool conectarMQTT();
float lerTemperatura();
void publicarTemperatura();
void publicarHeartbeat();
void handleRoot();
void handleSave();
void handleNotFound();

// ─── EEPROM ───────────────────────────────────────────────────────────────────
void lerEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, cfg);
  EEPROM.end();
}

void salvarEEPROM() {
  cfg.magic = MAGIC_BYTE;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("[EEPROM] Config salva");
}

bool carregarConfig() {
  lerEEPROM();
  if (cfg.magic == MAGIC_BYTE &&
      strlen(cfg.ssid) > 0 &&
      strlen(cfg.mqttHost) > 0 &&
      strlen(cfg.deviceId) > 0) {
    return true;
  }
  return false;
}

// ─── Portal HTTP handlers ─────────────────────────────────────────────────────
void handleRoot() {
  portalServer.send_P(200, "text/html", PORTAL_HTML);
}

void handleSave() {
  if (portalServer.method() != HTTP_POST) {
    portalServer.send(405, "text/plain", "Method Not Allowed");
    return;
  }

  String ssid     = portalServer.arg("ssid");
  String pass     = portalServer.arg("pass");
  String host     = portalServer.arg("host");
  String port     = portalServer.arg("port");
  String deviceId = portalServer.arg("deviceId");

  if (ssid.length() == 0 || host.length() == 0 || deviceId.length() == 0) {
    portalServer.send(400, "text/plain", "ssid, host e deviceId sao obrigatorios");
    return;
  }

  ssid.toCharArray(cfg.ssid, sizeof(cfg.ssid));
  pass.toCharArray(cfg.pass, sizeof(cfg.pass));
  host.toCharArray(cfg.mqttHost, sizeof(cfg.mqttHost));
  cfg.mqttPort = port.length() > 0 ? port.toInt() : 1883;
  deviceId.toCharArray(cfg.deviceId, sizeof(cfg.deviceId));
  cfg.intervalo = 60;

  salvarEEPROM();
  portalServer.send(200, "text/plain", "OK");

  Serial.println("[Portal] Config recebida. Reiniciando em 2s...");
  delay(2000);
  ESP.restart();
}

void handleNotFound() {
  // Captive portal: redireciona tudo para a raiz
  portalServer.sendHeader("Location", "http://192.168.4.1/", true);
  portalServer.send(302, "text/plain", "");
}

// ─── Inicia modo Portal ───────────────────────────────────────────────────────
void iniciarPortal() {
  estado = PORTAL;
  Serial.println("[Portal] Iniciando AP...");

  WiFi.mode(WIFI_AP);
  String apName = "RizomTemp-" + deviceMac;
  WiFi.softAP(apName.c_str());

  IPAddress apIP(192, 168, 4, 1);
  // DNS catch-all → redireciona qualquer domínio para o portal
  dnsServer.start(53, "*", apIP);

  portalServer.on("/", HTTP_GET, handleRoot);
  portalServer.on("/save", HTTP_POST, handleSave);
  portalServer.onNotFound(handleNotFound);
  portalServer.begin();

  portalInicio = millis();
  Serial.printf("[Portal] AP: %s  IP: %s\n", apName.c_str(), apIP.toString().c_str());
}

void loopPortal() {
  dnsServer.processNextRequest();
  portalServer.handleClient();

  // Timeout do portal
  if (millis() - portalInicio >= PORTAL_TIMEOUT_MS) {
    Serial.println("[Portal] Timeout. Reiniciando...");
    ESP.restart();
  }
}

// ─── WiFi (modo STA) ──────────────────────────────────────────────────────────
void conectarWifi() {
  Serial.printf("[WiFi] Conectando a %s", cfg.ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid, cfg.pass);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] OK — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Falha. Abrindo portal...");
    iniciarPortal();
  }
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────
bool conectarMQTT() {
  String clientId = "rizomtemp_esp01_" + deviceMac;

  int tentativas = 0;
  while (!mqtt.connected() && tentativas < MQTT_MAX_RETRIES) {
    Serial.printf("[MQTT] Conectando a %s:%d ...", cfg.mqttHost, cfg.mqttPort);

    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" OK");
      return true;
    } else {
      Serial.printf(" Falha (rc=%d). Aguardando 5s...\n", mqtt.state());
      delay(5000);
      tentativas++;
    }
  }

  Serial.println("[MQTT] Falha apos 5 tentativas");
  return false;
}

// ─── Sensor ───────────────────────────────────────────────────────────────────
float lerTemperatura() {
  sensors.requestTemperatures();
  float t = sensors.getTempCByIndex(0);

  if (t == DEVICE_DISCONNECTED_C || t == 85.0f || t < -55.0f || t > 125.0f) {
    Serial.println("[Sensor] Leitura invalida ignorada");
    return NAN;
  }
  return t;
}

// ─── Publicações MQTT ─────────────────────────────────────────────────────────
void publicarTemperatura() {
  float t = lerTemperatura();
  if (isnan(t)) return;

  char topic[80];
  snprintf(topic, sizeof(topic), "rizomtemp/%s/temperatura", cfg.deviceId);

  char payload[64];
  snprintf(payload, sizeof(payload), "{\"t\":%.2f,\"v\":\"2.0\",\"rssi\":%d}",
           t, WiFi.RSSI());

  if (mqtt.publish(topic, payload, true)) {
    Serial.printf("[Temp] %.2f C publicado\n", t);
  } else {
    Serial.println("[Temp] Falha ao publicar");
  }
}

void publicarHeartbeat() {
  char topic[80];
  snprintf(topic, sizeof(topic), "rizomtemp/%s/heartbeat", cfg.deviceId);

  char payload[64];
  snprintf(payload, sizeof(payload), "{\"v\":\"2.0\",\"rssi\":%d,\"hw\":\"esp01\"}",
           WiFi.RSSI());

  mqtt.publish(topic, payload, false);
  Serial.printf("[HB] RSSI: %d dBm\n", WiFi.RSSI());
}

// ─── Inicia modo Operação ─────────────────────────────────────────────────────
void iniciarOperacao() {
  estado = OPERANDO;
  sensors.begin();
  Serial.printf("[Sensor] DS18B20: %d sensor(es)\n", sensors.getDeviceCount());

  conectarWifi();
  if (estado == PORTAL) return; // WiFi falhou, entrou no portal

  mqtt.setServer(cfg.mqttHost, cfg.mqttPort);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(15);

  conectarMQTT();

  // Primeira leitura imediata
  publicarTemperatura();
  publicarHeartbeat();

  ultimaLeitura   = millis();
  ultimoHeartbeat = millis();
}

void loopOperacao() {
  // Reconecta WiFi se necessário
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Desconectado. Reconectando...");
    conectarWifi();
    if (estado == PORTAL) return;
  }

  // Reconecta MQTT se necessário
  if (!mqtt.connected()) {
    if (!conectarMQTT()) {
      Serial.println("[Operacao] MQTT indisponivel. Iniciando portal de reconfig...");
      iniciarPortal();
      return;
    }
  }

  mqtt.loop();

  unsigned long agora = millis();

  if (agora - ultimaLeitura >= (unsigned long)(cfg.intervalo * 1000)) {
    publicarTemperatura();
    ultimaLeitura = agora;
  }

  if (agora - ultimoHeartbeat >= INTERVALO_HB_MS) {
    publicarHeartbeat();
    ultimoHeartbeat = agora;
  }
}

// ─── Setup & Loop ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== Rizom Temp v2.0 — ESP-01 ===");

  // Obtém últimos 6 chars do MAC para identificação única (uppercase)
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  deviceMac = mac.substring(mac.length() - 6);
  deviceMac.toUpperCase();
  Serial.printf("[Init] MAC suffix: %s\n", deviceMac.c_str());

  if (carregarConfig()) {
    Serial.println("[Init] Config EEPROM valida. Modo operacao.");
    // Clamp interval to prevent MQTT spam from corrupted EEPROM
    if (cfg.intervalo <= 0 || cfg.intervalo > 3600) {
      Serial.printf("[Init] Intervalo invalido (%d). Usando padrao 60s\n", cfg.intervalo);
      cfg.intervalo = 60;
    }
    iniciarOperacao();
  } else {
    Serial.println("[Init] Sem config. Abrindo portal de configuracao.");
    iniciarPortal();
  }
}

void loop() {
  if (estado == PORTAL) {
    loopPortal();
  } else {
    loopOperacao();
  }
}
