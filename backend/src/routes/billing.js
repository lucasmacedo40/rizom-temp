const express = require('express');
const { autenticar, exigirPerfil } = require('../middleware/auth');
const db = require('../db');
const { getStripe } = require('../services/stripeClient');
const billingService = require('../services/billingService');

const router = express.Router();

const PLANOS_VALIDOS = new Set(['starter', 'operador', 'master']);
const CICLOS_VALIDOS = new Set(['monthly', 'yearly']);

function frontendUrl(path) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${base}${path}`;
}

router.get('/status', autenticar, async (req, res, next) => {
  try {
    const status = await billingService.buscarStatus(req.usuario.cliente_id);
    if (!status) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post('/checkout-session', autenticar, exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { plano, ciclo } = req.body;
    if (!PLANOS_VALIDOS.has(plano) || !CICLOS_VALIDOS.has(ciclo)) {
      return res.status(400).json({ erro: 'Plano ou ciclo inválido.' });
    }

    const priceId = billingService.obterPriceId(plano, ciclo);
    const stripe = getStripe();

    const { rows } = await db.query(
      `SELECT id, nome, email, stripe_customer_id
         FROM clientes
        WHERE id = $1 AND ativo = true`,
      [req.usuario.cliente_id]
    );
    const cliente = rows[0];
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });

    const statusAtual = await billingService.buscarStatus(cliente.id);
    const assinaturaEmAberto = statusAtual?.stripe_subscription_id
      && !['canceled', 'incomplete_expired'].includes(statusAtual.status);
    if (assinaturaEmAberto) {
      return res.status(409).json({
        erro: 'Cliente já possui uma assinatura. Use o portal de cobrança para alterar plano ou forma de pagamento.',
      });
    }

    let customerId = cliente.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: cliente.nome,
        email: cliente.email,
        metadata: {
          app: 'rizom-temp',
          cliente_id: cliente.id,
        },
      });
      customerId = customer.id;
      await billingService.vincularStripeCustomer(cliente.id, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: cliente.id,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      tax_id_collection: { enabled: true },
      customer_update: {
        name: 'auto',
        address: 'auto',
      },
      line_items: [
        { price: priceId, quantity: 1 },
      ],
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          app: 'rizom-temp',
          cliente_id: cliente.id,
          plano,
          ciclo,
        },
      },
      metadata: {
        app: 'rizom-temp',
        cliente_id: cliente.id,
        plano,
        ciclo,
      },
      success_url: frontendUrl('/configuracoes?aba=pagamento&billing=success'),
      cancel_url: frontendUrl('/configuracoes?aba=pagamento&billing=cancel'),
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.post('/portal-session', autenticar, exigirPerfil('admin'), async (req, res, next) => {
  try {
    const stripe = getStripe();
    const status = await billingService.buscarStatus(req.usuario.cliente_id);

    if (!status?.stripe_customer_id) {
      return res.status(400).json({ erro: 'Cliente ainda não possui cadastro de cobrança.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: status.stripe_customer_id,
      return_url: frontendUrl('/configuracoes?aba=pagamento'),
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
