-- backend/src/migrations/003_codigos_pareamento.sql
CREATE TABLE IF NOT EXISTS codigos_pareamento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipamento_id UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  codigo         CHAR(6) NOT NULL,
  expira_em      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  usado          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_codigos_pareamento_codigo
  ON codigos_pareamento (codigo)
  WHERE usado = FALSE;
