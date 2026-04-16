# Provisionamento de Dispositivo via Código — Design Spec

## Objetivo

Simplificar o processo de configuração do ESP32-C3 para a plataforma Rizom Temp. Hoje o usuário precisa encontrar o device_id no dashboard e digitá-lo manualmente no portal do dispositivo junto com host MQTT, porta e outras configs. Com essa feature, o usuário digita apenas Wi-Fi + um código de 6 dígitos gerado pelo dashboard.

## Arquitetura

O dashboard gera um código temporário de 6 dígitos vinculado ao equipamento. O ESP32-C3 conecta no Wi-Fi, chama um endpoint público de provisionamento com esse código e recebe toda a configuração necessária (device_id, mqtt_host, mqtt_port, intervalo). O código expira em 10 minutos e é de uso único.

## Tech Stack

- Backend: Node.js/Express + PostgreSQL (já em uso)
- Frontend: React 19 + Vite (já em uso)
- Firmware: C++ Arduino (ESP32-C3)

---

## Seção 1 — Backend

### Nova tabela: `codigos_pareamento`

```sql
CREATE TABLE codigos_pareamento (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipamento_id UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  codigo       CHAR(6) NOT NULL UNIQUE,
  expira_em    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  usado        BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Novo arquivo: `backend/src/routes/provisioning.js`

**Endpoint 1 — Gerar código (autenticado)**

`POST /equipamentos/:id/pareamento`

- Verifica que o equipamento pertence ao cliente autenticado
- Invalida códigos anteriores não usados do mesmo equipamento
- Gera código de 6 dígitos aleatório (zero-padded)
- Insere na tabela `codigos_pareamento`
- Retorna: `{ codigo: "482951", expira_em: "2026-04-15T15:30:00Z" }`

**Endpoint 2 — Provisioning (público, sem auth)**

`GET /provisioning/:codigo`

- Busca código válido: `usado = false AND expira_em > NOW()`
- Se não encontrar: 404 `{ erro: "Código inválido ou expirado" }`
- Busca equipamento associado
- Marca `usado = true`
- Retorna:
```json
{
  "device_id": "esp01_a1b2c3d4",
  "mqtt_host": "192.168.1.212",
  "mqtt_port": 1883,
  "intervalo_seg": 60
}
```

O `mqtt_host` vem de uma nova variável de ambiente `MQTT_HOST_LOCAL` (ex: `192.168.1.212`) definida no `.env` do Pi. É diferente do `MQTT_HOST` existente (que é `localhost` — usado pelo backend para conectar internamente). O ESP32 precisa do IP da rede local, não de localhost.

### Registro das rotas em `backend/src/index.js`

```js
const provisioningRouter = require('./routes/provisioning');
app.use('/provisioning', provisioningRouter);
// rota de geração de código dentro do router de equipamentos:
app.use('/equipamentos', equipamentosRouter); // já existe, adicionar endpoint lá
```

### Nova migration: `backend/src/migrations/003_codigos_pareamento.sql`

Cria a tabela `codigos_pareamento` descrita acima.

---

## Seção 2 — Frontend (Dashboard)

### Mudança em `frontend/src/pages/Equipamentos.tsx`

**Fluxo do modal de criação — 2 passos:**

**Passo 1 (atual):** Formulário com nome, tipo, localização → botão "Criar equipamento"

**Passo 2 (novo):** Após criar com sucesso, modal muda para tela de configuração:

```
Equipamento criado! ✓
Agora configure o dispositivo ESP32-C3:

① Ligue o ESP32-C3 — LED piscará rápido
② Conecte seu celular/computador no Wi-Fi "RizomTemp-XXXX"
③ Acesse 192.168.4.1 no navegador
④ Digite o código abaixo e sua senha Wi-Fi

╔═══════════════════╗
║    4  8  2  9  5  1  ║
║    expira em 09:42   ║
╚═══════════════════╝

