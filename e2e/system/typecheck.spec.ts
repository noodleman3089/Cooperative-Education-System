import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

/**
 * tsc ต้องผ่านทั้งสองฝั่ง
 *
 * ไม่ใช้ browser และไม่แตะฐานข้อมูล — เรียก compiler ตรงๆ
 *
 * มีไว้เพราะเคยพลาดมาแล้วจริง: `npm run build` ฝั่ง frontend ล้มด้วย 53 error
 * ตั้งแต่รอบ 37 (c1d60bd) แล้วผ่านไปอีกสามรอบโดยไม่มีใครรู้ เหตุผลคือไม่มีอะไร
 * ในกระบวนการตรวจของโปรเจคเรียก tsc เลย —
 *   · E2E รันผ่าน `vite dev` ซึ่ง transpile อย่างเดียว ไม่ typecheck
 *   · `npm run lint` เป็น syntax-only ไม่แตะ type
 * ทั้งสองอย่างจึงเขียวได้ทั้งที่ build จริงพัง และของที่พังคือ "ขึ้น production ไม่ได้"
 * ซึ่งเป็นอาการที่ไม่มีทางเห็นระหว่างพัฒนา
 *
 * เทสต์นี้ช้ากว่าเพื่อน (~30 วิ) เพราะคอมไพล์ทั้งโปรเจค — ยอมแลก
 * แนวคิดเดียวกับ schema-drift และ thai-address: มีทางที่ของสองอย่างหลุดจากกันได้
 * เมื่อไหร่ ต้องมีตัวเทียบ ไม่ใช่พึ่งความจำ
 */

const ROOT = path.resolve(__dirname, '../..');

/** คืน stdout+stderr ของ tsc เมื่อ exit code ไม่ใช่ 0 · คืนสตริงว่างเมื่อผ่าน */
function typecheck(workspace: string, command: string): string {
  try {
    execSync(command, { cwd: path.join(ROOT, workspace), encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
  }
}

test.describe('Typecheck', () => {
  test.describe.configure({ timeout: 180_000 });

  test('backend: tsc ผ่าน (นี่คือคำสั่ง build จริงของ backend)', () => {
    const output = typecheck('backend', 'npx tsc --noEmit');
    expect(output, `tsc ฝั่ง backend ไม่ผ่าน:\n${output}`).toBe('');
  });

  test('frontend: tsc ผ่าน — ถ้าเทสต์นี้แดง แปลว่า npm run build ขึ้น production ไม่ได้', () => {
    // --force เพราะ tsc -b จำผลเดิมไว้ใน .tsbuildinfo แล้วข้ามการตรวจซ้ำ
    const output = typecheck('frontend', 'npx tsc -b --force');
    expect(output, `tsc ฝั่ง frontend ไม่ผ่าน:\n${output}`).toBe('');
  });
});
