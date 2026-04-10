-- migrations/002_estado_alertas.sql
-- Persiste o estado de alerta por equipamento para sobreviver a restarts do servidor

CREATE TABLE IF NOT EXISTS estado_alertas (
  equipamento_id UUID PRIMARY KEY REFERENCES equipamentos(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL,
  inicio         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notificado     BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
