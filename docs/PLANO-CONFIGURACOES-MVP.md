# Plano de Implementacao - Pagina Configuracoes MVP

Data: 2026-05-21
Projeto: Rizom Temp
Objetivo: transformar `/configuracoes` de placeholder em uma area administrativa util para o MVP.

## 1. Contexto Atual

O projeto e um sistema de monitoramento de temperatura para conformidade ANVISA, com:

- Backend Node.js + Express em `backend/src`
- PostgreSQL
- MQTT via Mosquitto
- Frontend React + TypeScript + Vite em `frontend/src`
- Autenticacao JWT por perfis: `admin`, `operador`, `visualizador`

Arquivos importantes:

- Backend entrypoint: `backend/src/index.js`
- Middleware auth: `backend/src/middleware/auth.js`
- Rotas auth existentes: `backend/src/routes/auth.js`
- Cliente MQTT: `backend/src/mqtt/client.js`
- Schema inicial: `backend/src/migrations/001_schema_inicial.sql`
- Frontend API client: `frontend/src/api.ts`
- Pagina atual de configuracoes: `frontend/src/pages/Configuracoes.tsx`
- Roteamento: `frontend/src/App.tsx`
- Layout/sidebar: `frontend/src/components/Layout.tsx`
- Tema global claro: `frontend/src/index.css`

Estado atual de `Configuracoes.tsx`:

```tsx
// src/pages/Configuracoes.tsx
export default function Configuracoes() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Configurações</h1>
      <p style={{ color: 'var(--text-muted)' }}>Em breve.</p>
    </div>
  );
}
```

## 2. Objetivo Do MVP

Criar uma pagina de configuracoes que resolva necessidades reais de operacao, instalacao e suporte sem aumentar demais o escopo.

Blocos prioritarios:

1. Empresa
2. Usuarios
3. Alertas
4. Sistema

Nao implementar neste ciclo:

- Upload de logo
- Backup/restore
- Restart de servicos
- Permissoes granulares
- Edicao persistente de webhook no banco
- Configuracao de limites globais por tipo de equipamento
- Auditoria completa de alteracoes

## 3. Principios De Implementacao

- Manter o padrao atual do projeto: Express Router + queries parametrizadas + frontend com Axios em `api.ts`.
- Proteger todas as rotas de configuracoes com `autenticar`.
- Proteger escrita administrativa com `exigirPerfil('admin')`.
- Evitar expor segredos: nunca retornar `DATABASE_URL`, `JWT_SECRET`, senha MQTT ou webhook completo.
- Retornar mensagens de erro amigaveis no backend.
- Tipar as respostas no frontend.
- Nao usar `any`.
- Manter visual consistente com o tema claro em `frontend/src/index.css`.
- Cards com `borderRadius: 8`, `background: var(--surface)`, `border: 1px solid var(--border)`.
- Usar fonte global Inter/system via CSS atual.

## 4. Permissoes Recomendadas

### Leitura

Todos os usuarios autenticados podem ver:

- Dados da empresa
- Status de alertas
- Status do sistema

### Escrita

Somente `admin` pode:

- Editar empresa
- Criar usuario
- Alterar perfil de usuario
- Ativar/desativar usuario
- Enviar teste de webhook

Justificativa: configuracoes alteram seguranca e operacao do cliente.

## 5. Backend - Nova Rota

Criar arquivo:

```txt
backend/src/routes/configuracoes.js
```

Registrar em `backend/src/index.js`:

```js
const configuracoesRoutes = require('./routes/configuracoes');
app.use('/configuracoes', configuracoesRoutes);
```

Importacoes esperadas:

```js
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const mqttClient = require('../mqtt/client');
const pkg = require('../../package.json');
```

Se `require('../../package.json')` causar problema no caminho, usar `require('../..//package.json')` nao e ideal. Verificar caminho correto a partir de `backend/src/routes/configuracoes.js`: `../../package.json`.

## 6. Backend - Helpers

Dentro de `configuracoes.js`, criar helpers pequenos:

```js
function trimOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function trimRequired(value) {
  const trimmed = trimOrNull(value);
  return trimmed;
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
```

Perfis validos:

