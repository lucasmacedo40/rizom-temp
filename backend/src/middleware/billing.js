const billingService = require('../services/billingService');

function exigirBillingAtivo(req, res, next) {
  billingService.verificarAcessoCliente(req.usuario.cliente_id)
    .then(acesso => {
      if (acesso.permitido) return next();

      return res.status(402).json({
        erro: 'Assinatura bloqueada por pendência de pagamento.',
        billing_status: acesso.status,
        bloquear_em: acesso.bloquear_em,
      });
    })
    .catch(next);
}

module.exports = { exigirBillingAtivo };
