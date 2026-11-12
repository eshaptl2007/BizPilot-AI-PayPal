// Usage: node src/db/migrate.js [--reset] [--seed]
//   (no flags)  apply pending migrations from /database/migrations
//   --reset     drop and recreate the public schema first (development only)
//   --seed      load /database/seed.sql (demo bakery + 90 days of sales)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../database');
const args = new Set(process.argv.slice(2));

async function main() {
  if (args.has('--reset')) {
    if (config.nodeEnv === 'production') throw new Error('Refusing to --reset in production');
    console.log('Resetting schema...');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const dir = path.join(dbDir, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (done.has(file)) continue;
    console.log(`Applying ${file}`);
    // migration files manage their own BEGIN/COMMIT
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
  }

  if (args.has('--seed')) {
    console.log('Seeding demo data...');
    await pool.query(fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8'));
    console.log('Demo login: demo@bizpilot.ai / Demo@1234   (storefront: /shop/sweet-crumbs)');
  }
  console.log('Database ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
