// src/routes/provisioning.js
const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /provisioning/:codigo — endpoint público para o ESP32 buscar config
router.get('/:codigo', async (req, res) => {
  const { codigo } = req.params;

  if (!/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código inválido' });
  }

  const { rows } = await db.query(
    `SELECT cp.equipamento_id, e.device_id, e.temp_min, e.temp_max
     FROM codigos_pareamento cp
     JOIN equipamentos e ON e.id = cp.equipamento_id
     WHERE cp.codigo = $1
       AND cp.usado = FALSE
       AND cp.expira_em > NOW()`,
    [codigo]
  );

  if (rows.length === 0) {
    return res.status(404).json({ erro: 'Código inválido ou expirado' });
  }

  const equip = rows[0];

  // Marks as used
  await db.query(
    `UPDATE codigos_pareamento SET usado = TRUE WHERE codigo = $1`,
    [codigo]
  );

  res.json({
    device_id:    equip.device_id,
    mqtt_host:    process.env.MQTT_HOST_LOCAL || process.env.MQTT_HOST || 'localhost',
    mqtt_port:    parseInt(process.env.MQTT_PORT || '1883'),
    intervalo_seg: 60,
  });
});

module.exports = router;
