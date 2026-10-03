import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from './config.js';

export async function migrate(pool, log = message => process.stdout.write(message + '\n')) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1739107001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
    if (!files.length) throw new Error('Database migrations are missing');
    for (const file of files) {
      const source = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [file])).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error('Applied migration was modified: ' + file);
        continue;
      }
      await client.query(source);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [file, checksum]);
      log('Applied migration: ' + file);
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Migration and rollback failed'); }
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  pool.on('error', error => { process.stderr.write('Migration database connection error: ' + error.message + '\n'); });
  try { await migrate(pool); }
  finally { await pool.end(); }
}
