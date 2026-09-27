import { test, expect } from '@playwright/test';
import { encryptSensitive, decryptSensitive, maskNationalId } from '../../backend/src/utils/encryption';

/**
 * SEC-12 — เข้ารหัสสองทางสำหรับข้อมูลอ่อนไหวของ สหกิจ 03
 *
 * ไม่ต้องใช้ browser และไม่แตะฐานข้อมูล — เรียกฟังก์ชันตรงๆ (แบบเดียวกับ
 * `env-guard.spec.ts`) เพราะยังไม่มี endpoint ที่ใช้จริงในระบบ (รอก้อนหน้าจอ สหกิจ 03)
 * ชุดนี้ล็อกพฤติกรรมของตัวเข้ารหัสไว้ก่อนแล้ว
 */

// ⛔ ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร (256 บิต) — คนละค่ากับกุญแจจริงบนเครื่อง dev
const TEST_KEY = '1'.repeat(64);

// ⛔ Playwright รันทุกไฟล์ในโปรเซสเดียว (workers: 1) — `process.env` ที่แก้ที่นี่ค้างไปถึงไฟล์ถัดไป
//    เดิมไม่คืนค่า `student/coop03-application` C2 จึงถอดเลขบัตรที่ server เข้ารหัสด้วยกุญแจจริง
//    โดยใช้ TEST_KEY แล้วแดงด้วย "unable to authenticate data" เฉพาะตอนรันชุดเต็ม (พบ 2026-09-21)
const ORIGINAL_KEY = process.env.SENSITIVE_DATA_ENCRYPTION_KEY;

test.describe('SEC-12: การเข้ารหัสข้อมูลอ่อนไหว', () => {
  test.beforeEach(() => {
    process.env.SENSITIVE_DATA_ENCRYPTION_KEY = TEST_KEY;
  });

  test.afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SENSITIVE_DATA_ENCRYPTION_KEY;
    else process.env.SENSITIVE_DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  test('เข้ารหัสแล้วถอดกลับได้ค่าเดิมเป๊ะ รวมอักษรไทยและอักขระพิเศษ', () => {
    const plaintext = '1-2345-67890-12-3 · เลขบัตรประชาชนตัวอย่าง — 中文';
    const payload = encryptSensitive(plaintext);

    expect(decryptSensitive(payload)).toBe(plaintext);
    // ciphertext ต้องไม่ใช่ plaintext แปะเฉยๆ
    expect(payload.ciphertext).not.toContain(plaintext);
  });

  test('เข้ารหัสข้อความเดียวกันสองครั้ง ได้ ciphertext คนละค่า (IV สุ่มใหม่ทุกครั้ง)', () => {
    const a = encryptSensitive('1234567890123');
    const b = encryptSensitive('1234567890123');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    // แต่ถอดกลับต้องได้ค่าเดิมทั้งคู่
    expect(decryptSensitive(a)).toBe('1234567890123');
    expect(decryptSensitive(b)).toBe('1234567890123');
  });

  test('ciphertext ที่ถูกแก้ไขระหว่างทาง ต้องถอดไม่ผ่าน (GCM auth tag จับได้)', () => {
    const payload = encryptSensitive('ข้อมูลลับ');
    const tampered = {
      ...payload,
      ciphertext: Buffer.from('ของปลอม').toString('base64'),
    };
    expect(() => decryptSensitive(tampered)).toThrow();
  });

  test('authTag ที่ถูกแก้ไข ต้องถอดไม่ผ่านเช่นกัน', () => {
    const payload = encryptSensitive('ข้อมูลลับ');
    const tampered = { ...payload, authTag: encryptSensitive('อื่น').authTag };
    expect(() => decryptSensitive(tampered)).toThrow();
  });

  test('กุญแจผิด ถอดไม่ผ่าน', () => {
    const payload = encryptSensitive('1234567890123');
    process.env.SENSITIVE_DATA_ENCRYPTION_KEY = '2'.repeat(64);
    expect(() => decryptSensitive(payload)).toThrow();
  });

  test('ไม่มีกุญแจใน env → throw ทันที ไม่ใช่คืนค่าว่างหรือขยะเงียบๆ', () => {
    delete process.env.SENSITIVE_DATA_ENCRYPTION_KEY;
    expect(() => encryptSensitive('1234567890123')).toThrow(/SENSITIVE_DATA_ENCRYPTION_KEY/);
  });

  test('กุญแจรูปแบบผิด (ไม่ใช่ hex 64 ตัว) → throw', () => {
    process.env.SENSITIVE_DATA_ENCRYPTION_KEY = 'not-a-valid-hex-key';
    expect(() => encryptSensitive('1234567890123')).toThrow(/64 ตัวอักษร/);
  });

  test('มาสก์เลขบัตรประชาชน — เห็นแค่หลักตรวจสอบ (หลักสุดท้าย)', () => {
    expect(maskNationalId('1234567890123')).toBe('x-xxxx-xxxxx-xx-3');
    expect(maskNationalId('1-2345-67890-12-9')).toBe('x-xxxx-xxxxx-xx-9');
  });

  test('มาสก์ค่าที่ไม่ใช่เลขบัตรประชาชน 13 หลัก → รูปแบบว่างเปล่า ไม่ใช่เดา', () => {
    expect(maskNationalId('123')).toBe('x-xxxx-xxxxx-xx-x');
    expect(maskNationalId('')).toBe('x-xxxx-xxxxx-xx-x');
  });
});
