function fail(message) {
  throw new Error(`[Config] ${message}`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    fail(`${name} e obrigatoria`);
  }
  return value;
}

function validateDatabaseEnv() {
  requireEnv('DATABASE_URL');
}

function validateRuntimeEnv() {
  validateDatabaseEnv();

  const jwtSecret = requireEnv('JWT_SECRET');
  if (jwtSecret.length < 32) {
    fail('JWT_SECRET deve ter pelo menos 32 caracteres');
  }

  if (process.env.NODE_ENV === 'production' && jwtSecret.length < 64) {
    fail('JWT_SECRET deve ter pelo menos 64 caracteres em producao');
  }
}

module.exports = {
  validateDatabaseEnv,
  validateRuntimeEnv,
};
