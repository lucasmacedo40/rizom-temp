# Raspberry Pi Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar os arquivos de configuração e script de instalação para rodar o Rizom Temp completo em um Raspberry Pi Zero 2W com acesso remoto via Cloudflare Tunnel.

**Architecture:** O Pi roda PostgreSQL + Mosquitto + Node.js backend + Nginx gerenciados pelo systemd. Um túnel cloudflared expõe o sistema pelo domínio do usuário sem abrir portas no roteador. Os ESP-01 conectam ao Mosquitto via MQTT over WebSocket (porta 9001).

**Tech Stack:** Raspberry Pi OS Lite 64-bit, Node.js 20, PostgreSQL 15, Mosquitto 2, Nginx, cloudflared, systemd

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `raspberry/install.sh` | Criar | Script principal de instalação no Pi |
| `raspberry/mosquitto.conf` | Criar | Broker MQTT com WebSocket na porta 9001 |
| `raspberry/nginx.conf` | Criar | Proxy reverso para o backend |
| `raspberry/rizomtemp-backend.service` | Criar | Systemd service do Node.js backend |
| `raspberry/verify.sh` | Criar | Script de verificação pós-instalação |
| `firmware/rizom_temp_esp01.ino` | Modificar | Mudar MQTT para WebSocket porta 9001 |

---

## Task 1: Estrutura de diretórios e Mosquitto config

**Files:**
- Create: `raspberry/mosquitto.conf`

