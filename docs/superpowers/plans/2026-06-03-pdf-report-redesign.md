# PDF Report Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the monthly PDF report with professional layout, per-equipment line charts with configurable granularity, and a period/granularity selector in the generation UI.

**Architecture:** Backend extends `relatorios.js` with new helpers (`drawBarChart`, `drawLineChart`, `buscarLeiturasAgregadas`) and a fully restructured multi-page route handler. Frontend extends `Relatorios.tsx` and `api.ts` with period toggle and granularity selector. No external chart libraries — all rendering via PDFKit drawing primitives.

**Tech Stack:** Node.js 20, PDFKit 0.14, PostgreSQL 16 (`DATE_TRUNC`, `bool_or`), React 19, TypeScript, date-fns 3

---

## File Map

| File | Change |
|---|---|
| `backend/src/routes/relatorios.js` | Major rewrite: new helpers + restructured route handler |
| `frontend/src/api.ts` | Update `relatoriosApi.mensal` signature (add `periodo`, `granularidade`) |
| `frontend/src/pages/Relatorios.tsx` | New period toggle + granularity selector UI |

---

## Task 1 — Backend: New parameter parsing + try/catch

**Files:**
- Modify: `backend/src/routes/relatorios.js:111-120` (route handler opening)

The current route handler has no try/catch — errors surface as "Erro interno do servidor" with no useful log. This task wraps it and adds the new param handling.

- [ ] **1.1 — Replace the route handler opening with param parsing + try/catch**

Open `backend/src/routes/relatorios.js`. Replace the route handler starting at line 112 with the following. Keep all the helper functions above (lines 1–110) unchanged.

```javascript
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
```

- [ ] **1.2 — Restart backend and verify param parsing**

```bash
# kill the existing backend process and restart
pkill -f "node src/index.js" 2>/dev/null; sleep 1
cd /path/to/rizom-temp/backend && node src/index.js &
sleep 2

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Test new periodo param
curl -s "http://localhost:3000/relatorios/mensal?periodo=2026-05" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"ok":true,"inicio":"2026-05-01T...","fim":"2026-05-31T...","nomePeriodo":"maio 2026","granularidade":"3h"}

# Test semana
curl -s "http://localhost:3000/relatorios/mensal?periodo=semana" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"ok":true,...,"nomePeriodo":"Últimos 7 dias"}

# Test backward compat with old ?mes= param
curl -s "http://localhost:3000/relatorios/mensal?mes=2026-05" \
  -H "Authorization: Bearer $TOKEN"
# Expected: same as periodo=2026-05
```

- [ ] **1.3 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "refactor(relatorios): add try/catch and new periodo/granularidade param parsing"
```

---

## Task 2 — Backend: `buscarLeiturasAgregadas` function

**Files:**
- Modify: `backend/src/routes/relatorios.js` (add function before the route handler)

- [ ] **2.1 — Add the aggregation function**

Insert the following function between the existing helpers and the route handler (after `drawTableRow`, before `router.get`):

```javascript
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
```

- [ ] **2.2 — Verify the query returns correct shape**

Update the temporary `res.json` in Task 1 to test the new function:

```javascript
// Temporarily add to end of try block (before res.json):
const { rows: equips } = await db.query(
  `SELECT id, temp_min, temp_max FROM equipamentos WHERE cliente_id = $1 LIMIT 1`,
  [req.usuario.cliente_id]
);
if (equips.length) {
  const pontos = await buscarLeiturasAgregadas(equips[0].id, inicio, fim, granularidade);
  return res.json({ total_pontos: pontos.length, primeiro: pontos[0], ultimo: pontos[pontos.length-1] });
}
res.json({ ok: true });
```

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:3000/relatorios/mensal?periodo=2026-05&granularidade=3h" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"total_pontos":240,"primeiro":{"ts":"2026-05-01T...","avg_temp":"2.48","tem_violacao":false},...}

curl -s "http://localhost:3000/relatorios/mensal?periodo=2026-05&granularidade=diaria" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"total_pontos":31,...}

curl -s "http://localhost:3000/relatorios/mensal?periodo=semana&granularidade=1h" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"total_pontos":168,...}
```

After verifying, revert the temporary res.json call (restore to just `res.json({ ok: true })`).

- [ ] **2.3 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): add buscarLeiturasAgregadas with DATE_TRUNC per granularity"
```

---

## Task 3 — Backend: `drawKpi` redesign + `drawBarChart`

**Files:**
- Modify: `backend/src/routes/relatorios.js`

The current `drawKpi` uses a rounded-rect card. The new design uses a 3px left border on a light background. The `drawBarChart` function is new.

- [ ] **3.1 — Replace `drawKpi` with the new left-border style**

Find and replace the existing `drawKpi` function (lines 73–79):

```javascript
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
```

- [ ] **3.2 — Add `drawBarChart` after `drawKpi`**

```javascript
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
```

- [ ] **3.3 — Verify functions are syntactically valid**

```bash
node --check backend/src/routes/relatorios.js && echo "OK"
# Expected: OK
```

- [ ] **3.4 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): redesign drawKpi with left border + add drawBarChart"
```

