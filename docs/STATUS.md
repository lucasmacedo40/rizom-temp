# Rizom Temp — Status do Projeto

> Última atualização: 2026-05-22

---

## Visão Geral

Sistema de monitoramento de temperatura IoT para conformidade com a ANVISA RDC 216/2004 (controle de temperatura em estabelecimentos de alimentos). Dispositivos ESP32-C3 com sensor DS18B20 enviam leituras via MQTT para um backend Node.js que persiste, processa alertas e expõe uma API REST consumida por um frontend React.

**URL de produção:** https://temp.rizom.com.br  
**Repositório:** https://github.com/lucasmacedo40/rizom-temp  
**Status:** ✅ Em produção

---

## Arquitetura

```
ESP32-C3 (DS18B20)
    │  MQTT (porta 1883)
    ▼
Mosquitto (broker MQTT)
    │
    ▼
Backend Node.js/Express ──► PostgreSQL
    │
    ▼
Frontend React (Nginx)
    │  HTTPS
    ▼
Traefik (reverse proxy + SSL Let's Encrypt)
    │
Usuário (navegador)
```

**Infra de produção:** Docker Swarm no VPS Hostinger KVM 4 (4 vCPUs, 16 GB RAM, Ubuntu 24.04)  
**Deploy automático:** GitHub Actions → GHCR → Docker Swarm

---

## O que foi feito nesta sprint

### 1. Correção de bugs críticos

#### `limparAlerta` nunca era chamado
O serviço de alerta verificava se a temperatura estava fora do limite e gerava alerta, mas nunca limpava o estado quando a temperatura voltava ao normal. O branch `else if` estava ausente.

**Arquivo:** `backend/src/mqtt/client.js`
```js
// Antes: sem limpeza
if (!dentroLimite && equip.alerta_ativo) {
    await alertaService.verificarEGerarAlerta(equip, temperatura);
}

// Depois: limpa ao voltar ao normal
if (!dentroLimite && equip.alerta_ativo) {
    await alertaService.verificarEGerarAlerta(equip, temperatura);
} else if (dentroLimite && equip.alerta_ativo) {
    await alertaService.limparAlerta(equip.id);
}
```

#### Dependência `mqtt` no frontend removida
O pacote `mqtt` estava listado nas dependências do frontend mas nunca era usado. Removido do `package.json`.

---

### 2. Nova funcionalidade: Página de Configurações

Implementada do zero — antes era um placeholder vazio.

**Backend — `backend/src/routes/configuracoes.js`** (novo arquivo)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/configuracoes/cliente` | GET | Dados da empresa |
| `/configuracoes/cliente` | PATCH | Atualizar dados da empresa |
| `/configuracoes/usuarios` | GET | Listar usuários |
| `/configuracoes/usuarios` | POST | Criar usuário |
| `/configuracoes/usuarios/:id` | PATCH | Editar usuário |
| `/configuracoes/alertas` | GET | Configurações de alerta/webhook |
| `/configuracoes/alertas/teste` | POST | Disparar alerta de teste |
| `/configuracoes/sistema` | GET | Status do sistema (backend, DB, MQTT, API) |

Proteções implementadas:
- Último admin não pode ser desativado ou ter perfil rebaixado
- Admin não pode desativar a si mesmo
- Campos sensíveis nunca expostos (`DATABASE_URL`, `JWT_SECRET`, `MQTT_PASSWORD`, `N8N_WEBHOOK_URL` completo — apenas mascarado)

**Frontend — `frontend/src/pages/Configuracoes.tsx`** (616 linhas)

4 abas:
- **Empresa** — editar nome, CNPJ, e-mail, telefone
- **Usuários** — listar, criar, editar, ativar/desativar (admin only)
- **Alertas** — ver configuração de webhook, disparar teste
- **Sistema** — status do backend, banco, MQTT e API em tempo real

---

### 3. Auditoria de relatórios

Toda geração de relatório PDF agora registra uma linha na tabela `relatorios` para fins de auditoria (fire-and-forget, sem impacto na resposta).

**Arquivo:** `backend/src/routes/relatorios.js`

---

### 4. Validação de ambiente

Criado `backend/src/config/env.js` — valida no startup que todas as variáveis de ambiente obrigatórias estão presentes. Se alguma faltar, o servidor não sobe e exibe quais estão faltando.

---

### 5. Adição da rota `/configuracoes` ao Nginx

O proxy Nginx não incluía `/configuracoes` na lista de rotas redirecionadas ao backend.

**Arquivo:** `raspberry/nginx.conf`

---

### 6. Repositório GitHub + CI/CD

**Repositório criado:** https://github.com/lucasmacedo40/rizom-temp (privado)

**Pipeline `.github/workflows/cicd.yml`:**

```
push para qualquer branch
  ├── CI: Backend — syntax check (node --check em todos os .js)
  └── CI: Frontend — lint (eslint) + build (tsc + vite)