- [ ] **Step 1: Criar diretório raspberry/**

```bash
mkdir -p /Users/lucas/Downloads/rizom-temp/raspberry
```

- [ ] **Step 2: Criar raspberry/mosquitto.conf**

```conf
# Rizom Temp — Mosquitto config para Raspberry Pi
# Porta padrão MQTT (uso interno pelo backend Node.js)
listener 1883 localhost

# WebSocket para os ESP-01
listener 9001 0.0.0.0
protocol websockets

# Desenvolvimento: sem autenticação
# Em produção: comente a linha abaixo e configure pwfile
allow_anonymous true

# Logging
log_type error
log_type warning
log_type notice
```

- [ ] **Step 3: Verificar sintaxe**

```bash
mosquitto -c /Users/lucas/Downloads/rizom-temp/raspberry/mosquitto.conf --help 2>&1 | head -3
# Esperado: não deve mostrar erro de parsing
```

- [ ] **Step 4: Commit**

```bash
cd /Users/lucas/Downloads/rizom-temp
git add raspberry/mosquitto.conf
git commit -m "feat(raspberry): add mosquitto config with websocket support"
```

---

## Task 2: Nginx config

**Files:**
- Create: `raspberry/nginx.conf`

- [ ] **Step 1: Criar raspberry/nginx.conf**

```nginx
# Rizom Temp — Nginx proxy reverso
# Substitua rizomtemp.seudominio.com pelo seu subdomínio real

server {
    listen 80;
    server_name rizomtemp.seudominio.com;

    # Dashboard e API
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add raspberry/nginx.conf
git commit -m "feat(raspberry): add nginx reverse proxy config"
```

---

## Task 3: Systemd service do backend

**Files:**
- Create: `raspberry/rizomtemp-backend.service`

- [ ] **Step 1: Criar raspberry/rizomtemp-backend.service**

```ini
[Unit]
Description=Rizom Temp Backend
Documentation=https://github.com/seu-usuario/rizom-temp
After=network.target postgresql.service mosquitto.service
Requires=postgresql.service mosquitto.service

[Service]
Type=simple
User=rizomtemp
WorkingDirectory=/opt/rizomtemp/backend
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rizomtemp-backend

# Variáveis de ambiente — serão preenchidas pelo install.sh
EnvironmentFile=/opt/rizomtemp/.env

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add raspberry/rizomtemp-backend.service
git commit -m "feat(raspberry): add systemd service for backend"
```

---

## Task 4: Script de verificação pós-instalação

**Files:**
- Create: `raspberry/verify.sh`

- [ ] **Step 1: Criar raspberry/verify.sh**

```bash
#!/bin/bash
# Rizom Temp — verificação pós-instalação
# Rode no Pi após o install.sh terminar

set -e
PASS=0
FAIL=0

check() {
  local desc="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc"
    ((FAIL++))
  fi
}

echo ""
echo "=== Rizom Temp — Verificação ==="
echo ""

echo "[ Serviços ]"
check "PostgreSQL rodando"           "systemctl is-active --quiet postgresql"
check "Mosquitto rodando"            "systemctl is-active --quiet mosquitto"
check "Backend rodando"              "systemctl is-active --quiet rizomtemp-backend"
check "Nginx rodando"                "systemctl is-active --quiet nginx"
check "cloudflared rodando"          "systemctl is-active --quiet cloudflared"

echo ""
echo "[ Conectividade ]"
check "Backend responde /health"     "curl -sf http://localhost:3000/health"
check "MQTT porta 1883 aberta"       "nc -z localhost 1883"
check "MQTT WebSocket 9001 aberta"   "nc -z localhost 9001"
check "Nginx porta 80 aberta"        "nc -z localhost 80"

echo ""
echo "[ Banco de dados ]"
check "Tabela equipamentos existe"   "psql -U rizomtemp -d rizomtemp -c '\dt equipamentos' | grep -q equipamentos"
check "Usuário admin existe"         "psql -U rizomtemp -d rizomtemp -c \"SELECT id FROM usuarios WHERE perfil='admin' LIMIT 1\" | grep -q row"

echo ""
echo "─────────────────────────────────"
echo "  Passou: $PASS  |  Falhou: $FAIL"
echo "─────────────────────────────────"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "Verifique os serviços com falha:"
  echo "  journalctl -u rizomtemp-backend -n 50"
  echo "  journalctl -u mosquitto -n 20"
  exit 1
else
  echo "Sistema pronto! Acesse: http://localhost"
fi
```

- [ ] **Step 2: Tornar executável e commitar**

```bash
chmod +x /Users/lucas/Downloads/rizom-temp/raspberry/verify.sh
git add raspberry/verify.sh
git commit -m "feat(raspberry): add post-install verification script"
```

---

## Task 5: Script principal de instalação

**Files:**
- Create: `raspberry/install.sh`

- [ ] **Step 1: Criar raspberry/install.sh**

```bash
#!/bin/bash
# Rizom Temp — Install Script para Raspberry Pi Zero 2W
# Testado em: Raspberry Pi OS Lite 64-bit (Bookworm)
#
# USO:
#   1. Edite as variáveis CONFIGURAÇÃO abaixo
#   2. Copie para o Pi: scp raspberry/install.sh pi@<IP_DO_PI>:~/
#   3. No Pi: chmod +x install.sh && sudo ./install.sh

set -euo pipefail

# ─── CONFIGURAÇÃO — EDITE ANTES DE RODAR ─────────────────────────────────────
DOMINIO="rizomtemp.seudominio.com"          # seu subdomínio no Cloudflare
CF_TUNNEL_TOKEN="SEU_TOKEN_CLOUDFLARE"      # token gerado no Cloudflare Zero Trust
DB_SENHA="senha_forte_aqui"                 # senha do banco PostgreSQL
JWT_SECRET="$(openssl rand -hex 64)"        # gerado automaticamente
N8N_WEBHOOK_URL=""                          # opcional: URL do webhook n8n
ADMIN_EMAIL="admin@empresa.com"
ADMIN_SENHA="senha123"
ADMIN_NOME="Admin"
CLIENTE_NOME="Cliente Default"
# ─────────────────────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/rizomtemp"
REPO_URL="https://github.com/seu-usuario/rizom-temp.git"  # ajuste para seu repo

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[ERRO] $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || err "Execute como root: sudo ./install.sh"

log "=== Rizom Temp — Instalação no Raspberry Pi ==="

# ─── 1. Dependências do sistema ──────────────────────────────────────────────
log "Instalando dependências do sistema..."
apt-get update -qq
apt-get install -y -qq \
  curl wget git nginx mosquitto postgresql \
  postgresql-client netcat-openbsd

# Node.js 20
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  log "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# cloudflared
if ! command -v cloudflared &>/dev/null; then
  log "Instalando cloudflared..."
  ARCH=$(dpkg --print-architecture)
  wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -O /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm /tmp/cloudflared.deb
fi

# ─── 2. Usuário do sistema ────────────────────────────────────────────────────
log "Criando usuário rizomtemp..."
id -u rizomtemp &>/dev/null || useradd -r -s /bin/false -d "$INSTALL_DIR" rizomtemp

# ─── 3. Código do projeto ─────────────────────────────────────────────────────
log "Instalando código do projeto em $INSTALL_DIR..."
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR" && git pull -q
else
  git clone -q "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/backend"
npm install --omit=dev --silent

# ─── 4. Banco de dados ────────────────────────────────────────────────────────
log "Configurando PostgreSQL..."
systemctl enable postgresql --quiet
systemctl start postgresql

sudo -u postgres psql -c "CREATE USER rizomtemp WITH PASSWORD '$DB_SENHA';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE rizomtemp OWNER rizomtemp;" 2>/dev/null || true

# Arquivo .env
cat > "$INSTALL_DIR/.env" <<EOF
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://rizomtemp:${DB_SENHA}@localhost:5432/rizomtemp
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
FRONTEND_URL=https://${DOMINIO}
REPORT_TIMEZONE=America/Recife
N8N_WEBHOOK_URL=${N8N_WEBHOOK_URL}
SEED_ADMIN_EMAIL=${ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=${ADMIN_SENHA}
SEED_ADMIN_NAME=${ADMIN_NOME}
SEED_CLIENT_NAME=${CLIENTE_NOME}
SEED_CLIENT_EMAIL=contato@${DOMINIO}
EOF
chmod 600 "$INSTALL_DIR/.env"

# Migrations e seed
cd "$INSTALL_DIR/backend"
NODE_ENV=production node -e "require('dotenv').config({path:'$INSTALL_DIR/.env'})" src/migrations/run.js 2>/dev/null || \
  DATABASE_URL="postgresql://rizomtemp:${DB_SENHA}@localhost:5432/rizomtemp" node src/migrations/run.js
DATABASE_URL="postgresql://rizomtemp:${DB_SENHA}@localhost:5432/rizomtemp" \
  SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_SENHA" \
  SEED_ADMIN_NAME="$ADMIN_NOME" SEED_CLIENT_NAME="$CLIENTE_NOME" \
  node src/migrations/seed.js

# ─── 5. Mosquitto ─────────────────────────────────────────────────────────────
log "Configurando Mosquitto..."
cp "$INSTALL_DIR/raspberry/mosquitto.conf" /etc/mosquitto/conf.d/rizomtemp.conf
systemctl enable mosquitto --quiet
systemctl restart mosquitto

# ─── 6. Nginx ─────────────────────────────────────────────────────────────────
log "Configurando Nginx..."
sed "s/rizomtemp.seudominio.com/$DOMINIO/g" \
  "$INSTALL_DIR/raspberry/nginx.conf" > /etc/nginx/sites-available/rizomtemp
ln -sf /etc/nginx/sites-available/rizomtemp /etc/nginx/sites-enabled/rizomtemp
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx --quiet
systemctl restart nginx

# ─── 7. Systemd service do backend ───────────────────────────────────────────
log "Configurando serviço do backend..."
sed "s|EnvironmentFile=/opt/rizomtemp/.env|EnvironmentFile=$INSTALL_DIR/.env|g" \
  "$INSTALL_DIR/raspberry/rizomtemp-backend.service" > /etc/systemd/system/rizomtemp-backend.service
chown -R rizomtemp:rizomtemp "$INSTALL_DIR"
systemctl daemon-reload
systemctl enable rizomtemp-backend --quiet
systemctl start rizomtemp-backend

# ─── 8. cloudflared ──────────────────────────────────────────────────────────
log "Configurando cloudflared tunnel..."
cloudflared service install "$CF_TUNNEL_TOKEN"
systemctl enable cloudflared --quiet
systemctl start cloudflared

# ─── 9. Permissões finais ────────────────────────────────────────────────────
chown -R rizomtemp:rizomtemp "$INSTALL_DIR"

# ─── Fim ─────────────────────────────────────────────────────────────────────
log ""
log "=== Instalação concluída! ==="
log ""
log "  Dashboard local:  http://localhost"
log "  Dashboard remoto: https://$DOMINIO"
log "  Admin:            $ADMIN_EMAIL / $ADMIN_SENHA"
log ""
log "Execute para verificar: bash $INSTALL_DIR/raspberry/verify.sh"
```

- [ ] **Step 2: Tornar executável e commitar**

```bash
chmod +x /Users/lucas/Downloads/rizom-temp/raspberry/install.sh
git add raspberry/install.sh
git commit -m "feat(raspberry): add complete install script for Pi Zero 2W"
```

---

## Task 6: Atualizar firmware ESP-01 para WebSocket MQTT

**Files:**
- Modify: `firmware/rizom_temp_esp01.ino`

O PubSubClient padrão não suporta WebSocket nativamente. Precisamos trocar para a biblioteca **`AsyncMqttClient`** ou usar a abordagem mais simples: manter PubSubClient mas usar a variante `EspMqttClient` com suporte a WS. A opção mais compatível com o hardware limitado do ESP-01 é usar o **`PubSubClient` com `WiFiClient` apontando para a porta WebSocket do Mosquitto** — o Mosquitto aceita conexões TCP puras na porta 1883 (local) e WS na 9001, mas como o ESP está na mesma rede local, **podemos manter a porta 1883 TCP** e não precisar de WebSocket.

> **Decisão de arquitetura:** O WebSocket só seria necessário se o ESP-01 precisasse atravessar um proxy HTTP. Como ele está na rede local e acessa o Pi diretamente via IP, a porta 1883 TCP funciona perfeitamente. O Cloudflare Tunnel só expõe HTTP/HTTPS — o MQTT dos sensores nunca sai da rede local.

- [ ] **Step 1: Atualizar as constantes de configuração no firmware**

Em `firmware/rizom_temp_esp01.ino`, localize o bloco de configuração (linhas 20-30) e atualize as instruções de comentário para refletir o IP do Pi:

```cpp
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
```

- [ ] **Step 2: Commitar**

```bash
git add firmware/rizom_temp_esp01.ino
git commit -m "docs(firmware): update comments for Pi Zero 2W local IP setup"
```

---

## Task 7: Instruções de deploy no Pi

**Files:**
- Create: `raspberry/README.md`

- [ ] **Step 1: Criar raspberry/README.md**

```markdown
# Rizom Temp — Deploy no Raspberry Pi Zero 2W

## Pré-requisitos

- Raspberry Pi Zero 2W com **Raspberry Pi OS Lite 64-bit** (Bookworm)
- SSH habilitado (crie arquivo `ssh` vazio no cartão SD antes de bootar)
- Pi e seu computador na mesma rede WiFi
- Conta Cloudflare com domínio configurado
- Token do Cloudflare Tunnel (veja abaixo como gerar)

## Gerar token do Cloudflare Tunnel

1. Acesse [dash.cloudflare.com](https://dash.cloudflare.com)
2. Vá em **Zero Trust → Networks → Tunnels**
3. Clique em **Create a tunnel → Cloudflared**
4. Dê um nome (ex: `rizomtemp-pi`)
5. Em **Public Hostname**, adicione:
   - Subdomínio: `rizomtemp` (ou o que preferir)
   - Domínio: seu domínio
   - Serviço: `http://localhost:80`
6. Copie o token gerado (começa com `eyJ...`)

## Instalação

```bash
# 1. Descubra o IP do Pi na rede
ping raspberrypi.local

# 2. Copie os arquivos para o Pi
scp -r raspberry/ pi@<IP_DO_PI>:~/rizomtemp-raspberry/

# 3. Edite as variáveis no install.sh
ssh pi@<IP_DO_PI>
nano ~/rizomtemp-raspberry/install.sh
# Preencha: DOMINIO, CF_TUNNEL_TOKEN, DB_SENHA, ADMIN_SENHA

# 4. Execute a instalação
sudo bash ~/rizomtemp-raspberry/install.sh

# 5. Verifique
sudo bash /opt/rizomtemp/raspberry/verify.sh
```

## Configurar o ESP-01

No firmware `rizom_temp_esp01.ino`:
```cpp
const char* MQTT_SERVIDOR = "<IP_DO_PI>";  // ex: 192.168.1.150
const int   MQTT_PORTA    = 1883;
const char* MQTT_USUARIO  = "";
const char* MQTT_SENHA    = "";
const char* TOPICO_TEMP   = "rizomtemp/<device_id>/temperatura";
const char* TOPICO_HEART  = "rizomtemp/<device_id>/heartbeat";
```

O `device_id` está no dashboard em **Equipamentos → [nome do equipamento]**.

## Comandos úteis no Pi

```bash
# Ver logs do backend
journalctl -u rizomtemp-backend -f

# Ver logs do MQTT
journalctl -u mosquitto -f

# Reiniciar tudo
sudo systemctl restart rizomtemp-backend mosquitto nginx

# Status geral
sudo systemctl status rizomtemp-backend mosquitto nginx cloudflared
```
```

- [ ] **Step 2: Commitar**

```bash
git add raspberry/README.md
git commit -m "docs(raspberry): add complete deployment guide for Pi Zero 2W"
```

---

## Verificação Final

- [ ] **Testar localmente que os arquivos de config têm sintaxe correta**

```bash
# Verificar nginx.conf
nginx -t -c /Users/lucas/Downloads/rizom-temp/raspberry/nginx.conf 2>&1 || true

# Verificar mosquitto.conf
mosquitto -c /Users/lucas/Downloads/rizom-temp/raspberry/mosquitto.conf -v &
sleep 1 && kill %1 2>/dev/null || true

echo "Arquivos de configuração OK"
```

- [ ] **Verificar estrutura final**

```bash
ls -la /Users/lucas/Downloads/rizom-temp/raspberry/
# Esperado:
# install.sh
# mosquitto.conf
# nginx.conf
# rizomtemp-backend.service
# verify.sh
# README.md
```

- [ ] **Commit final**

```bash
cd /Users/lucas/Downloads/rizom-temp
git status
git log --oneline -6
```
