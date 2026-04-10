# Rizom Temp — Avaliação do Sistema e Roteiro de Correções

> Avaliado em: 10/04/2026  
> Sistema: Monitoramento de temperatura para conformidade ANVISA (RDC 216/2004)  
> Status geral: **~80% do MVP implementado**

---

## 1. Visão Geral da Arquitetura

```
[ESP-01 + DS18B20]
       │ MQTT (WiFi)
       ▼
[Mosquitto Broker]
       │
       ▼
[Backend — Node.js + Express]  ←→  [PostgreSQL]
       │ REST API (JWT)
       ▼
[Frontend — React 19 + TypeScript + Vite]
```

**Stack completa:**
- **Firmware:** ESP8266 (ESP-01) com sensor DS18B20, publicando via MQTT a cada 60s
- **Backend:** Node.js 20 + Express, porta 3000, autenticação JWT
- **Banco de dados:** PostgreSQL com 9 tabelas, views e triggers
- **Frontend:** React 19 + Vite, dashboard com refresh a cada 60s e gráficos Recharts
- **Broker:** Mosquitto (MQTT) rodando localmente no VPS
- **Deploy:** Ubuntu 22.04, Nginx (proxy reverso), PM2 (processo Node)

---

## 2. O Que Está Implementado e Funcionando

### Backend (`/backend`)
- [x] API REST completa com 5 módulos de rotas: `auth`, `equipamentos`, `leituras`, `alertas`, `relatorios`
- [x] Autenticação JWT com 3 perfis: `admin`, `operador`, `visualizador`
- [x] Ingestão de temperatura via MQTT em tempo real
- [x] Entrada manual de temperatura (fallback para equipamentos sem IoT)
- [x] Geração de alertas com tolerância configurável por equipamento
- [x] Detecção de dispositivos offline (cron a cada 5 minutos)
- [x] Geração de relatórios PDF (conformidade ANVISA)
- [x] Notificação via webhook n8n (WhatsApp / e-mail)
- [x] Segurança: Helmet, CORS, rate limiting, bcrypt, JWT

### Banco de Dados
- [x] 9 tabelas: `clientes`, `usuarios`, `equipamentos`, `leituras`, `alertas`, `registros_manuais`, `relatorios`
- [x] View `v_equipamentos_status` com última leitura + status de heartbeat
- [x] Índice composto em `leituras (equipamento_id, registrado_em DESC)` para consultas rápidas
- [x] Soft delete com flag `ativo` em equipamentos, usuários e clientes
- [x] Triggers de `atualizado_em` automático

### Frontend (`/frontend`)
- [x] Dashboard com cards de equipamentos, métricas e alertas ativos
- [x] Listagem e criação de equipamentos
- [x] Detalhe do equipamento com gráfico de temperatura (últimas 72h)
- [x] Fila de alertas com ação de reconhecimento
- [x] Download de relatórios PDF mensais
- [x] Contexto de autenticação com persistência de sessão (localStorage)
- [x] Redirecionamento automático para login em resposta 401

### Firmware (`/firmware`)
- [x] Publicação de temperatura a cada 60s (`{"t": 4.25}`)
- [x] Heartbeat a cada 120s com RSSI do WiFi
- [x] Auto-reconexão WiFi e MQTT

---

## 3. Bugs Críticos — Impedem o Funcionamento

### BUG 1 — Página `/configuracoes` não existe (quebra o app)

**Arquivo:** `frontend/src/components/Layout.tsx`, linha 12  
**Arquivo:** `frontend/src/App.tsx`, linha 36 (sem rota para `/configuracoes`)

O link "Config." na sidebar aponta para `/configuracoes`, mas nem a página nem a rota foram criadas. Ao clicar, o React Router redireciona para `/` (pela rota `*`), mas o link fica com destaque de ativo causando confusão. Se a rota coringa for removida no futuro, o app quebra com tela em branco.

