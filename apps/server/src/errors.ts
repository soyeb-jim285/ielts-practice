import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';

export type ErrorCode =
  | 'quota_exceeded' // 429
  | 'community_balance_exhausted' // 402
  | 'community_busy' // 503
  | 'too_many_requests' // 429
  | 'otp_locked' // 429: too many wrong email codes for this address (auth-email.ts); `retryAfterSeconds` says when to try again
  | 'live_requires_own_key' // 403
  | 'account_required' // 403
  | 'cambridge_required' // 403: Listening & Reading are for Cambridge-allow-listed users
  | 'keys_unavailable' // 503
  | 'invalid_key' // 400
  | 'key_check_failed' // 502
  | 'mock_open' // 409: the person already has an open full mock test (`mockId` says which)
  | 'mock_closed' // 409: the mock is finished or closed
  | 'out_of_order' // 409: a mock section started before the one(s) before it were submitted
  | 'section_done' // 409: that mock section was already submitted
  | 'no_complete_set'; // 404: not enough content for a complete mock

export type ErrorBody = { error: string; code: ErrorCode; [k: string]: unknown };

/** An error with a machine-readable `code` (docs/community.md): clients map it to UX instead of showing `error`. app.ts renders `body` as the JSON response. */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public body: ErrorBody,
  ) {
    super(status as never, { message: body.error });
  }
}
