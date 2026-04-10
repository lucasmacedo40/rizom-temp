-- migrations/001_schema_inicial.sql
-- Rizom Temp — Schema completo
-- Executar via: psql $DATABASE_URL -f migrations/001_schema_inicial.sql

-- ─── Extensões ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tabela: clientes (empresas que usam o sistema) ─────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome         VARCHAR(200) NOT NULL,
  cnpj         VARCHAR(18) UNIQUE,
  email        VARCHAR(200) NOT NULL,
  telefone     VARCHAR(20),
  plano        VARCHAR(20) NOT NULL DEFAULT 'starter' CHECK (plano IN ('starter','operador','master')),
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabela: usuários ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome         VARCHAR(200) NOT NULL,
  email        VARCHAR(200) NOT NULL UNIQUE,
  senha_hash   VARCHAR(255) NOT NULL,
  perfil       VARCHAR(20) NOT NULL DEFAULT 'operador' CHECK (perfil IN ('admin','operador','visualizador')),
  ativo        BOOLEAN NOT NULL DEFAULT true,
  ultimo_login TIMESTAMPTZ,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabela: equipamentos (câmaras, freezers, geladeiras, expositores) ───────
CREATE TABLE IF NOT EXISTS equipamentos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome            VARCHAR(200) NOT NULL,             -- ex: "Câmara Fria 1", "Freezer Açougue"
  tipo            VARCHAR(30) NOT NULL CHECK (tipo IN (
                    'camara_fria','freezer','refrigerador','expositor','outro'
                  )),
  localizacao     VARCHAR(200),                      -- ex: "Cozinha - fundo esquerdo"
  fabricante      VARCHAR(100),
  modelo          VARCHAR(100),
  -- Limites de temperatura (sobrescrevem os defaults do .env)
  temp_min        DECIMAL(5,2) NOT NULL,
  temp_max        DECIMAL(5,2) NOT NULL,
  -- Configuração de alertas
  alerta_ativo    BOOLEAN NOT NULL DEFAULT true,
  alerta_atraso_min INTEGER NOT NULL DEFAULT 5,      -- minutos fora do limite antes de alertar
  -- Metadados do dispositivo IoT
  device_id       VARCHAR(100) UNIQUE,               -- ex: "esp01_a1b2c3" (MAC do ESP-01)
  mqtt_topico     VARCHAR(200),                      -- ex: "rizomtemp/cliente_id/equip_id/temp"
  ultimo_heartbeat TIMESTAMPTZ,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabela: leituras (série temporal de temperaturas) ───────────────────────
CREATE TABLE IF NOT EXISTS leituras (
  id              BIGSERIAL PRIMARY KEY,
  equipamento_id  UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  temperatura     DECIMAL(5,2) NOT NULL,
  dentro_limite   BOOLEAN NOT NULL,                  -- calculado na inserção
  fonte           VARCHAR(20) NOT NULL DEFAULT 'mqtt' CHECK (fonte IN ('mqtt','manual','api')),
  registrado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para queries de série temporal (frequentes)
CREATE INDEX IF NOT EXISTS idx_leituras_equip_tempo
  ON leituras(equipamento_id, registrado_em DESC);

-- Índice para relatórios por período
CREATE INDEX IF NOT EXISTS idx_leituras_tempo
  ON leituras(registrado_em DESC);

-- ─── Tabela: alertas gerados ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alertas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id  UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL CHECK (tipo IN (
                    'temp_acima','temp_abaixo','sem_sinal','dispositivo_offline'
                  )),
  temperatura     DECIMAL(5,2),                      -- temperatura no momento do alerta
  mensagem        TEXT NOT NULL,
  notificado      BOOLEAN NOT NULL DEFAULT false,    -- enviado via n8n/WhatsApp?
  reconhecido     BOOLEAN NOT NULL DEFAULT false,    -- operador marcou como visto?
  reconhecido_por UUID REFERENCES usuarios(id),
  reconhecido_em  TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_cliente
  ON alertas(cliente_id, criado_em DESC);

-- ─── Tabela: registros manuais (quando não há dispositivo IoT) ───────────────
CREATE TABLE IF NOT EXISTS registros_manuais (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id  UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  temperatura     DECIMAL(5,2) NOT NULL,
  dentro_limite   BOOLEAN NOT NULL,
  observacao      TEXT,
  registrado_por  UUID NOT NULL REFERENCES usuarios(id),
  registrado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabela: relatórios gerados ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relatorios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL DEFAULT 'mensal',
  periodo_inicio  DATE NOT NULL,
  periodo_fim     DATE NOT NULL,
  gerado_por      UUID REFERENCES usuarios(id),
  arquivo_path    TEXT,                              -- caminho no servidor
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Função: atualiza campo atualizado_em automaticamente ───────────────────
CREATE OR REPLACE FUNCTION trigger_atualiza_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_equipamentos_updated
  BEFORE UPDATE ON equipamentos
  FOR EACH ROW EXECUTE FUNCTION trigger_atualiza_timestamp();

CREATE TRIGGER tr_clientes_updated
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION trigger_atualiza_timestamp();

-- ─── View: status atual de todos os equipamentos ─────────────────────────────
CREATE OR REPLACE VIEW v_equipamentos_status AS
SELECT
  e.id,
  e.cliente_id,
  e.nome,
  e.tipo,
  e.localizacao,
  e.temp_min,
  e.temp_max,
  e.device_id,
  e.ativo,
  e.ultimo_heartbeat,
  l.temperatura AS ultima_temperatura,
  l.dentro_limite AS ultima_dentro_limite,
  l.registrado_em AS ultima_leitura_em,
  CASE
    WHEN e.ultimo_heartbeat IS NULL THEN 'sem_dados'
    WHEN e.ultimo_heartbeat < NOW() - INTERVAL '10 minutes' THEN 'offline'
    WHEN NOT l.dentro_limite THEN 'alerta'
    ELSE 'ok'
  END AS status
FROM equipamentos e
LEFT JOIN LATERAL (
  SELECT temperatura, dentro_limite, registrado_em
  FROM leituras
  WHERE equipamento_id = e.id
  ORDER BY registrado_em DESC
  LIMIT 1
) l ON true;

COMMENT ON TABLE leituras IS 'Série temporal de leituras de temperatura. Alta frequência de escrita.';
COMMENT ON TABLE alertas IS 'Alertas gerados automaticamente pelo motor de verificação de limites.';
