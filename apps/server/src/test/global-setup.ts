import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

export default async function setup() {
  const base = process.env.TEST_DATABASE_BASE ?? 'postgres://postgres:ielts@localhost:5433';
  const name = `ielts_test_${(process.env.TEST_DB ?? 'main').replace(/\W/g, '_')}`;
  const admin = postgres(`${base}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const sql = postgres(`${base}/${name}`, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  await sql.end();
}
