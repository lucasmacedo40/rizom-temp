# Atualizar Rizom Temp no Raspberry Pi Zero 2W

## Visão Geral

Este guia descreve como atualizar a versão existente do Rizom Temp no seu Raspberry Pi Zero 2W.

**Seu Pi:** `192.168.1.212`

---

## ⚡ Método Rápido (Recomendado)

Execute isto no seu computador (onde você tem o projeto):

```bash
# Tornar scripts executáveis
chmod +x deploy-to-pi.sh
chmod +x UPDATE.sh

# Execute o deploy automático
bash UPDATE.sh
```

Isso irá automaticamente:
- ✅ Fazer backup do banco de dados
- ✅ Enviar código para o Pi
- ✅ Parar o backend gracefully
- ✅ Atualizar dependências
- ✅ Executar migrations
- ✅ Reiniciar tudo

---

## 🔧 Método Manual (Se preferir controle total)

### 1. Conecte ao Pi via SSH

```bash
ssh pi@192.168.1.212
```

### 2. Faça backup manualmente (opcional)

```bash
sudo bash /opt/rizomtemp/raspberry/rollback.sh
# (apenas para criar um novo backup)
```

### 3. Execute a atualização

```bash
sudo bash /opt/rizomtemp/raspberry/update.sh
```

---

## 📝 O que cada script faz

### `deploy-to-pi.sh`
Roda **no seu computador** - prepara e envia código para o Pi via SSH/SCP

### `raspberry/update.sh`
Roda **no Pi** - faz todo o trabalho pesado de atualização

### `raspberry/rollback.sh`
Roda **no Pi** - reverte para o backup mais recente se algo der errado

---

## ✅ Verificar se funcionou

### Log de atualização (em tempo real)

```bash
ssh pi@192.168.1.212 sudo journalctl -u rizomtemp-backend -f
```

### Teste rápido

```bash
curl -I http://192.168.1.212
# Esperado: HTTP/1.1 200 OK

# Ou através do domínio
curl -I https://seu-dominio.com
```

### Verificação completa

```bash
ssh pi@192.168.1.212 sudo /opt/rizomtemp/raspberry/verify.sh
```

---

## 🚨 Se algo der errado

### Opção 1: Reverter para o backup anterior

```bash
ssh pi@192.168.1.212 sudo bash /opt/rizomtemp/raspberry/rollback.sh
```

### Opção 2: Verificar logs de erro

```bash
# Backend
ssh pi@192.168.1.212 sudo journalctl -u rizomtemp-backend --no-pager | tail -50

# MQTT
ssh pi@192.168.1.212 sudo journalctl -u mosquitto --no-pager | tail -50

# Nginx
ssh pi@192.168.1.212 sudo journalctl -u nginx --no-pager | tail -50
```

### Opção 3: Reiniciar tudo manualmente

```bash
ssh pi@192.168.1.212 sudo systemctl restart rizomtemp-backend mosquitto nginx cloudflared
```

---

## 📊 Estrutura de Backups

Os backups do banco de dados ficam em:

```
/opt/rizomtemp-backups/
├── rizomtemp_backup_20260415_143022.sql
├── rizomtemp_backup_20260415_142015.sql
└── ...
```

**Limpeza manual** (se necessário):

```bash
ssh pi@192.168.1.212 "ls -lh /opt/rizomtemp-backups/ | head -20"
```

---

## 🔐 Variáveis de Ambiente

Suas configurações atuais estão em `/opt/rizomtemp/.env` no Pi.

Se precisar mudar algo, edite:

```bash
ssh pi@192.168.1.212 sudo nano /opt/rizomtemp/.env
```

Depois reinicie:

```bash
ssh pi@192.168.1.212 sudo systemctl restart rizomtemp-backend
```

---

## 📋 Checklist Pós-Atualização

- [ ] Backend respondendo (`curl -I http://192.168.1.212`)
- [ ] MQTT conectando (ESP-01 está conectado?)
- [ ] Dashboard carregando (`https://seu-dominio.com`)
- [ ] Leituras de temperatura chegando
- [ ] Alertas funcionando
- [ ] Logs sem erros (`journalctl -u rizomtemp-backend -f`)

---

## 💡 Dicas

1. **Atualizações futuras**: Execute o mesmo `bash UPDATE.sh` quando tiver nova versão
2. **Monitoramento**: Configure alertas de CPU/memória do Pi
3. **Segurança**: Mude a senha do admin depois de atualizar
4. **Timezone**: Verifique se `/opt/rizomtemp/.env` tem `REPORT_TIMEZONE=America/Recife` correto

---

## 🆘 Suporte Rápido

| Problema | Comando |
|----------|---------|
| Backend não sobe | `ssh pi@192.168.1.212 sudo journalctl -u rizomtemp-backend -n 50` |
| ESP-01 não conecta | `ssh pi@192.168.1.212 sudo journalctl -u mosquitto -f` |
| Nginx dando erro | `ssh pi@192.168.1.212 sudo nginx -t` |
| Precisa reverter | `ssh pi@192.168.1.212 sudo bash /opt/rizomtemp/raspberry/rollback.sh` |
| Deseja fazer backup agora | `ssh pi@192.168.1.212 sudo bash /opt/rizomtemp/raspberry/update.sh` (faz backup no início) |

---

**Pronto! Execute `bash UPDATE.sh` para começar a atualização.** 🚀
