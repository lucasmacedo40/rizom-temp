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