```js
const PERFIS_VALIDOS = new Set(['admin', 'operador', 'visualizador']);
```

Tratamento de erro Postgres:

- `23505`: conflito de unicidade
- Para CNPJ/email duplicado, retornar `409`

## 7. Backend - Endpoints Empresa

### `GET /configuracoes/cliente`

Autenticacao:

- `autenticar`

Query:

```sql
SELECT id, nome, cnpj, email, telefone, plano, ativo, criado_em, atualizado_em
FROM clientes
WHERE id = $1
```

Param:

- `req.usuario.cliente_id`

Resposta:

```json
{
  "id": "uuid",
  "nome": "Cliente Default",
  "cnpj": null,
  "email": "contato@cliente.com",
  "telefone": null,
  "plano": "master",
  "ativo": true,
  "criado_em": "...",
  "atualizado_em": "..."
}
```

### `PATCH /configuracoes/cliente`

Autenticacao:

- `autenticar`
- `exigirPerfil('admin')`

Body:

```json
{
  "nome": "Empresa Exemplo",
  "cnpj": "00.000.000/0001-00",
  "email": "contato@empresa.com",
  "telefone": "(85) 99999-9999"
}
```

Validacoes:

- `nome` obrigatorio se enviado e nao pode ficar vazio.
- `email` obrigatorio se enviado e deve parecer email.
- `cnpj` pode ser null/string vazia.
- `telefone` pode ser null/string vazia.
- Nao permitir alterar `plano` por este endpoint no MVP.

Query:

```sql
UPDATE clientes SET
  nome = COALESCE($1, nome),
  cnpj = $2,
  email = COALESCE($3, email),
  telefone = $4
WHERE id = $5
RETURNING id, nome, cnpj, email, telefone, plano, ativo, criado_em, atualizado_em
```

Observacao importante:

- Para permitir limpar `cnpj` e `telefone`, nao usar `COALESCE` nesses campos; passar null explicitamente.
- Para `nome` e `email`, se body nao contiver a chave, manter valor existente. Uma implementacao mais simples pode exigir todos os campos do formulario e sempre atualizar tudo.

Resposta: objeto cliente atualizado.

Erros:

- `400`: dados invalidos
- `403`: perfil sem permissao
- `409`: CNPJ duplicado

## 8. Backend - Endpoints Usuarios

### `GET /configuracoes/usuarios`

Autenticacao:

- `autenticar`

Query:

```sql
SELECT id, nome, email, perfil, ativo, ultimo_login, criado_em
FROM usuarios
WHERE cliente_id = $1
ORDER BY ativo DESC, nome ASC
```

Resposta:

```json
[
  {
    "id": "uuid",
    "nome": "Admin",
    "email": "admin@empresa.com",
    "perfil": "admin",
    "ativo": true,
    "ultimo_login": "...",
    "criado_em": "..."
  }
]
```

### `POST /configuracoes/usuarios`

Autenticacao:

- `autenticar`
- `exigirPerfil('admin')`

Body:

```json
{
  "nome": "Operador",
  "email": "operador@empresa.com",
  "senha": "senha1234",
  "perfil": "operador"
}
```

Validacoes:

- `nome` obrigatorio
- `email` obrigatorio e valido
- `senha` obrigatoria com minimo 8 caracteres
- `perfil` deve estar em `admin`, `operador`, `visualizador`

Query:

```sql
INSERT INTO usuarios (cliente_id, nome, email, senha_hash, perfil)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, nome, email, perfil, ativo, ultimo_login, criado_em
```

Antes:

```js
const senhaHash = await bcrypt.hash(senha, 12);
```

Erros:

- `409` se email duplicado (`usuarios.email` e UNIQUE global).

### `PATCH /configuracoes/usuarios/:id`

Autenticacao:

- `autenticar`
- `exigirPerfil('admin')`

Body permitido:

```json
{
  "nome": "Novo Nome",
  "perfil": "visualizador",
  "ativo": false,
  "senha": "novaSenha123"
}
```

Campos opcionais:

- `nome`
- `perfil`
- `ativo`
- `senha`

Validacoes:

