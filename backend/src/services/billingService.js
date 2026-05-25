const db = require('../db');

const PRICE_MAP = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    yearly: process.env.STRIPE_PRICE_STARTER_YEARLY,
  },
  operador: {
    monthly: process.env.STRIPE_PRICE_OPERADOR_MONTHLY,
    yearly: process.env.STRIPE_PRICE_OPERADOR_YEARLY,
  },
  master: {
    monthly: process.env.STRIPE_PRICE_MASTER_MONTHLY,
    yearly: process.env.STRIPE_PRICE_MASTER_YEARLY,
  },
};

const PRICE_TO_PLAN = Object.entries(PRICE_MAP).reduce((acc, [plano, ciclos]) => {
  Object.entries(ciclos).forEach(([ciclo, priceId]) => {
    if (priceId) acc[priceId] = { plano, ciclo };
  });
  return acc;
}, {});

function dateFromUnix(value) {
  return value ? new Date(value * 1000) : null;
}

function calcularBloqueio(status, inadimplenteDesdeAtual) {
  const statusInadimplente = ['past_due', 'unpaid'].includes(status);
  const inadimplenteDesde = statusInadimplente
    ? (inadimplenteDesdeAtual ? new Date(inadimplenteDesdeAtual) : new Date())
    : null;
  const bloquearEm = inadimplenteDesde
    ? new Date(inadimplenteDesde.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;
  const bloqueado = bloquearEm ? bloquearEm <= new Date() : false;

  return { inadimplenteDesde, bloquearEm, bloqueado };
}

async function buscarStatus(clienteId) {
  const { rows } = await db.query(
    `SELECT c.id AS cliente_id, c.nome AS cliente_nome, c.email, c.plano,
            c.stripe_customer_id, c.billing_status, c.billing_bloqueado, c.billing_bloquear_em,
            a.stripe_subscription_id, a.stripe_price_id, a.ciclo, a.status,
            a.trial_end, a.current_period_start, a.current_period_end,
            a.cancel_at_period_end, a.canceled_at, a.inadimplente_desde,
            a.bloquear_em, a.bloqueado
       FROM clientes c
       LEFT JOIN assinaturas a ON a.cliente_id = c.id
      WHERE c.id = $1`,
    [clienteId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    cliente_id: row.cliente_id,
    cliente_nome: row.cliente_nome,
    email: row.email,
    plano: row.plano,
    ciclo: row.ciclo,
    status: row.status || row.billing_status || 'sem_assinatura',
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    stripe_price_id: row.stripe_price_id,
    trial_end: row.trial_end,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
    canceled_at: row.canceled_at,
    inadimplente_desde: row.inadimplente_desde,
    bloquear_em: row.bloquear_em || row.billing_bloquear_em,
    bloqueado: Boolean(row.bloqueado || row.billing_bloqueado),
    prices_configured: Object.keys(PRICE_TO_PLAN).length === 6,
  };
}

function obterPriceId(plano, ciclo) {
  const priceId = PRICE_MAP[plano]?.[ciclo];
  if (!priceId) {
    const err = new Error('Plano ou ciclo de cobrança não configurado.');
    err.status = 400;
    throw err;
  }
  return priceId;
}

function planoPorPrice(priceId) {
  return PRICE_TO_PLAN[priceId] || { plano: 'starter', ciclo: null };
}

async function vincularStripeCustomer(clienteId, customerId) {
  await db.query(
    `UPDATE clientes SET stripe_customer_id = $1 WHERE id = $2`,
    [customerId, clienteId]
  );
}

async function upsertAssinaturaPorSubscription(subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return null;

  const cliente = await db.query(
    `SELECT id FROM clientes WHERE stripe_customer_id = $1`,
    [customerId]
  );

  const clienteId = cliente.rows[0]?.id || subscription.metadata?.cliente_id;
  if (!clienteId) return null;

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const { plano, ciclo } = planoPorPrice(priceId);

  const atual = await db.query(
    `SELECT inadimplente_desde FROM assinaturas WHERE cliente_id = $1`,
    [clienteId]
  );
  const { inadimplenteDesde, bloquearEm, bloqueado } = calcularBloqueio(
    subscription.status,
    atual.rows[0]?.inadimplente_desde
  );

  const currentPeriodStart = item?.current_period_start || subscription.current_period_start;
  const currentPeriodEnd = item?.current_period_end || subscription.current_period_end;

  const { rows } = await db.query(
    `INSERT INTO assinaturas
       (cliente_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        plano, ciclo, status, trial_end, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, inadimplente_desde, bloquear_em, bloqueado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (cliente_id) DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       plano = EXCLUDED.plano,
       ciclo = EXCLUDED.ciclo,
       status = EXCLUDED.status,
       trial_end = EXCLUDED.trial_end,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       canceled_at = EXCLUDED.canceled_at,
       inadimplente_desde = EXCLUDED.inadimplente_desde,
       bloquear_em = EXCLUDED.bloquear_em,
       bloqueado = EXCLUDED.bloqueado
     RETURNING *`,
    [
      clienteId,
      customerId,
      subscription.id,
      priceId,
      plano,
      ciclo,
      subscription.status,
      dateFromUnix(subscription.trial_end),
      dateFromUnix(currentPeriodStart),
      dateFromUnix(currentPeriodEnd),
      Boolean(subscription.cancel_at_period_end),
      dateFromUnix(subscription.canceled_at),
      inadimplenteDesde,
      bloquearEm,
      bloqueado,
    ]
  );

  await db.query(
    `UPDATE clientes
        SET plano = $1,
            stripe_customer_id = COALESCE(stripe_customer_id, $2),
            billing_status = $3,
            billing_bloqueado = $4,
            billing_bloquear_em = $5
      WHERE id = $6`,
    [plano, customerId, subscription.status, bloqueado, bloquearEm, clienteId]
  );

  return rows[0];
}

async function marcarPagamentoOk(subscriptionId) {
  if (!subscriptionId) return;
  const { rows } = await db.query(
    `UPDATE assinaturas
        SET inadimplente_desde = NULL,
            bloquear_em = NULL,
            bloqueado = false
      WHERE stripe_subscription_id = $1
      RETURNING cliente_id, status`,
    [subscriptionId]
  );

  const assinatura = rows[0];
  if (!assinatura) return;

  await db.query(
    `UPDATE clientes
        SET billing_bloqueado = false,
            billing_bloquear_em = NULL,
            billing_status = $1
      WHERE id = $2`,
    [assinatura.status, assinatura.cliente_id]
  );
}

async function marcarPagamentoFalhou(subscriptionId) {
  if (!subscriptionId) return;

  const now = new Date();
  const bloquearEm = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { rows } = await db.query(
    `UPDATE assinaturas
        SET status = 'past_due',
            inadimplente_desde = COALESCE(inadimplente_desde, $1),
            bloquear_em = COALESCE(bloquear_em, $2),
            bloqueado = false
      WHERE stripe_subscription_id = $3
      RETURNING cliente_id, bloquear_em`,
    [now, bloquearEm, subscriptionId]
  );

  const assinatura = rows[0];
  if (!assinatura) return;

  await db.query(
    `UPDATE clientes
        SET billing_status = 'past_due',
            billing_bloqueado = false,
            billing_bloquear_em = $1
      WHERE id = $2`,
    [assinatura.bloquear_em, assinatura.cliente_id]
  );
}

async function registrarEventoStripe(event) {
  const { rowCount } = await db.query(
    `INSERT INTO stripe_events (id, tipo, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type, event]
  );
  return rowCount === 1;
}

module.exports = {
  PRICE_MAP,
  buscarStatus,
  obterPriceId,
  vincularStripeCustomer,
  upsertAssinaturaPorSubscription,
  marcarPagamentoOk,
  marcarPagamentoFalhou,
  registrarEventoStripe,
};
