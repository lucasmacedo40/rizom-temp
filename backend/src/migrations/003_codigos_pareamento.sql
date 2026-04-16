-- backend/src/migrations/003_codigos_pareamento.sql
-- Códigos de 6 dígitos de uso único para pareamento de dispositivos ESP32-C3.
-- Expiram em 10 minutos. Após uso, o código fica inativo mas é preservado para auditoria.
BEGIN;

CREATE TABLE IF NOT EXISTS codigos_pareamento (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  codigo         CHAR(6) NOT NULL CHECK (codigo ~ '^\d{6}$'),
  expira_em      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  usado          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_codigos_pareamento_codigo
  ON codigos_pareamento (codigo)
  WHERE usado = FALSE;

CREATE INDEX IF NOT EXISTS idx_codigos_pareamento_equipamento
  ON codigos_pareamento (equipamento_id);

COMMIT;