- Usuario alvo precisa pertencer ao mesmo cliente.
- Perfil valido se enviado.
- Senha minima 8 se enviada.
- Nao permitir desativar o proprio usuario logado.
- Nao permitir deixar o cliente sem nenhum admin ativo.

Regra "ultimo admin":

Antes de aplicar `ativo=false` ou mudar perfil de admin para outro perfil:

```sql
SELECT COUNT(*)::int AS total
FROM usuarios
WHERE cliente_id = $1
  AND perfil = 'admin'
  AND ativo = true
  AND id <> $2
```

Se total for 0 e a alteracao remover admin ativo, retornar `400`.

Query de update:

Construir dinamicamente ou usar COALESCE com cuidado.

Sugestao simples:

1. Buscar usuario atual.
2. Calcular valores finais em JS.
3. Executar:

```sql
UPDATE usuarios SET
  nome = $1,
  perfil = $2,
  ativo = $3,
  senha_hash = COALESCE($4, senha_hash)
WHERE id = $5 AND cliente_id = $6
RETURNING id, nome, email, perfil, ativo, ultimo_login, criado_em
```

Resposta: usuario atualizado.

## 9. Backend - Endpoints Alertas

### `GET /configuracoes/alertas`

Autenticacao:

- `autenticar`

Retornar configuracao operacional sem vazar segredo:

```json
{
  "webhook_configurado": true,
  "webhook_mascarado": "https://n8n.exemplo.com/webhook/rizo...",
  "notificacoes_ativas": true,
  "timeout_ms": 8000,
  "atraso_padrao_min": 5
}
```

Fonte:

- `process.env.N8N_WEBHOOK_URL`
- `process.env.ALERTA_TIMEOUT_MS` opcional, default 8000
- `atraso_padrao_min`: default hardcoded 5 por enquanto, porque o schema de equipamentos tambem usa default 5.

### `POST /configuracoes/alertas/teste`

Autenticacao:

- `autenticar`
- `exigirPerfil('admin')`

Comportamento:

- Se `N8N_WEBHOOK_URL` ausente, retornar `400` com mensagem "Webhook nao configurado".
- Buscar cliente:

```sql
SELECT nome, telefone, email FROM clientes WHERE id = $1
```

- Enviar payload de teste:

```json
{
  "tipo": "teste_configuracao",
  "cliente_nome": "...",
  "cliente_telefone": "...",
  "mensagem": "Teste de notificacao do Rizom Temp",
  "timestamp": "..."
}
```

- Usar `fetch` com timeout:

```js
const res = await fetch(process.env.N8N_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(8000),
});
```

Resposta sucesso:

```json
{
  "ok": true,
  "status": 200
}
```

Resposta erro:

```json
{
  "ok": false,
  "erro": "Webhook retornou 500"
}
```

Problemas possiveis:

- Em Node antigo, `AbortSignal.timeout` pode nao existir. O projeto esta rodando Node moderno, mas se quiser robustez, criar fallback.
- O backend ja usa `fetch` em `alertaService.js`, entao nao precisa instalar dependencia.

## 10. Backend - Endpoint Sistema

### Ajustar `backend/src/mqtt/client.js`

Hoje exporta:

```js
module.exports = { conectar, publicar };
```

Adicionar estado:

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

Nao retornar username/password.

### `GET /configuracoes/sistema`

Autenticacao:

- `autenticar`

Checar DB:

```js
let dbOk = false;
try {
  await db.query('SELECT 1');
  dbOk = true;
} catch {}
```

Resposta:

```json
{
  "backend": {
    "status": "ok",
    "version": "1.0.0",
    "node_env": "development",
    "server_time": "2026-05-21T..."
  },
  "database": {
    "status": "ok"
  },
  "mqtt": {
    "conectado": true,
    "host": "localhost",
    "port": 1883
  },
  "api": {
    "frontend_url": "http://localhost:5173",
    "report_timezone": "America/Recife"
  }
}
```

Nao expor:

- `DATABASE_URL`
- `JWT_SECRET`
- `MQTT_PASSWORD`
- `N8N_WEBHOOK_URL` completo

## 11. Frontend - Tipos E API

Editar `frontend/src/api.ts`.

Adicionar tipos:

```ts
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
  database: {
    status: string;
  };
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
```

Adicionar client:

