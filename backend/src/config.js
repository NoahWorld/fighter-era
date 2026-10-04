import { isIP } from 'node:net';

function integer(name, value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

export function normalizeIpAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return null;
  const version = isIP(address);
  if (!version) return null;
  if (version === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  // Socket peers may represent the same IPv4 gateway as mapped IPv6.
  const value = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
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
  const trustProxyHops = integer('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS ?? '0', 0, 1);
  const trustProxyAddress = env.TRUST_PROXY_ADDRESS ? normalizeIpAddress(env.TRUST_PROXY_ADDRESS) : null;
  if (env.TRUST_PROXY_ADDRESS && !trustProxyAddress) throw new Error('TRUST_PROXY_ADDRESS must be an exact IPv4 or IPv6 address');
  if (trustProxyHops === 1 && !trustProxyAddress) throw new Error('TRUST_PROXY_ADDRESS is required when TRUST_PROXY_HOPS is 1');
  return {
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: integer('PORT', env.PORT || '4317', 1, 65535),
    databaseUrl: env.DATABASE_URL,
    appId,
    appSecret,
    sessionTtlSeconds: integer('SESSION_TTL_SECONDS', env.SESSION_TTL_SECONDS || '2592000', 60, 7776000),
    trustProxyHops,
    trustProxyAddress,
    logLevel
  };
}
