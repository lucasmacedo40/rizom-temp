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
if [ -d "/tmp/rizom-source/rizom-temp" ]; then
  cp -r /tmp/rizom-source/rizom-temp "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ]; then
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