**Solução A — Remover o item do menu (mais rápido):**

Em `frontend/src/components/Layout.tsx`, remova a linha:
```ts
// Apague esta linha:
{ to: '/configuracoes', label: 'Config.',    icon: Settings },
```
E remova também o import de `Settings` do `lucide-react` se não for usado em outro lugar.

**Solução B — Criar a página (recomendado):**

1. Crie o arquivo `frontend/src/pages/Configuracoes.tsx`:

```tsx
export default function Configuracoes() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Configurações</h1>
      <p style={{ color: 'var(--text-muted)' }}>Em breve.</p>
    </div>
  );
}
```

2. Registre a rota em `frontend/src/App.tsx`:

```tsx
// Adicione o import no topo:
import Configuracoes from './pages/Configuracoes';

// Adicione a rota antes do <Route path="*" ...>:
<Route path="/configuracoes" element={<PrivateRoute><Configuracoes /></PrivateRoute>} />
```

---

### BUG 2 — Estado de alertas em memória (perdido ao reiniciar o servidor)

**Arquivo:** `backend/src/services/alertaService.js`, linha 9

```js
const estadoAlertas = new Map(); // ← perdido a cada restart
```

O mapa em memória rastreia se um equipamento já está em estado de alerta e quanto tempo faz que saiu do limite. Ao reiniciar o servidor (deploy, crash, manutenção), todos os temporizadores são zerados: equipamentos que já estavam fora da temperatura voltam a ter o período de tolerância do zero, atrasando alertas críticos.

**Solução — Persistir o estado no PostgreSQL:**

1. Adicione uma tabela de estado ao schema (execute no banco):

```sql
CREATE TABLE IF NOT EXISTS estado_alertas (
  equipamento_id UUID PRIMARY KEY REFERENCES equipamentos(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL,
  inicio         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notificado     BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

2. Substitua as operações do Map no `alertaService.js`:

```js
// Buscar estado
async function buscarEstado(equipamentoId) {
  const { rows } = await db.query(
    'SELECT * FROM estado_alertas WHERE equipamento_id = $1',
    [equipamentoId]
  );
  return rows[0] || null;
}

// Salvar/atualizar estado
async function salvarEstado(equipamentoId, tipo, notificado) {
  await db.query(
    `INSERT INTO estado_alertas (equipamento_id, tipo, notificado)
     VALUES ($1, $2, $3)
     ON CONFLICT (equipamento_id) DO UPDATE
     SET tipo = $2, notificado = $3, atualizado_em = NOW()`,
    [equipamentoId, tipo, notificado]
  );
}