[Gerar novo código]        [Fechar]
```

- Código exibido com fonte grande, dígitos separados visualmente
- Countdown em tempo real até expirar
- Botão "Gerar novo código" chama o endpoint novamente
- Quando countdown chega a zero: exibe aviso e habilita apenas "Gerar novo código"

### Mudança em `frontend/src/pages/EquipamentoDetalhe.tsx`

Adicionar botão "Configurar dispositivo" próximo ao cabeçalho do equipamento. Ao clicar, abre modal idêntico ao passo 2 acima (sem o passo 1 de criação).

### Mudança em `frontend/src/api.ts`

Novo método:
```ts
gerarCodigo: (id: string) =>
  api.post<{ codigo: string; expira_em: string }>(`/equipamentos/${id}/pareamento`)
```

---

## Seção 3 — Firmware (ESP32-C3)

### Portal simplificado — apenas 3 campos

Remove os campos: MQTT host, MQTT porta, MQTT usuário, MQTT senha, device_id, intervalo.

Mantém apenas:
- Nome da rede Wi-Fi
- Senha do Wi-Fi
- Código do dashboard (6 dígitos)

### Constante de provisionamento no firmware

```cpp
const char* PROVISIONING_URL = "https://temp.rizomtag.com.br/provisioning/";
```

### Novo estado: `PROVISIONANDO`

Após salvar no portal, o fluxo muda:

```
PORTAL → [salva SSID+senha+código] → CONECTANDO_WIFI →
PROVISIONANDO → [GET provisioning/codigo] → salva config NVS →
ESP.restart() → OPERANDO
```

### Função `buscarConfigRemota(String codigo)`

```cpp
bool buscarConfigRemota(String codigo) {
  HTTPClient http;
  String url = String(PROVISIONING_URL) + codigo;
  http.begin(wifiClient, url);
  int httpCode = http.GET();

  if (httpCode != 200) {
    Serial.printf("[Prov] Falha HTTP: %d\n", httpCode);
    http.end();
    return false;
  }

  JsonDocument doc;
  deserializeJson(doc, http.getString());
  http.end();

  strlcpy(cfg.deviceId,  doc["device_id"]     | "", sizeof(cfg.deviceId));
  strlcpy(cfg.mqttHost,  doc["mqtt_host"]      | "", sizeof(cfg.mqttHost));
  cfg.mqttPort     = doc["mqtt_port"]     | 1883;
  cfg.intervaloSeg = doc["intervalo_seg"] | 60;

  // Salva apenas a config recebida (SSID/senha já estão salvos)
  salvarConfig();
  return true;
}
```

### NVS — novo campo `codigo`

Salvar o código temporariamente para uso após conectar o Wi-Fi.

### OLED durante provisionamento

```
Tela: "Provisionando..."
      "Buscando config"
      "do servidor..."
```

Em caso de erro:
```
Tela: "! ERRO !"
      "Código inválido"
      "ou expirado."
      "Reiniciando portal"
```

Após sucesso:
```
Tela: "Config recebida!"
      "Reiniciando..."
```

---

## Fluxo completo de ponta a ponta

```
1. Admin acessa dashboard → Equipamentos → Novo equipamento
2. Preenche nome/tipo/localização → Criar
3. Dashboard exibe código "482951" com timer de 10 min
4. Admin liga o ESP32-C3 (LED pisca rápido — portal ativo)
5. Admin conecta no Wi-Fi "RizomTemp-XXXXXX"
6. Abre 192.168.4.1 — portal com 3 campos
7. Preenche: rede Wi-Fi, senha, código 482951 → Salvar
8. ESP32 conecta no Wi-Fi → GET /provisioning/482951
9. Backend valida código, retorna config, marca como usado
10. ESP32 salva config, reinicia → OLED mostra temperatura
11. Dashboard começa a receber leituras do device_id correto
```

---

## O que NÃO está no escopo

- Suporte a múltiplos domínios por cliente (URL de provisioning fixo no firmware)
- Re-provisionamento OTA (atualização de config sem portal)
- Autenticação MQTT (broker está com allow_anonymous true)
