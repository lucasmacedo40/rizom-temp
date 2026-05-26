// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const { exigirBillingAtivo } = require('../middleware/billing');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  const { rows } = await db.query(
    `SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.cliente_id, u.ativo,
            c.nome AS cliente_nome, c.plano
     FROM usuarios u
     JOIN clientes c ON c.id = u.cliente_id
     WHERE u.email = $1`,
    [email.toLowerCase().trim()]
  );

  const usuario = rows[0];
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaValida) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  await db.query(`UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1`, [usuario.id]);

  const payload = {
    id: usuario.id,
    cliente_id: usuario.cliente_id,
    perfil: usuario.perfil,
    email: usuario.email,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      cliente_nome: usuario.cliente_nome,
      plano: usuario.plano,
    },
  });
});

// GET /auth/me — dados do usuário logado
router.get('/me', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nome, u.email, u.perfil, u.ultimo_login,
            c.nome AS cliente_nome, c.plano
     FROM usuarios u
     JOIN clientes c ON c.id = u.cliente_id
     WHERE u.id = $1`,
    [req.usuario.id]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado' });
  res.json(rows[0]);
});

// POST /auth/usuarios — cria usuário (somente admin)
router.post('/usuarios', autenticar, exigirBillingAtivo, exigirPerfil('admin'), async (req, res) => {
  const { nome, email, senha, perfil = 'operador' } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  const senhaHash = await bcrypt.hash(senha, 12);

  const { rows } = await db.query(
    `INSERT INTO usuarios (cliente_id, nome, email, senha_hash, perfil)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nome, email, perfil`,
    [req.usuario.cliente_id, nome, email.toLowerCase().trim(), senhaHash, perfil]
  );

  res.status(201).json(rows[0]);
});

module.exports = router;
