// src/index.js — Rizom Temp Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const mqttClient = require('./mqtt/client');
const alertaService = require('./services/alertaService');

const authRoutes = require('./routes/auth');
const equipamentosRoutes = require('./routes/equipamentos');
const leiturasRoutes = require('./routes/leituras');
const alertasRoutes = require('./routes/alertas');
const relatoriosRoutes = require('./routes/relatorios');
const provisioningRoutes = require('./routes/provisioning');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting geral
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Rate limiting mais restrito para /auth/login
app.use('/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
}));

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/equipamentos', equipamentosRoutes);
app.use('/leituras', leiturasRoutes);
app.use('/alertas', alertasRoutes);
app.use('/relatorios', relatoriosRoutes);
app.use('/provisioning', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas. Tente novamente mais tarde.' },
}));
app.use('/provisioning', provisioningRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), servico: 'rizom-temp' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

// Erro global
app.use((err, req, res, next) => {
  console.error('[API] Erro não tratado:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ─── Jobs agendados ───────────────────────────────────────────────────────────
// Verifica dispositivos offline a cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  try {
    await alertaService.verificarDispositivosOffline();
  } catch (err) {
    console.error('[Cron] Erro ao verificar dispositivos offline:', err.message);
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  Rizom Temp — Backend v1.0               ║
║  API:  http://localhost:${PORT}              ║
║  MQTT: ${process.env.MQTT_HOST}:${process.env.MQTT_PORT || 1883}                 ║
╚══════════════════════════════════════════╝
  `);

  // Conecta ao broker MQTT após a API subir
  mqttClient.conectar();
});

module.exports = app;
