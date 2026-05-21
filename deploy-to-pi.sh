#!/bin/bash
# Rizom Temp — Script de atualização LOCAL (roda no seu computador)
# Este script prepara e envia os arquivos para o Raspberry Pi
# USO: bash deploy-to-pi.sh

set -euo pipefail

# ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────
PI_ADDRESS="${1:-192.168.1.212}"
PI_USER="${2:-pi}"
PROJETO_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[ERRO] $*" >&2; exit 1; }
success() { echo "✓ $*"; }

log "=== Rizom Temp — Deploy Local → Raspberry Pi ==="
log "PI_ADDRESS: $PI_ADDRESS"
log "PI_USER: $PI_USER"
log ""

# ─── 1. Verificar conectividade ─────────────────────────────────────────────
log "🔍 Testando conexão com o Pi..."
if ! ping -c 1 "$PI_ADDRESS" >/dev/null 2>&1; then
  err "Não consegui alcançar o Pi em $PI_ADDRESS"
fi
success "Pi alcançável"
log ""

# ─── 2. Testar SSH ──────────────────────────────────────────────────────────
log "🔐 Testando SSH..."
if ! ssh -o ConnectTimeout=5 "$PI_USER@$PI_ADDRESS" "echo OK" >/dev/null 2>&1; then
  err "SSH não está funcionando. Verifique:"
  echo "  • O Pi está na rede?"
  echo "  • SSH está habilitado? (criar arquivo 'ssh' vazio no SD card)"
  echo "  • Usuário está correto? (padrão: pi)"
fi
success "SSH funcionando"
log ""

# ─── 3. Enviar código ──────────────────────────────────────────────────────
log "📦 Preparando código..."

# Limpar e criar diretório temporário
TMP_DEPLOY="/tmp/rizom-deploy-$$"
rm -rf "$TMP_DEPLOY"
mkdir -p "$TMP_DEPLOY"

# Copiar código (sem .git, node_modules, etc)
rsync -q --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  "$PROJETO_DIR/" "$TMP_DEPLOY/rizom-temp/"

success "Código preparado"
log ""

# ─── 4. Enviar para o Pi ────────────────────────────────────────────────────
log "📤 Enviando para Pi..."
scp -q -r "$TMP_DEPLOY/rizom-temp/" "$PI_USER@$PI_ADDRESS:~/rizom-temp-incoming/"
success "Código enviado"
log ""

# ─── 5. Executar atualização no Pi ──────────────────────────────────────────
log "🚀 Executando atualização no Pi..."
log ""

ssh "$PI_USER@$PI_ADDRESS" sudo bash -s "$TMP_DEPLOY" << 'SCRIPT'
set -euo pipefail

INCOMING_DIR=~/rizom-temp-incoming
INSTALL_DIR=/opt/rizomtemp

# Copiar código para diretório final
sudo cp -r "$INCOMING_DIR/rizom-temp"/* "$INSTALL_DIR/"
sudo chown -R rizomtemp:rizomtemp "$INSTALL_DIR"

# Executar update script
sudo bash "$INSTALL_DIR/raspberry/update.sh"
SCRIPT

log ""
success "Atualização concluída no Pi!"
log ""

# ─── 6. Limpar ─────────────────────────────────────────────────────────────
rm -rf "$TMP_DEPLOY"

log "=== Deploy concluído com sucesso! ==="
log ""
log "Próximos passos:"
log "  1. Aguarde 30 segundos para o sistema estabilizar"
log "  2. Teste: curl -I http://$PI_ADDRESS"
log "  3. Verifique logs: ssh $PI_USER@$PI_ADDRESS sudo journalctl -u rizomtemp-backend -f"
log ""
log "Se houver problemas, execute no Pi:"
log "  ssh $PI_USER@$PI_ADDRESS sudo bash /opt/rizomtemp/raspberry/rollback.sh"
log ""
