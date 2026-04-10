// src/migrations/seed.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@empresa.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'senha123';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Admin';
const CLIENT_NAME = process.env.SEED_CLIENT_NAME || 'Cliente Default';
const CLIENT_EMAIL = process.env.SEED_CLIENT_EMAIL || 'contato@cliente.com';

async function runSeed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('[Seed] Verificando/Inserindo cliente...');
    let clienteId;

    const existingCustomer = await pool.query(
      `SELECT id FROM clientes WHERE email = $1`,
      [CLIENT_EMAIL.toLowerCase().trim()]
    );

    if (existingCustomer.rows.length > 0) {
      clienteId = existingCustomer.rows[0].id;
      console.log(`[Seed] cliente já existe: ${clienteId}`);
    } else {
      const clientResult = await pool.query(
        `INSERT INTO clientes (nome, email, cnpj, plano)
         VALUES ($1, $2, $3, 'master')
         RETURNING id`,
        [CLIENT_NAME, CLIENT_EMAIL.toLowerCase().trim(), null]
      );
      clienteId = clientResult.rows[0].id;
      console.log(`[Seed] cliente_id = ${clienteId}`);
    }

    console.log('[Seed] Verificando/Inserindo usuário admin...');
    const senhaHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const existingAdmin = await pool.query(
      `SELECT id FROM usuarios WHERE email = $1`,
      [ADMIN_EMAIL.toLowerCase().trim()]
    );

    if (existingAdmin.rows.length > 0) {
      console.log('[Seed] Usuário admin já existe. Atualizando senha e perfil.');
      await pool.query(
        `UPDATE usuarios
         SET nome = $1, senha_hash = $2, perfil = 'admin', ativo = true, cliente_id = $3
         WHERE email = $4`,
        [ADMIN_NAME, senhaHash, clienteId, ADMIN_EMAIL.toLowerCase().trim()]
      );
    } else {
      await pool.query(
        `INSERT INTO usuarios (cliente_id, nome, email, senha_hash, perfil, ativo)
         VALUES ($1, $2, $3, $4, 'admin', true)`,
        [clienteId, ADMIN_NAME, ADMIN_EMAIL.toLowerCase().trim(), senhaHash]
      );
      console.log('[Seed] Usuário admin criado com sucesso.');
    }

    console.log('[Seed] Concluído.');
    console.log(`Admin -> email: ${ADMIN_EMAIL}, senha: ${ADMIN_PASSWORD}`);
  } catch (err) {
    console.error('[Seed] Erro:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSeed();
