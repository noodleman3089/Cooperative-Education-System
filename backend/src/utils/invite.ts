import crypto from 'crypto';
import { PoolClient } from 'pg';
import { query } from '../config/database';

/**
 * Companies and mentors never register themselves — every account is opened for
 * them by staff or by an approval flow. They used to receive a generated
 * password by email, which left a working credential sitting in an inbox that
 * is often shared (hr@, contact@) and that nothing ever forced them to rotate.
 *
 * Instead they now get a single-use link that lets them choose their own
 * password. It reuses the reset-token machinery already on `users`
 * (`reset_token` / `reset_token_expires`) and the public
 * `POST /api/auth/reset-password` endpoint, which clears the token after use.
 */

/**
 * 48 hours. Long enough that an external partner who reads university mail the
 * next morning is not locked out, short enough that the window in which anyone
 * with access to a shared mailbox (hr@, contact@) could claim the account ahead
 * of them stays small. Staff can always reissue — see resendInvite.
 */
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/** Human-readable form of INVITE_TTL_MS, for email copy. */
export const INVITE_TTL_LABEL = '48 ชั่วโมง';

/**
 * Issue an invitation link for a user who has no password yet.
 *
 * @param client pass the caller's transaction client when this runs inside a
 *   transaction (see `acceptance.ts` officer approval) so the token is rolled
 *   back with everything else. Omit it when running after COMMIT.
 */
export const createInviteLink = async (userId: number, client?: PoolClient): Promise<string> => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const sql = 'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE user_id = $3';
  if (client) {
    await client.query(sql, [token, expiresAt, userId]);
  } else {
    await query(sql, [token, expiresAt, userId]);
  }

  // The invite lands on the company login page itself, carrying the token.
  // External partners then have one address for the system, first visit and
  // every visit after, instead of a separate activation page they never see again.
  return `${companyLoginUrl()}?token=${token}`;
};

/** Where an external partner logs in once they have set a password. */
export const companyLoginUrl = (): string =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login/company`;
