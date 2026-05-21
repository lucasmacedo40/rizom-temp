#!/bin/sh
set -e

echo "[entrypoint] Aguardando PostgreSQL..."
until node -e "
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => { p.end(); process.exit(1); });
" 2>/dev/null; do
  echo "[entrypoint] PostgreSQL não disponível, tentando em 3s..."
  sleep 3
done

echo "[entrypoint] Executando migrations..."
node src/migrations/run.js

echo "[entrypoint] Iniciando servidor..."
exec node src/index.js
