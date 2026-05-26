const Stripe = require('stripe');

let instance = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('STRIPE_SECRET_KEY não configurada.');
    err.status = 503;
    throw err;
  }

  if (!instance) {
    instance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-04-22.dahlia',
    });
  }

  return instance;
}

module.exports = { getStripe };
