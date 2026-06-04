# PDF Report Redesign — Rizom Temp

**Data:** 2026-06-03  
**Status:** Aprovado pelo usuário

---

## Contexto

O relatório PDF atual (`backend/src/routes/relatorios.js`) tem problemas de alinhamento e apresentação visual. Não possui gráficos e a organização das informações não é adequada para o duplo público-alvo: operadores internos e fiscais da COVISA (Coordenadoria de Vigilância em Saúde municipal).

O relatório é gerado mensalmente e entregue digitalmente — às vezes impresso no local ou anexado em portais de fiscalização.

---

## Objetivos

1. Redesenhar o PDF com estilo **Profissional Equilibrado**: limpo, sério o suficiente para inspeção, visual o suficiente para uso interno
2. Adicionar **gráficos de linha** por equipamento mostrando temperatura ao longo do período
3. Adicionar **gráfico de barras** de conformidade por equipamento na página de resumo
4. Introduzir **filtro de granularidade** nos gráficos (1h / 3h / diária)
5. Adicionar **filtro de período** na tela de geração (últimos 7 dias ou mês específico)
6. Manter compatibilidade com impressão P&B

---

## Tela de Geração (Frontend — `Relatorios.tsx`)

### Novos campos

| Campo | Tipo | Opções | Padrão |
|-------|------|--------|--------|
| Equipamento | Select | "Todos (consolidado)" + lista dinâmica | Todos |
| Período | Toggle + Select | "Últimos 7 dias" \| "Mês específico" | Mês atual |
| Granularidade | Selector 4 opções | Todas leituras / 1h / 3h / Diária | 3h |

### Comportamento

- **Período "Últimos 7 dias":** calcula `NOW() - 7 days` até `NOW()` no momento da geração. Mostra o intervalo de datas calculado abaixo do seletor.
- **Período "Mês específico":** dropdown com últimos 12 meses no formato "Junho 2026".
- **Granularidade "Todas as leituras":** exibida com aviso visual ("gráfico denso") e levemente desabilitada visualmente — ainda selecionável.
- **Nota fixa:** "A conformidade e a tabela de dados sempre usam o total de leituras — a granularidade afeta apenas os gráficos de linha."
- Parâmetros enviados para a API: `equipamento_id`, `periodo` (`semana` | `YYYY-MM`), `granularidade` (`raw` | `1h` | `3h` | `diaria`)

---

## Estrutura do PDF

### Página 1 — Resumo Consolidado

**Cabeçalho**
- Fundo branco com borda inferior azul-escuro (`#102a43`), 3px
- Lado esquerdo: ícone quadrado RT + "Rizom Temp" + subtítulo "Controle de Temperatura — ANVISA RDC 216/2004"
- Lado direito: período e data de geração
- Badge "CONFORME" (verde `#15803d`) ou "ATENÇÃO" (vermelho `#b42318`) no canto superior direito

**Identificação do documento**
- Nome do cliente, CNPJ (se preenchido), período, gerado em, ID do relatório

**4 KPIs em linha** (com barra colorida lateral esquerda)
- Conformidade geral (cor condicional: verde ≥95%, amarelo 80–95%, vermelho <80%)
- Nº de equipamentos monitorados
- Total de leituras no período
- Leituras fora da faixa

**Gráfico de barras horizontal — Conformidade por equipamento**
- Uma barra por equipamento, comprimento proporcional ao %
- Cor: verde ≥95%, amarelo `#d97706` entre 80–95%, vermelho `#b42318` abaixo de 80%
- Valor % exibido no final de cada barra
- Renderizado via PDFKit paths (sem dependência externa)

**Tabela resumo**
- Colunas: Equipamento, Localização, Faixa (°C), Média, Mín/Máx, Alertas, Conf.%
- Linhas alternadas branco/#f9fafb
- Cabeçalho fundo `#eef3f8`
- Alinhamentos: texto à esquerda, números à direita — **sem texto com align right misturado com texto descritivo**

**Rodapé** (todas as páginas)
- Esquerda: "ANVISA RDC 216/2004 · Sistema Rizom Temp · ID: {reportId}"
- Direita: "Página N" (PDFKit em modo stream não conhece o total de páginas antecipadamente; sem "de Total")

---

### Páginas 2–N — Uma por equipamento

Uma página por equipamento, na ordem alfabética. Sempre gerada para todos os equipamentos do período, independente de ter alertas ou não.

**Cabeçalho da seção**
- Fundo `#102a43` com nome do equipamento em branco
- Subtítulo: tipo formatado + localização + faixa configurada

**4 KPIs do equipamento**
- Conformidade %, Temperatura média, Temperatura mínima, Temperatura máxima
- Mesmo estilo de barra lateral colorida da página 1

