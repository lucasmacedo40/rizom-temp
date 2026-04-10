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
