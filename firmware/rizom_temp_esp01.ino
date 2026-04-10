/*
 * Rizom Temp — Firmware ESP-01 v1.0
 * Sensor DS18B20 → MQTT → VPS na nuvem
 *
 * Hardware:
 *   ESP-01 / ESP-01S
 *   DS18B20 ligado no GPIO2 (pino DATA)
 *   Resistor pull-up 4.7kΩ entre DATA e 3.3V
 *
 * Bibliotecas necessárias (Arduino IDE / PlatformIO):
 *   - PubSubClient (Nick O'Leary) v2.8+
 *   - OneWire (Paul Stoffregen) v2.3+
 *   - DallasTemperature v3.9+
 *
 * ⚠️  ESP-01 opera em 3.3V — não conecte diretamente em 5V
 * ⚠️  GPIO0 e GPIO2 devem estar HIGH na inicialização (boot normal)
 *      O DS18B20 com pull-up no GPIO2 satisfaz esta condição.
 */

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Configuração — EDITE ANTES DE GRAVAR ──────────────────────────────────
const char* WIFI_SSID     = "NOME_DA_REDE";
const char* WIFI_SENHA    = "SENHA_WIFI";

const char* MQTT_SERVIDOR = "192.168.1.XXX"; // ← IP do Raspberry Pi na rede local
                                               //   (descubra com: hostname -I no Pi)
const int   MQTT_PORTA    = 1883;              // porta TCP direta — funciona na rede local
const char* MQTT_USUARIO  = "";                // vazio em desenvolvimento
const char* MQTT_SENHA    = "";                // vazio em desenvolvimento

// device_id: copie do cadastro do equipamento no dashboard
// Ex: esp01_685c452f (Câmara fria 01)
const char* TOPICO_TEMP   = "rizomtemp/SEU_DEVICE_ID/temperatura";
const char* TOPICO_HEART  = "rizomtemp/SEU_DEVICE_ID/heartbeat";
// ────────────────────────────────────────────────────────────────────────────

// DS18B20 no GPIO2
#define PINO_SENSOR 2
OneWire oneWire(PINO_SENSOR);
DallasTemperature sensors(&oneWire);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

unsigned long ultimaLeitura = 0;
unsigned long ultimoHeartbeat = 0;

void conectarWifi() {
  Serial.print("WiFi conectando");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi OK — IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nFalha no WiFi. Reiniciando...");
    ESP.restart();
  }
}

void conectarMQTT() {
  int tentativas = 0;
  while (!mqtt.connected() && tentativas < 5) {
    Serial.print("MQTT conectando...");

    // ClientId único baseado no MAC
    String clientId = "rizomtemp_" + WiFi.macAddress();
    clientId.replace(":", "");

    if (mqtt.connect(clientId.c_str(), MQTT_USUARIO, MQTT_SENHA)) {
      Serial.println(" OK");
    } else {
      Serial.printf(" Falha (rc=%d). Tentando em 5s...\n", mqtt.state());
      delay(5000);
      tentativas++;
    }
  }
}

void publicarTemperatura() {
  sensors.requestTemperatures();
  float temp = sensors.getTempCByIndex(0);

  if (temp == DEVICE_DISCONNECTED_C || temp == 85.0) {
    Serial.println("[Sensor] Erro de leitura — sensor desconectado?");
    return;
  }

  // Payload compacto para economizar memória
  // Formato: {"t":4.25}
  char payload[32];
  dtostrf(temp, 4, 2, payload + 5);
  String json = "{\"t\":" + String(temp, 2) + "}";

  if (mqtt.publish(TOPICO_TEMP, json.c_str(), true)) {
    Serial.printf("[Temp] %.2f°C publicado\n", temp);
  } else {
    Serial.println("[Temp] Falha ao publicar");
  }
}

void publicarHeartbeat() {
  String json = "{\"v\":\"1.0\",\"rssi\":" + String(WiFi.RSSI()) + "}";
  mqtt.publish(TOPICO_HEART, json.c_str());
  Serial.printf("[HB] RSSI: %d dBm\n", WiFi.RSSI());
}

void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n=== Rizom Temp v1.0 — ESP-01 ===");

  sensors.begin();
  Serial.printf("[Sensor] DS18B20 encontrado: %d sensor(es)\n", sensors.getDeviceCount());

  conectarWifi();

  mqtt.setServer(MQTT_SERVIDOR, MQTT_PORTA);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(15);

  conectarMQTT();

  // Primeira leitura imediata
  publicarTemperatura();
  publicarHeartbeat();
}

void loop() {
  // Reconecta WiFi se necessário
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Desconectado. Reconectando...");
    conectarWifi();
  }

  // Reconecta MQTT se necessário
  if (!mqtt.connected()) {
    conectarMQTT();
  }

  mqtt.loop();

  unsigned long agora = millis();

  // Leitura de temperatura
  if (agora - ultimaLeitura >= INTERVALO_LEITURA_MS) {
    publicarTemperatura();
    ultimaLeitura = agora;
  }

  // Heartbeat
  if (agora - ultimoHeartbeat >= INTERVALO_HEARTBEAT_MS) {
    publicarHeartbeat();
    ultimoHeartbeat = agora;
  }

  delay(100);
}