---

## Task 4 — Backend: `drawLineChart`

**Files:**
- Modify: `backend/src/routes/relatorios.js` (add after `drawBarChart`)

- [ ] **4.1 — Add `drawLineChart`**

```javascript
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
```

- [ ] **4.2 — Verify syntax**

```bash
node --check backend/src/routes/relatorios.js && echo "OK"
# Expected: OK
```

- [ ] **4.3 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): add drawLineChart with limits, violation dots and legend"
```

---

## Task 5 — Backend: New Page 1 (summary)

**Files:**
- Modify: `backend/src/routes/relatorios.js` (full route handler rewrite)

Replace the entire route handler body (inside try/catch) with the new structure. Remove the temporary `res.json({ ok: true })` from Task 1.

- [ ] **5.1 — Rewrite route handler body — queries + PDF setup + Page 1**

The full route handler (replace everything inside the `try { }` block, from param parsing through `doc.pipe(res)`):

```javascript
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
      { label: 'Localização',  x: PAGE.left + 116,  width: 100 },
      { label: 'Faixa (°C)',   x: PAGE.left + 216,  width: 72 },
      { label: 'Média',        x: PAGE.left + 288,  width: 54, align: 'right' },
      { label: 'Mín / Máx',   x: PAGE.left + 342,  width: 72, align: 'right' },
      { label: 'Alertas',      x: PAGE.left + 414,  width: 44, align: 'right' },
      { label: 'Conf.',        x: PAGE.left + 458,  width: 87, align: 'right' },
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
```

- [ ] **5.2 — Update `drawFooter` to remove ANVISA from footer text**

Find `drawFooter` (around line 53) and update the footer text:

```javascript
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
```

- [ ] **5.3 — Verify syntax**

```bash
node --check backend/src/routes/relatorios.js && echo "OK"
# Expected: OK
```

- [ ] **5.4 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): rewrite page 1 with new header, doc-info, KPIs, bar chart and table"
```

---

## Task 6 — Backend: Equipment pages (Pages 2–N) + finalize handler

**Files:**
- Modify: `backend/src/routes/relatorios.js` (complete the route handler after Page 1)

- [ ] **6.1 — Add equipment pages loop + close handler**

Append the following to the route handler, after the ANVISA note (still inside the `try` block):

```javascript
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
```

- [ ] **6.2 — Verify syntax**

```bash
node --check backend/src/routes/relatorios.js && echo "OK"
# Expected: OK
```

- [ ] **6.3 — Restart backend and generate a test PDF**

```bash
pkill -f "node src/index.js" 2>/dev/null; sleep 1
cd backend && node src/index.js &
sleep 2

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:3000/relatorios/mensal?periodo=2026-05&granularidade=3h" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/relatorio-novo.pdf \
  -w "HTTP %{http_code} | %{size_download} bytes\n"
# Expected: HTTP 200 | >10000 bytes

open /tmp/relatorio-novo.pdf
# Visually verify:
# - Page 1: header sem ANVISA no topo, 2 colunas de info, KPIs com barra lateral, barra de conformidade, tabela
# - Pages 2-4: uma por equipamento com gráfico de linha
# - Rodapé sem menção a ANVISA
```

- [ ] **6.4 — Test com granularidade diária e período semana**

```bash
curl -s "http://localhost:3000/relatorios/mensal?periodo=semana&granularidade=diaria" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/relatorio-semana.pdf \
  -w "HTTP %{http_code} | %{size_download} bytes\n"
# Expected: HTTP 200, PDF com 4 páginas (menos pontos no gráfico)
open /tmp/relatorio-semana.pdf
```

- [ ] **6.5 — Commit**

```bash
git add backend/src/routes/relatorios.js
git commit -m "feat(relatorios): add per-equipment pages with line chart and alerts table"
```

---

## Task 7 — Frontend: Period toggle + granularity selector

**Files:**
- Modify: `frontend/src/api.ts` (update `relatoriosApi.mensal` signature)
- Modify: `frontend/src/pages/Relatorios.tsx` (new UI controls)

- [ ] **7.1 — Update `relatoriosApi.mensal` in `api.ts`**

Find lines 125–132 in `frontend/src/api.ts` and replace:

```typescript
export const relatoriosApi = {
  resumo: () => api.get<Resumo>('/relatorios/resumo'),
  mensal: (periodo: string, equipamento_id?: string, granularidade = '3h') =>
    api.get('/relatorios/mensal', {
      params: { periodo, equipamento_id, granularidade },
      responseType: 'blob',
    }),
};
```

