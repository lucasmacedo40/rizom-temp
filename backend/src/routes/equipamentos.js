// src/routes/equipamentos.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const { exigirBillingAtivo } = require('../middleware/billing');

const router = express.Router();

// Limites ANVISA padrão por tipo de equipamento
const LIMITES_PADRAO = {
  camara_fria:  { min: -18, max: -15 },
  freezer:      { min: -18, max: -10 },
  refrigerador: { min: 0,   max: 5   },
  expositor:    { min: 0,   max: 10  },
  outro:        { min: 0,   max: 10  },
};

// GET /equipamentos — lista todos do cliente
router.get('/', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM v_equipamentos_status
     WHERE cliente_id = $1
     ORDER BY nome`,
    [req.usuario.cliente_id]
  );
  res.json(rows);
});

// GET /equipamentos/:id — detalhes de um equipamento
router.get('/:id', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM v_equipamentos_status
     WHERE id = $1 AND cliente_id = $2`,
    [req.params.id, req.usuario.cliente_id]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Equipamento não encontrado' });
  res.json(rows[0]);
});

// POST /equipamentos — cadastra equipamento
router.post('/', autenticar, exigirBillingAtivo, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { nome, tipo, localizacao, fabricante, modelo, temp_min, temp_max } = req.body;

  if (!nome || !tipo) {
    return res.status(400).json({ erro: 'nome e tipo são obrigatórios' });
  }

  const limites = LIMITES_PADRAO[tipo] || LIMITES_PADRAO.outro;
  const deviceId = `rz_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const mqttTopico = `rizomtemp/${deviceId}/temperatura`;

  const { rows } = await db.query(
    `INSERT INTO equipamentos
       (cliente_id, nome, tipo, localizacao, fabricante, modelo,
        temp_min, temp_max, device_id, mqtt_topico)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.usuario.cliente_id, nome, tipo, localizacao, fabricante, modelo,
      temp_min ?? limites.min,
      temp_max ?? limites.max,
      deviceId, mqttTopico,
    ]
  );

  res.status(201).json(rows[0]);
});

// PATCH /equipamentos/:id — atualiza equipamento
router.patch('/:id', autenticar, exigirBillingAtivo, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { nome, localizacao, temp_min, temp_max, alerta_ativo, alerta_atraso_min } = req.body;

  const { rows } = await db.query(
    `UPDATE equipamentos SET
       nome = COALESCE($1, nome),
       localizacao = COALESCE($2, localizacao),
       temp_min = COALESCE($3, temp_min),
       temp_max = COALESCE($4, temp_max),
       alerta_ativo = COALESCE($5, alerta_ativo),
       alerta_atraso_min = COALESCE($6, alerta_atraso_min)
     WHERE id = $7 AND cliente_id = $8
     RETURNING *`,
    [nome, localizacao, temp_min, temp_max, alerta_ativo, alerta_atraso_min,
     req.params.id, req.usuario.cliente_id]
  );

  if (!rows[0]) return res.status(404).json({ erro: 'Equipamento não encontrado' });
  res.json(rows[0]);
});

// DELETE /equipamentos/:id — desativa (soft delete)
router.delete('/:id', autenticar, exigirBillingAtivo, exigirPerfil('admin'), async (req, res) => {
  await db.query(
    `UPDATE equipamentos SET ativo = false WHERE id = $1 AND cliente_id = $2`,
    [req.params.id, req.usuario.cliente_id]
  );
  res.json({ ok: true });
});

// GET /equipamentos/:id/config-dispositivo — dados para configurar o ESP-01
router.get('/:id/config-dispositivo', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT device_id, mqtt_topico, temp_min, temp_max
     FROM equipamentos
     WHERE id = $1 AND cliente_id = $2`,
    [req.params.id, req.usuario.cliente_id]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Não encontrado' });

  const e = rows[0];
  res.json({
    device_id: e.device_id,
    mqtt_host: process.env.MQTT_HOST_PUBLICO || process.env.MQTT_HOST,
    mqtt_port: 1883,
    mqtt_topico: e.mqtt_topico,
    heartbeat_topico: `rizomtemp/${e.device_id}/heartbeat`,
    temp_min: e.temp_min,
    temp_max: e.temp_max,
    intervalo_leitura_seg: 60,
  });
});

// POST /equipamentos/:id/pareamento — gera código de 6 dígitos para provisioning
router.post('/:id/pareamento', autenticar, exigirBillingAtivo, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { id } = req.params;

  // Verifica se o equipamento pertence ao cliente
  const { rows: equips } = await db.query(
    `SELECT id FROM equipamentos WHERE id = $1 AND cliente_id = $2 AND ativo = true`,
    [id, req.usuario.cliente_id]
  );
  if (equips.length === 0) {
    return res.status(404).json({ erro: 'Equipamento não encontrado' });
  }

  // Invalida códigos anteriores não usados
  await db.query(
    `UPDATE codigos_pareamento SET usado = TRUE
     WHERE equipamento_id = $1 AND usado = FALSE`,
    [id]
  );

  // Gera código único de 6 dígitos de forma atômica
  let inserted = null;
  let tentativas = 0;
  while (!inserted && tentativas < 10) {
    const codigo = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const { rows } = await db.query(
      `INSERT INTO codigos_pareamento (equipamento_id, codigo)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING codigo, expira_em`,
      [id, codigo]
    );
    if (rows.length > 0) inserted = rows[0];
    tentativas++;
  }
  if (!inserted) {
    return res.status(503).json({ erro: 'Não foi possível gerar código. Tente novamente.' });
  }
  res.json({ codigo: inserted.codigo, expira_em: inserted.expira_em });
});

module.exports = router;