push para main (CI deve passar)
  ├── Build & Push: imagens Docker → GHCR
  │     ghcr.io/lucasmacedo40/rizomtemp-backend:latest
  │     ghcr.io/lucasmacedo40/rizomtemp-frontend:latest
  └── Deploy: self-hosted runner no VPS
        docker stack deploy rizomtemp
```

Não são necessários secrets — o deploy usa um **self-hosted runner** instalado diretamente no VPS.

---

### 7. Containerização com Docker

**`backend/Dockerfile`**
- Node 20 Alpine
- Entrypoint aguarda PostgreSQL estar pronto antes de iniciar
- Roda migrations automaticamente no startup
- Inicia o servidor Node.js

**`frontend/Dockerfile`**
- Multi-stage: Node 20 Alpine (build) → Nginx Alpine (serve)
- Produz imagem ~25 MB

**`frontend/nginx.docker.conf`**
- Serve o SPA React
- Faz proxy de `/api/*` para o backend (rewrite remove o prefixo `/api`)
- Fallback para `index.html` em todas as rotas (SPA)

---

### 8. Deploy em produção (Docker Swarm)

**`docker/stack.yml`** — stack completo:

| Serviço | Imagem | Rede | Porta exposta |
|---------|--------|------|---------------|
| `rizomtemp_frontend` | ghcr.io/…/rizomtemp-frontend | public + internal | — (Traefik) |
| `rizomtemp_backend` | ghcr.io/…/rizomtemp-backend | internal | — |
| `rizomtemp_postgres` | postgres:16-alpine | internal | — |
| `rizomtemp_mosquitto` | eclipse-mosquitto:2 | internal | 1883 (ESP32) |

Integrado ao Traefik existente no VPS:
- Domínio: `temp.rizom.com.br`
- SSL: Let's Encrypt automático via `letsencryptresolver`
- HTTP → HTTPS gerenciado pelo Traefik

---

## Status atual dos serviços

| Serviço | Status | Detalhe |
|---------|--------|---------|
| Frontend | ✅ Running | https://temp.rizom.com.br |
| Backend API | ✅ Running | Migrations aplicadas, MQTT conectado |
| PostgreSQL | ✅ Running | 3 migrations aplicadas |
| Mosquitto MQTT | ✅ Running | Porta 1883 aberta para ESP32 |
| DNS | ✅ Propagado | `temp.rizom.com.br` → `72.62.106.51` |
| SSL | ✅ Ativo | Let's Encrypt via Traefik |
| CI/CD | ✅ Funcional | Build + push automático no push para main |

---

## Credenciais de acesso inicial

| Campo | Valor |
|-------|-------|
| URL | https://temp.rizom.com.br |
| Email | admin@rizom.com.br |
| Senha | senha123 |

> ⚠️ Trocar a senha após o primeiro acesso via Configurações → Usuários.

---

## Próximos passos sugeridos

- [ ] Instalar o **self-hosted runner** no VPS para deploys 100% automáticos (sem intervenção manual)
- [ ] Configurar **autenticação no Mosquitto** (usuário/senha para os ESP32)
- [ ] Provisionar o primeiro dispositivo ESP32 via fluxo de pareamento
- [ ] Configurar URL do webhook n8n em Configurações → Alertas para notificações
- [ ] Trocar a senha padrão do admin
- [ ] Configurar backup automático do PostgreSQL

---

## Estrutura do repositório

```
rizom-temp/
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh          # aguarda postgres + migrations + start
│   └── src/
│       ├── config/env.js      # validação de variáveis de ambiente
│       ├── migrations/        # schema SQL + runner idempotente
│       ├── mqtt/client.js     # processamento de leituras MQTT
│       ├── routes/
│       │   ├── auth.js
│       │   ├── equipamentos.js
│       │   ├── leituras.js
│       │   ├── alertas.js
│       │   ├── relatorios.js
│       │   ├── provisioning.js
│       │   └── configuracoes.js  ← novo
│       └── services/
│           └── alertaService.js
├── frontend/
│   ├── Dockerfile
│   ├── nginx.docker.conf      # proxy /api/* → backend
│   └── src/
│       ├── api.ts             # axios client + tipos
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── Equipamentos.tsx
│       │   ├── Alertas.tsx
│       │   ├── Relatorios.tsx
│       │   └── Configuracoes.tsx  ← novo
│       └── contexts/
│           └── AuthContext.tsx
├── docker/
│   ├── stack.yml              # Docker Swarm stack
│   └── mosquitto.prod.conf
├── firmware/
│   └── src/main.cpp           # ESP32-C3 + DS18B20
├── raspberry/                 # scripts legados (Pi/VPS sem Docker)
└── .github/
    ├── workflows/cicd.yml     # CI + build GHCR + deploy Swarm
    └── DEPLOY.md
```
