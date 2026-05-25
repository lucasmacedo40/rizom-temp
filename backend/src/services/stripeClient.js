const Stripe = require('stripe');

let instance = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('STRIPE_SECRET_KEY não configurada.');
    err.status = 503;
    throw err;
  }

  if (!instance) {
    instance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return instance;
}

module.exports = { getStripe };
