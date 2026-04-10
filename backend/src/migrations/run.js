// src/migrations/run.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const migrationFiles = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`[Migration] Encontradas ${migrationFiles.length} migration(s)`);

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    console.log(`[Migration] Executando ${file}...`);
    await pool.query(sql);
    console.log(`[Migration] ✓ ${file}`);
  }

  await pool.end();
  console.log('[Migration] Concluído.');
}

runMigrations().catch(err => {
  console.error('[Migration] Erro:', err.message);
  process.exit(1);
});
