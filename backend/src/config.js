function integer(name, value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

export function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  let database;
  try { database = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const appId = (env.WECHAT_APP_ID || '').trim();
  const appSecret = (env.WECHAT_APP_SECRET || '').trim();
  if (appId && !/^wx[a-zA-Z0-9]{16}$/.test(appId)) throw new Error('WECHAT_APP_ID is not a valid WeChat AppID');
  if (appSecret && !appId) throw new Error('WECHAT_APP_ID is required when WECHAT_APP_SECRET is configured');
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');
  const logLevel = env.LOG_LEVEL || 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) throw new Error('LOG_LEVEL is invalid');
  return {
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: integer('PORT', env.PORT || '4317', 1, 65535),
    databaseUrl: env.DATABASE_URL,
    appId,
    appSecret,
    sessionTtlSeconds: integer('SESSION_TTL_SECONDS', env.SESSION_TTL_SECONDS || '2592000', 60, 7776000),
    logLevel
  };
}
