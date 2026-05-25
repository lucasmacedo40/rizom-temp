-- Integração Stripe Billing

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100) UNIQUE,
  ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) NOT NULL DEFAULT 'sem_assinatura',
  ADD COLUMN IF NOT EXISTS billing_bloqueado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_bloquear_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS assinaturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100) UNIQUE,
  stripe_price_id VARCHAR(100),
  plano VARCHAR(20) NOT NULL DEFAULT 'starter' CHECK (plano IN ('starter','operador','master')),
  ciclo VARCHAR(10) CHECK (ciclo IN ('monthly','yearly')),
  status VARCHAR(30) NOT NULL DEFAULT 'sem_assinatura',
  trial_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  inadimplente_desde TIMESTAMPTZ,
  bloquear_em TIMESTAMPTZ,
  bloqueado BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_cliente
  ON assinaturas(cliente_id);

CREATE INDEX IF NOT EXISTS idx_assinaturas_subscription
  ON assinaturas(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  id VARCHAR(255) PRIMARY KEY,
  tipo VARCHAR(100) NOT NULL,
  processado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL
);

DROP TRIGGER IF EXISTS tr_assinaturas_updated ON assinaturas;
CREATE TRIGGER tr_assinaturas_updated
  BEFORE UPDATE ON assinaturas
  FOR EACH ROW EXECUTE FUNCTION trigger_atualiza_timestamp();