- [ ] **7.2 — Rewrite `Relatorios.tsx`**

Replace the entire file content:

```tsx
import { useEffect, useState } from 'react';
import { equipamentosApi, relatoriosApi } from '../api';
import type { Equipamento } from '../api';
import { AlertCircle, Download, FileText } from 'lucide-react';
import { format, subDays } from 'date-fns';

type Granularidade = 'raw' | '1h' | '3h' | 'diaria';

const GRANULARIDADES: { value: Granularidade; label: string; hint: string; warn?: boolean }[] = [
  { value: 'raw',    label: 'Todas',      hint: '~8.640 pts/mês', warn: true },
  { value: '1h',     label: 'A cada 1h',  hint: '~720 pts/mês' },
  { value: '3h',     label: 'A cada 3h',  hint: '~240 pts/mês' },
  { value: 'diaria', label: 'Diária',     hint: '~30 pts/mês' },
];

export default function Relatorios() {
  const [periodoTipo, setPeriodoTipo]   = useState<'mes' | 'semana'>('mes');
  const [mes, setMes]                   = useState(format(new Date(), 'yyyy-MM'));
  const [granularidade, setGranularidade] = useState<Granularidade>('3h');
  const [equipamentoId, setEquipamentoId] = useState('');
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [gerando, setGerando]           = useState(false);
  const [carregando, setCarregando]     = useState(true);
  const [erro, setErro]                 = useState('');

  useEffect(() => {
    equipamentosApi.listar()
      .then(({ data }) => setEquipamentos(data))
      .catch(() => setErro('Não foi possível carregar os equipamentos. O relatório geral ainda pode ser gerado.'))
      .finally(() => setCarregando(false));
  }, []);

  async function gerarPDF() {
    setGerando(true);
    setErro('');
    try {
      const periodo = periodoTipo === 'semana' ? 'semana' : mes;
      const { data } = await relatoriosApi.mensal(periodo, equipamentoId || undefined, granularidade);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      const equip = equipamentos.find(e => e.id === equipamentoId);
      const sufixo = equip ? `-${equip.nome.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}` : '';
      a.href     = url;
      a.download = `rizom-temp-${periodo}-${granularidade}${sufixo}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErro('Não foi possível gerar o relatório. Tente novamente em alguns instantes.');
    } finally {
      setGerando(false);
    }
  }

  const semanaInicio = format(subDays(new Date(), 7), 'dd/MM');
  const semanaFim    = format(new Date(), 'dd/MM');

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  } as const;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Relatórios</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Exporte o registro de temperaturas em PDF para uso interno ou fiscalização.
        </p>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 28, maxWidth: 520,
      }}>
        {/* Header do card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8,
            background: 'rgba(26,110,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={20} color="var(--rizom-blue)" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Relatório de temperatura</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              PDF com conformidade, gráficos e alertas por equipamento
            </div>
          </div>
        </div>

        {/* Equipamento */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Equipamento
          </label>
          <select
            value={equipamentoId}
            onChange={e => setEquipamentoId(e.target.value)}
            disabled={carregando}
            style={inputStyle}
          >
            <option value="">Todos os equipamentos (consolidado)</option>
            {equipamentos.map(eq => (
              <option key={eq.id} value={eq.id}>
                {eq.nome}{eq.localizacao ? ` — ${eq.localizacao}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Período */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Período
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {(['semana', 'mes'] as const).map(tipo => (
              <button
                key={tipo}
                onClick={() => setPeriodoTipo(tipo)}
                style={{
                  padding: '10px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  border: periodoTipo === tipo ? '2px solid var(--rizom-blue)' : '1px solid var(--border)',
                  background: periodoTipo === tipo ? 'rgba(26,110,255,0.06)' : 'var(--surface-2)',
                  color: periodoTipo === tipo ? 'var(--rizom-blue)' : 'var(--text-primary)',
                  fontWeight: periodoTipo === tipo ? 600 : 400,
                }}
              >
                {tipo === 'semana' ? `Últimos 7 dias` : 'Mês específico'}
                {tipo === 'semana' && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>
                    {semanaInicio} – {semanaFim}
                  </div>
                )}
              </button>
            ))}
          </div>
          {periodoTipo === 'mes' && (
            <input
              type="month" value={mes}
              onChange={e => setMes(e.target.value)}
              max={format(new Date(), 'yyyy-MM')}
              style={inputStyle}
            />
          )}
        </div>

        {/* Granularidade */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Granularidade dos gráficos
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
              — afeta apenas o gráfico de linha, não a conformidade
            </span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {GRANULARIDADES.map(g => (
              <button
                key={g.value}
                onClick={() => setGranularidade(g.value)}
                style={{
                  padding: '8px 6px', borderRadius: 8, fontSize: 11, cursor: 'pointer', textAlign: 'center',
                  border: granularidade === g.value ? '2px solid var(--rizom-blue)' : '1px solid var(--border)',
                  background: granularidade === g.value ? 'rgba(26,110,255,0.06)' : 'var(--surface-2)',
                  color: g.warn ? 'var(--text-muted)' : 'var(--text-primary)',
                  opacity: g.warn && granularidade !== g.value ? 0.6 : 1,
                }}
              >
                <div style={{ fontWeight: granularidade === g.value ? 700 : 500 }}>{g.label}</div>
                <div style={{ fontSize: 9, marginTop: 2, color: 'var(--text-muted)' }}>{g.hint}</div>
                {g.warn && <div style={{ fontSize: 9, color: 'var(--danger)', marginTop: 1 }}>denso</div>}
              </button>
            ))}
          </div>
        </div>

        {erro && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.22)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            fontSize: 12, color: 'var(--danger)',
          }}>
            <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{erro}</span>
          </div>
        )}

        <button
          onClick={gerarPDF}
          disabled={gerando || carregando}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '12px',
            background: gerando || carregando ? 'var(--surface-2)' : 'var(--rizom-blue)',
            color: 'white', borderRadius: 8, fontWeight: 500, fontSize: 15,
            opacity: gerando || carregando ? 0.7 : 1, transition: 'all .2s', cursor: 'pointer',
            border: 'none',
          }}
        >
          <Download size={16} />
          {gerando ? 'Gerando PDF...' : 'Baixar relatório PDF'}
        </button>
      </div>

      {/* Tabela de referência ANVISA */}
      <div style={{
        marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 24, maxWidth: 520,
      }}>
        <h3 style={{ fontSize: 14, marginBottom: 16 }}>
          Faixas de temperatura ANVISA RDC 216/2004
        </h3>
        {[
          ['Câmara fria / Freezer', '-18°C a -15°C'],
          ['Refrigerador', '0°C a 5°C'],
          ['Expositor de frios', '0°C a 10°C'],
          ['Expositor de quentes', 'acima de 60°C'],
        ].map(([tipo, faixa]) => (
          <div key={tipo} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{tipo}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--rizom-iris)' }}>{faixa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **7.3 — Verify TypeScript build**

```bash
cd frontend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **7.4 — Open browser and test the UI**

Open http://localhost:5173, navigate to Relatórios and verify:
- Toggle "Últimos 7 dias" / "Mês específico" works
- Month picker appears only when "Mês específico" is selected
- "A cada 3h" comes pré-selecionado com borda azul
- "Todas" aparece levemente opaco com aviso "denso"
- Botão gera PDF com nome `rizom-temp-2026-05-3h.pdf` (ou variação)

- [ ] **7.5 — Commit**

```bash
git add frontend/src/api.ts frontend/src/pages/Relatorios.tsx
git commit -m "feat(relatorios): add period toggle and granularity selector UI"
```

---

## Self-Review Checklist

Ran against spec `docs/superpowers/specs/2026-06-03-pdf-report-redesign.md`:

| Spec requirement | Task |
|---|---|
| Estilo Profissional Equilibrado: borda azul-escuro no header | Task 5 |
| Sem ANVISA no topo / subtítulo | Task 5 (`drawFooter` update) |
| Identificação em 2 colunas (cliente+cnpj / periodo+id) | Task 5 |
| KPIs com barra colorida lateral | Task 3 (`drawKpi` redesign) |
| Gráfico de barras de conformidade por equipamento | Task 3 (`drawBarChart`) |
| Tabela com alinhamentos corrigidos (texto esquerda, números direita) | Task 5 (column `align` definitions) |
| ANVISA só na nota | Task 5 + `drawFooter` update |
| Uma página por equipamento | Task 6 |
| KPIs individuais por equipamento | Task 6 |
| Gráfico de linha com limites tracejados + pontos de violação | Task 4 + Task 6 |
| Legenda do gráfico | Task 4 |
| Tabela de alertas por equipamento | Task 6 |
| `buscarLeiturasAgregadas` com DATE_TRUNC | Task 2 |
| Granularidade raw/1h/3h/diaria | Task 2 |
| Padrão 3h | Task 7 (frontend default) + Task 1 (backend default) |
| Período semana/mês | Task 1 + Task 7 |
| Frontend: toggle período | Task 7 |
| Frontend: selector granularidade 4 opções | Task 7 |
| `api.ts` novo parâmetro `granularidade` | Task 7 |
| Filename com período + granularidade | Task 5 + Task 7 |
| try/catch no handler | Task 1 |
| Backward compat `mes` param | Task 1 |
