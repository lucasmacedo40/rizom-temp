/*
 * Portal simples de temperatura para Wemos D1 mini / ESP8266
 *
 * Hardware sugerido:
 *   - Wemos D1 mini
 *   - Sensor DS18B20
 *   - Resistor 4.7k entre DATA e 3V3
 *
 * Ligacao:
 *   DS18B20 VCC  -> 3V3
 *   DS18B20 GND  -> GND
 *   DS18B20 DATA -> D5 / GPIO14
 *
 * Como usar:
 *   1. Grave este sketch no Wemos D1 mini.
 *   2. Conecte no Wi-Fi "RizomTemp-Teste".
 *   3. Abra http://192.168.4.1 no navegador.
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define PIN_SENSOR 14  // D5 no Wemos D1 mini

const char* AP_SSID = "RizomTemp-Teste";
const char* AP_PASS = "12345678";

OneWire oneWire(PIN_SENSOR);
DallasTemperature sensor(&oneWire);
ESP8266WebServer server(80);

float ultimaTemperatura = NAN;
bool sensorOk = false;
unsigned long ultimaLeituraMs = 0;

void lerTemperatura() {
  sensor.requestTemperatures();
  float temp = sensor.getTempCByIndex(0);

  if (temp == DEVICE_DISCONNECTED_C || temp < -100 || temp > 125) {
    sensorOk = false;
    ultimaTemperatura = NAN;
    return;
  }

  sensorOk = true;
  ultimaTemperatura = temp;
}

String temperaturaTexto() {
  if (!sensorOk || isnan(ultimaTemperatura)) {
    return "--";
  }
  return String(ultimaTemperatura, 2);
}

void handlePagina() {
  String html = R"HTML(
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RizomTemp Teste</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f3f5f7;
      color: #17202a;
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    main {
      width: 100%;
      max-width: 380px;
      background: white;
      border: 1px solid #dde3ea;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 8px 28px rgba(20, 28, 38, .08);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
    }
    .sub {
      margin: 0 0 24px;
      color: #667085;
      font-size: 14px;
    }
    .temp {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 12px;
    }
    #valor {
      font-size: 56px;
      line-height: 1;
      font-weight: 700;
    }
    .unidade {
      font-size: 24px;
      font-weight: 700;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 6px 10px;
      border-radius: 6px;
      background: #eef6ff;
      color: #175cd3;
      font-size: 13px;
    }
    .erro {
      background: #fff1f3;
      color: #c01048;
    }
    footer {
      margin-top: 22px;
      color: #667085;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main>
    <h1>RizomTemp</h1>
    <p class="sub">Portal local do Wemos D1 mini</p>

    <section class="temp">
      <span id="valor">--</span>
      <span class="unidade">&deg;C</span>
    </section>

    <div id="status" class="status">Conectando...</div>

    <footer>
      Atualiza automaticamente a cada 2 segundos.
    </footer>
  </main>

  <script>
    async function atualizar() {
      const status = document.getElementById('status');
      const valor = document.getElementById('valor');

      try {
        const resposta = await fetch('/api/temperatura', { cache: 'no-store' });
        const dados = await resposta.json();

        if (dados.sensorOk) {
          valor.textContent = Number(dados.temperatura).toFixed(2);
          status.textContent = 'Sensor online';
          status.className = 'status';
        } else {
          valor.textContent = '--';
          status.textContent = 'Sensor nao detectado';
          status.className = 'status erro';
        }
      } catch (erro) {
        status.textContent = 'Falha ao ler o Wemos';
        status.className = 'status erro';
      }
    }

    atualizar();
    setInterval(atualizar, 2000);
  </script>
</body>
</html>
)HTML";

  server.send(200, "text/html; charset=utf-8", html);
}

void handleApiTemperatura() {
  String json = "{";
  json += "\"sensorOk\":";
  json += sensorOk ? "true" : "false";
  json += ",\"temperatura\":";
  json += sensorOk ? String(ultimaTemperatura, 2) : "null";
  json += ",\"uptimeMs\":";
  json += String(millis());
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  sensor.begin();
  lerTemperatura();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  server.on("/", handlePagina);
  server.on("/api/temperatura", handleApiTemperatura);
  server.begin();

  Serial.println();
  Serial.println("Portal iniciado.");
  Serial.print("Wi-Fi: ");
  Serial.println(AP_SSID);
  Serial.print("Senha: ");
  Serial.println(AP_PASS);
  Serial.print("Endereco: http://");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  server.handleClient();

  if (millis() - ultimaLeituraMs >= 2000) {
    ultimaLeituraMs = millis();
    lerTemperatura();

    Serial.print("Temperatura: ");
    Serial.println(temperaturaTexto());
  }
}
