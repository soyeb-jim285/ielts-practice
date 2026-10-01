import { eq, sql, type SQL } from 'drizzle-orm';
import { isCambridgeAllowed } from './auth';
import { prompts } from './db/schema';

/** WHERE clause for prompts this user may see. Cambridge (restricted) rows only for allow-listed emails; guests (null) never see them. */
export function visiblePromptWhere(user: { email: string; emailVerified: boolean } | null): SQL {
  return isCambridgeAllowed(user) ? sql`true` : eq(prompts.restricted, false);
}
