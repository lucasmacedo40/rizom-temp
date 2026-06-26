/*
 * Rizom Temp — Firmware ESP-01 v2.1
 * Sensor DS18B20 → MQTT → VPS na nuvem
 * Self-configuring via Captive Portal (no hardcoded credentials)
 *
 * Hardware:
 *   ESP-01 / ESP-01S
 *   DS18B20 ligado no GPIO2 (pino DATA)
 *   Resistor pull-up 4.7kΩ entre DATA e 3.3V
 *   Botão de factory reset entre GPIO0 e GND (segurar 5s durante operação)
 *
 * Bibliotecas necessárias:
 *   - PubSubClient (Nick O'Leary) v2.8+
 *   - OneWire (Paul Stoffregen) v2.3+
 *   - DallasTemperature v3.9+
 *   - ESP8266WiFi, ESP8266WebServer, EEPROM (built-in ESP8266 framework)
 *
 * Funcionamento:
 *   - Primeiro boot: abre AP "RizomTemp-XXXXXX" e serve portal em 192.168.4.1
 *   - Portal exibe redes WiFi disponíveis para seleção
 *   - Após configuração: conecta WiFi + MQTT e publica temperatura a cada 60s
 *   - MQTT broker fixo: temp.rizom.com.br:1883
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
#define PINO_RESET          0          // GPIO0 — botão de factory reset
#define EEPROM_SIZE         256
#define MAGIC_BYTE          0xBF       // 0xBF: v2.1 — struct sem mqttHost/mqttPort
#define MQTT_HOST_PROD      "temp.rizom.com.br"
#define MQTT_PORT_PROD      1883
#define PORTAL_TIMEOUT_MS   300000UL   // 5 minutos
#define INTERVALO_HB_MS     120000UL   // 2 minutos
#define MQTT_MAX_RETRIES    5
#define RESET_HOLD_MS       5000UL     // Segurar GPIO0 por 5s para factory reset

// ─── Config struct (stored in EEPROM) ────────────────────────────────────────
struct Config {
  uint8_t magic;
  char    ssid[64];
  char    pass[64];
  char    deviceId[32];
  int     intervalo;
};

Config cfg;

// ─── Estado ──────────────────────────────────────────────────────────────────
enum Estado { PORTAL, OPERANDO } estado;

// ─── Objetos globais ─────────────────────────────────────────────────────────
OneWire           oneWire(PINO_SENSOR);
DallasTemperature sensors(&oneWire);

WiFiClient        wifiClient;
PubSubClient      mqtt(wifiClient);

ESP8266WebServer  portalServer(80);
DNSServer         dnsServer;

// ─── Timers ───────────────────────────────────────────────────────────────────
unsigned long ultimaLeitura      = 0;
unsigned long ultimoHeartbeat    = 0;
unsigned long portalInicio       = 0;
unsigned long resetPressInicio   = 0;
bool          resetPressPendente = false;

// ─── Cache do scan WiFi ───────────────────────────────────────────────────────
String cachedScanJson = "[]";

// ─── MAC (últimos 6 chars) ───────────────────────────────────────────────────
String deviceMac;

// ─── Portal HTML (PROGMEM) ───────────────────────────────────────────────────
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
select,input{width:100%;padding:.5rem .6rem;border:1px solid #333;border-radius:6px;
background:#0d1117;color:#eee;box-sizing:border-box;font-size:.95rem}
select:focus,input:focus{outline:none;border-color:#0f9}
button{width:100%;margin-top:1.4rem;padding:.65rem;background:#0f9;border:none;
border-radius:6px;color:#000;font-weight:bold;cursor:pointer;font-size:1rem}
button:hover{background:#0c7}
.hint{font-size:.75rem;color:#555;margin:.3rem 0 0}
#msg{margin-top:1rem;text-align:center;font-size:.9rem;color:#0f9;display:none}
</style>
</head>
<body>
<div class="card">
<h2>RizomTemp &mdash; Configuração</h2>
<form id="f">
<label>Rede WiFi</label>
<select id="sel" onchange="document.getElementById('ssid').value=this.value">
<option value="">Buscando redes...</option>
</select>
<input name="ssid" id="ssid" required maxlength="63"
  placeholder="Ou digite o nome da rede" style="margin-top:.4rem">
<label>Senha WiFi</label>
<input name="pass" type="password" maxlength="63" placeholder="••••••••">
<label>Device ID</label>
<input name="deviceId" required maxlength="31" placeholder="ex: esp01_abc123">
<p class="hint">Cadastre o equipamento em temp.rizom.com.br para obter o Device ID.</p>
<button type="submit">Salvar e conectar</button>
</form>
<div id="msg">Configuração salva! Conectando...</div>
</div>
<script>
fetch('/scan').then(function(r){return r.json();}).then(function(nets){
  var sel=document.getElementById('sel');
  if(!nets||nets.length===0){
    sel.innerHTML='<option value="">Nenhuma rede — digite manualmente</option>';
    return;
  }
  sel.innerHTML='<option value="">Selecione a rede...</option>';
  nets.forEach(function(n){
    var o=document.createElement('option');
    o.value=n; o.textContent=n; sel.appendChild(o);
  });
});
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var fd=new URLSearchParams(new FormData(this));
  fetch('/save',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:fd.toString()})
  .then(function(r){
    if(r.ok){
      document.getElementById('f').style.display='none';
      document.getElementById('msg').style.display='block';
    }
  });
});
</script>
</body>
</html>
)rawhtml";

// ─── Protótipos ───────────────────────────────────────────────────────────────
void lerEEPROM();
void salvarEEPROM();
bool carregarConfig();
void limparConfig();
void iniciarPortal();
void loopPortal();
void iniciarOperacao();
void loopOperacao();
void conectarWifi();
bool conectarMQTT();
float lerTemperatura();
void publicarTemperatura();
void publicarHeartbeat();
void verificarReset();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleRoot();
void handleScan();
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
  return (cfg.magic == MAGIC_BYTE &&
          strlen(cfg.ssid) > 0 &&
          strlen(cfg.deviceId) > 0);
}

void limparConfig() {
  Serial.println("[Reset] Apagando config da EEPROM...");
  memset(&cfg, 0, sizeof(cfg));
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("[Reset] Feito. Solte o GPIO0 e aguarde o reinicio...");
  while (digitalRead(PINO_RESET) == LOW) delay(100);
  delay(500);
  ESP.restart();
}

// ─── GPIO0 long-press ─────────────────────────────────────────────────────────
void verificarReset() {
  if (digitalRead(PINO_RESET) == LOW) {
    if (!resetPressPendente) {
      resetPressPendente = true;
      resetPressInicio   = millis();
      Serial.println("[Reset] GPIO0 pressionado — segure 5s para factory reset...");
    } else if (millis() - resetPressInicio >= RESET_HOLD_MS) {
      Serial.println("[Reset] Hold de 5s confirmado. Factory reset!");
      limparConfig();
    }
  } else {
    if (resetPressPendente) {
      Serial.println("[Reset] GPIO0 solto antes de 5s. Cancelado.");
    }
    resetPressPendente = false;
  }
}

// ─── MQTT callback ────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char msg[64];
  unsigned int len = min(length, (unsigned int)(sizeof(msg) - 1));
  memcpy(msg, payload, len);
  msg[len] = '\0';

  Serial.printf("[MQTT] Mensagem em %s: %s\n", topic, msg);

  if (strstr(msg, "factory_reset") != nullptr) {
    Serial.println("[MQTT] Comando factory_reset recebido");
    limparConfig();
  }
}

// ─── Portal HTTP handlers ─────────────────────────────────────────────────────
void handleRoot() {
  portalServer.send_P(200, "text/html", PORTAL_HTML);
}

void handleScan() {
  // Retorna cache gerado antes do AP subir — sem interferência de canal
  portalServer.send(200, "application/json", cachedScanJson);
}

void handleSave() {
  if (portalServer.method() != HTTP_POST) {
    portalServer.send(405, "text/plain", "Method Not Allowed");
    return;
  }

  String ssid     = portalServer.arg("ssid");
  String pass     = portalServer.arg("pass");
  String deviceId = portalServer.arg("deviceId");

  if (ssid.length() == 0 || deviceId.length() == 0) {
    portalServer.send(400, "text/plain", "ssid e deviceId sao obrigatorios");
    return;
  }

  ssid.toCharArray(cfg.ssid, sizeof(cfg.ssid));
  pass.toCharArray(cfg.pass, sizeof(cfg.pass));
  deviceId.toCharArray(cfg.deviceId, sizeof(cfg.deviceId));
  cfg.intervalo = 60;

  salvarEEPROM();
  portalServer.send(200, "text/plain", "OK");

  Serial.println("[Portal] Config recebida. Reiniciando em 2s...");
  delay(2000);
  ESP.restart();
}

void handleNotFound() {
  portalServer.sendHeader("Location", "http://192.168.4.1/", true);
  portalServer.send(302, "text/plain", "");
}

// ─── Inicia modo Portal ───────────────────────────────────────────────────────
void iniciarPortal() {
  estado = PORTAL;

  // Scan bloqueante em modo STA antes de subir o AP.
  // Scan assíncrono em AP_STA causa troca de canal e desconecta clientes.
  Serial.println("[Portal] Escaneando redes WiFi...");
  WiFi.mode(WIFI_STA);
  // 500ms por canal (padrão 300ms) para capturar mais redes
  int n = WiFi.scanNetworks(false, false, false, 500);
  if (n > 0) {
    // Ordena índices por RSSI decrescente (sinal mais forte primeiro)
    int idx[32];
    int count = (n < 32) ? n : 32;
    for (int i = 0; i < count; i++) idx[i] = i;
    for (int i = 0; i < count - 1; i++) {
      for (int j = 0; j < count - i - 1; j++) {
        if (WiFi.RSSI(idx[j]) < WiFi.RSSI(idx[j + 1])) {
          int tmp = idx[j]; idx[j] = idx[j + 1]; idx[j + 1] = tmp;
        }
      }
    }
    cachedScanJson = "[";
    for (int i = 0; i < count; i++) {
      if (i > 0) cachedScanJson += ",";
      String s = WiFi.SSID(idx[i]);
      s.replace("\\", "\\\\");
      s.replace("\"", "\\\"");
      cachedScanJson += "\"" + s + "\"";
    }
    cachedScanJson += "]";
    WiFi.scanDelete();
  } else {
    cachedScanJson = "[]";
  }
  Serial.printf("[Portal] %d redes encontradas\n", n);

  Serial.println("[Portal] Iniciando AP...");
  WiFi.mode(WIFI_AP);
  String apName = "RizomTemp-" + deviceMac;
  WiFi.softAP(apName.c_str());

  IPAddress apIP(192, 168, 4, 1);
  dnsServer.start(53, "*", apIP);

  portalServer.on("/",      HTTP_GET,  handleRoot);
  portalServer.on("/scan",  HTTP_GET,  handleScan);
  portalServer.on("/save",  HTTP_POST, handleSave);
  portalServer.onNotFound(handleNotFound);
  portalServer.begin();

  portalInicio = millis();
  Serial.printf("[Portal] AP: %s  IP: %s\n", apName.c_str(), apIP.toString().c_str());
}

void loopPortal() {
  dnsServer.processNextRequest();
  portalServer.handleClient();
  verificarReset();

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
    Serial.printf("[MQTT] Conectando a %s:%d ...", MQTT_HOST_PROD, MQTT_PORT_PROD);

    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" OK");

      char cmdTopic[80];
      snprintf(cmdTopic, sizeof(cmdTopic), "rizomtemp/%s/cmd", cfg.deviceId);
      mqtt.subscribe(cmdTopic);
      Serial.printf("[MQTT] Inscrito em %s\n", cmdTopic);

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
  snprintf(payload, sizeof(payload), "{\"t\":%.2f,\"v\":\"2.1\",\"rssi\":%d}",
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
  snprintf(payload, sizeof(payload), "{\"v\":\"2.1\",\"rssi\":%d,\"hw\":\"esp01\"}",
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
  if (estado == PORTAL) return;

  mqtt.setCallback(mqttCallback);
  mqtt.setServer(MQTT_HOST_PROD, MQTT_PORT_PROD);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(15);

  conectarMQTT();

  publicarTemperatura();
  publicarHeartbeat();

  ultimaLeitura   = millis();
  ultimoHeartbeat = millis();
}

void loopOperacao() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Desconectado. Reconectando...");
    conectarWifi();
    if (estado == PORTAL) return;
  }

  if (!mqtt.connected()) {
    if (!conectarMQTT()) {
      Serial.println("[Operacao] MQTT indisponivel. Abrindo portal de reconfig...");
      iniciarPortal();
      return;
    }
  }

  mqtt.loop();
  verificarReset();

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
  Serial.println("\n=== Rizom Temp v2.1 — ESP-01 ===");

  pinMode(PINO_RESET, INPUT_PULLUP);

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  deviceMac = mac.substring(mac.length() - 6);
  deviceMac.toUpperCase();
  Serial.printf("[Init] MAC suffix: %s\n", deviceMac.c_str());

  if (carregarConfig()) {
    Serial.println("[Init] Config EEPROM valida. Modo operacao.");
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
