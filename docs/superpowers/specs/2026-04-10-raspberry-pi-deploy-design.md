# Rizom Temp — Raspberry Pi Zero 2W Deploy com Cloudflare Tunnel

> Avaliado em: 10/04/2026

## Objetivo

Rodar o sistema Rizom Temp completo (backend, banco de dados, broker MQTT) em um Raspberry Pi Zero 2W instalado no local monitorado, com acesso remoto ao dashboard de qualquer lugar via domínio próprio e HTTPS, sem IP fixo.

---

## Arquitetura

```
[ESP-01 + DS18B20]
       │ MQTT over WebSocket (porta 9001, WiFi local)
       ▼
[Raspberry Pi Zero 2W — rede local]
  ├── Mosquitto  (broker MQTT: 1883 local + 9001 WebSocket)
  ├── Node.js backend  (porta 3000)
  ├── PostgreSQL  (banco local)
  ├── Nginx  (proxy reverso interno)
  └── cloudflared  (túnel persistente para Cloudflare)
       │
       ▼
[Cloudflare] ← domínio do usuário (ex: rizomtemp.seudominio.com)
       │ HTTPS automático, sem abrir portas no roteador
       ▼
[Acesso remoto — celular / computador, qualquer rede]
```

---

## Componentes

### Mosquitto
- Porta `1883`: conexões locais (servidor Node.js)
- Porta `9001`: WebSocket para os ESP-01
- Sem autenticação em desenvolvimento; configurável via variáveis

### Backend Node.js
- Mesmo código do repositório atual (`backend/`)
- Gerenciado pelo systemd (`rizomtemp-backend.service`)
- Inicia após PostgreSQL e Mosquitto

### PostgreSQL
- Banco local no Pi
- Migrations e seed executados pelo install.sh
- Dados persistem mesmo sem internet

### Nginx
- Proxy reverso: domínio local → backend porta 3000
- Necessário para o cloudflared rotear corretamente

### cloudflared
- Túnel persistente entre Pi e Cloudflare
- HTTPS automático via certificado Cloudflare
- Reconecta automaticamente quando internet volta
- Gerenciado pelo systemd

### Firmware ESP-01
- Mudança mínima: porta MQTT `1883` → `9001`, protocolo WebSocket
- `MQTT_SERVIDOR` passa a ser o IP do Pi na rede local

---

## Resiliência

| Cenário | Comportamento |
|---------|--------------|
| Queda de internet | ESP-01 continua enviando dados para o Pi; dados salvos no banco local; dashboard acessível só pela rede local |
| Internet volta | cloudflared reconecta automaticamente; dashboard fica acessível pelo domínio novamente |
| Pi reinicia | Todos os serviços sobem automaticamente via systemd na ordem correta |
| ESP-01 perde WiFi | Firmware tenta reconectar a cada 5s; leituras durante offline são perdidas (limitação de RAM do ESP-01) |

---

## Alertas

- Integração com n8n via webhook mantida
- Quando Pi tem internet: alertas enviados em tempo real
- Quando sem internet: alerta salvo no banco, reenvio quando conexão volta (comportamento atual do backend)

---

## Entregáveis

| Arquivo | Descrição |
|---------|-----------|
| `raspberry/install.sh` | Script de instalação completo — roda no Pi com um comando |
| `raspberry/mosquitto.conf` | Config Mosquitto com WebSocket habilitado |
| `raspberry/nginx.conf` | Config Nginx proxy reverso |
| `raspberry/rizomtemp-backend.service` | Systemd service do backend |
| `raspberry/verify.sh` | Script de verificação pós-instalação |
| `firmware/rizom_temp_esp01.ino` | Firmware atualizado com MQTT WebSocket |

---

## Pré-requisitos para instalação

- Raspberry Pi Zero 2W com Raspberry Pi OS Lite (64-bit) e SSH habilitado
- Conta na Cloudflare com domínio configurado
- Token do Cloudflare Tunnel (gerado no dashboard Cloudflare)
- Pi e Mac na mesma rede (para copiar arquivos via `scp`)
