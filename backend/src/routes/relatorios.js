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
    `Sistema Rizom Temp · ID ${reportId}`,
    PAGE.left,
    y,
    { width: 360 }
  );
  doc.text(`Página ${pageNumber}`, 420, y, { width: 125, align: 'right' });
  doc.restore();
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1f2933')
    .text(title, PAGE.left, doc.y);
  doc.moveDown(0.35);
}

function drawKpi(doc, x, y, width, label, value, color) {
  doc.save();
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
  doc.restore();
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

function drawLineChart(doc, pontos, tempMin, tempMax) {
  if (!pontos || pontos.length < 2) {
    doc.moveDown(0.3);
    doc.fontSize(8.5).fillColor('#94a3b8').font('Helvetica')
      .text('Dados insuficientes para o período selecionado.');
    doc.moveDown(0.5);
    return;
  }

  const CHART_LEFT  = PAGE.left + 34; // room for Y-axis labels
  const CHART_RIGHT = PAGE.right;
  const CHART_W     = CHART_RIGHT - CHART_LEFT;
  const CHART_H     = 130;
  const TOP         = doc.y + 4;
  const BOTTOM      = TOP + CHART_H;

  // Y scale: 20% margin around configured limits
  const margin = Math.max((tempMax - tempMin) * 0.2, 2);
  const yMin   = Number(tempMin) - margin;
  const yMax   = Number(tempMax) + margin;
  const yRange = yMax - yMin;

  const xAt = (i) => CHART_LEFT + (i / Math.max(pontos.length - 1, 1)) * CHART_W;
  const yAt = (t) => BOTTOM - ((Number(t) - yMin) / yRange) * CHART_H;

  // Background
  doc.rect(CHART_LEFT, TOP, CHART_W, CHART_H).fillColor('#f8fafc').fill();

  // Conformance zone (between configured limits)
  const yMaxPx = yAt(tempMax);
  const yMinPx = yAt(tempMin);
  doc.save();
  doc.opacity(0.25);
  doc.rect(CHART_LEFT, yMaxPx, CHART_W, yMinPx - yMaxPx).fillColor('#f0fdf4').fill();
  doc.restore();

  // Horizontal grid lines
  [0.25, 0.5, 0.75].forEach(pct => {
    const y = TOP + pct * CHART_H;
    doc.moveTo(CHART_LEFT, y).lineTo(CHART_RIGHT, y)
      .strokeColor('#e5e7eb').lineWidth(0.4).stroke();
  });

  // Y-axis labels
  doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8');
  [yMin, Number(tempMin), Number(tempMax), yMax].forEach(t => {
    const y = yAt(t);
    if (y >= TOP - 4 && y <= BOTTOM + 4) {
      doc.text(`${formatarNumero(t, 0)}°`, PAGE.left, y - 3.5, { width: 30, align: 'right' });
    }
  });

  // Limit lines (dashed)
  doc.save();
  doc.moveTo(CHART_LEFT, yMaxPx).lineTo(CHART_RIGHT, yMaxPx)
    .strokeColor('#ef4444').lineWidth(0.8).dash(4, { space: 3 }).stroke();
  doc.moveTo(CHART_LEFT, yMinPx).lineTo(CHART_RIGHT, yMinPx)
    .strokeColor('#3b82f6').lineWidth(0.8).dash(4, { space: 3 }).stroke();
  doc.undash();
  doc.restore();

  // Temperature line
  doc.save();
  doc.moveTo(xAt(0), yAt(pontos[0].avg_temp));
  for (let i = 1; i < pontos.length; i++) {
    doc.lineTo(xAt(i), yAt(pontos[i].avg_temp));
  }
  doc.strokeColor('#102a43').lineWidth(1.5).lineJoin('round').lineCap('round').stroke();
  doc.restore();

  // Violation dots
  pontos.forEach((p, i) => {
    if (p.tem_violacao) {
      doc.circle(xAt(i), yAt(p.avg_temp), 2.5).fillColor('#ef4444').fill();
    }
  });

  // X-axis date labels (~7 evenly spaced)
  const nLabels = Math.min(7, pontos.length);
  const step    = Math.max(1, Math.floor(pontos.length / nLabels));
  doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8');
  for (let i = 0; i < pontos.length; i += step) {
    const x = xAt(i);
    const label = format(new Date(pontos[i].ts), 'dd/MM', { locale: ptBR });
    doc.text(label, x - 12, BOTTOM + 4, { width: 24, align: 'center' });
  }

  // Legend
  doc.y = BOTTOM + 18;
  const ly = doc.y;
  let lx   = PAGE.left;
  const legendItems = [
    { type: 'line', color: '#102a43', label: 'Temperatura' },
    { type: 'dash', color: '#ef4444', label: `Máx (${formatarNumero(tempMax, 0)}°C)` },
    { type: 'dash', color: '#3b82f6', label: `Mín (${formatarNumero(tempMin, 0)}°C)` },
    { type: 'dot',  color: '#ef4444', label: 'Violação' },
  ];
  legendItems.forEach(item => {
    if (item.type === 'dot') {
      doc.circle(lx + 5, ly + 4, 3).fillColor(item.color).fill();
    } else {
      doc.save();
      const line = doc.moveTo(lx, ly + 4).lineTo(lx + 14, ly + 4)
        .strokeColor(item.color).lineWidth(item.type === 'line' ? 1.5 : 1);
      if (item.type === 'dash') line.dash(3, { space: 2 });
      line.stroke();
      if (item.type === 'dash') doc.undash();
      doc.restore();
    }
    doc.fillColor('#64748b').fontSize(7).font('Helvetica')
      .text(item.label, lx + 18, ly + 1, { width: 95 });
    lx += 112;
  });
  doc.y = ly + 14;
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
       AND l.temperatura <> -127
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
    const periodoParam  = req.query.periodo || req.query.mes;
    const reportId      = crypto.randomUUID();

    // ── Date range ──────────────────────────────────────────────────────────
    let inicio, fim, nomePeriodo;
    if (periodoParam === 'semana') {
      fim        = new Date();
      inicio     = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000);
      nomePeriodo = 'Últimos 7 dias';
    } else {
      const refDate = periodoParam ? parseISO(`${periodoParam}-01`) : new Date();
      if (periodoParam && isNaN(refDate.getTime())) {
        return res.status(400).json({ erro: 'Parâmetro "periodo" inválido. Use YYYY-MM ou "semana".' });
      }
      inicio        = startOfMonth(refDate);
      fim           = endOfMonth(refDate);
      nomePeriodo   = format(refDate, 'MMMM yyyy', { locale: ptBR });
    }

    // ── Client info ─────────────────────────────────────────────────────────
    const { rows: clienteRows } = await db.query(
      `SELECT nome, cnpj, email FROM clientes WHERE id = $1`,
      [req.usuario.cliente_id]
    );
    const cliente = clienteRows[0];
    if (!cliente) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // ── Equipment summary stats ──────────────────────────────────────────────
    let equipFilter = `e.cliente_id = $1`;
    const equipParams = [req.usuario.cliente_id, inicio, fim];
    if (equipamento_id) {
      equipFilter += ` AND e.id = $4`;
      equipParams.push(equipamento_id);
    }

    const { rows: equipamentos } = await db.query(
      `SELECT e.id, e.nome, e.tipo, e.localizacao, e.fabricante, e.modelo,
              e.temp_min, e.temp_max,
              COUNT(l.id)                                        AS total_leituras,
              COUNT(l.id) FILTER (WHERE NOT l.dentro_limite)    AS leituras_alerta,
              ROUND(AVG(l.temperatura)::numeric, 2)             AS media,
              MIN(l.temperatura)                                AS minima,
              MAX(l.temperatura)                                AS maxima
       FROM equipamentos e
       LEFT JOIN leituras l ON l.equipamento_id = e.id
         AND l.registrado_em BETWEEN $2 AND $3
         AND l.temperatura <> -127
       WHERE ${equipFilter}
       GROUP BY e.id, e.nome, e.tipo, e.localizacao, e.fabricante, e.modelo, e.temp_min, e.temp_max
       ORDER BY e.nome`,
      equipParams
    );

    if (equipamento_id && equipamentos.length === 0) {
      return res.status(404).json({ erro: 'Equipamento não encontrado' });
    }

    // ── PDF setup ────────────────────────────────────────────────────────────
    const periodoLabel = periodoParam === 'semana'
      ? `semana`
      : (periodoParam || format(new Date(), 'yyyy-MM'));
    const filenameParts = ['rizom-temp', periodoLabel, granularidade];
    if (equipamento_id && equipamentos.length) {
      filenameParts.push(slugify(equipamentos[0].nome));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filenameParts.filter(Boolean).join('-')}.pdf"`
    );

    // Fire-and-forget audit record
    db.query(
      `INSERT INTO relatorios (id, cliente_id, tipo, periodo_inicio, periodo_fim, gerado_por)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [reportId, req.usuario.cliente_id, 'mensal', inicio, fim, req.usuario.id]
    ).catch(err => console.error('[Relatorios] Erro ao registrar auditoria:', err.message));

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // ── Totals for Page 1 KPIs ───────────────────────────────────────────────
    const totalLeituras      = equipamentos.reduce((s, e) => s + Number(e.total_leituras || 0), 0);
    const totalAlerta        = equipamentos.reduce((s, e) => s + Number(e.leituras_alerta || 0), 0);
    const semDados           = equipamentos.filter(e => Number(e.total_leituras || 0) === 0).length;
    const conformidadeGeral  = totalLeituras > 0
      ? ((totalLeituras - totalAlerta) / totalLeituras) * 100
      : null;
    const statusGeral  = conformidadeGeral === null
      ? 'Sem dados'
      : conformidadeGeral >= 95 && semDados === 0 ? 'Conforme' : 'Atenção';
    const statusColor  = statusGeral === 'Conforme' ? '#15803d' : '#b42318';

    let pageNumber = 1;
    const addPage = () => {
      drawFooter(doc, pageNumber, reportId);
      doc.addPage();
      pageNumber++;
    };

    // ── PAGE 1: Header ───────────────────────────────────────────────────────
    // White header with 3px dark-blue bottom border
    doc.rect(0, 0, 595, 68).fillColor('#ffffff').fill();
    doc.rect(0, 65, 595, 3).fillColor('#102a43').fill();

    // RT logo square
    doc.roundedRect(PAGE.left, 18, 30, 30, 4).fillColor('#102a43').fill();
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
      .text('RT', PAGE.left, 27, { width: 30, align: 'center' });

    // Title + subtitle
    doc.fillColor('#102a43').fontSize(14).font('Helvetica-Bold')
      .text('Rizom Temp', PAGE.left + 38, 20);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica')
      .text('Relatório de Controle de Temperatura', PAGE.left + 38, 36);

    // Period + badge (right side)
    doc.fillColor('#102a43').fontSize(10).font('Helvetica-Bold')
      .text(nomePeriodo, 0, 20, { width: PAGE.right, align: 'right' });
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
      .text(`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`, 0, 34, { width: PAGE.right, align: 'right' });
    doc.roundedRect(PAGE.right - 72, 44, 72, 18, 4).fillColor(statusColor).fill();
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
      .text(statusGeral, PAGE.right - 72, 49, { width: 72, align: 'center' });

    // ── PAGE 1: Doc info (2 columns) ─────────────────────────────────────────
    doc.y = 82;
    const midX = PAGE.left + (PAGE.right - PAGE.left) / 2 + 20;

    // Left column: Client + CNPJ
    doc.fillColor('#475467').fontSize(9).font('Helvetica');
    doc.text('Cliente: ', PAGE.left, doc.y, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#102a43').text(cliente.nome);
    if (cliente.cnpj) {
      doc.font('Helvetica').fillColor('#475467').text('CNPJ: ', PAGE.left, doc.y, { continued: true });
      doc.font('Helvetica-Bold').fillColor('#102a43').text(cliente.cnpj);
    }

    // Right column: Period + ID (painted over same rows)
    const docInfoTop = 82;
    doc.fillColor('#475467').fontSize(9).font('Helvetica')
      .text('Período: ', midX, docInfoTop, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#102a43')
      .text(`${format(inicio, 'dd/MM/yyyy')} – ${format(fim, 'dd/MM/yyyy')}`);
    doc.font('Helvetica').fillColor('#475467')
      .text('ID: ', midX, docInfoTop + 14, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#102a43')
      .text(reportId.substring(0, 18) + '…');

    // Separator
    doc.y = Math.max(doc.y, docInfoTop + 28) + 4;
    doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.right, doc.y)
      .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.y += 12;

    // ── PAGE 1: KPIs ──────────────────────────────────────────────────────────
    const kpiY = doc.y;
    const kpiW = 116;
    const kpiColor = conformidadeGeral === null ? '#64748b'
      : conformidadeGeral >= 95 ? '#15803d'
      : conformidadeGeral >= 80 ? '#d97706' : '#b42318';

    drawKpi(doc, PAGE.left,        kpiY, kpiW,
      'Conformidade geral',
      conformidadeGeral === null ? 'N/A' : `${formatarNumero(conformidadeGeral)}%`,
      kpiColor);
    drawKpi(doc, PAGE.left + 126,  kpiY, kpiW,
      'Equipamentos', String(equipamentos.length), '#102a43');
    drawKpi(doc, PAGE.left + 252,  kpiY, kpiW,
      'Total de leituras', totalLeituras.toLocaleString('pt-BR'), '#6366f1');
    drawKpi(doc, PAGE.left + 378,  kpiY, kpiW,
      'Fora da faixa', String(totalAlerta),
      totalAlerta > 0 ? '#b42318' : '#15803d');

    doc.y = kpiY + 72;

    // ── PAGE 1: Bar chart ─────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Conformidade por equipamento');
    drawBarChart(doc, equipamentos, addPage);

    // ── PAGE 1: Summary table ─────────────────────────────────────────────────
    drawSectionTitle(doc, 'Resumo por equipamento');
    const cols = [
      { label: 'Equipamento',  x: PAGE.left,       width: 116 },
      { label: 'Localização',  x: PAGE.left + 116,  width: 85 },
      { label: 'Faixa (°C)',   x: PAGE.left + 201,  width: 68 },
      { label: 'Média',        x: PAGE.left + 269,  width: 50, align: 'right' },
      { label: 'Mín / Máx',   x: PAGE.left + 319,  width: 70, align: 'right' },
      { label: 'Alertas',      x: PAGE.left + 389,  width: 42, align: 'right' },
      { label: 'Conf.',        x: PAGE.left + 431,  width: 64, align: 'right' },
    ];

    drawTableHeader(doc, cols);
    equipamentos.forEach((equip, idx) => {
      ensureSpace(doc, 34, () => { addPage(); drawTableHeader(doc, cols); });
      const conf = calcularConformidade(equip);
      drawTableRow(doc, cols, [
        `${equip.nome}\n${formatarTipo(equip.tipo)}`,
        equip.localizacao || '—',
        `${formatarNumero(equip.temp_min)} a ${formatarNumero(equip.temp_max)}`,
        equip.total_leituras > 0 ? `${formatarNumero(equip.media)}°C` : '—',
        equip.total_leituras > 0
          ? `${formatarNumero(equip.minima, 1)} / ${formatarNumero(equip.maxima, 1)}°C`
          : '—',
        String(equip.leituras_alerta || 0),
        conf === null ? 'N/A' : `${formatarNumero(conf)}%`,
      ], idx);
    });

    // ── PAGE 1: ANVISA note ───────────────────────────────────────────────────
    ensureSpace(doc, 40, addPage);
    doc.moveDown(1.2);
    doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
      .text(
        'Referência: ANVISA RDC 216/2004 — Boas Práticas para Serviços de Alimentação. ' +
        'Este documento consolida indicadores do período e não substitui anexos técnicos ' +
        'ou registros operacionais quando solicitados.',
        PAGE.left, doc.y, { width: PAGE.right - PAGE.left, align: 'center' }
      );

    // ── PAGES 2–N: One page per equipment ────────────────────────────────────
    for (const equip of equipamentos) {
      // Fetch aggregated readings and alerts for this equipment
      const [pontos, alertasEquip] = await Promise.all([
        buscarLeiturasAgregadas(equip.id, inicio, fim, granularidade),
        db.query(
          `SELECT a.tipo, a.temperatura, a.mensagem, a.criado_em
           FROM alertas a
           WHERE a.equipamento_id = $1
             AND a.criado_em BETWEEN $2 AND $3
           ORDER BY a.criado_em DESC
           LIMIT 50`,
          [equip.id, inicio, fim]
        ).then(r => r.rows),
      ]);

      addPage();

      // Equipment header bar
      doc.rect(0, doc.y, 595, 52).fillColor('#102a43').fill();
      doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold')
        .text(equip.nome, PAGE.left, doc.y + 10);
      const metaParts = [
        formatarTipo(equip.tipo),
        equip.localizacao || null,
        `Faixa: ${formatarNumero(equip.temp_min, 0)}°C a ${formatarNumero(equip.temp_max, 0)}°C`,
        equip.fabricante && equip.modelo ? `${equip.fabricante} ${equip.modelo}` : null,
      ].filter(Boolean);
      doc.fillColor('#9db4d4').fontSize(9).font('Helvetica')
        .text(metaParts.join('  ·  '), PAGE.left, doc.y + 28, { width: PAGE.right - PAGE.left });
      doc.y = doc.y + 52 + 8; // manual advance past header rect

      // Equipment KPIs
      const eKpiY  = doc.y;
      const eKpiW  = 116;
      const eConf  = calcularConformidade(equip);
      const eColor = eConf === null ? '#64748b'
        : eConf >= 95 ? '#15803d'
        : eConf >= 80 ? '#d97706' : '#b42318';

      drawKpi(doc, PAGE.left,       eKpiY, eKpiW,
        'Conformidade', eConf === null ? 'N/A' : `${formatarNumero(eConf)}%`, eColor);
      drawKpi(doc, PAGE.left + 126, eKpiY, eKpiW,
        'Temperatura média',
        equip.total_leituras > 0 ? `${formatarNumero(equip.media)}°C` : '—',
        '#102a43');
      drawKpi(doc, PAGE.left + 252, eKpiY, eKpiW,
        'Mínima registrada',
        equip.total_leituras > 0 ? `${formatarNumero(equip.minima)}°C` : '—',
        '#3b82f6');
      drawKpi(doc, PAGE.left + 378, eKpiY, eKpiW,
        'Máxima registrada',
        equip.total_leituras > 0 ? `${formatarNumero(equip.maxima)}°C` : '—',
        '#ef4444');
      doc.y = eKpiY + 72;

      // Line chart
      drawSectionTitle(doc, `Temperatura registrada no período (granularidade: ${granularidade})`);
      drawLineChart(doc, pontos, equip.temp_min, equip.temp_max);

      // Alerts table
      ensureSpace(doc, 60, addPage);
      drawSectionTitle(doc, 'Alertas no período');

      if (alertasEquip.length === 0) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#94a3b8')
          .text('Nenhum alerta registrado no período selecionado.');
        doc.moveDown(0.5);
      } else {
        const alertCols = [
          { label: 'Data / Hora',  x: PAGE.left,       width: 80 },
          { label: 'Tipo',         x: PAGE.left + 80,   width: 90 },
          { label: 'Temperatura',  x: PAGE.left + 170,  width: 72, align: 'right' },
          { label: 'Mensagem',     x: PAGE.left + 242,  width: 303 },
        ];
        drawTableHeader(doc, alertCols);
        alertasEquip.forEach((al, idx) => {
          ensureSpace(doc, 28, () => { addPage(); drawTableHeader(doc, alertCols); });
          drawTableRow(doc, alertCols, [
            format(new Date(al.criado_em), 'dd/MM/yyyy HH:mm'),
            formatarTipo(al.tipo),
            al.temperatura != null ? `${formatarNumero(al.temperatura)}°C` : '—',
            al.mensagem || '—',
          ], idx);
        });
        if (alertasEquip.length === 50) {
          doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
            .text('Mostrando os 50 alertas mais recentes do período.');
          doc.moveDown(0.3);
        }
      }
    }

    // ── Close document ────────────────────────────────────────────────────────
    drawFooter(doc, pageNumber, reportId);
    doc.end();
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
