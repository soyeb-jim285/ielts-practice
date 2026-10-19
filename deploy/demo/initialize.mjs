// Runs inside the pinned app image, after its normal migrations and bank seed.
import { auth } from '/app/apps/server/src/auth.ts';
import { sql } from '/app/apps/server/src/db/client.ts';
import { sendsIdle } from '/app/apps/server/src/auth-email.ts';

if (process.env.NODE_ENV !== 'development' || process.env.BETTER_AUTH_URL !== 'http://localhost:8787' || process.env.LOCAL_STORAGE_DIR !== '/app/data/local-storage') {
  throw new Error('This initializer is only for the local demo bundle.');
}
const email = 'demo@example.test';
try {
  const [existing] = await sql`select id from "user" where email = ${email}`;
  if (!existing) {
    await auth.api.signUpEmail({ body: { name: 'Local Demo', email, password: process.env.DEMO_PASSWORD } });
    await sendsIdle();
  }
  const [user] = await sql`update "user" set email_verified = true where email = ${email} returning id`;
  if (!user) throw new Error('Demo account was not created.');
  await sql`insert into user_limits (user_id, unlimited, updated_by) values (${user.id}, true, ${user.id})
    on conflict (user_id) do update set unlimited = true`;
  console.log('Demo account ready. Sign in using demo-login.txt.');
} finally {
  await sql.end();
}
