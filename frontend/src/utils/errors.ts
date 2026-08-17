/**
 * อ่านข้อมูลจาก error ที่จับได้ โดยไม่ต้องประกาศ `catch (err: any)`
 *
 * ทั้งโปรเจคเคยเขียน `catch (err: any)` แล้วอ่าน `err.response?.data?.message`
 * ตรงๆ 79 จุด ซึ่ง TypeScript ยอมให้ทำอะไรกับ `any` ก็ได้ — รวมถึงพิมพ์ชื่อฟิลด์ผิด
 * แล้วได้ `undefined` เงียบๆ · `catch (err)` เปล่าๆ ให้ `unknown` ซึ่งปลอดภัยกว่า
 * แต่ต้องมีตัวช่วยอ่านค่าออกมา ไฟล์นี้คือตัวช่วยนั้น
 *
 * รูปร่างของ error ที่ระบบนี้โยนจริง มาจาก `services/api.ts`:
 *   const err = new Error(errorData?.message || 'An error occurred');
 *   err.response = { status, data };
 * จึงมีทั้ง `.message` (ข้อความจากเซิร์ฟเวอร์) และ `.response.data.message`
 * ตัวเดียวกัน — ลำดับการอ่านด้านล่างจึงครอบทั้งสองแบบและของแปลกปลอมอื่นๆ ด้วย
 */

interface ApiErrorShape {
  message?: unknown;
  name?: unknown;
  response?: {
    status?: unknown;
    data?: { message?: unknown } | unknown;
  };
}

const asErrorShape = (err: unknown): ApiErrorShape =>
  typeof err === 'object' && err !== null ? (err as ApiErrorShape) : {};

/**
 * ข้อความที่ผู้ใช้ควรเห็น — ข้อความจากเซิร์ฟเวอร์ก่อน แล้วจึงข้อความสำรองที่ผู้เรียกกำหนด
 *
 * @param fallback ข้อความภาษาไทยที่อธิบายว่างานอะไรล้มเหลว
 */
export function getErrorMessage(err: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'): string {
  const shape = asErrorShape(err);

  const data = shape.response?.data;
  const fromResponse =
    typeof data === 'object' && data !== null ? (data as { message?: unknown }).message : undefined;
  if (typeof fromResponse === 'string' && fromResponse.trim()) return fromResponse;

  if (typeof shape.message === 'string' && shape.message.trim()) return shape.message;

  return fallback;
}

/** รหัสสถานะ HTTP ถ้ามี — ใช้แยก 404 (ยังไม่มีข้อมูล) ออกจากความผิดพลาดจริง */
export function getErrorStatus(err: unknown): number | undefined {
  const status = asErrorShape(err).response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** ชื่อชนิดของ error — ใช้ตรวจ `AbortError` ตอนผู้ใช้ออกจากหน้าไปก่อนโหลดเสร็จ */
export function getErrorName(err: unknown): string | undefined {
  const name = asErrorShape(err).name;
  return typeof name === 'string' ? name : undefined;
}
