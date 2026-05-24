# Rizom Temp — Fluxo n8n de Alertas

## Como importar

1. Abrir o painel do n8n
2. Menu → **Import Workflow** → selecionar `workflow-alertas.json`
3. Configurar os campos marcados (ver abaixo)
4. Ativar o fluxo

## Configuração obrigatória após importar

### Nó "WhatsApp — Evolution API"

Editar o nó e preencher:

| Campo | Valor |
|---|---|
| URL | `https://SUA-EVOLUTION-API.com/message/sendText/NOME-DA-INSTANCIA` |
| Header `apikey` | sua chave da Evolution API |

### Nó "Enviar Email — SMTP"

1. Em **Credentials**, criar uma credencial do tipo **SMTP**:
   - Host: `smtp.gmail.com` (ou seu servidor)
   - Porta: `587`
   - Usuário: seu email
   - Senha: senha de app (Gmail) ou senha SMTP

2. No campo **From Email**: `alertas@seudominio.com`

### URL do webhook para o backend

Após ativar o fluxo, copiar a URL de produção do nó "Alerta Recebido":

```
https://SEU-N8N.com/webhook/rizomtemp-alerta
```

Colocar essa URL no arquivo `.env` do backend no VPS:

```
N8N_WEBHOOK_URL=https://SEU-N8N.com/webhook/rizomtemp-alerta
```

E reiniciar o backend:

```bash
docker service update --force rizomtemp_backend
```

## Testando

1. Na aba **Alertas** do painel Rizom Temp, clicar em **Enviar alerta de teste**
2. Verificar que o n8n executou (histórico de execuções)
3. Confirmar recebimento no WhatsApp e email

## Payload recebido pelo fluxo

```json
{
  "alerta_id": "uuid",
  "cliente_nome": "Nome da Empresa",
  "cliente_telefone": "(81) 99999-9999",
  "cliente_email": "contato@empresa.com",
  "equipamento": "Câmara Fria 1",
  "localizacao": "Cozinha — fundo esquerdo",
  "tipo": "temp_acima",
  "temperatura": 28.5,
  "temp_min": -18,
  "temp_max": -15,
  "mensagem": "Temperatura ALTA: 28.5°C (limite máx: -15°C)",
  "timestamp": "2026-05-24T14:35:00.000Z"
}
```
