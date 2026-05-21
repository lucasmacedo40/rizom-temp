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

Nenhum. O deploy usa **self-hosted runner** — o job roda diretamente no VPS, sem SSH nem chaves.

## Configurar o self-hosted runner no VPS

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
```

Acesse no GitHub: **Settings → Actions → Runners → New self-hosted runner**
- Escolha: Linux / x64
- Cole os comandos `curl` + `tar` + `./config.sh` que o GitHub mostrar

```bash
# Instalar como serviço systemd (inicia automaticamente no boot)
sudo ./svc.sh install
sudo ./svc.sh start
```

Pronto — sem secrets, sem SSH.

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
