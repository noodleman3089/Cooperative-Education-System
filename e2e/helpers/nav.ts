import type { Page } from '@playwright/test';

/**
 * Navigating by clicking a Thai label meant every test that walked through the
 * app was pinned to the exact wording of the sidebar. Reword one menu item and
 * a dozen unrelated tests go red for a reason that has nothing to do with what
 * they check.
 *
 * The sidebar renders `data-testid="nav-<id>"` from ids it already had. Those
 * ids are the stable thing; the labels are free to change.
 *
 * Assertions are a different matter and stay as they are: a test that checks
 * the user sees "บันทึกข้อมูลสำเร็จ" should read that text, because that text
 * is the thing being promised.
 */
export type NavId =
  // student
  | 'dashboard'
  // ⛔ 'application' / 'applications' (สหกิจ 01) ถูกตัดทั้งชุด 2026-09-14
  | 'jobs'
  | 'job_application'
  | 'accommodation_plan'
  | 'report_outline'
  | 'weekly_log'
  | 'final_report'
  | 'evaluation_result'
  | 'memos'
  | 'profile'
  // advisor / dept head
  | 'students'
  | 'report_outlines'
  | 'supervision'
  | 'supervision_record'
  | 'final_evaluation'
  | 'approval'
  | 'assignment'
  | 'final_progress'
  // นักศึกษาตอนนี้ (เจ้าหน้าที่) — ท่อสถานะ · ใครถือเรื่อง · ค้างนาน
  | 'pipeline'
  // ติดตามพี่เลี้ยง — เจ้าหน้าที่ · หัวหน้าสาขา · อาจารย์ที่ปรึกษา/นิเทศ
  | 'mentor_followup'
  // dean
  | 'signature'
  // staff
  // ⛔ 'dispatch_letters' ถูกถอดออกจาก sidebar เมื่อ 2026-08-27 — หน้าออกหนังสือส่งตัว
  //    ถูกลบไปตั้งแต่ 2026-08-26 แต่เมนูยังค้างและกดแล้วเด้งกลับแดชบอร์ดเงียบๆ
  | 'announcements'
  | 'appointments'
  | 'calendar'
  | 'semesters'
  | 'users'
  | 'import'
  // mentor (บริษัทไม่มีบัญชีแล้ว — เมนู 'form07' ของบริษัทถูกถอด 2026-10-02)
  | 'certify';

/**
 * Clicks a sidebar entry and waits for the screen to be really on the page.
 *
 * Two things stand between the click and the content. Screens are code-split,
 * so React shows a placeholder while the chunk is fetched — and in dev Vite
 * compiles it on first request. Then the screen shows the same placeholder
 * while it fetches its data. Both carry `screen-loading`, so this one wait
 * covers both, and an assertion afterwards is looking at real content.
 *
 * The timeout is explicit because `waitFor` has none by default: a screen whose
 * request never settles would otherwise hang here until the whole test timed
 * out, reported against this line instead of against the assertion that cared.
 */
export async function goToMenu(page: Page, id: NavId): Promise<void> {
  await page.getByTestId(`nav-${id}`).click();
  await page
    .getByTestId('screen-loading')
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
}

/** Signs out through the user menu. */
export async function logout(page: Page): Promise<void> {
  const btn = page.getByTestId('logout');
  if (!(await btn.isVisible())) {
    await page.getByRole('button', { name: 'เมนูบัญชีผู้ใช้' }).click();
  }
  await btn.click();
  /**
   * ⛔ ต้องรอให้เด้งไป /login ให้เสร็จก่อนคืนค่า
   *
   * `logout()` ใน `AuthContext` เคลียร์ state แล้วปล่อยให้ตัวกันเส้นทางพาไป /login
   * แบบ async · ผู้เรียกที่สั่ง `page.goto(...)` ต่อทันทีจะไปชนกับการเด้งนั้น
   * แล้วได้ `Navigation ... is interrupted by another navigation to .../login`
   * เป็นครั้งคราว — แดงคนละเคสกันทุกรอบ หาสาเหตุยาก (เจอ 2026-09-10)
   */
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}
