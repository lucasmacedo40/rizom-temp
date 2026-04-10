# Rizom Temp — Guia de Setup Completo

## 1. VPS: Preparar o servidor (Ubuntu 22.04)

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Instalar Mosquitto (broker MQTT)
sudo apt install -y mosquitto mosquitto-clients

# Instalar Nginx
sudo apt install -y nginx

# Instalar PM2 (gerenciador de processos Node)
sudo npm install -g pm2
```

## 2. PostgreSQL: Criar banco e usuário

```bash
sudo -u postgres psql << 'EOF'
CREATE USER rizomtemp WITH PASSWORD 'SENHA_FORTE_AQUI';
CREATE DATABASE rizomtemp OWNER rizomtemp;
GRANT ALL PRIVILEGES ON DATABASE rizomtemp TO rizomtemp;
\q
EOF
```

## 3. Mosquitto: Configurar autenticação

```bash
# Criar arquivo de senhas
sudo mosquitto_passwd -c /etc/mosquitto/passwd rizomtemp_server
# (digita senha do servidor)

# Para cada ESP-01, adicionar usuário:
sudo mosquitto_passwd /etc/mosquitto/passwd esp01_a1b2c3
# (digita senha do dispositivo)

# Criar configuração
sudo tee /etc/mosquitto/conf.d/rizomtemp.conf << 'EOF'
listener 1883 localhost
allow_anonymous false
password_file /etc/mosquitto/passwd

# Para acesso externo dos ESP-01 (porta diferente, com TLS futuramente)
listener 1883 0.0.0.0
allow_anonymous false
password_file /etc/mosquitto/passwd
EOF

sudo systemctl restart mosquitto
sudo systemctl enable mosquitto
```

> **Atenção:** Para produção, configure TLS no Mosquitto com Let's Encrypt.
> Porta 8883 com TLS. O firmware ESP-01 precisa de BearSSL para TLS.

## 4. Backend: Deploy

```bash
# Clonar ou enviar projeto
git clone ... /opt/rizom-temp
# ou: scp -r ./rizom-temp user@vps:/opt/

cd /opt/rizom-temp/backend

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
nano .env  # edite com suas configurações

# Executar migrations
npm run migrate

# Iniciar com PM2
pm2 start src/index.js --name rizom-temp
pm2 startup
pm2 save
```

## 5. Nginx: Proxy reverso

```nginx
# /etc/nginx/sites-available/rizomtemp
server {
    listen 80;
    server_name seudominio.com;

    # API
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Frontend (após build do React)
    location / {
        root /opt/rizom-temp/frontend/dist;
        try_files $uri /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rizomtemp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS com Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com
```

## 6. ESP-01: Gravar firmware

### Conexão para gravar (modo flash):
```
ESP-01     →  Programador USB-Serial (3.3V!)
VCC        →  3.3V
GND        →  GND
TX         →  RX do programador
RX         →  TX do programador
GPIO0      →  GND (entra em modo flash)
GPIO2      →  pull-up 10kΩ para 3.3V (não conectar ao sensor durante flash)
CH_PD/EN   →  3.3V
```

### Arduino IDE:
- Placa: `Generic ESP8266 Module`
- Flash Size: `1MB (FS:64KB OTA:~470KB)`
- Upload Speed: `115200`

### Antes de gravar, edite no firmware:
```cpp
const char* WIFI_SSID  = "SUA_REDE";
const char* WIFI_SENHA = "SUA_SENHA";
const char* MQTT_SERVIDOR = "seudominio.com";
const char* MQTT_USUARIO  = "esp01_a1b2c3";   // do backend
const char* MQTT_SENHA    = "senha_do_esp";
const char* TOPICO_TEMP   = "rizomtemp/esp01_a1b2c3/temperatura";
const char* TOPICO_HEART  = "rizomtemp/esp01_a1b2c3/heartbeat";
```

### Conexão operacional (após flash):
```
DS18B20   →  ESP-01
VCC       →  3.3V
GND       →  GND
DATA      →  GPIO2  + resistor 4.7kΩ entre DATA e 3.3V
GPIO0     →  3.3V (solto ou pull-up — NÃO conectar ao GND em operação)
```

## 7. Cadastrar equipamento via API

```bash
# 1. Login
curl -X POST https://seudominio.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","senha":"senha123"}'
# Salva o token retornado

# 2. Cadastrar equipamento
curl -X POST https://seudominio.com/api/equipamentos \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Câmara Fria 1",
    "tipo": "camara_fria",
    "localizacao": "Cozinha - fundo"
  }'
# Salva o id e device_id retornados

# 3. Buscar configuração para o firmware
curl https://seudominio.com/api/equipamentos/ID_AQUI/config-dispositivo \
  -H "Authorization: Bearer SEU_TOKEN"
```

## 8. Verificar funcionamento

```bash
# No VPS, monitorar mensagens MQTT em tempo real:
mosquitto_sub -h localhost -u rizomtemp_server -P senha \
  -t "rizomtemp/#" -v

# Deve aparecer:
# rizomtemp/esp01_a1b2c3/temperatura {"t":4.25}
# rizomtemp/esp01_a1b2c3/heartbeat {"v":"1.0","rssi":-65}
```

## Limites ANVISA de referência

| Tipo             | Mínimo  | Máximo  | Norma                     |
|------------------|---------|---------|---------------------------|
| Câmara fria      | -18°C   | -15°C   | RDC 216/2004              |
| Freezer          | -18°C   | -10°C   | RDC 216/2004              |
| Refrigerador     | 0°C     | 5°C     | RDC 216/2004              |
| Expositor frio   | 0°C     | 10°C    | RDC 216/2004              |
| Expositor quente | 60°C    | —       | RDC 216/2004              |

> Verifique sempre a legislação estadual complementar (ex: SP, RJ podem ter normas adicionais).
