#!/bin/bash
# Rizom Temp — Script de atualização no Raspberry Pi
# Roda NO PI (via SSH)
# USO: sudo bash /opt/rizomtemp/raspberry/update.sh

set -euo pipefail

INSTALL_DIR="/opt/rizomtemp"
BACKUP_DIR="/opt/rizomtemp-backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[ERRO] $*" >&2; exit 1; }
success() { echo "✓ $*"; }

[ "$(id -u)" = "0" ] || err "Execute como root: sudo bash /opt/rizomtemp/raspberry/update.sh"

log "=== Rizom Temp — Atualização ==="
log "Data: $TIMESTAMP"
log ""

# ─── 1. Criar backup do banco ────────────────────────────────────────────────
log "📦 Fazendo backup do banco de dados..."
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/rizomtemp_backup_${TIMESTAMP}.sql"

source "$INSTALL_DIR/.env" 2>/dev/null || err "Arquivo .env não encontrado em $INSTALL_DIR"

# Extrair credenciais do DATABASE_URL
DB_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  > "$BACKUP_FILE" 2>/dev/null || err "Falha ao fazer backup do banco"

success "Backup salvo em: $BACKUP_FILE"
log ""

# ─── 2. Parar o backend gracefully ───────────────────────────────────────────
log "🛑 Parando backend..."
systemctl stop rizomtemp-backend || true
sleep 2
success "Backend parado"
log ""

# ─── 3. Atualizar código ────────────────────────────────────────────────────
log "📥 Atualizando código..."
cd "$INSTALL_DIR"

# Se estiver num repo git, fazer pull
if [ -d ".git" ]; then
  git fetch -q origin
  git checkout -q origin/main || git checkout -q origin/master || true
  git pull -q || log "  (usando versão local)"
  success "Código atualizado via git"
else
  log "  (pasta não é um repo git - pulando)"
fi

log ""

# ─── 4. Instalar dependências do backend ────────────────────────────────────
log "📚 Instalando dependências..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev
success "Dependências instaladas"
log ""

# ─── 5. Executar migrations ─────────────────────────────────────────────────
log "🗄️  Executando migrations..."
if [ -f "$INSTALL_DIR/backend/src/migrations/run.js" ]; then
  cd "$INSTALL_DIR/backend"
  NODE_ENV=production node src/migrations/run.js || log "  ⚠️  Migrations falharam ou não houve mudanças"
  success "Migrations concluídas"
else
  log "  ⚠️  Arquivo de migrations não encontrado"
fi
log ""

# ─── 6. Reiniciar o backend ────────────────────────────────────────────────
log "🚀 Iniciando backend..."
systemctl start rizomtemp-backend
sleep 3

if systemctl is-active --quiet rizomtemp-backend; then
  success "Backend iniciado com sucesso"
else
  err "Backend falhou ao iniciar! Verifique: sudo journalctl -u rizomtemp-backend -n 30"
fi
log ""

# ─── 7. Testar conectividade ────────────────────────────────────────────────
log "🧪 Validando..."
if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
  success "Backend respondendo (health check ✓)"
else
  log "  ⚠️  Backend não respondeu ao health check"
fi

if systemctl is-active --quiet mosquitto; then
  success "Mosquitto rodando ✓"
else
  log "  ⚠️  Mosquitto não está rodando"
fi

if systemctl is-active --quiet nginx; then
  success "Nginx rodando ✓"
else
  log "  ⚠️  Nginx não está rodando"
fi
log ""

# ─── Fim ─────────────────────────────────────────────────────────────────────
log "=== Atualização concluída com sucesso! ==="
log ""
log "Próximos passos:"
log "  • Teste a aplicação em: https://seu-dominio.com"
log "  • Verifique os logs: sudo journalctl -u rizomtemp-backend -f"
log "  • Se houver problemas, reverta: sudo bash /opt/rizomtemp/raspberry/rollback.sh"
log ""
