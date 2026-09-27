import { test, expect } from '@playwright/test';
import { checkEnvironment } from '../../backend/src/config/validateEnv';

/**
 * ด่านตรวจ env ตอนสตาร์ท
 *
 * ไม่ต้องใช้ browser และไม่แตะฐานข้อมูล — เรียกฟังก์ชันตรงๆ ด้วยค่า env จำลอง
 * เทสต์ชุดนี้มีเพื่อกันไม่ให้มีใครถอด guard ออกตอนที่มันเกะกะระหว่างพัฒนา
 */

const productionBase = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(64),
  FRONTEND_URL: 'https://coop.rmutto.ac.th',
  TRUST_PROXY: '1',
  SMTP_HOST: 'smtp.rmutto.ac.th',
  SMTP_USER: 'coop',
  GOOGLE_CLIENT_ID: 'client-id',
  SENSITIVE_DATA_ENCRYPTION_KEY: '11'.repeat(32),
};

test.describe('Production env guard', () => {
  test('คอนฟิก production ที่ถูกต้องผ่านโดยไม่มี error และไม่มีคำเตือน', () => {
    const result = checkEnvironment(productionBase);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('ALLOW_SIMULATED_SSO ที่ติดไปกับ production ต้องหยุดการสตาร์ท', () => {
    const result = checkEnvironment({ ...productionBase, ALLOW_SIMULATED_SSO: 'true' });
    expect(result.errors.join(' ')).toContain('ALLOW_SIMULATED_SSO');
  });

  test('ENABLE_TEST_ROUTES ที่ติดไปกับ production ต้องหยุดการสตาร์ท', () => {
    const result = checkEnvironment({ ...productionBase, ENABLE_TEST_ROUTES: 'true' });
    expect(result.errors.join(' ')).toContain('ENABLE_TEST_ROUTES');
  });

  test('JWT_SECRET ที่หายไปหรือสั้นเกินไปต้องหยุดการสตาร์ท', () => {
    expect(checkEnvironment({ ...productionBase, JWT_SECRET: undefined }).errors).toHaveLength(1);
    expect(checkEnvironment({ ...productionBase, JWT_SECRET: 'sekret' }).errors).toHaveLength(1);
  });

  test('FRONTEND_URL ที่ไม่ใช่ https และ TRUST_PROXY ที่ว่าง เป็นคำเตือน ไม่ใช่การหยุด', () => {
    const result = checkEnvironment({
      ...productionBase,
      FRONTEND_URL: 'http://coop.rmutto.ac.th',
      TRUST_PROXY: undefined,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('https');
    expect(result.warnings.join(' ')).toContain('TRUST_PROXY');
  });

  test('SEC-12: SENSITIVE_DATA_ENCRYPTION_KEY หายไปหรือรูปแบบผิด เป็นคำเตือน (ยังไม่ error)', () => {
    // ⛔ ยังเป็นคำเตือนเพราะฟีเจอร์ที่เรียกใช้ (สหกิจ 03) ยังไม่มีในระบบ — วันที่ขึ้นจริง
    // ต้องยกระดับเป็น error แล้วแก้เทสต์นี้ให้คาดหวัง errors แทน (ดูคอมเมนต์ที่ validateEnv.ts)
    const missing = checkEnvironment({ ...productionBase, SENSITIVE_DATA_ENCRYPTION_KEY: undefined });
    expect(missing.errors).toEqual([]);
    expect(missing.warnings.join(' ')).toContain('SENSITIVE_DATA_ENCRYPTION_KEY');

    const wrongLength = checkEnvironment({
      ...productionBase,
      SENSITIVE_DATA_ENCRYPTION_KEY: 'abc123',
    });
    expect(wrongLength.errors).toEqual([]);
    expect(wrongLength.warnings.join(' ')).toContain('64 ตัวอักษร');

    const notHex = checkEnvironment({
      ...productionBase,
      SENSITIVE_DATA_ENCRYPTION_KEY: 'z'.repeat(64), // 'z' ไม่ใช่เลขฐานสิบหก
    });
    expect(notHex.warnings.join(' ')).toContain('SENSITIVE_DATA_ENCRYPTION_KEY');
  });

  test('โหมด dev เปิด simulated SSO ได้ แต่ต้องเตือนไว้', () => {
    const result = checkEnvironment({
      NODE_ENV: 'development',
      JWT_SECRET: 'short-but-fine-in-dev',
      ALLOW_SIMULATED_SSO: 'true',
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('ALLOW_SIMULATED_SSO');
  });
});
