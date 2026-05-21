# Rizom Temp — Consolidado: Bug Fixes + Configurações MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir bugs críticos de produção e implementar a página de Configurações completa (empresa, usuários, alertas, sistema).

**Architecture:** Segue o padrão já estabelecido: Express Router + queries parametrizadas no backend; React com inline styles e `api.ts` centralizado no frontend. Nenhuma nova dependência de produção. Sem migration de schema (todos os bugs se resolvem em código).

**Tech Stack:** Node.js 20 + Express + PostgreSQL + JWT no backend; React 19 + TypeScript + Vite + Axios no frontend.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/mqtt/client.js` | Modificar | Corrigir `limparAlerta` + exportar `getStatus()` |
| `backend/src/routes/relatorios.js` | Modificar | Registrar auditoria de geração de PDF |
| `backend/src/routes/configuracoes.js` | Criar | Endpoints `/configuracoes/*` |
| `backend/src/index.js` | Modificar | Registrar rota `/configuracoes` |
| `frontend/package.json` | Modificar | Remover dependência `mqtt` não utilizada |
| `frontend/src/api.ts` | Modificar | Tipos + `configuracoesApi` |
| `frontend/src/pages/Configuracoes.tsx` | Substituir | Página completa com 4 abas |

---

## Task 1 — Corrigir bug crítico: `limparAlerta` nunca chamado

**Contexto:** Quando temperatura retorna ao limite normal, `estado_alertas` nunca é limpo. Na próxima vez que o equipamento sair do limite, o registro com `notificado=true` impede novos alertas eternamente.

**Files:**
- Modify: `backend/src/mqtt/client.js`

- [ ] **Step 1: Localizar o trecho de verificação de alerta**

No arquivo `backend/src/mqtt/client.js`, encontre a função `processarLeitura`. O trecho atual (em torno da linha 87) é:

```js
if (!dentroLimite && equip.alerta_ativo) {
    await alertaService.verificarEGerarAlerta(equip, temperatura);
}

console.log(`[MQTT] ${equip.nome} → ${temperatura}°C ${dentroLimite ? '✓' : '⚠ ALERTA'}`);
```

- [ ] **Step 2: Adicionar chamada de limpeza quando temperatura volta ao normal**

Substituir o bloco acima por:

```js
if (!dentroLimite && equip.alerta_ativo) {
    await alertaService.verificarEGerarAlerta(equip, temperatura);
} else if (dentroLimite && equip.alerta_ativo) {
    await alertaService.limparAlerta(equip.id);
}

console.log(`[MQTT] ${equip.nome} → ${temperatura}°C ${dentroLimite ? '✓' : '⚠ ALERTA'}`);
```

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check backend/src/mqtt/client.js
```

Saída esperada: nenhuma saída (sem erros).

- [ ] **Step 4: Commit**

```bash
git add backend/src/mqtt/client.js
git commit -m "fix(alertas): call limparAlerta when temperature returns to normal range"
```

---

## Task 2 — Adicionar `getStatus()` ao cliente MQTT

**Contexto:** O endpoint `GET /configuracoes/sistema` precisará do estado atual da conexão MQTT. O módulo hoje não expõe essa informação.

**Files:**
- Modify: `backend/src/mqtt/client.js`

- [ ] **Step 1: Adicionar função `getStatus` antes do `module.exports`**

No arquivo `backend/src/mqtt/client.js`, encontre a linha:

```js
module.exports = { conectar, publicar };
```

Substituir por:

```js
function getStatus() {
  return {
    conectado: Boolean(client?.connected),
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT || '1883', 10),
    clientId: client?.options?.clientId || null,
  };
}

module.exports = { conectar, publicar, getStatus };
```

- [ ] **Step 2: Verificar sintaxe**

```bash
node --check backend/src/mqtt/client.js
```

Saída esperada: sem erros.

- [ ] **Step 3: Commit**

```bash
git add backend/src/mqtt/client.js
git commit -m "feat(mqtt): export getStatus() for system diagnostics"
```

---

## Task 3 — Remover dependência `mqtt` não utilizada no frontend

**Contexto:** `frontend/package.json` declara `"mqtt": "^5.15.1"` mas nenhum arquivo em `frontend/src/` importa essa biblioteca. O frontend usa polling HTTP (Axios).

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/node_modules/` (efeito colateral do npm)

- [ ] **Step 1: Desinstalar o pacote**

```bash
cd frontend && npm uninstall mqtt
```

Saída esperada: linhas `removed N packages` sem erros.

- [ ] **Step 2: Confirmar remoção**

```bash
grep -n '"mqtt"' frontend/package.json
```

Saída esperada: nenhuma linha (grep retorna vazio).

- [ ] **Step 3: Garantir que o build ainda passa**

```bash
cd frontend && npm run build
```

Saída esperada: `✓ built in Xs` sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): remove unused mqtt dependency"
```

---

## Task 4 — Registrar auditoria ao gerar relatório PDF

**Contexto:** A tabela `relatorios` existe no schema mas nunca é preenchida. Sem isso, não há histórico de quem gerou qual relatório. O INSERT deve ser fire-and-forget para não bloquear o streaming do PDF.

**Files:**
- Modify: `backend/src/routes/relatorios.js`

- [ ] **Step 1: Localizar onde o PDF começa a ser gerado**

Em `backend/src/routes/relatorios.js`, dentro do handler `GET /mensal`, encontre o trecho onde os headers de resposta são configurados (após buscar os dados de equipamentos):

```js
res.setHeader('Content-Type', 'application/pdf');
res.setHeader(
  'Content-Disposition',
  `attachment; filename="rizom-temp-${mes || format(new Date(), 'yyyy-MM')}.pdf"`
);
```

- [ ] **Step 2: Inserir chamada de auditoria imediatamente após o `setHeader`**

Adicionar logo após os dois `setHeader`:

```js
// Registra auditoria de geração (fire-and-forget)
db.query(
  `INSERT INTO relatorios (cliente_id, tipo, periodo_inicio, periodo_fim, gerado_por)
   VALUES ($1, $2, $3, $4, $5)`,
  [req.usuario.cliente_id, 'mensal', inicio, fim, req.usuario.id]
).catch(err => console.error('[Relatorios] Erro ao registrar auditoria:', err.message));
```

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check backend/src/routes/relatorios.js
```

Saída esperada: sem erros.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): write audit record to relatorios table on PDF generation"
```

---

## Task 5 — Criar rota backend `configuracoes.js`

**Contexto:** Arquivo novo com todos os endpoints de configuração. Segue o padrão de `routes/equipamentos.js`: Express Router, queries parametrizadas, sem ORM.

**Files:**
- Create: `backend/src/routes/configuracoes.js`

- [ ] **Step 1: Criar o arquivo com helpers e endpoints de empresa**

Criar `backend/src/routes/configuracoes.js` com o conteúdo abaixo:

```js
// src/routes/configuracoes.js
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const mqttClient = require('../mqtt/client');
const pkg = require('../../package.json');

const router = express.Router();

const PERFIS_VALIDOS = new Set(['admin', 'operador', 'visualizador']);

function trimOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskSecretUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.slice(0, 12)}...`;
  } catch {
    return 'configurado';
  }
}

// ─── Empresa ──────────────────────────────────────────────────────────────────

router.get('/cliente', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, nome, cnpj, email, telefone, plano, ativo, criado_em, atualizado_em
     FROM clientes WHERE id = $1`,
    [req.usuario.cliente_id]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
  res.json(rows[0]);
});

router.patch('/cliente', autenticar, exigirPerfil('admin'), async (req, res) => {
  const nome = trimOrNull(req.body.nome);
  const email = trimOrNull(req.body.email);
  const cnpj = trimOrNull(req.body.cnpj);
  const telefone = trimOrNull(req.body.telefone);

  if (nome !== null && nome.length < 2) {
    return res.status(400).json({ erro: 'Nome deve ter pelo menos 2 caracteres' });
  }
  if (email !== null && !isEmail(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE clientes SET
         nome     = COALESCE($1, nome),
         email    = COALESCE($2, email),
         cnpj     = $3,
         telefone = $4
       WHERE id = $5
       RETURNING id, nome, cnpj, email, telefone, plano, ativo, criado_em, atualizado_em`,
      [nome, email, cnpj, telefone, req.usuario.cliente_id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'CNPJ já cadastrado' });
    throw err;
  }
});

// ─── Usuários ──────────────────────────────────────────────────────────────────

router.get('/usuarios', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, nome, email, perfil, ativo, ultimo_login, criado_em
     FROM usuarios
     WHERE cliente_id = $1
     ORDER BY ativo DESC, nome ASC`,
    [req.usuario.cliente_id]
  );
  res.json(rows);
});

router.post('/usuarios', autenticar, exigirPerfil('admin'), async (req, res) => {
  const nome = trimOrNull(req.body.nome);
  const email = trimOrNull(req.body.email);
  const senha = req.body.senha;
  const perfil = req.body.perfil || 'operador';

  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });
  if (!email || !isEmail(email)) return res.status(400).json({ erro: 'Email inválido' });
  if (!senha || String(senha).length < 8) {
    return res.status(400).json({ erro: 'Senha deve ter pelo menos 8 caracteres' });
  }
  if (!PERFIS_VALIDOS.has(perfil)) return res.status(400).json({ erro: 'Perfil inválido' });

  const senhaHash = await bcrypt.hash(String(senha), 12);

  try {
    const { rows } = await db.query(
      `INSERT INTO usuarios (cliente_id, nome, email, senha_hash, perfil)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, perfil, ativo, ultimo_login, criado_em`,
      [req.usuario.cliente_id, nome, email.toLowerCase(), senhaHash, perfil]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Email já cadastrado' });
    throw err;
  }
});

router.patch('/usuarios/:id', autenticar, exigirPerfil('admin'), async (req, res) => {
  const { id } = req.params;
  const { nome, perfil, ativo, senha } = req.body;

  const { rows: current } = await db.query(
    `SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = $1 AND cliente_id = $2`,
    [id, req.usuario.cliente_id]
  );
  if (!current[0]) return res.status(404).json({ erro: 'Usuário não encontrado' });

  if (id === req.usuario.id && ativo === false) {
    return res.status(400).json({ erro: 'Você não pode desativar sua própria conta' });
  }
  if (perfil !== undefined && !PERFIS_VALIDOS.has(perfil)) {
    return res.status(400).json({ erro: 'Perfil inválido' });
  }
  if (senha !== undefined && String(senha).length < 8) {
    return res.status(400).json({ erro: 'Senha deve ter pelo menos 8 caracteres' });
  }

  const mudandoDeAdmin = perfil !== undefined && current[0].perfil === 'admin' && perfil !== 'admin';
  const desativandoAdmin = ativo === false && current[0].perfil === 'admin';
  if (mudandoDeAdmin || desativandoAdmin) {
    const { rows: admins } = await db.query(
      `SELECT COUNT(*)::int AS total FROM usuarios
       WHERE cliente_id = $1 AND perfil = 'admin' AND ativo = true AND id <> $2`,
      [req.usuario.cliente_id, id]
    );
    if (admins[0].total === 0) {
      return res.status(400).json({ erro: 'Não é possível remover o único admin ativo' });
    }
  }

  const novoNome = trimOrNull(nome) ?? current[0].nome;
  const novoPerfil = perfil ?? current[0].perfil;
  const novoAtivo = ativo !== undefined ? Boolean(ativo) : current[0].ativo;
  const novoHash = senha ? await bcrypt.hash(String(senha), 12) : null;

  const { rows } = await db.query(
    `UPDATE usuarios SET
       nome       = $1,
       perfil     = $2,
       ativo      = $3,
       senha_hash = COALESCE($4, senha_hash)
     WHERE id = $5 AND cliente_id = $6
     RETURNING id, nome, email, perfil, ativo, ultimo_login, criado_em`,
    [novoNome, novoPerfil, novoAtivo, novoHash, id, req.usuario.cliente_id]
  );
  res.json(rows[0]);
});

// ─── Alertas ──────────────────────────────────────────────────────────────────

router.get('/alertas', autenticar, async (req, res) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  res.json({
    webhook_configurado: Boolean(webhookUrl),
    webhook_mascarado: maskSecretUrl(webhookUrl),
    notificacoes_ativas: Boolean(webhookUrl),
    timeout_ms: parseInt(process.env.ALERTA_TIMEOUT_MS || '8000', 10),
    atraso_padrao_min: 5,
  });
});

router.post('/alertas/teste', autenticar, exigirPerfil('admin'), async (req, res) => {
  if (!process.env.N8N_WEBHOOK_URL) {
    return res.status(400).json({ erro: 'Webhook não configurado' });
  }

  const { rows } = await db.query(
    `SELECT nome, telefone, email FROM clientes WHERE id = $1`,
    [req.usuario.cliente_id]
  );
  const cliente = rows[0];

  const payload = {
    tipo: 'teste_configuracao',
    cliente_nome: cliente?.nome,
    cliente_telefone: cliente?.telefone,
    mensagem: 'Teste de notificação do Rizom Temp',
    timestamp: new Date().toISOString(),
  };

  try {
    const r = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.json({ ok: false, erro: err.message });
  }
});

// ─── Sistema ──────────────────────────────────────────────────────────────────

router.get('/sistema', autenticar, async (req, res) => {
  let dbOk = false;
  try {
    await db.query('SELECT 1');
    dbOk = true;
  } catch {}

  const mqttStatus = mqttClient.getStatus();

  res.json({
    backend: {
      status: 'ok',
      version: pkg.version,
      node_env: process.env.NODE_ENV || 'development',
      server_time: new Date().toISOString(),
    },
    database: { status: dbOk ? 'ok' : 'erro' },
    mqtt: {
      conectado: mqttStatus.conectado,
      host: mqttStatus.host,
      port: mqttStatus.port,
    },
    api: {
      frontend_url: process.env.FRONTEND_URL || null,
      report_timezone: process.env.REPORT_TIMEZONE || 'America/Recife',
    },
  });
});

module.exports = router;
```

- [ ] **Step 2: Verificar sintaxe**

```bash
node --check backend/src/routes/configuracoes.js
```

Saída esperada: sem erros.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/configuracoes.js
git commit -m "feat(backend): add /configuracoes routes (empresa, usuarios, alertas, sistema)"
```

---

## Task 6 — Registrar rota em `index.js`

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Adicionar import da nova rota**

Em `backend/src/index.js`, encontre o bloco de requires de rotas:

```js
const provisioningRoutes = require('./routes/provisioning');
```

Adicionar logo abaixo:

```js
const configuracoesRoutes = require('./routes/configuracoes');
```

- [ ] **Step 2: Registrar a rota no app**

Encontre o bloco de `app.use` das rotas, onde está `app.use('/provisioning', ...)`. Adicionar após o bloco de provisioning (antes do health check):

```js
app.use('/configuracoes', configuracoesRoutes);
```

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check backend/src/index.js
```

Saída esperada: sem erros.

- [ ] **Step 4: Testar endpoints com curl**

Subir o backend em outro terminal (precisa do `.env` configurado):

```bash
cd backend && node src/index.js &
```

Obter token de admin:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token))")
echo "Token: ${TOKEN:0:20}..."
```

Testar cada endpoint:

```bash
# GET cliente
curl -s http://localhost:3000/configuracoes/cliente \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).nome))"
# Esperado: nome do cliente (ex: "Cliente Default")

# GET usuarios
curl -s http://localhost:3000/configuracoes/usuarios \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).length+' usuarios'))"
# Esperado: "1 usuarios" (ou mais)

# GET alertas
curl -s http://localhost:3000/configuracoes/alertas \
  -H "Authorization: Bearer $TOKEN"
# Esperado: {"webhook_configurado":false,...}

# GET sistema
curl -s http://localhost:3000/configuracoes/sistema \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).backend.status))"
# Esperado: "ok"

# POST usuarios (criar operador de teste)
curl -s -X POST http://localhost:3000/configuracoes/usuarios \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Operador Teste","email":"operador.teste@example.com","senha":"senha1234","perfil":"operador"}'
# Esperado: {"id":"...","nome":"Operador Teste",...}
```

Parar o backend:

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.js
git commit -m "feat(backend): register /configuracoes route in express app"
```

---

## Task 7 — Atualizar `frontend/src/api.ts`

**Contexto:** Adicionar tipos TypeScript e o objeto `configuracoesApi` ao final do arquivo existente (linha 132 em diante).

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Adicionar tipos ao final do arquivo**

Em `frontend/src/api.ts`, após a última linha (`};` do `relatoriosApi`), adicionar:

```ts
// ─── Tipos: Configurações ─────────────────────────────────────────────────────

export interface ClienteConfiguracao {
  id: string;
  nome: string;
  cnpj?: string | null;
  email: string;
  telefone?: string | null;
  plano: string;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface UsuarioConfiguracao {
  id: string;
  nome: string;
  email: string;
  perfil: 'admin' | 'operador' | 'visualizador';
  ativo: boolean;
  ultimo_login?: string | null;
  criado_em: string;
}

export interface AlertasConfiguracao {
  webhook_configurado: boolean;
  webhook_mascarado?: string | null;
  notificacoes_ativas: boolean;
  timeout_ms: number;
  atraso_padrao_min: number;
}

export interface SistemaConfiguracao {
  backend: {
    status: string;
    version: string;
    node_env: string;
    server_time: string;
  };
  database: { status: string };
  mqtt: {
    conectado: boolean;
    host: string;
    port: number;
  };
  api: {
    frontend_url?: string | null;
    report_timezone?: string | null;
  };
}

// ─── API: Configurações ───────────────────────────────────────────────────────

export const configuracoesApi = {
  cliente: () =>
    api.get<ClienteConfiguracao>('/configuracoes/cliente'),
  atualizarCliente: (dados: Partial<Pick<ClienteConfiguracao, 'nome' | 'cnpj' | 'email' | 'telefone'>>) =>
    api.patch<ClienteConfiguracao>('/configuracoes/cliente', dados),
  usuarios: () =>
    api.get<UsuarioConfiguracao[]>('/configuracoes/usuarios'),
  criarUsuario: (dados: { nome: string; email: string; senha: string; perfil: UsuarioConfiguracao['perfil'] }) =>
    api.post<UsuarioConfiguracao>('/configuracoes/usuarios', dados),
  atualizarUsuario: (id: string, dados: Partial<Pick<UsuarioConfiguracao, 'nome' | 'perfil' | 'ativo'>> & { senha?: string }) =>
    api.patch<UsuarioConfiguracao>(`/configuracoes/usuarios/${id}`, dados),
  alertas: () =>
    api.get<AlertasConfiguracao>('/configuracoes/alertas'),
  testarAlertas: () =>
    api.post<{ ok: boolean; status?: number; erro?: string }>('/configuracoes/alertas/teste'),
  sistema: () =>
    api.get<SistemaConfiguracao>('/configuracoes/sistema'),
};
```

- [ ] **Step 2: Verificar que o TypeScript compila sem erros**

```bash
cd frontend && npx tsc --noEmit
```

Saída esperada: sem erros (saída vazia).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(frontend): add ConfiguracoesApi types and client to api.ts"
```

---

## Task 8 — Implementar `frontend/src/pages/Configuracoes.tsx`

**Contexto:** Substituir o placeholder "Em breve." por uma página completa com 4 abas. Todos os estilos são inline seguindo o padrão do projeto. Sem CSS modules, sem biblioteca de UI. Variáveis CSS disponíveis: `--rizom-blue`, `--ok`, `--ok-bg`, `--danger`, `--danger-bg`, `--surface`, `--surface-2`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--night`.

**Files:**
- Modify: `frontend/src/pages/Configuracoes.tsx`

- [ ] **Step 1: Substituir todo o conteúdo do arquivo**

Substituir `frontend/src/pages/Configuracoes.tsx` com:

```tsx
import { useEffect, useState } from 'react';
import { Building2, Users, Bell, Server, Save, Send, RefreshCw, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  configuracoesApi,
  type ClienteConfiguracao,
  type UsuarioConfiguracao,
  type AlertasConfiguracao,
  type SistemaConfiguracao,
} from '../api';
import { useAuth } from '../contexts/useAuth';

type Aba = 'empresa' | 'usuarios' | 'alertas' | 'sistema';

// ─── Componentes utilitários ──────────────────────────────────────────────────

function TabButton({
  label, aba, atual, icon: Icon, onClick,
}: {
  label: string; aba: Aba; atual: Aba;
  icon: React.FC<{ size?: number; color?: string }>;
  onClick: (a: Aba) => void;
}) {
  const active = aba === atual;
  return (
    <button
      onClick={() => onClick(aba)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: active ? 'var(--rizom-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400, fontSize: 14,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: 24, marginBottom: 16,
    }}>
      {title && (
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: 14, width: '100%', boxSizing: 'border-box',
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
      background: ok ? 'var(--ok-bg)' : 'var(--danger-bg)',
      color: ok ? 'var(--ok)' : 'var(--danger)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  );
}

function PrimaryBtn({ onClick, disabled, loading, loadingLabel, icon: Icon, children }: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: React.FC<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: 'var(--rizom-blue)', color: '#fff', fontWeight: 600, fontSize: 14,
        opacity: (disabled || loading) ? 0.6 : 1,
      }}
    >
      {Icon && <Icon size={14} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

// ─── Aba Empresa ──────────────────────────────────────────────────────────────

function AbaEmpresa({
  cliente, isAdmin, onUpdate,
}: {
  cliente: ClienteConfiguracao;
  isAdmin: boolean;
  onUpdate: (c: ClienteConfiguracao) => void;
}) {
  const [form, setForm] = useState({
    nome: cliente.nome,
    cnpj: cliente.cnpj ?? '',
    email: cliente.email,
    telefone: cliente.telefone ?? '',
  });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setMsg(null);
    try {
      const { data } = await configuracoesApi.atualizarCliente({
        nome: form.nome,
        cnpj: form.cnpj || null,
        email: form.email,
        telefone: form.telefone || null,
      });
      onUpdate(data);
      setMsg({ tipo: 'ok', texto: 'Salvo com sucesso.' });
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao salvar.';
      setMsg({ tipo: 'erro', texto });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SectionCard title="Dados da empresa">
      <form onSubmit={salvar}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16, marginBottom: 20,
        }}>
          <Field label="Nome da empresa *">
            <input
              style={inputStyle} value={form.nome} required
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            />
          </Field>
          <Field label="CNPJ">
            <input
              style={inputStyle} value={form.cnpj}
              disabled={!isAdmin} placeholder="00.000.000/0001-00"
              onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))}
            />
          </Field>
          <Field label="Email de contato *">
            <input
              style={inputStyle} value={form.email} type="email" required
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Telefone">
            <input
              style={inputStyle} value={form.telefone}
              disabled={!isAdmin} placeholder="(00) 00000-0000"
              onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
            />
          </Field>
          <Field label="Plano">
            <input
              style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'default' }}
              value={cliente.plano} disabled
            />
          </Field>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PrimaryBtn loading={salvando} loadingLabel="Salvando..." icon={Save}>
              Salvar alterações
            </PrimaryBtn>
            {msg && (
              <span style={{ fontSize: 13, color: msg.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
                {msg.texto}
              </span>
            )}
          </div>
        )}
      </form>
    </SectionCard>
  );
}

// ─── Aba Usuários ─────────────────────────────────────────────────────────────

function AbaUsuarios({
  usuarios, isAdmin, onRefresh,
}: {
  usuarios: UsuarioConfiguracao[];
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { usuario: eu } = useAuth();
  const [novo, setNovo] = useState({
    nome: '', email: '', senha: '',
    perfil: 'operador' as UsuarioConfiguracao['perfil'],
  });
  const [criando, setCriando] = useState(false);
  const [msgNovo, setMsgNovo] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [acaoId, setAcaoId] = useState<string | null>(null);

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    setMsgNovo(null);
    try {
      await configuracoesApi.criarUsuario(novo);
      setNovo({ nome: '', email: '', senha: '', perfil: 'operador' });
      setMsgNovo({ tipo: 'ok', texto: 'Usuário criado com sucesso.' });
      await onRefresh();
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao criar usuário.';
      setMsgNovo({ tipo: 'erro', texto });
    } finally {
      setCriando(false);
    }
  }

  async function alterarPerfil(id: string, perfil: UsuarioConfiguracao['perfil']) {
    setAcaoId(id);
    try {
      await configuracoesApi.atualizarUsuario(id, { perfil });
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao alterar perfil.';
      alert(msg);
    } finally {
      setAcaoId(null);
    }
  }

  async function alterarAtivo(id: string, ativo: boolean) {
    setAcaoId(id);
    try {
      await configuracoesApi.atualizarUsuario(id, { ativo });
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao alterar status.';
      alert(msg);
    } finally {
      setAcaoId(null);
    }
  }

  const PERFIL_LABELS: Record<string, string> = {
    admin: 'Admin', operador: 'Operador', visualizador: 'Visualizador',
  };

  return (
    <>
      <SectionCard title="Usuários">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Email', 'Perfil', 'Status', 'Último login'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '8px 12px',
                    fontWeight: 500, color: 'var(--text-secondary)', fontSize: 12,
                  }}>{h}</th>
                ))}
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: u.id === eu?.id ? 600 : 400 }}>
                    {u.nome}
                    {u.id === eu?.id && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>(você)</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {isAdmin ? (
                      <select
                        value={u.perfil}
                        disabled={acaoId === u.id}
                        onChange={e => alterarPerfil(u.id, e.target.value as UsuarioConfiguracao['perfil'])}
                        style={{ ...inputStyle, width: 'auto', padding: '4px 8px' }}
                      >
                        {(['admin', 'operador', 'visualizador'] as const).map(p => (
                          <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{PERFIL_LABELS[u.perfil]}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusPill ok={u.ativo} label={u.ativo ? 'Ativo' : 'Inativo'} />
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                    {u.ultimo_login
                      ? format(new Date(u.ultimo_login), 'dd/MM/yyyy HH:mm', { locale: ptBR })
                      : 'Nunca'}
                  </td>
                  {isAdmin && (
                    <td style={{ padding: '10px 12px' }}>
                      {u.id !== eu?.id && (
                        <button
                          onClick={() => alterarAtivo(u.id, !u.ativo)}
                          disabled={acaoId === u.id}
                          style={{
                            padding: '4px 10px', borderRadius: 4,
                            border: '1px solid var(--border)',
                            background: 'transparent', cursor: 'pointer', fontSize: 12,
                            color: u.ativo ? 'var(--danger)' : 'var(--ok)',
                            opacity: acaoId === u.id ? 0.5 : 1,
                          }}
                        >
                          {u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {isAdmin && (
        <SectionCard title="Novo usuário">
          <form onSubmit={criarUsuario}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16, marginBottom: 16,
            }}>
              <Field label="Nome *">
                <input style={inputStyle} value={novo.nome} required
                  onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))} />
              </Field>
              <Field label="Email *">
                <input style={inputStyle} value={novo.email} type="email" required
                  onChange={e => setNovo(n => ({ ...n, email: e.target.value }))} />
              </Field>
              <Field label="Senha temporária * (mín. 8 chars)">
                <input style={inputStyle} value={novo.senha} type="password" required
                  minLength={8}
                  onChange={e => setNovo(n => ({ ...n, senha: e.target.value }))} />
              </Field>
              <Field label="Perfil">
                <select style={inputStyle} value={novo.perfil}
                  onChange={e => setNovo(n => ({ ...n, perfil: e.target.value as UsuarioConfiguracao['perfil'] }))}>
                  <option value="operador">Operador</option>
                  <option value="visualizador">Visualizador</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PrimaryBtn loading={criando} loadingLabel="Criando..." icon={Plus}>
                Criar usuário
              </PrimaryBtn>
              {msgNovo && (
                <span style={{ fontSize: 13, color: msgNovo.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
                  {msgNovo.texto}
                </span>
              )}
            </div>
          </form>
        </SectionCard>
      )}
    </>
  );
}

// ─── Aba Alertas ──────────────────────────────────────────────────────────────

function AbaAlertas({ alertas, isAdmin }: { alertas: AlertasConfiguracao; isAdmin: boolean }) {
  const [testando, setTestando] = useState(false);
  const [msgTeste, setMsgTeste] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function testar() {
    setTestando(true);
    setMsgTeste(null);
    try {
      const { data } = await configuracoesApi.testarAlertas();
      setMsgTeste(data.ok
        ? { tipo: 'ok', texto: 'Notificação de teste enviada com sucesso.' }
        : { tipo: 'erro', texto: data.erro ?? 'Webhook retornou erro.' }
      );
    } catch {
      setMsgTeste({ tipo: 'erro', texto: 'Falha ao contatar o webhook.' });
    } finally {
      setTestando(false);
    }
  }

  const items = [
    { label: 'Status do webhook', valor: <StatusPill ok={alertas.webhook_configurado} label={alertas.webhook_configurado ? 'Configurado' : 'Não configurado'} /> },
    ...(alertas.webhook_mascarado ? [{ label: 'Endpoint', valor: <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{alertas.webhook_mascarado}</code> }] : []),
    { label: 'Timeout', valor: `${alertas.timeout_ms / 1000}s` },
    { label: 'Atraso padrão', valor: `${alertas.atraso_padrao_min} min` },
  ];

  return (
    <SectionCard title="Configuração de alertas">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 20 }}>
        <tbody>
          {items.map(item => (
            <tr key={item.label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: '40%' }}>
                {item.label}
              </td>
              <td style={{ padding: '10px 12px' }}>{item.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        O atraso real de cada equipamento pode ser ajustado na tela de equipamentos.
      </p>

      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PrimaryBtn
            onClick={testar}
            loading={testando}
            loadingLabel="Enviando..."
            disabled={!alertas.webhook_configurado}
            icon={Send}
          >
            Enviar alerta de teste
          </PrimaryBtn>
          {msgTeste && (
            <span style={{ fontSize: 13, color: msgTeste.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
              {msgTeste.texto}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Aba Sistema ──────────────────────────────────────────────────────────────

function AbaSistema({ sistema: inicial }: { sistema: SistemaConfiguracao }) {
  const [sistema, setSistema] = useState(inicial);
  const [atualizando, setAtualizando] = useState(false);

  async function atualizar() {
    setAtualizando(true);
    try {
      const { data } = await configuracoesApi.sistema();
      setSistema(data);
    } finally {
      setAtualizando(false);
    }
  }

  const rows: Array<{ label: string; valor: React.ReactNode }> = [
    { label: 'Backend', valor: <StatusPill ok={sistema.backend.status === 'ok'} label={sistema.backend.status} /> },
    { label: 'Versão', valor: `v${sistema.backend.version}` },
    { label: 'Ambiente', valor: sistema.backend.node_env },
    { label: 'Horário do servidor', valor: new Date(sistema.backend.server_time).toLocaleString('pt-BR') },
    { label: 'Banco de dados', valor: <StatusPill ok={sistema.database.status === 'ok'} label={sistema.database.status} /> },
    { label: 'MQTT', valor: <StatusPill ok={sistema.mqtt.conectado} label={sistema.mqtt.conectado ? 'Conectado' : 'Desconectado'} /> },
    { label: 'Broker MQTT', valor: `${sistema.mqtt.host}:${sistema.mqtt.port}` },
    { label: 'Frontend URL', valor: sistema.api.frontend_url ?? '—' },
    { label: 'Fuso horário', valor: sistema.api.report_timezone ?? '—' },
  ];

  return (
    <SectionCard title="Diagnóstico do sistema">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: '40%' }}>
                {r.label}
              </td>
              <td style={{ padding: '10px 12px' }}>{r.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={atualizar}
        disabled={atualizando}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent', cursor: 'pointer',
          fontSize: 14, color: 'var(--text-primary)',
          opacity: atualizando ? 0.6 : 1,
        }}
      >
        <RefreshCw size={14} /> {atualizando ? 'Atualizando...' : 'Atualizar status'}
      </button>
    </SectionCard>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Configuracoes() {
  const { usuario } = useAuth();
  const isAdmin = usuario?.perfil === 'admin';

  const [aba, setAba] = useState<Aba>('empresa');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [cliente, setCliente] = useState<ClienteConfiguracao | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioConfiguracao[]>([]);
  const [alertasCfg, setAlertasCfg] = useState<AlertasConfiguracao | null>(null);
  const [sistema, setSistema] = useState<SistemaConfiguracao | null>(null);

  async function carregarUsuarios() {
    const { data } = await configuracoesApi.usuarios();
    setUsuarios(data);
  }

  useEffect(() => {
    (async () => {
      try {
        const [cRes, uRes, aRes, sRes] = await Promise.all([
          configuracoesApi.cliente(),
          configuracoesApi.usuarios(),
          configuracoesApi.alertas(),
          configuracoesApi.sistema(),
        ]);
        setCliente(cRes.data);
        setUsuarios(uRes.data);
        setAlertasCfg(aRes.data);
        setSistema(sRes.data);
      } catch {
        setErro('Erro ao carregar configurações. Tente recarregar a página.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Carregando...</span>
    </div>
  );

  if (erro) return (
    <div style={{ padding: 32 }}>
      <span style={{ color: 'var(--danger)', fontSize: 15 }}>{erro}</span>
    </div>
  );

  const abas: Array<{ id: Aba; label: string; icon: React.FC<{ size?: number; color?: string }> }> = [
    { id: 'empresa',  label: 'Empresa',  icon: Building2 },
    { id: 'usuarios', label: 'Usuários', icon: Users },
    { id: 'alertas',  label: 'Alertas',  icon: Bell },
    { id: 'sistema',  label: 'Sistema',  icon: Server },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Configurações</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Gerencie empresa, usuários, alertas e diagnóstico do sistema.
        </p>
      </div>

      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid var(--border)', paddingBottom: 8,
        flexWrap: 'wrap',
      }}>
        {abas.map(a => (
          <TabButton key={a.id} aba={a.id} atual={aba} label={a.label} icon={a.icon} onClick={setAba} />
        ))}
      </div>

      {aba === 'empresa'  && cliente     && <AbaEmpresa   cliente={cliente} isAdmin={isAdmin} onUpdate={setCliente} />}
      {aba === 'usuarios'                && <AbaUsuarios  usuarios={usuarios} isAdmin={isAdmin} onRefresh={carregarUsuarios} />}
      {aba === 'alertas'  && alertasCfg  && <AbaAlertas   alertas={alertasCfg} isAdmin={isAdmin} />}
      {aba === 'sistema'  && sistema     && <AbaSistema   sistema={sistema} />}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript e lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Saída esperada: sem erros de tipo; lint sem erros bloqueantes.

- [ ] **Step 3: Verificar build de produção**

```bash
cd frontend && npm run build
```

Saída esperada: `✓ built in Xs` sem erros.

- [ ] **Step 4: Testar no navegador**

Com backend e frontend rodando (`npm run dev`):

1. Abrir `http://localhost:5173/configuracoes` logado como admin.
2. Verificar que a aba **Empresa** carrega com dados reais (nome, email).
3. Alterar o nome e clicar **Salvar alterações** → mensagem "Salvo com sucesso."
4. Clicar aba **Usuários** → lista de usuários aparece.
5. Criar um usuário novo (ex: `teste@example.com`, senha `teste1234`) → usuário aparece na tabela.
6. Alterar perfil do usuário criado → select muda e persiste ao recarregar.
7. Clicar **Desativar** no usuário de teste → StatusPill muda para "Inativo".
8. Verificar que o botão **Desativar** não aparece ao lado do próprio usuário logado.
9. Clicar aba **Alertas** → cards de status aparecem (webhook "Não configurado" em ambiente local).
10. Clicar aba **Sistema** → todos os campos preenchidos; MQTT mostra conectado/desconectado conforme ambiente.
11. Clicar **Atualizar status** → horário do servidor muda.
12. Logar com usuário operador → aba Empresa sem botão Salvar; aba Usuários sem formulário nem ações.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Configuracoes.tsx
git commit -m "feat(frontend): implement Configuracoes page with empresa/usuarios/alertas/sistema tabs"
```

---

## Task 9 — Verificação final integrada

- [ ] **Step 1: Rodar lint e build do frontend**

```bash
cd frontend && npm run lint && npm run build
```

Saída esperada: sem erros.

- [ ] **Step 2: Checar sintaxe dos arquivos backend alterados**

```bash
node --check backend/src/mqtt/client.js && \
node --check backend/src/routes/configuracoes.js && \
node --check backend/src/routes/relatorios.js && \
node --check backend/src/index.js
```

Saída esperada: sem erros (saída vazia).

- [ ] **Step 3: Commit de encerramento (se houver arquivos não commitados)**

```bash
git status --short
```

Se limpo: tarefa concluída. Se houver arquivos pendentes, revisá-los antes de commitar.

---

## Bugs conhecidos NÃO incluídos neste plano

Os itens abaixo foram identificados na avaliação mas ficam fora do escopo desta iteração por exigirem infraestrutura diferente ou risco de regressão sem hardware disponível:

| Item | Motivo do adiamento |
|---|---|
| **Firmware: `PIN_LED=8` conflita com `PIN_SDA=8`** | Requer teste físico no ESP32-C3. Solução: renomear `PIN_LED` para uma GPIO livre (ex: GPIO3) e testar no hardware real. |
| **Firmware: `PROVISIONING_URL` hardcoded** | Decisão de produto — mudar exige reflash de todos os dispositivos em campo. |
| **Payload `rssi` ignorado pelo backend** | Requer migration de schema (nova coluna em `leituras`). Fica como melhoria futura. |
| **Validação com zod nos endpoints** | Escopo grande; todos os endpoints precisariam ser atualizados. |
| **PDF bloqueia event loop** | Solução correta (worker_threads ou fila) tem escopo alto. |
