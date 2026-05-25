const express = require('express');
const { getStripe } = require('../services/stripeClient');
const billingService = require('../services/billingService');

const router = express.Router();

function subscriptionIdFromInvoice(invoice) {
  return invoice.subscription
    || invoice.lines?.data?.[0]?.subscription
    || invoice.parent?.subscription_details?.subscription
    || null;
}

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const signature = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ erro: 'STRIPE_WEBHOOK_SECRET não configurado.' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe] Webhook inválido:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const novoEvento = await billingService.registrarEventoStripe(event);
    if (!novoEvento) return res.json({ received: true, duplicate: true });

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ['items.data.price'],
          });
          await billingService.upsertAssinaturaPorSubscription(subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await billingService.upsertAssinaturaPorSubscription(event.data.object);
        break;
      case 'invoice.paid':
        await billingService.marcarPagamentoOk(subscriptionIdFromInvoice(event.data.object));
        break;
      case 'invoice.payment_failed':
        await billingService.marcarPagamentoFalhou(subscriptionIdFromInvoice(event.data.object));
        break;
      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe] Erro ao processar webhook:', err);
    res.status(500).json({ erro: 'Erro ao processar webhook.' });
  }
});

module.exports = router;
