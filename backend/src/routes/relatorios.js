// src/routes/relatorios.js
// Geração de relatório PDF de temperatura para conformidade ANVISA
// RDC 216/2004 exige registro e manutenção de controle de temperatura

const express = require('express');
const PDFDocument = require('pdfkit');
const { format, startOfMonth, endOfMonth, parseISO } = require('date-fns');
const { ptBR } = require('date-fns/locale');
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const router = express.Router();

// GET /relatorios/mensal?mes=2024-12&equipamento_id= (opcional)
router.get('/mensal', autenticar, async (req, res) => {
  const { mes, equipamento_id } = req.query;

  // Determina período
  const refDate = mes ? parseISO(`${mes}-01`) : new Date();
  const inicio = startOfMonth(refDate);
  const fim = endOfMonth(refDate);

  // Busca dados do cliente
  const { rows: clienteRows } = await db.query(
    `SELECT nome, cnpj, email FROM clientes WHERE id = $1`,
    [req.usuario.cliente_id]
  );
  const cliente = clienteRows[0];

  // Busca equipamentos
  let equipFilter = `e.cliente_id = $1`;
  const params = [req.usuario.cliente_id, inicio, fim];
  if (equipamento_id) {
    equipFilter += ` AND e.id = $4`;
    params.push(equipamento_id);
  }

  const { rows: equipamentos } = await db.query(
    `SELECT e.id, e.nome, e.tipo, e.localizacao, e.temp_min, e.temp_max,
            COUNT(l.id) AS total_leituras,
            COUNT(l.id) FILTER (WHERE NOT l.dentro_limite) AS leituras_alerta,
            ROUND(AVG(l.temperatura)::numeric, 2) AS media,
            MIN(l.temperatura) AS minima,
            MAX(l.temperatura) AS maxima
     FROM equipamentos e
     LEFT JOIN leituras l ON l.equipamento_id = e.id
       AND l.registrado_em BETWEEN $2 AND $3
     WHERE ${equipFilter}
     GROUP BY e.id, e.nome, e.tipo, e.localizacao, e.temp_min, e.temp_max
     ORDER BY e.nome`,
    params
  );

  // Configura resposta PDF
  const nomePeriodo = format(refDate, 'MMMM yyyy', { locale: ptBR });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="rizom-temp-${mes || format(new Date(), 'yyyy-MM')}.pdf"`
  );

  // Fire-and-forget audit record
  db.query(
    `INSERT INTO relatorios (cliente_id, tipo, periodo_inicio, periodo_fim, gerado_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.usuario.cliente_id, 'mensal', inicio, fim, req.usuario.id]
  ).catch(err => console.error('[Relatorios] Erro ao registrar auditoria:', err.message));

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  doc.fontSize(18).font('Helvetica-Bold').text('RIZOM TEMP', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(
    'Relatório de Controle de Temperatura — ANVISA RDC 216/2004',
    { align: 'center' }
  );
  doc.moveDown(0.5);

  doc.fontSize(10).text(`Cliente: ${cliente.nome}`, { align: 'left' });
  if (cliente.cnpj) doc.text(`CNPJ: ${cliente.cnpj}`);
  doc.text(`Período: ${nomePeriodo}`);
  doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`);

  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  // ── Resumo por equipamento ─────────────────────────────────────────────────
  for (const equip of equipamentos) {
    const conformidade = equip.total_leituras > 0
      ? (((equip.total_leituras - equip.leituras_alerta) / equip.total_leituras) * 100).toFixed(1)
      : 'N/A';

    doc.fontSize(11).font('Helvetica-Bold').text(equip.nome);
    doc.fontSize(9).font('Helvetica');
    doc.text(`Tipo: ${equip.tipo.replace('_', ' ')}  |  Localização: ${equip.localizacao || '—'}`);
    doc.text(`Faixa permitida: ${equip.temp_min}°C a ${equip.temp_max}°C`);
    doc.text(`Total de leituras: ${equip.total_leituras}  |  Leituras fora do limite: ${equip.leituras_alerta}`);

    if (equip.total_leituras > 0) {
      doc.text(`Média: ${equip.media}°C  |  Mínima: ${equip.minima}°C  |  Máxima: ${equip.maxima}°C`);
    }

    const conformColor = parseFloat(conformidade) >= 95 ? '#27ae60' : '#e74c3c';
    doc.fontSize(10).font('Helvetica-Bold')
      .fillColor(conformColor)
      .text(`Conformidade: ${conformidade}%`)
      .fillColor('black');

    doc.moveDown(0.8);
  }

  // ── Alertas do período ─────────────────────────────────────────────────────
  const { rows: alertas } = await db.query(
    `SELECT a.tipo, a.temperatura, a.mensagem, a.criado_em, e.nome AS equip_nome
     FROM alertas a
     JOIN equipamentos e ON e.id = a.equipamento_id
     WHERE a.cliente_id = $1
       AND a.criado_em BETWEEN $2 AND $3
     ORDER BY a.criado_em DESC
     LIMIT 100`,
    [req.usuario.cliente_id, inicio, fim]
  );

  if (alertas.length > 0) {
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text('Alertas gerados no período');
    doc.moveDown(0.3);

    for (const alerta of alertas) {
      doc.fontSize(9).font('Helvetica')
        .text(
          `${format(new Date(alerta.criado_em), 'dd/MM HH:mm')}  |  ${alerta.equip_nome}  |  ${alerta.mensagem}`
        );
    }
    doc.moveDown();
  }

  // ── Rodapé ────────────────────────────────────────────────────────────────
  doc.fontSize(8).fillColor('#888888')
    .text(
      'Documento gerado automaticamente pelo sistema Rizom Temp. ' +
      'Conforme ANVISA RDC 216/2004 — Boas Práticas para Serviços de Alimentação.',
      50, 760, { align: 'center', width: 495 }
    );

  doc.end();
});

// GET /relatorios/resumo — dados JSON para dashboard
router.get('/resumo', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `WITH equipamentos_cliente AS (
       SELECT id
       FROM equipamentos
       WHERE cliente_id = $1 AND ativo = true
     ),
     leituras_resumo AS (
       SELECT
         COUNT(*) FILTER (WHERE l.registrado_em >= NOW() - INTERVAL '24 hours') AS leituras_24h,
         COUNT(*) FILTER (
           WHERE NOT l.dentro_limite
             AND l.registrado_em >= NOW() - INTERVAL '24 hours'
         ) AS alertas_24h
       FROM leituras l
       JOIN equipamentos_cliente e ON e.id = l.equipamento_id
     ),
     alertas_resumo AS (
       SELECT COUNT(*) FILTER (WHERE NOT reconhecido) AS alertas_nao_reconhecidos
       FROM alertas
       WHERE cliente_id = $1
     )
     SELECT
       (SELECT COUNT(*) FROM equipamentos_cliente) AS total_equipamentos,
       COALESCE(l.leituras_24h, 0) AS leituras_24h,
       COALESCE(l.alertas_24h, 0) AS alertas_24h,
       COALESCE(a.alertas_nao_reconhecidos, 0) AS alertas_nao_reconhecidos
     FROM leituras_resumo l
     CROSS JOIN alertas_resumo a`,
    [req.usuario.cliente_id]
  );
  res.json(rows[0]);
});

module.exports = router;
