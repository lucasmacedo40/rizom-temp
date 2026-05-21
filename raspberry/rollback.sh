#!/bin/bash
# Rizom Temp — Script de rollback (reversão) no Raspberry Pi
# Roda NO PI (via SSH)
# USO: sudo bash /opt/rizomtemp/raspberry/rollback.sh

set -euo pipefail

BACKUP_DIR="/opt/rizomtemp-backups"
INSTALL_DIR="/opt/rizomtemp"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[ERRO] $*" >&2; exit 1; }
success() { echo "✓ $*"; }

[ "$(id -u)" = "0" ] || err "Execute como root: sudo bash /opt/rizomtemp/raspberry/rollback.sh"

log "=== Rizom Temp — Rollback ==="
log ""

# Listar backups disponíveis
log "Backups disponíveis:"
ls -1t "$BACKUP_DIR"/rizomtemp_backup_*.sql 2>/dev/null | head -5 | while read file; do
  echo "  • $(basename $file)"
done
echo ""

# Usar o backup mais recente
LATEST_BACKUP=$(ls -1t "$BACKUP_DIR"/rizomtemp_backup_*.sql 2>/dev/null | head -1)
[ -z "$LATEST_BACKUP" ] && err "Nenhum backup encontrado em $BACKUP_DIR"

log "Usando backup: $(basename $LATEST_BACKUP)"
log ""

# Parar o backend
log "🛑 Parando backend..."
systemctl stop rizomtemp-backend
sleep 2
success "Backend parado"
log ""

# Restaurar banco
log "🗄️  Restaurando banco de dados..."
source "$INSTALL_DIR/.env"

DB_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

# Dropar e recriar a DB
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true

# Restaurar
PGPASSWORD="$DB_PASS" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  < "$LATEST_BACKUP" 2>/dev/null || err "Falha ao restaurar banco"

success "Banco restaurado"
log ""

# Reiniciar backend
log "🚀 Reiniciando backend..."
systemctl start rizomtemp-backend
sleep 3

if systemctl is-active --quiet rizomtemp-backend; then
  success "Backend restaurado com sucesso"
else
  err "Backend falhou ao iniciar"
fi
log ""

log "=== Rollback concluído! ==="
log ""
