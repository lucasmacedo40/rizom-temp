// src/mqtt/client.js
// Serviço MQTT — coração do sistema
// Recebe leituras dos dispositivos ESP-01 e processa em tempo real

const mqtt = require('mqtt');
const db = require('../db');
const alertaService = require('../services/alertaService');

const TOPICO_BASE = 'rizomtemp';
// Formato dos tópicos:
//   publicar leitura:  rizomtemp/{device_id}/temperatura
//   heartbeat:         rizomtemp/{device_id}/heartbeat
//   comando (futuro):  rizomtemp/{device_id}/cmd

let client = null;

function conectar() {
  const options = {
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT || '1883'),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `rizomtemp_server_${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
  };

  console.log(`[MQTT] Conectando em ${options.host}:${options.port}...`);
  client = mqtt.connect(options);

  client.on('connect', () => {
    console.log('[MQTT] Conectado ao broker.');

    // Assina todos os tópicos de temperatura e heartbeat
    client.subscribe([
      `${TOPICO_BASE}/+/temperatura`,
      `${TOPICO_BASE}/+/heartbeat`,
    ], { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Erro ao assinar tópicos:', err.message);
      else console.log('[MQTT] Assinado: rizomtemp/+/temperatura e heartbeat');
    });
  });

  client.on('message', async (topico, payload) => {
    try {
      await processarMensagem(topico, payload);
    } catch (err) {
      console.error('[MQTT] Erro ao processar mensagem:', err.message, { topico });
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Erro de conexão:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Tentando reconectar...');
  });

  client.on('offline', () => {
    console.warn('[MQTT] Cliente offline.');
  });

  return client;
}

async function processarMensagem(topico, payload) {
  // Extrai device_id do tópico: rizomtemp/{device_id}/tipo
  const partes = topico.split('/');
  if (partes.length !== 3 || partes[0] !== TOPICO_BASE) return;

  const deviceId = partes[1];
  const tipo = partes[2];

  if (tipo === 'heartbeat') {
    await processarHeartbeat(deviceId);
    return;
  }

  if (tipo === 'temperatura') {
    const dados = JSON.parse(payload.toString());
    await processarLeitura(deviceId, dados);
  }
}

async function processarLeitura(deviceId, dados) {
  // Formatos aceitos:
  //   RizomTemp ESP:  { "t": 4.25 }  ou  { "temperatura": 4.25 }
  //   Monitorie SM-WT: { "Ch1": -7.0, "Ch2": null }  ou  { "ch1": -7.0 }

  const temperatura =
    dados.t ??
    dados.temperatura ??
    dados.Ch1 ??
    dados.ch1 ??
    dados.Ch2 ??
    dados.ch2;

  if (temperatura === undefined || temperatura === null || isNaN(temperatura)) {
    console.warn(`[MQTT] Leitura inválida de ${deviceId}:`, dados);
    return;
  }

  // Busca equipamento pelo device_id
  const { rows } = await db.query(
    `SELECT id, cliente_id, nome, temp_min, temp_max, alerta_ativo, alerta_atraso_min
     FROM equipamentos
     WHERE device_id = $1 AND ativo = true`,
    [deviceId]
  );

  if (rows.length === 0) {
    console.warn(`[MQTT] Dispositivo desconhecido: ${deviceId}`);
    return;
  }

  const equip = rows[0];
  const dentroLimite = temperatura >= equip.temp_min && temperatura <= equip.temp_max;

  // Persiste leitura
  await db.query(
    `INSERT INTO leituras (equipamento_id, temperatura, dentro_limite, fonte)
     VALUES ($1, $2, $3, 'mqtt')`,
    [equip.id, temperatura, dentroLimite]
  );

  // Atualiza heartbeat do equipamento
  await db.query(
    `UPDATE equipamentos SET ultimo_heartbeat = NOW() WHERE id = $1`,
    [equip.id]
  );

  // Verifica se deve gerar alerta
  if (!dentroLimite && equip.alerta_ativo) {
    await alertaService.verificarEGerarAlerta(equip, temperatura);
  } else if (dentroLimite && equip.alerta_ativo) {
    await alertaService.limparAlerta(equip.id);
  }

  console.log(`[MQTT] ${equip.nome} → ${temperatura}°C ${dentroLimite ? '✓' : '⚠ ALERTA'}`);
}

async function processarHeartbeat(deviceId) {
  await db.query(
    `UPDATE equipamentos SET ultimo_heartbeat = NOW() WHERE device_id = $1`,
    [deviceId]
  );
}

function publicar(topico, payload) {
  if (!client || !client.connected) {
    console.warn('[MQTT] Tentativa de publicar sem conexão.');
    return;
  }
  client.publish(topico, JSON.stringify(payload), { qos: 1 });
}

function getStatus() {
  return {
    conectado: Boolean(client?.connected),
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT || '1883', 10),
    clientId: client?.options?.clientId || null,
  };
}

module.exports = { conectar, publicar, getStatus };
