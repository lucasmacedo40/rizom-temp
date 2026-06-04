// src/routes/leituras.js
const express = require('express');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const { exigirBillingAtivo } = require('../middleware/billing');

const router = express.Router();

// GET /leituras?equipamento_id=&inicio=&fim=&limite=
// Consulta histórico de leituras com filtros
router.get('/', autenticar, async (req, res) => {
  const {
    equipamento_id,
    inicio,
    fim,
    limite = 200,
    apenas_alertas = false,
  } = req.query;

  // Valida que o equipamento pertence ao cliente
  if (equipamento_id) {
    const { rows } = await db.query(
      `SELECT id FROM equipamentos WHERE id = $1 AND cliente_id = $2`,
      [equipamento_id, req.usuario.cliente_id]
    );
    if (!rows[0]) return res.status(403).json({ erro: 'Equipamento não encontrado' });
  }

  const params = [req.usuario.cliente_id];
  let where = `e.cliente_id = $1 AND l.temperatura <> -127`;
  let idx = 2;

  if (equipamento_id) {
    where += ` AND l.equipamento_id = $${idx++}`;
    params.push(equipamento_id);
  }
  if (inicio) {
    where += ` AND l.registrado_em >= $${idx++}`;
    params.push(new Date(inicio));
  }
  if (fim) {
    where += ` AND l.registrado_em <= $${idx++}`;
    params.push(new Date(fim));
  }
  if (apenas_alertas === 'true') {
    where += ` AND l.dentro_limite = false`;
  }

  params.push(Math.min(parseInt(limite), 5000));

  const { rows } = await db.query(
    `SELECT l.id, l.equipamento_id, e.nome AS equipamento_nome,
            l.temperatura, l.dentro_limite, l.fonte, l.registrado_em
     FROM leituras l
     JOIN equipamentos e ON e.id = l.equipamento_id
     WHERE ${where}
     ORDER BY l.registrado_em DESC
     LIMIT $${idx}`,
    params
  );

  res.json(rows);
});

// GET /leituras/grafico?equipamento_id=&horas=24
// Dados agregados para o gráfico (1 ponto por minuto)
router.get('/grafico', autenticar, async (req, res) => {
  const { equipamento_id, horas = 24 } = req.query;

  if (!equipamento_id) {
    return res.status(400).json({ erro: 'equipamento_id é obrigatório' });
  }

  // Verifica propriedade
  const { rows: equip } = await db.query(
    `SELECT id, temp_min, temp_max FROM equipamentos
     WHERE id = $1 AND cliente_id = $2`,
    [equipamento_id, req.usuario.cliente_id]
  );
  if (!equip[0]) return res.status(403).json({ erro: 'Não encontrado' });

  const { rows } = await db.query(
    `SELECT
       date_trunc('minute', registrado_em) AS minuto,
       ROUND(AVG(temperatura)::numeric, 2) AS media,
       MIN(temperatura) AS minima,
       MAX(temperatura) AS maxima,
       COUNT(*) AS leituras,
       BOOL_AND(dentro_limite) AS tudo_ok
     FROM leituras
     WHERE equipamento_id = $1
       AND registrado_em >= NOW() - ($2::int * INTERVAL '1 hour')
       AND temperatura <> -127
     GROUP BY minuto
     ORDER BY minuto ASC`,
    [equipamento_id, parseInt(horas)]
  );

  res.json({
    dados: rows,
    limites: { min: equip[0].temp_min, max: equip[0].temp_max },
  });
});

// POST /leituras/manual — registro manual (sem IoT)
router.post('/manual', autenticar, exigirBillingAtivo, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { equipamento_id, temperatura, observacao } = req.body;

  if (!equipamento_id || temperatura === undefined) {
    return res.status(400).json({ erro: 'equipamento_id e temperatura são obrigatórios' });
  }

  const { rows: equip } = await db.query(
    `SELECT id, temp_min, temp_max FROM equipamentos
     WHERE id = $1 AND cliente_id = $2`,
    [equipamento_id, req.usuario.cliente_id]
  );
  if (!equip[0]) return res.status(403).json({ erro: 'Não encontrado' });

  const dentroLimite = temperatura >= equip[0].temp_min && temperatura <= equip[0].temp_max;

  // Insere em leituras E em registros_manuais
  await db.query(
    `INSERT INTO leituras (equipamento_id, temperatura, dentro_limite, fonte)
     VALUES ($1, $2, $3, 'manual')`,
    [equipamento_id, temperatura, dentroLimite]
  );

  await db.query(
    `INSERT INTO registros_manuais
       (equipamento_id, temperatura, dentro_limite, observacao, registrado_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [equipamento_id, temperatura, dentroLimite, observacao, req.usuario.id]
  );

  res.status(201).json({ ok: true, dentro_limite: dentroLimite });
});

module.exports = router;