```ts
export const configuracoesApi = {
  cliente: () => api.get<ClienteConfiguracao>('/configuracoes/cliente'),
  atualizarCliente: (dados: Partial<ClienteConfiguracao>) =>
    api.patch<ClienteConfiguracao>('/configuracoes/cliente', dados),
  usuarios: () => api.get<UsuarioConfiguracao[]>('/configuracoes/usuarios'),
  criarUsuario: (dados: { nome: string; email: string; senha: string; perfil: UsuarioConfiguracao['perfil'] }) =>
    api.post<UsuarioConfiguracao>('/configuracoes/usuarios', dados),
  atualizarUsuario: (id: string, dados: Partial<Pick<UsuarioConfiguracao, 'nome' | 'perfil' | 'ativo'>> & { senha?: string }) =>
    api.patch<UsuarioConfiguracao>(`/configuracoes/usuarios/${id}`, dados),
  alertas: () => api.get<AlertasConfiguracao>('/configuracoes/alertas'),
  testarAlertas: () => api.post<{ ok: boolean; status?: number; erro?: string }>('/configuracoes/alertas/teste'),
  sistema: () => api.get<SistemaConfiguracao>('/configuracoes/sistema'),
};
```

## 12. Frontend - Pagina Configuracoes

Substituir `frontend/src/pages/Configuracoes.tsx`.

### Estrutura visual

Topo:

- Titulo: "Configuracoes"
- Subtitulo: "Gerencie empresa, usuarios, alertas e diagnostico do sistema."

Abas:

- Empresa
- Usuarios
- Alertas
- Sistema

Usar state:

```ts
const [aba, setAba] = useState<'empresa' | 'usuarios' | 'alertas' | 'sistema'>('empresa');
```

### Dados carregados

Carregar tudo no mount:

```ts
const [cliente, setCliente] = useState<ClienteConfiguracao | null>(null);
const [usuarios, setUsuarios] = useState<UsuarioConfiguracao[]>([]);
const [alertas, setAlertas] = useState<AlertasConfiguracao | null>(null);
const [sistema, setSistema] = useState<SistemaConfiguracao | null>(null);
const [loading, setLoading] = useState(true);
const [erro, setErro] = useState<string | null>(null);
```

Usar `Promise.all`, mas com cuidado: se uma chamada falhar, a pagina inteira pode ficar quebrada. Para MVP, tudo bem usar `Promise.all` e mostrar erro geral.

### Componentes internos sugeridos

Pode implementar dentro do arquivo para reduzir escopo:

- `SectionCard`
- `Field`
- `StatusPill`
- `TabButton`

Evitar criar muitos arquivos neste ciclo.

## 13. Frontend - Aba Empresa

Campos:

- Nome
- CNPJ
- Email
- Telefone
- Plano (somente leitura)

Botao:

- "Salvar alteracoes"

Comportamento:

- Inicializa formulario com dados do cliente.
- Ao salvar, chama `configuracoesApi.atualizarCliente`.
- Mostrar feedback:
  - "Salvo com sucesso."
  - erro retornado do backend se houver.

Layout recomendado:

- Card com grid de 2 colunas em desktop.
- Uma coluna em telas menores via CSS inline:
  - Como inline nao tem media query, usar `gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'`.

Problemas possiveis:

- Usuario nao admin recebera `403`; ocultar botao de salvar para nao admin seria ideal, mas `useAuth` tem `usuario.perfil`.
- Pode deixar inputs disabled para nao admin.

## 14. Frontend - Aba Usuarios

Funcionalidade:

- Tabela/lista de usuarios.
- Formulario compacto para novo usuario.
- Acoes por usuario:
  - Alterar perfil via select.
  - Ativar/desativar via botao.

Campos novo usuario:

- Nome
- Email
- Perfil
- Senha temporaria

Regras UI:

- Apenas admin ve formulario e acoes.
- Nao admin ve lista read-only.

Exibir:

- Nome
- Email
- Perfil
- Status ativo/inativo
- Ultimo login formatado ou "Nunca"

Data:

- Usar `date-fns` ja instalado.
- Exemplo:

```ts
format(new Date(usuario.ultimo_login), 'dd/MM/yyyy HH:mm')
```

