import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { db, sql } from './client';

export async function runMigrations() {
  const folder = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder: folder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  await sql.end();
  console.log('migrations applied');
}
