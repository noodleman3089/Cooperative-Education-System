import { expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import { API_URL } from './env';

/**
 * The seeded accounts, and which door each one comes through. Spelling the
 * address and the login path out at 56 call sites meant that when the login
 * pages changed — as they did when the company page moved to an invitation
 * flow — every one of them was a place the change could have been missed.
 */
export const ACCOUNTS = {
  student1: { email: 'student1@test.com', path: '/login/student', field: 'text' },
  student2: { email: 'student2@test.com', path: '/login/student', field: 'text' },
  advisor1: { email: 'advisor1@test.com', path: '/login/personnel', field: 'text' },
  advisor2: { email: 'advisor2@test.com', path: '/login/personnel', field: 'text' },
  dean1: { email: 'dean1@test.com', path: '/login/personnel', field: 'text' },
  staff1: { email: 'staff1@test.com', path: '/login/personnel', field: 'text' },
  head1: { email: 'head1@test.com', path: '/login/personnel', field: 'text' },
  // External partners have no university Google account and no card on /login.
  company1: { email: 'company1@test.com', path: '/login/company', field: 'email' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

export const DEFAULT_PASSWORD = 'password123';

/**
 * Fills the login form and submits it, without saying what should happen next.
 * Use this when the login is the thing under test — a deactivated account, a
 * wrong password — and assert the outcome yourself.
 *
 * The session is an httpOnly cookie, so switching accounts means ending the
 * previous session for real; clearing localStorage does nothing. That is done
 * here rather than remembered at each call site.
 */
export async function attemptLogin(
  page: Page,
  account: AccountKey,
  password: string = DEFAULT_PASSWORD
): Promise<void> {
  const { email, path, field } = ACCOUNTS[account];

  await page.request.post(`${API_URL}/auth/logout`);
  await page.goto(path);
  const pwdTab = page.locator('button:has-text("รหัสผ่านเฉพาะระบบ")');
  if (await pwdTab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await pwdTab.click();
  }
  await page.locator(`input[type="${field}"]`).first().fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.click('button[type="submit"]');
}

/** Signs in and waits for the dashboard. The usual case: login is setup. */
export async function loginAs(
  page: Page,
  account: AccountKey,
  password: string = DEFAULT_PASSWORD
): Promise<void> {
  await attemptLogin(page, account, password);
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Signs in on an API context. Its cookie jar carries the session from here on,
 * so nothing needs to be threaded through the calls that follow.
 */
export async function apiLoginAs(
  request: APIRequestContext,
  account: AccountKey,
  password: string = DEFAULT_PASSWORD
): Promise<void> {
  const { email } = ACCOUNTS[account];
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(res.status(), `login failed for ${email}: ${await res.text()}`).toBe(200);
}