Problemas possiveis:

- Criar usuario com email duplicado.
- Admin tentar desativar a si mesmo.
- Admin tentar remover ultimo admin.
- Senha curta.

Mostrar mensagens de backend.

## 15. Frontend - Aba Alertas

Exibir cards:

- Status do webhook:
  - "Configurado" em verde
  - "Nao configurado" em cinza/alerta
- Webhook mascarado
- Timeout
- Atraso padrao

Botao:

- "Enviar alerta de teste"

Comportamento:

- Admin pode testar.
- Se webhook ausente, botao disabled ou chama e mostra resposta amigavel.

Texto util:

- "O atraso real de cada equipamento pode ser ajustado na tela de equipamentos."

Problemas possiveis:

- Teste demora.
- Webhook retorna erro.
- Ambiente local sem webhook.

## 16. Frontend - Aba Sistema

Exibir diagnostico:

- Backend: status, versao, ambiente, horario servidor
- Banco: ok/erro
- MQTT: conectado/desconectado, host, porta
- API: frontend_url, report_timezone

Botao:

- "Atualizar status"

Comportamento:

- Chama `configuracoesApi.sistema()`.

Status visual:

- Verde para ok/conectado.
- Amarelo/cinza para nao configurado.
- Vermelho para erro/desconectado.

Problemas possiveis:

- MQTT desconectado mas backend ok.
- Banco query falha: rota ainda deve responder com database.status = "erro", se possivel.

## 17. Design Detalhado

Usar variaveis atuais:

- Fundo da pagina: herdado `var(--night)`
- Cards: `var(--surface)`
- Inputs: `var(--surface-2)` ou `#fff` com border `var(--border)`
- Texto principal: `var(--text-primary)`
- Texto secundario: `var(--text-secondary)`
- Muted: `var(--text-muted)`
- Azul primario: `var(--rizom-blue)`
- Sucesso: `var(--ok)`
- Alerta: `var(--alerta)`
- Erro: `var(--danger)`

Evitar:

- Gradientes grandes
- Hero
- Cards dentro de cards sem necessidade
- Texto explicando demais a UI
- Orbs/decoracoes
- Componentes arredondados demais: preferir `borderRadius: 8`

Icones:

- Usar `lucide-react`, ja instalado.
- Sugestoes:
  - Empresa: `Building2`
  - Usuarios: `Users`
  - Alertas: `Bell`
  - Sistema: `Server`
  - Salvar: `Save`
  - Testar: `Send`
  - Atualizar: `RefreshCw`

## 18. Ordem De Execucao Recomendada

1. Criar backend `routes/configuracoes.js` com todos endpoints.
2. Registrar rota em `index.js`.
3. Ajustar `mqtt/client.js` para exportar `getStatus`.
4. Rodar checks:
   - `node --check src/routes/configuracoes.js`
   - `node --check src/index.js`
   - `node --check src/mqtt/client.js`
5. Testar endpoints com curl usando token existente:
   - Login admin
   - GET cliente
   - PATCH cliente
   - GET usuarios
   - POST usuario
   - PATCH usuario
   - GET alertas
   - POST alertas/teste
   - GET sistema
6. Atualizar `frontend/src/api.ts`.
7. Implementar `Configuracoes.tsx`.
8. Rodar:
   - `npm run lint`
   - `npm run build`
9. Testar no navegador:
   - Abrir `/configuracoes`
   - Salvar empresa
   - Criar usuario
   - Alterar perfil
   - Testar alerta
   - Atualizar sistema

## 19. Comandos Uteis Para Teste

### Login

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@empresa.com","senha":"senha123"}'
```

Salvar token em shell:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token))")
```

### Cliente

```bash
curl -s http://localhost:3000/configuracoes/cliente \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s -X PATCH http://localhost:3000/configuracoes/cliente \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Cliente Default","email":"contato@cliente.com","cnpj":"","telefone":"(85) 99999-9999"}'
```

### Usuarios

```bash
curl -s http://localhost:3000/configuracoes/usuarios \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s -X POST http://localhost:3000/configuracoes/usuarios \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Operador Teste","email":"operador.teste@example.com","senha":"senha1234","perfil":"operador"}'
```

