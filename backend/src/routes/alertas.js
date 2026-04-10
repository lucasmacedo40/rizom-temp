// src/routes/alertas.js
const express = require('express');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');

const router = express.Router();

// GET /alertas — lista alertas do cliente
router.get('/', autenticar, async (req, res) => {
  const { reconhecido, limit = 50 } = req.query;

  let where = `a.cliente_id = $1`;
  const params = [req.usuario.cliente_id];

  if (reconhecido !== undefined) {
    params.push(reconhecido === 'true');
    where += ` AND a.reconhecido = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT a.id, a.tipo, a.temperatura, a.mensagem,
            a.notificado, a.reconhecido, a.reconhecido_em,
            a.criado_em, e.nome AS equipamento_nome
     FROM alertas a
     JOIN equipamentos e ON e.id = a.equipamento_id
     WHERE ${where}
     ORDER BY a.criado_em DESC
     LIMIT $${params.length + 1}`,
    [...params, parseInt(limit)]
  );

  res.json(rows);
});

// PATCH /alertas/:id/reconhecer
router.patch('/:id/reconhecer', autenticar, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { rows } = await db.query(
    `UPDATE alertas
     SET reconhecido = true, reconhecido_por = $1, reconhecido_em = NOW()
     WHERE id = $2 AND cliente_id = $3
     RETURNING id, reconhecido, reconhecido_em`,
    [req.usuario.id, req.params.id, req.usuario.cliente_id]
  );

  if (!rows[0]) return res.status(404).json({ erro: 'Alerta não encontrado' });
  res.json(rows[0]);
});

module.exports = router;
