# Deploy — GitHub Actions

## Pipeline

```
push to any branch
  └── CI: Backend syntax check
  └── CI: Frontend lint + build

push to main (CI must pass)
  └── Deploy → VPS via SSH
        git pull + npm ci + build frontend + migrations + pm2 reload
```

## Secrets obrigatórios

Configure em: **GitHub → Settings → Secrets and variables → Actions**

| Secret | Exemplo | Descrição |
|--------|---------|-----------|
| `VPS_HOST` | `203.0.113.10` | IP ou domínio do VPS |
| `VPS_USER` | `ubuntu` | Usuário SSH no VPS |
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH...` | Chave SSH privada (Ed25519 recomendado) |
| `VPS_DEPLOY_PATH` | `/opt/rizomtemp` | Caminho do projeto no VPS |

## Gerar chave SSH para o deploy

No seu computador local:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/rizomtemp_deploy
```

Copiar chave pública para o VPS:

```bash
ssh-copy-id -i ~/.ssh/rizomtemp_deploy.pub ubuntu@SEU_VPS_IP
```

Adicionar no GitHub Secrets:
- `VPS_SSH_KEY` → conteúdo de `~/.ssh/rizomtemp_deploy` (chave **privada**)

## Primeiro deploy (setup inicial no VPS)

Antes do primeiro push, o VPS precisa ter o repositório clonado:

```bash
# No VPS
git clone https://github.com/SEU_USUARIO/rizom-temp.git /opt/rizomtemp
cd /opt/rizomtemp/backend
npm ci --omit=dev
cd ../frontend
npm ci && npm run build

# Configurar .env
cp /opt/rizomtemp/backend/.env.example /opt/rizomtemp/backend/.env
# edite o .env com as variáveis reais

# Rodar migrations
cd /opt/rizomtemp/backend
node src/migrations/run.js

# Registrar no PM2
pm2 start src/index.js --name rizomtemp-backend
pm2 save
pm2 startup
```

Depois disso, todo `git push origin main` faz deploy automático.
