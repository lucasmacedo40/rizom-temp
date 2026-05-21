#!/bin/bash
# Rizom Temp — Quick Setup Guide
# Execute isto no seu computador (com o projeto local)

# Variáveis - EDITE CONFORME NECESSÁRIO
PI_ADDRESS="192.168.1.212"    # IP do seu Raspberry Pi
PI_USER="pi"                   # usuário padrão do Raspberry Pi OS

# ─────────────────────────────────────────────────────────────────────────────
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║        Rizom Temp — Atualizar Raspberry Pi Zero 2W           ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuração:"
echo "  • IP do Pi: $PI_ADDRESS"
echo "  • Usuário: $PI_USER"
echo ""

# ─── OPÇÃO 1: Deploy automático (recomendado) ────────────────────────────────
echo "Executando deploy automático..."
echo ""
bash deploy-to-pi.sh "$PI_ADDRESS" "$PI_USER"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ✓ Atualização enviada para o Pi!                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "O que aconteceu:"
echo "  ✓ Código enviado para o Pi"
echo "  ✓ Banco de dados foi feito backup"
echo "  ✓ Backend parou gracefully"
echo "  ✓ Dependências instaladas"
echo "  ✓ Migrations executadas"
echo "  ✓ Serviços reiniciados"
echo ""
echo "Próximos passos:"
echo "  1. Aguarde 30 segundos para o sistema estabilizar"
echo "  2. Verifique se está funcionando:"
echo "       curl -I http://$PI_ADDRESS"
echo "  3. Acompanhe os logs em tempo real:"
echo "       ssh $PI_USER@$PI_ADDRESS sudo journalctl -u rizomtemp-backend -f"
echo ""
echo "Se precisar reverter:"
echo "  ssh $PI_USER@$PI_ADDRESS sudo bash /opt/rizomtemp/raspberry/rollback.sh"
echo ""
