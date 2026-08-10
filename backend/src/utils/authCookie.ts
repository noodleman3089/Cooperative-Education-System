import { CookieOptions, Response } from 'express';

/** Name of the httpOnly cookie carrying the session JWT. */
export const AUTH_COOKIE = 'coop_session';

/**
 * Frontend and API are served from the same site, so SameSite=Lax is enough to
 * stop cross-site requests from carrying the session — no CSRF token needed.
 * Move to `sameSite: 'none'` + a CSRF token if the frontend ever moves to a
 * different site.
 */
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

/**
 * Translates a JWT `expiresIn` value ("24h", "30m", "3600") into milliseconds so
 * the cookie dies with the token it carries. A cookie that outlives its JWT
 * leaves the user looking logged in while every request comes back 401.
 */
const parseExpiryMs = (expiresIn: string): number => {
  const match = /^(\d+)\s*([smhd])?$/i.exec(expiresIn.trim());
  if (!match) return 24 * 60 * 60 * 1000;

  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * unitMs[unit];
};

export const setAuthCookie = (res: Response, token: string): Response =>
  res.cookie(AUTH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: parseExpiryMs(process.env.JWT_EXPIRES_IN || '24h'),
  });

/** clearCookie only matches when the options mirror the ones used to set it. */
export const clearAuthCookie = (res: Response): Response =>
  res.clearCookie(AUTH_COOKIE, cookieOptions());
