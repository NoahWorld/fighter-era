import pg from 'pg';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
// Migrate before listening; a failed migration is a failed startup, never a partially working service.
try { await migrate(pool); }
catch (error) { await pool.end(); throw error; }
const app = await buildApp({ config, pool });
pool.on('error', error => { app.log.error({ err: error }, 'Idle PostgreSQL connection failed'); });
app.addHook('onClose', async () => { await pool.end(); });
app.log.info({ wechat: config.appId && config.appSecret ? 'configured' : 'pending_configuration', payment: 'not_enabled', advertising: 'not_enabled' }, 'Backend configuration status');
await app.listen({ host: config.host, port: config.port });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Graceful shutdown started');
  const deadline = setTimeout(() => { app.log.fatal('Graceful shutdown timed out'); process.exit(1); }, 15000);
  try { await app.close(); clearTimeout(deadline); }
  catch (error) { app.log.error({ err: error }, 'Graceful shutdown failed'); process.exit(1); }
});
