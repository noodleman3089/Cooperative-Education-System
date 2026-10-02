import { expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import { API_URL } from './env';
import { dbExec, dbValue } from './db';

/**
 * The seeded accounts, and which door each one comes through. Spelling the
 * address and the login path out at 56 call sites meant that when the login
 * pages changed — as they did when the company role was removed and mentors
 * moved to link login — every one of them was a place the change could have been missed.
 */
export const ACCOUNTS = {
  student1: { email: 'student1@test.com', path: '/login/student', field: 'text' },
  student2: { email: 'student2@test.com', path: '/login/student', field: 'text' },
  advisor1: { email: 'advisor1@test.com', path: '/login/personnel', field: 'text' },
  advisor2: { email: 'advisor2@test.com', path: '/login/personnel', field: 'text' },
  dean1: { email: 'dean1@test.com', path: '/login/personnel', field: 'text' },
  staff1: { email: 'staff1@test.com', path: '/login/personnel', field: 'text' },
  head1: { email: 'head1@test.com', path: '/login/personnel', field: 'text' },
  // พี่เลี้ยง (role mentor อย่างเดียว) — ไม่มีรหัสผ่าน (SEC-15)
  // เข้าด้วยลิงก์อีเมลครั้งเดียวทาง /login/mentor → /m?token=… จึงไม่ผ่านฟอร์มรหัสผ่าน
  mentor1: { email: 'mentor1@test.com', path: '/login/mentor', field: 'email' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

export const DEFAULT_PASSWORD = 'password123';

/**
 * บัญชีที่ไม่มีรหัสผ่าน — helper ด้านล่างจำลอง "กดลิงก์ในอีเมล" แทน:
 * ยัดแถว `mentor_login_tokens` ทาง SQL แล้วแลกลิงก์ (ผ่านเบราว์เซอร์หรือ API)
 * ให้ session cookie ลงใน cookie jar ของ page/request ที่ส่งมา
 */
const LINK_LOGIN_ACCOUNTS: readonly AccountKey[] = ['mentor1'];
const isLinkLogin = (account: AccountKey): boolean => LINK_LOGIN_ACCOUNTS.includes(account);

function assertNoPassword(account: AccountKey, password: string): void {
  if (password !== DEFAULT_PASSWORD) {
    throw new Error(`พี่เลี้ยงไม่มีรหัสผ่าน — ${account} เข้าด้วยลิงก์เท่านั้น (ห้ามส่งรหัสผ่านเข้า helper)`);
  }
}

/** ยัด token เข้าระบบ (30 นาที · เป้าหมาย /dashboard) ให้บัญชีนั้น — เหมือนที่ระบบออกให้ตอนส่งลิงก์ทางอีเมล */
async function insertLoginLinkToken(account: AccountKey): Promise<string> {
  const token = crypto.randomUUID();
  const inserted = await dbExec(
    `INSERT INTO mentor_login_tokens (token, user_id, target, expires_at)
     SELECT $1::uuid, user_id, '/dashboard', NOW() + INTERVAL '30 minutes'
       FROM users WHERE email = $2`,
    [token, ACCOUNTS[account].email]
  );
  if (inserted !== 1) throw new Error(`${ACCOUNTS[account].email} is missing — seedTestData() not called?`);
  return token;
}

const removeLoginLinkToken = (token: string) =>
  dbExec('DELETE FROM mentor_login_tokens WHERE token = $1::uuid', [token]);

const tokenUsed = async (token: string): Promise<boolean> =>
  (await dbValue<boolean>('SELECT used_at IS NOT NULL FROM mentor_login_tokens WHERE token = $1::uuid', [token])) === true;

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

  if (isLinkLogin(account)) {
    assertNoPassword(account, password);
    await page.request.post(`${API_URL}/auth/logout`);
    const token = await insertLoginLinkToken(account);
    await page.goto(`/m?token=${token}`);
    // รอจนลิงก์ถูกแลก แล้วลบแถวทิ้ง — เทสต์ที่นับ mentor_login_tokens เพื่อพิสูจน์ว่า "ไม่มีลิงก์ถูกส่ง"
    // ต้องไม่เห็นลิงก์ที่ helper ยัดเองเพื่อเข้าระบบ
    await expect.poll(() => tokenUsed(token), { timeout: 30_000 }).toBe(true);
    await removeLoginLinkToken(token);
    return;
  }

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
  if (isLinkLogin(account)) {
    assertNoPassword(account, password);
    const token = await insertLoginLinkToken(account);
    const consumed = await request.post(`${API_URL}/auth/mentor-link/consume`, { data: { token } });
    expect(consumed.status(), `link login failed for ${email}: ${await consumed.text()}`).toBe(200);
    await removeLoginLinkToken(token);
    return;
  }
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(res.status(), `login failed for ${email}: ${await res.text()}`).toBe(200);
}
