// src/services/alertaService.js
// Gera alertas quando temperatura sai do limite
// Integração com n8n via webhook para notificação no WhatsApp

const db = require('../db');

async function buscarEstado(equipamentoId) {
  const { rows } = await db.query(
    'SELECT * FROM estado_alertas WHERE equipamento_id = $1',
    [equipamentoId]
  );
  return rows[0] || null;
}

async function salvarEstado(equipamentoId, tipo, notificado) {
  await db.query(
    `INSERT INTO estado_alertas (equipamento_id, tipo, notificado)
     VALUES ($1, $2, $3)
     ON CONFLICT (equipamento_id) DO UPDATE
     SET tipo = $2, notificado = $3, atualizado_em = NOW()`,
    [equipamentoId, tipo, notificado]
  );
}

async function verificarEGerarAlerta(equip, temperatura) {
  const tipo = temperatura > equip.temp_max ? 'temp_acima' : 'temp_abaixo';
  const agora = Date.now();

  const estado = await buscarEstado(equip.id);

  if (!estado) {
    // Primeira leitura fora do limite — inicia temporizador no banco
    await salvarEstado(equip.id, tipo, false);
    return;
  }

  // Já existe estado de alerta
  const minutosForaLimite = (agora - new Date(estado.inicio).getTime()) / 60000;

  if (!estado.notificado && minutosForaLimite >= equip.alerta_atraso_min) {
    // Passou do tempo de tolerância — cria alerta no banco e notifica
    await criarAlerta(equip, tipo, temperatura);
    await salvarEstado(equip.id, tipo, true);
  }
}

async function limparAlerta(equipamentoId) {
  // Chamado quando temperatura volta ao normal
  await db.query(
    'DELETE FROM estado_alertas WHERE equipamento_id = $1',
    [equipamentoId]
  );
}

async function criarAlerta(equip, tipo, temperatura) {
  const mensagens = {
    temp_acima: `Temperatura ALTA: ${temperatura}°C (limite máx: ${equip.temp_max}°C)`,
    temp_abaixo: `Temperatura BAIXA: ${temperatura}°C (limite mín: ${equip.temp_min}°C)`,
    sem_sinal: `Sem sinal do dispositivo há mais de 10 minutos`,
    dispositivo_offline: `Dispositivo offline`,
  };

  const mensagem = mensagens[tipo] || `Alerta: ${tipo}`;

  // Busca cliente para montar a notificação
  const { rows: clienteRows } = await db.query(
    `SELECT c.nome, c.telefone, c.email
     FROM clientes c
     WHERE c.id = $1`,
    [equip.cliente_id]
  );
  const cliente = clienteRows[0];

  // Persiste alerta
  const { rows } = await db.query(
    `INSERT INTO alertas (equipamento_id, cliente_id, tipo, temperatura, mensagem)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [equip.id, equip.cliente_id, tipo, temperatura, mensagem]
  );

  console.log(`[Alerta] Criado: ${equip.nome} — ${mensagem}`);

  // Notifica via n8n (WhatsApp / e-mail)
  if (process.env.N8N_WEBHOOK_URL) {
    await enviarNotificacao({
      alerta_id: rows[0].id,
      cliente_nome: cliente?.nome,
      cliente_telefone: cliente?.telefone,
      cliente_email: cliente?.email,
      equipamento: equip.nome,
      localizacao: equip.localizacao ?? null,
      tipo,
      temperatura,
      temp_min: equip.temp_min,
      temp_max: equip.temp_max,
      mensagem,
      timestamp: new Date().toISOString(),
    });
  }
}

async function enviarNotificacao(payload) {
  try {
    const res = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      // Marca como notificado
      await db.query(
        `UPDATE alertas SET notificado = true WHERE id = $1`,
        [payload.alerta_id]
      );
      console.log(`[Alerta] Notificação enviada via n8n para ${payload.cliente_telefone}`);
    } else {
      console.warn(`[Alerta] n8n retornou ${res.status}`);
    }
  } catch (err) {
    console.error('[Alerta] Falha ao notificar via n8n:', err.message);
  }
}

// Job: verifica dispositivos offline (executado pelo scheduler)
async function verificarDispositivosOffline() {
  const { rows } = await db.query(
    `SELECT id, cliente_id, nome
     FROM equipamentos
     WHERE ativo = true
       AND alerta_ativo = true
       AND ultimo_heartbeat < NOW() - INTERVAL '10 minutes'
       AND ultimo_heartbeat IS NOT NULL`
  );

  for (const equip of rows) {
    const jaAlertado = await db.query(
      `SELECT id FROM alertas
       WHERE equipamento_id = $1
         AND tipo = 'dispositivo_offline'
         AND criado_em > NOW() - INTERVAL '1 hour'`,
      [equip.id]
    );

    if (jaAlertado.rows.length === 0) {
      await criarAlerta(equip, 'dispositivo_offline', null);
    }
  }
}

module.exports = {
  verificarEGerarAlerta,
  limparAlerta,
  criarAlerta,
  verificarDispositivosOffline,
};