**Gráfico de linha — Temperatura ao longo do período**
- Eixo X: datas/horas do período (labels simplificados: dia do mês se mensal, hora se semanal)
- Eixo Y: escala automática com margem de 20% acima/abaixo dos limites configurados
- Linha de temperatura: azul-escuro `#102a43`, espessura 1.5pt
- Linha de limite máximo: tracejada vermelha `#ef4444`
- Linha de limite mínimo: tracejada azul `#3b82f6`
- Área entre limites: fundo verde muito suave (`#f0fdf4`, opacity 40%)
- Pontos de violação: círculo vermelho `#ef4444`, raio 2.5pt, só nos pontos fora da faixa
- Legenda abaixo do gráfico (4 itens: Temperatura, Limite máx, Limite mín, Violação)
- Renderizado via PDFKit drawing primitives (`moveTo`, `lineTo`, `circle`) — sem dependência externa de biblioteca de gráficos

**Agregação dos dados do gráfico**
| Granularidade | SQL | Pontos (mês) | Pontos (semana) |
|---|---|---|---|
| Todas | sem agregação | ~8.640 | ~2.016 |
| 1h | `DATE_TRUNC('hour', registrado_em)` | ~720 | ~168 |
| 3h | `DATE_TRUNC('hour', registrado_em) - EXTRACT(hour FROM registrado_em)::int % 3 * interval '1 hour'` | ~240 | ~56 |
| Diária | `DATE_TRUNC('day', registrado_em)` | ~30 | ~7 |

A query retorna `AVG(temperatura)` por bucket, com flag `bool_or(NOT dentro_limite)` para identificar se alguma leitura do bucket violou o limite (para marcar o ponto no gráfico).

**Tabela de alertas do equipamento** (só se houver alertas)
- Colunas: Data/Hora, Tipo, Temperatura registrada, Mensagem
- Máximo 50 linhas por equipamento (alertas mais recentes)
- Se não houver alertas: mensagem "Nenhum alerta registrado no período."

---

### Última página — apenas se necessário

Se a tabela de alertas de algum equipamento ultrapassar o espaço disponível na sua página, transborda para página adicional com cabeçalho "continuação — {nome do equipamento}". A lógica de `ensureSpace()` já existente cuida disso.

---

## Mudanças no Backend (`relatorios.js`)

### Novos parâmetros de query
- `periodo`: `semana` ou `YYYY-MM` (ex: `2026-05`)
- `granularidade`: `raw` | `1h` | `3h` | `diaria`
- `equipamento_id`: já existe, mantido

### Nova query de leituras agregadas para gráfico
```sql
SELECT
  date_trunc({bucket}, registrado_em) AS ts,
  AVG(temperatura)::numeric(5,2) AS avg_temp,
  bool_or(NOT dentro_limite) AS tem_violacao
FROM leituras
WHERE equipamento_id = $1
  AND registrado_em BETWEEN $2 AND $3
GROUP BY 1
ORDER BY 1
```
Onde `{bucket}` = `'hour'`, `'day'`, etc., com pós-processamento para granularidade 3h.

### Funções novas de renderização no PDF
- `drawBarChart(doc, equipamentos)` — gráfico de barras de conformidade
- `drawLineChart(doc, pontos, tempMin, tempMax)` — gráfico de linha por equipamento
- Ambas retornam a altura ocupada para atualizar `doc.y` corretamente

### Remoção de alinhamentos problemáticos
- Todos os textos descritivos (nome, localização, tipo) passam a usar `align: 'left'`
- Somente valores numéricos (temperatura, %) usam `align: 'right'`

---

## Mudanças no Frontend (`Relatorios.tsx`)

- Novos estados: `periodo` (`'semana' | string`), `granularidade` (`'raw' | '1h' | '3h' | 'diaria'`)
- Padrões: `periodo = YYYY-MM do mês atual`, `granularidade = '3h'`
- Nome do arquivo baixado: `rizom-temp-{periodo}-{granularidade}.pdf` (ou com slug do equipamento se filtrado)
- API call: `GET /relatorios/mensal?periodo=YYYY-MM&equipamento_id=...&granularidade=...`; para semana: `periodo=semana`. O parâmetro `mes` legado é substituído por `periodo` — o backend aceita ambos para compatibilidade durante a transição.

---

## Não está no escopo

- Gráfico de temperatura combinado com múltiplos equipamentos na mesma linha
- Export para outros formatos (Excel, CSV)
- Agendamento automático de envio por email
- Assinatura digital do documento

---

## Critérios de sucesso

1. PDF gerado sem erros para qualquer combinação de período × granularidade × equipamento
2. Gráfico de linha renderiza corretamente com pontos de violação destacados
3. Gráfico de barras de conformidade visível e legível em impressão P&B
4. Alinhamentos consistentes — sem texto descritivo alinhado à direita
5. Tela de geração responsiva com os 4 novos controles
6. Granularidade "3h" selecionada por padrão
7. Relatório de 4 páginas (1 resumo + 3 equipamentos) gerado em menos de 5 segundos