### Alertas

```bash
curl -s http://localhost:3000/configuracoes/alertas \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s -X POST http://localhost:3000/configuracoes/alertas/teste \
  -H "Authorization: Bearer $TOKEN"
```

### Sistema

```bash
curl -s http://localhost:3000/configuracoes/sistema \
  -H "Authorization: Bearer $TOKEN"
```

## 20. Criterios De Aceite

Backend:

- Todas as rotas `/configuracoes/*` exigem JWT.
- Escritas administrativas exigem perfil `admin`.
- Nao vaza segredos.
- Trata duplicidade de email/CNPJ.
- Impede desativar o proprio usuario.
- Impede remover ultimo admin ativo.
- `GET /configuracoes/sistema` mostra DB e MQTT corretamente.

Frontend:

- `/configuracoes` deixa de mostrar "Em breve".
- Abas funcionam.
- Empresa carrega e salva.
- Usuarios listam.
- Admin cria usuario.
- Admin altera perfil/status.
- Alertas mostram webhook configurado/ausente.
- Sistema mostra status.
- Nao admin ve pagina sem acoes perigosas.
- Visual consistente com tema claro.
- Sem overflow horizontal em largura comum.

Qualidade:

- `npm run lint` passa no frontend.
- `npm run build` passa no frontend.
- `node --check` passa nos arquivos backend alterados.
- Teste manual no navegador passa.

## 21. Riscos E Mitigacoes

### Risco: webhook completo exposto

Mitigacao:

- Retornar somente boolean + string mascarada.

### Risco: usuario admin se bloqueia

Mitigacao:

- Bloquear desativacao do proprio usuario.
- Bloquear alteracao que remova ultimo admin ativo.

### Risco: query dinamica insegura

Mitigacao:

- Preferir calcular valores finais em JS e usar query parametrizada fixa.

### Risco: frontend quebra para usuario nao-admin

Mitigacao:

- Usar `useAuth` para esconder/desabilitar acoes.
- Backend continua sendo fonte de verdade.

### Risco: MQTT desconectado gerar confusao

Mitigacao:

- Mostrar "Desconectado" claramente, mas nao impedir uso da pagina.

### Risco: migration desnecessaria

Mitigacao:

- Nao adicionar schema neste MVP.

### Risco: senha padrao fraca em novo usuario

Mitigacao:

- Exigir minimo 8 caracteres no backend.
- Mostrar campo como "Senha temporaria".

### Risco: frontend muito grande em um unico arquivo

Mitigacao:

- Aceitavel no MVP, mas manter componentes internos pequenos.
- Se passar de cerca de 500 linhas, considerar extrair componentes simples depois.

## 22. Possivel Estrutura De `Configuracoes.tsx`

Pseudoestrutura:

```tsx
export default function Configuracoes() {
  const { usuario } = useAuth();
  const isAdmin = usuario?.perfil === 'admin';

  const [aba, setAba] = useState<'empresa' | 'usuarios' | 'alertas' | 'sistema'>('empresa');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // dados
  // formularios
  // handlers

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <header>...</header>
      <nav>abas</nav>
      {aba === 'empresa' && <Empresa />}
      {aba === 'usuarios' && <Usuarios />}
      {aba === 'alertas' && <Alertas />}
      {aba === 'sistema' && <Sistema />}
    </div>
  );
}
```

## 23. Observacoes Sobre Estado Atual Do Repo

Ha alteracoes anteriores no workspace que nao pertencem diretamente a esta feature:

- `backend/.env` e `frontend/.env` foram removidos do indice Git, mas continuam locais.
- `backend/node_modules` foi removido do versionamento.
- Ha arquivos novos e modificacoes em firmware/raspberry/scripts.

Ao implementar, nao reverter alteracoes nao relacionadas.

## 24. Sugestao De Commit

Quando tudo passar:

```bash
git add backend/src frontend/src docs/PLANO-CONFIGURACOES-MVP.md
git status --short
git commit -m "Implement settings MVP"
```

Se quiser incluir limpeza de `.env` e `node_modules` no mesmo commit, revisar com cuidado porque ha muitas remocoes staged de `backend/node_modules`.