// Limpar estado (temperatura voltou ao normal)
async function limparAlerta(equipamentoId) {
  await db.query(
    'DELETE FROM estado_alertas WHERE equipamento_id = $1',
    [equipamentoId]
  );
}
```

3. Atualize `verificarEGerarAlerta` para usar as funções assíncronas acima em vez do Map.

---

### BUG 3 — Diretório corrompido `{backend` na raiz

**Local:** `/rizom-temp 2/{backend` (com chave literal no nome)

Resquício de extração ou cópia malformada. Não afeta o funcionamento hoje, mas pode causar confusão e erros em scripts de deploy.

**Solução:**

```bash
rm -rf "{backend"
```

---

## 4. Como Rodar Localmente (passo a passo)

### Pré-requisitos
- Node.js 20+
- PostgreSQL 14+
- Mosquitto (ou qualquer broker MQTT)

### 4.1 Configurar variáveis de ambiente

```bash
# Backend
cp backend/.env.example backend/.env
# Edite backend/.env com suas credenciais locais

# Frontend
cp frontend/.env.example frontend/.env
# Edite frontend/.env: VITE_API_URL=http://localhost:3000
```

### 4.2 Banco de dados

```bash
# Criar usuário e banco (ajuste a senha)
psql -U postgres -c "CREATE USER rizomtemp WITH PASSWORD 'senha123';"
psql -U postgres -c "CREATE DATABASE rizomtemp OWNER rizomtemp;"

# Executar migrations
cd backend
npm install
npm run migrate
```

### 4.3 Broker MQTT (mínimo para desenvolvimento)

```bash
# Instalar Mosquitto (macOS)
brew install mosquitto

# Subir sem autenticação (só desenvolvimento local)
mosquitto -v
```

Atualize `backend/.env` com:
```
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

> Para testar sem o ESP-01 físico, publique uma leitura manualmente:
> ```bash
> mosquitto_pub -h localhost -t "rizomtemp/SEU_DEVICE_ID/temperatura" -m '{"t":4.5}'
> ```

### 4.4 Subir o backend

```bash
cd backend
npm install
node src/index.js
# API disponível em http://localhost:3000
# Teste: curl http://localhost:3000/health
```

### 4.5 Subir o frontend

```bash
cd frontend
npm install
npm run dev
# Abrir http://localhost:5173
```

---

## 5. Problemas de Qualidade (não bloqueiam, mas devem ser resolvidos)

### 5.1 Dependência `mqtt` não utilizada no frontend

O `package.json` do frontend inclui `mqtt ^5.15.1`, mas nenhum arquivo importa essa biblioteca. O frontend usa polling HTTP (Axios), não WebSocket/MQTT direto.

**Solução:**
```bash
cd frontend
npm uninstall mqtt
```

### 5.2 Sem validação de entrada nos endpoints da API

As rotas do backend aceitam qualquer payload sem validar tipos ou campos obrigatórios. Queries parametrizadas protegem contra SQL injection, mas dados inválidos podem causar erros 500 obscuros.

**Solução — adicionar `zod` para validação:**

```bash
cd backend
npm install zod
```

Exemplo de uso em `routes/equipamentos.js`:
```js
const { z } = require('zod');

const esquemaEquipamento = z.object({
  nome:       z.string().min(2).max(100),
  tipo:       z.enum(['camara_fria', 'freezer', 'refrigerador', 'expositor']),
  temp_min:   z.number(),
  temp_max:   z.number(),
  localizacao: z.string().optional(),
});

// No handler da rota POST:
const resultado = esquemaEquipamento.safeParse(req.body);
if (!resultado.success) {
  return res.status(400).json({ erro: 'Dados inválidos', detalhes: resultado.error.flatten() });
}
```

### 5.3 Geração de PDF bloqueia o event loop

**Arquivo:** `backend/src/routes/relatorios.js`

O PDFKit gera o PDF de forma síncrona no thread principal do Node.js. Para relatórios com muitos dados, isso pode travar a API por alguns segundos.

**Solução de curto prazo:** Mover para um worker thread.  
**Solução definitiva:** Usar fila de jobs (Bull + Redis) para geração assíncrona com retorno de URL de download.

### 5.4 Erros genéricos retornados ao cliente

**Arquivo:** `backend/src/index.js`, linha 64

```js
res.status(500).json({ erro: 'Erro interno do servidor' }); // sem detalhe
```

Dificulta depuração no frontend. O log no servidor existe, mas o cliente não sabe o que falhou.

**Solução:** Criar códigos de erro internos:
```js
res.status(500).json({ erro: 'ERRO_INTERNO', codigo: 'DB_QUERY_FAILED' });
```

---

## 6. O Que Falta para Produção

### Prioridade Alta

| Item | Esforço estimado |
|------|-----------------|
| Corrigir bugs 1, 2 e 3 acima | 2–4h |
| Remover dependência `mqtt` não usada no frontend | 5min |
| Adicionar validação `zod` nos endpoints críticos | 1–2 dias |
| Configurar `FRONTEND_URL` no `.env` do backend (CORS restrito) | 15min |
| Arquivo `.env` real (não commitar) — garantir no `.gitignore` | 15min |

### Prioridade Média

| Item | Esforço estimado |
|------|-----------------|
| `docker-compose.yml` para subir tudo com um comando | 1 dia |
| Logging estruturado (substituir `console.log` por `pino` ou `winston`) | meio dia |
| Página de Configurações com campos reais (fuso, limites, n8n URL) | 1–2 dias |
| Auditoria de ações (quem fez o quê e quando) | 1 dia |
| Paginação nos endpoints de leituras e alertas | meio dia |

### Prioridade Baixa / Futuro

| Item | Esforço estimado |
|------|-----------------|
| Testes automatizados (backend: Jest + supertest / frontend: Vitest) | 3–5 dias |
| Exportação CSV além do PDF | 1 dia |
| Suporte a múltiplos fusos horários (hoje hardcoded `America/Recife`) | meio dia |
| TLS no Mosquitto (porta 8883) para ESP-01 em produção | 1 dia |
| OTA (atualização de firmware sem recabear o ESP-01) | 3–5 dias |
| Dois fatores (2FA) para login admin | 1–2 dias |
| Documentação OpenAPI/Swagger da API | 1 dia |

---

## 7. Variáveis de Ambiente — Referência Completa

### Backend (`backend/.env`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | não | Porta da API (padrão: 3000) |
| `NODE_ENV` | sim | `development` ou `production` |
| `DATABASE_URL` | sim | URL de conexão PostgreSQL |
| `JWT_SECRET` | sim | String aleatória longa (mín. 64 chars) |
| `JWT_EXPIRES_IN` | não | Expiração do token (padrão: `7d`) |
| `MQTT_HOST` | sim | Host do broker Mosquitto |
| `MQTT_PORT` | não | Porta MQTT (padrão: 1883) |
| `MQTT_USERNAME` | sim | Usuário do servidor no Mosquitto |
| `MQTT_PASSWORD` | sim | Senha do servidor no Mosquitto |
| `FRONTEND_URL` | sim | URL do frontend (para CORS) |
| `N8N_WEBHOOK_URL` | não | URL do webhook n8n para notificações |
| `REPORT_TIMEZONE` | não | Fuso dos relatórios (padrão: `America/Recife`) |

### Frontend (`frontend/.env`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `VITE_API_URL` | sim | URL base da API (ex: `http://localhost:3000`) |

---

## 8. Checklist Antes do Deploy em Produção

- [ ] Corrigir Bug 1 (rota `/configuracoes`)
- [ ] Corrigir Bug 2 (persistir estado de alertas no banco)
- [ ] Remover diretório `{backend` corrompido
- [ ] Preencher todos os `.env` com valores reais (nunca commitar)
- [ ] Configurar `FRONTEND_URL` no backend (restringir CORS)
- [ ] Gerar `JWT_SECRET` seguro: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] Configurar autenticação no Mosquitto (`allow_anonymous false`)
- [ ] Habilitar HTTPS com Let's Encrypt no Nginx
- [ ] Configurar PM2 com `pm2 startup` e `pm2 save`
- [ ] Testar endpoint `/health` após deploy
- [ ] Verificar recebimento de mensagens MQTT com `mosquitto_sub -t "rizomtemp/#" -v`
- [ ] Criar primeiro usuário admin via seed SQL ou script de bootstrap
- [ ] Remover dependência `mqtt` não usada do frontend
- [ ] Confirmar que `.env` está no `.gitignore`

---

## 9. Referência de Limites ANVISA (RDC 216/2004)

| Tipo de equipamento | Mín. | Máx. |
|---------------------|------|------|
| Câmara fria (congelados) | -18°C | -15°C |
| Freezer | -18°C | -10°C |
| Refrigerador | 0°C | 5°C |
| Expositor frio | 0°C | 10°C |
| Expositor quente | 60°C | — |

> Verifique legislação estadual complementar (SP, RJ e outros estados podem ter normas adicionais).

---

*Documento gerado a partir de análise estática do código-fonte em 10/04/2026.*
