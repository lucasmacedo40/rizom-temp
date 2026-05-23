// seed_demo.js — dados simulados para apresentação
// Cria 3 equipamentos + 30 dias de leituras + alertas realistas
// Uso: node src/migrations/seed_demo.js
//
// Idempotente: pode rodar mais de uma vez (apaga e recria as leituras demo)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Configuração dos 3 sensores demo ────────────────────────────────────────
const EQUIPAMENTOS = [
  {
    device_id:  'demo_camara01',
    nome:       'Câmara Fria 1',
    tipo:       'camara_fria',
    localizacao:'Cozinha — fundo esquerdo',
    fabricante: 'Metalfrio',
    modelo:     'VF55FL',
    temp_min:   0,
    temp_max:   5,
    base:       2.5,   // temperatura base normal
    noise:      0.6,   // amplitude do ruído
    diurnal:    0.8,   // variação dia/noite
  },
  {
    device_id:  'demo_freezer01',
    nome:       'Freezer Açougue',
    tipo:       'freezer',
    localizacao:'Setor açougue',
    fabricante: 'Hussmann',
    modelo:     'CF40',
    temp_min:   -18,
    temp_max:   -12,
    base:       -15,
    noise:      0.8,
    diurnal:    1.2,
  },
  {
    device_id:  'demo_expositor01',
    nome:       'Expositor Bebidas',
    tipo:       'expositor',
    localizacao:'Corredor central — gôndola 3',
    fabricante: 'Esmaltec',
    modelo:     'EOV570',
    temp_min:   2,
    temp_max:   8,
    base:       5,
    noise:      1.0,
    diurnal:    1.5,
  },
];

// ── Geração de temperatura realista ─────────────────────────────────────────
function gerarTemp(equip, date, forceOutOfLimit = false) {
  const hora = date.getHours() + date.getMinutes() / 60;

  // Variação diurna: mais quente no horário de pico (10h–18h)
  const diurnal = equip.diurnal * Math.sin(((hora - 6) / 24) * 2 * Math.PI);

  // Ruído aleatório gaussiano aproximado (Box-Muller simplificado)
  const u = Math.random(), v = Math.random();
  const noise = equip.noise * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);

  let temp = equip.base + diurnal + noise;

  if (forceOutOfLimit) {
    // Empurra ~3°C além do limite para simular evento
    temp = Math.random() > 0.5
      ? equip.temp_max + 2 + Math.random() * 2
      : equip.temp_min - 2 - Math.random() * 2;
  }

  return Math.round(temp * 100) / 100;
}

