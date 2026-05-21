// src/migrations/run.js
require('dotenv').config();
const { validateDatabaseEnv } = require('../config/env');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  validateDatabaseEnv();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationFiles = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`[Migration] Encontradas ${migrationFiles.length} migration(s)`);

  for (const file of migrationFiles) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (applied.rows.length > 0) {
      console.log(`[Migration] Pulando ${file} (já aplicada)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    console.log(`[Migration] Executando ${file}...`);
    await pool.query(sql);
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [file]
    );
    console.log(`[Migration] ✓ ${file}`);
  }

  await pool.end();
  console.log('[Migration] Concluído.');
}

runMigrations().catch(err => {
  console.error('[Migration] Erro:', err.message);
  process.exit(1);
});
