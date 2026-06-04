// src/routes/relatorios.js
// Geração de relatório PDF de temperatura para conformidade ANVISA
// RDC 216/2004 exige registro e manutenção de controle de temperatura

const express = require('express');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { format, startOfMonth, endOfMonth, parseISO } = require('date-fns');
const { ptBR } = require('date-fns/locale');
const db = require('../db');
const { autenticar } = require('../middleware/auth');
const { exigirBillingAtivo } = require('../middleware/billing');

const router = express.Router();

const PAGE = {
  left: 50,
  right: 545,
  top: 50,
  bottom: 735,
  footerY: 760,
};

function formatarNumero(valor, casas = 1) {
  if (valor === null || valor === undefined || valor === 'N/A') return 'N/A';
  return Number(valor).toFixed(casas).replace('.', ',');
}

function formatarTipo(tipo) {
  return tipo ? tipo.replace(/_/g, ' ') : '-';
}

function slugify(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function calcularConformidade(equip) {
  const total = Number(equip.total_leituras || 0);
  if (total === 0) return null;
  const alertas = Number(equip.leituras_alerta || 0);
  return ((total - alertas) / total) * 100;
}

function ensureSpace(doc, needed, addPage) {
  if (doc.y + needed > PAGE.bottom) addPage();
}

function drawFooter(doc, pageNumber, reportId) {
  const y = PAGE.footerY;
  doc.save();
  doc.fontSize(8).fillColor('#7f8c8d');
  doc.text(
    `Documento gerado automaticamente pelo sistema Rizom Temp | ID ${reportId}`,
    PAGE.left,
    y,
    { width: 360 }
  );
  doc.text(`Página ${pageNumber}`, 420, y, { width: 125, align: 'right' });
  doc.restore();
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1f2933').text(title);
  doc.moveDown(0.35);
}

function drawKpi(doc, x, y, width, label, value, color) {
  // Left border
  doc.rect(x, y, 3, 54).fillColor(color).fill();
  // Background
  doc.rect(x + 3, y, width - 3, 54).fillColor('#f8fafc').fill();
  // Label
  doc.fillColor('#64748b').fontSize(8).font('Helvetica')
    .text(label, x + 10, y + 8, { width: width - 16 });
  // Value
  doc.fillColor(color).fontSize(20).font('Helvetica-Bold')
    .text(value, x + 10, y + 24, { width: width - 16 });
}

function drawBarChart(doc, equipamentos, addPage) {
  const LABEL_W = 140;
  const VALUE_W = 48;
  const BAR_LEFT  = PAGE.left + LABEL_W + 8;
  const BAR_RIGHT = PAGE.right - VALUE_W - 4;
  const BAR_W     = BAR_RIGHT - BAR_LEFT;
  const ROW_H     = 20;

  equipamentos.forEach((equip) => {
    ensureSpace(doc, ROW_H + 4, addPage);
    const conf    = calcularConformidade(equip);
    const confPct = conf === null ? 0 : conf;
    const color   = confPct >= 95 ? '#15803d' : confPct >= 80 ? '#d97706' : '#b42318';
    const y       = doc.y;

    // Equipment name label
    doc.fillColor('#374151').fontSize(8.5).font('Helvetica')
      .text(equip.nome, PAGE.left, y + 5, { width: LABEL_W - 4, lineBreak: false });

    // Track background
    doc.rect(BAR_LEFT, y + 6, BAR_W, 8).fillColor('#e5e7eb').fill();

    // Bar fill (never render 0-width rect)
    const fillW = (confPct / 100) * BAR_W;
    if (fillW > 0) {
      doc.rect(BAR_LEFT, y + 6, fillW, 8).fillColor(color).fill();
    }

    // Percentage label
    const label = conf === null ? 'N/A' : `${formatarNumero(conf)}%`;
    doc.fillColor(color).fontSize(8.5).font('Helvetica-Bold')
      .text(label, BAR_RIGHT + 6, y + 5, { width: VALUE_W, align: 'right' });

    doc.y = y + ROW_H;
  });
  doc.y += 6;
}

function drawTableHeader(doc, columns) {
  const startY = doc.y;
  doc.save();
  doc.rect(PAGE.left, startY, PAGE.right - PAGE.left, 22).fill('#eef3f8');
  doc.fillColor('#344054').fontSize(8).font('Helvetica-Bold');
  for (const col of columns) {
    doc.text(col.label, col.x + 4, startY + 7, { width: col.width - 8, align: col.align || 'left' });
  }
  doc.restore();
  doc.y = startY + 22;
}

function drawTableRow(doc, columns, values, rowIndex) {
  const startY = doc.y;
  const rowHeight = 30;
  doc.save();
  doc.rect(PAGE.left, startY, PAGE.right - PAGE.left, rowHeight).fill(rowIndex % 2 === 0 ? '#ffffff' : '#fbfcfe');
  doc.strokeColor('#e5e7eb').moveTo(PAGE.left, startY + rowHeight).lineTo(PAGE.right, startY + rowHeight).stroke();
  doc.fillColor('#1f2933').fontSize(8).font('Helvetica');
  columns.forEach((col, index) => {
    doc.text(values[index], col.x + 4, startY + 8, {
      width: col.width - 8,
      align: col.align || 'left',
      lineGap: 1,
    });
  });
  doc.restore();
  doc.y = startY + rowHeight;
}

async function buscarLeiturasAgregadas(equipamentoId, inicio, fim, granularidade) {
  let bucketExpr;
  switch (granularidade) {
    case '1h':
      bucketExpr = `DATE_TRUNC('hour', l.registrado_em AT TIME ZONE 'America/Recife')`;
      break;
    case '3h':
      bucketExpr = `DATE_TRUNC('hour', l.registrado_em AT TIME ZONE 'America/Recife')
        - ((EXTRACT(HOUR FROM l.registrado_em AT TIME ZONE 'America/Recife')::int % 3) * INTERVAL '1 hour')`;
      break;
    case 'diaria':
      bucketExpr = `DATE_TRUNC('day', l.registrado_em AT TIME ZONE 'America/Recife')`;
      break;
    default: // raw — group by native 5-min sensor interval to avoid 8640 individual points
      bucketExpr = `DATE_TRUNC('minute', l.registrado_em AT TIME ZONE 'America/Recife')
        - ((EXTRACT(MINUTE FROM l.registrado_em AT TIME ZONE 'America/Recife')::int % 5) * INTERVAL '1 minute')`;
  }

  const { rows } = await db.query(
    `SELECT
       (${bucketExpr}) AS ts,
       ROUND(AVG(l.temperatura)::numeric, 2) AS avg_temp,
       bool_or(NOT l.dentro_limite)           AS tem_violacao
     FROM leituras l
     WHERE l.equipamento_id = $1
       AND l.registrado_em BETWEEN $2 AND $3
     GROUP BY 1
     ORDER BY 1`,
    [equipamentoId, inicio, fim]
  );
  return rows;
}

// GET /relatorios/mensal?periodo=YYYY-MM|semana&equipamento_id=&granularidade=raw|1h|3h|diaria
router.get('/mensal', autenticar, exigirBillingAtivo, async (req, res) => {
  try {
    const { equipamento_id } = req.query;
    const granularidade = req.query.granularidade || '3h';
    // backward compat: accept both ?periodo= (new) and ?mes= (old)
    const periodoParam = req.query.periodo || req.query.mes;
    const reportId = crypto.randomUUID();

    let inicio, fim, nomePeriodo;
    if (periodoParam === 'semana') {
      fim   = new Date();
      inicio = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000);
      nomePeriodo = 'Últimos 7 dias';
    } else {
      const refDate = periodoParam ? parseISO(`${periodoParam}-01`) : new Date();
      if (periodoParam && isNaN(refDate.getTime())) {
        return res.status(400).json({ erro: 'Parâmetro "periodo" inválido. Use YYYY-MM ou "semana".' });
      }
      inicio      = startOfMonth(refDate);
      fim         = endOfMonth(refDate);
      nomePeriodo = format(refDate, 'MMMM yyyy', { locale: ptBR });
    }

    // ... (rest of handler comes in Task 5 and 6)
    res.json({ ok: true, inicio, fim, nomePeriodo, granularidade }); // temporary
  } catch (err) {
    console.error('[Relatorios] Erro ao gerar relatório:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
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