// ── Script principal ─────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();

  try {
    // 1. Busca o cliente existente (por email se SEED_CLIENT_EMAIL definido)
    const clientEmail = process.env.SEED_CLIENT_EMAIL;
    const { rows: clientes } = clientEmail
      ? await client.query(`SELECT id, nome FROM clientes WHERE email = $1`, [clientEmail])
      : await client.query(`SELECT id, nome FROM clientes ORDER BY criado_em LIMIT 1`);

    if (!clientes.length) {
      console.error('[Demo] Nenhum cliente encontrado. Execute seed.js primeiro.');
      process.exit(1);
    }
    const clienteId = clientes[0].id;
    console.log(`[Demo] Cliente: "${clientes[0].nome}" (${clienteId})`);

    // 2. Cria (ou atualiza) os equipamentos demo
    const equipIds = {};
    for (const eq of EQUIPAMENTOS) {
      const { rows } = await client.query(`
        INSERT INTO equipamentos
          (cliente_id, nome, tipo, localizacao, fabricante, modelo,
           temp_min, temp_max, device_id, alerta_ativo, ultimo_heartbeat)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW())
        ON CONFLICT (device_id) DO UPDATE SET
          nome        = EXCLUDED.nome,
          localizacao = EXCLUDED.localizacao,
          temp_min    = EXCLUDED.temp_min,
          temp_max    = EXCLUDED.temp_max,
          ultimo_heartbeat = NOW()
        RETURNING id
      `, [clienteId, eq.nome, eq.tipo, eq.localizacao, eq.fabricante,
          eq.modelo, eq.temp_min, eq.temp_max, eq.device_id]);
      equipIds[eq.device_id] = rows[0].id;
      console.log(`[Demo] Equipamento: "${eq.nome}" → ${rows[0].id}`);
    }

    // 3. Remove leituras e alertas demo anteriores
    const equipIdList = Object.values(equipIds);
    await client.query(
      `DELETE FROM alertas WHERE equipamento_id = ANY($1)`, [equipIdList]
    );
    await client.query(
      `DELETE FROM leituras WHERE equipamento_id = ANY($1)`, [equipIdList]
    );
    console.log('[Demo] Leituras e alertas anteriores removidos.');

    // 4. Gera leituras — 30 dias, intervalo de 5 minutos
    const DIAS       = 30;
    const INTERVALO  = 5 * 60 * 1000; // 5 min em ms
    const agora      = Date.now();
    const inicio     = agora - DIAS * 24 * 60 * 60 * 1000;
    const totalPontos = (DIAS * 24 * 60) / 5; // 8640 por sensor

    // Janelas de evento out-of-limit (timestamps em ms):
    // Cada equipamento tem 4–6 eventos ao longo dos 30 dias
    function gerarEventos(n) {
      return Array.from({ length: n }, () => {
        const centro = inicio + Math.random() * (agora - inicio);
        const duracao = (15 + Math.random() * 45) * 60 * 1000; // 15–60 min
        return { inicio: centro - duracao / 2, fim: centro + duracao / 2 };
      });
    }

    const eventos = {
      demo_camara01:   gerarEventos(4),
      demo_freezer01:  gerarEventos(3),
      demo_expositor01:gerarEventos(5),
    };

    console.log(`[Demo] Gerando ${totalPontos * 3} leituras (3 sensores × ${totalPontos})...`);

    // Insere em lotes para não estourar memória
    const LOTE = 500;
    let buffer = [];

    async function flush() {
      if (!buffer.length) return;
      const valores = buffer.map((_, i) =>
        `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`
      ).join(',');
      await client.query(
        `INSERT INTO leituras (equipamento_id, temperatura, dentro_limite, registrado_em)
         VALUES ${valores}`,
        buffer.flat()
      );
      buffer = [];
    }

    // Coleta alertas para inserir depois
    const alertasParaInserir = [];

    for (const eq of EQUIPAMENTOS) {
      const eqId = equipIds[eq.device_id];
      const evsEq = eventos[eq.device_id];
      let alertaAberto = null;

      for (let i = 0; i < totalPontos; i++) {
        const ts = new Date(inicio + i * INTERVALO);
        const tsMs = ts.getTime();

        const emEvento = evsEq.some(ev => tsMs >= ev.inicio && tsMs <= ev.fim);
        const temp = gerarTemp(eq, ts, emEvento);
        const dentro = temp >= eq.temp_min && temp <= eq.temp_max;

        buffer.push([eqId, temp, dentro, ts.toISOString()]);
        if (buffer.length >= LOTE) await flush();

        // Controla abertura/fechamento de alertas
        if (!dentro && !alertaAberto) {
          alertaAberto = { ts, temp };
        } else if (dentro && alertaAberto) {
          const tipo = alertaAberto.temp > eq.temp_max ? 'temp_acima' : 'temp_abaixo';
          alertasParaInserir.push({
            equipamento_id: eqId,
            cliente_id: clienteId,
            tipo,
            temperatura: alertaAberto.temp,
            mensagem: tipo === 'temp_acima'
              ? `${eq.nome}: temperatura ${alertaAberto.temp.toFixed(1)}°C acima do limite (máx ${eq.temp_max}°C)`
              : `${eq.nome}: temperatura ${alertaAberto.temp.toFixed(1)}°C abaixo do limite (mín ${eq.temp_min}°C)`,
            criado_em: alertaAberto.ts.toISOString(),
            reconhecido: Math.random() > 0.4, // 60% já reconhecidos
          });
          alertaAberto = null;
        }
      }
      await flush();
      console.log(`[Demo] ✓ ${eq.nome} — ${totalPontos} leituras inseridas`);
    }

    // 5. Insere alertas
    for (const al of alertasParaInserir) {
      await client.query(`
        INSERT INTO alertas
          (equipamento_id, cliente_id, tipo, temperatura, mensagem, notificado, reconhecido, criado_em)
        VALUES ($1,$2,$3,$4,$5,true,$6,$7)
      `, [al.equipamento_id, al.cliente_id, al.tipo, al.temperatura,
          al.mensagem, al.reconhecido, al.criado_em]);
    }
    console.log(`[Demo] ✓ ${alertasParaInserir.length} alertas inseridos`);

    console.log('\n[Demo] Concluído! Resumo:');
    console.log(`  Equipamentos : ${EQUIPAMENTOS.length}`);
    console.log(`  Leituras     : ~${(totalPontos * 3).toLocaleString()}`);
    console.log(`  Alertas      : ${alertasParaInserir.length}`);
    console.log(`  Período      : últimos ${DIAS} dias`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[Demo] Erro:', err.message);
  process.exit(1);
});
