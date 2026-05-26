// src/routes/configuracoes.js
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const { exigirBillingAtivo } = require('../middleware/billing');
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

router.post('/usuarios', autenticar, exigirBillingAtivo, exigirPerfil('admin'), async (req, res) => {
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
    cliente_email: cliente?.email,
    equipamento: 'Teste de Configuração',
    localizacao: null,
    temperatura: null,
    temp_min: null,
    temp_max: null,
    mensagem: 'Teste de notificação do Rizom Temp — configuração verificada com sucesso.',
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
