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
  const fromServer =
    typeof fromResponse === 'string' && fromResponse.trim()
      ? fromResponse
      : typeof shape.message === 'string' && shape.message.trim()
        ? shape.message
        : '';
  if (!fromServer) return fallback;

  // ข้อความ 5xx และ 429 ที่ไม่ใช่ภาษาไทยคือข้อความกลางของเซิร์ฟเวอร์/ตัวจำกัดอัตรา
  // ("An unexpected error occurred on the server." · "Too many requests…") ผู้ใช้อ่านแล้วไม่รู้ว่าต้องทำอะไร
  // — ใช้ข้อความไทยของผู้เรียกแทน · ข้อความไทยที่เซิร์ฟเวอร์ตั้งใจส่งมา (ทุกสถานะ) ยังแสดงตามเดิม
  const status = getErrorStatus(err);
  const hasThai = /[฀-๿]/.test(fromServer);
  if (!hasThai && status === 429) return 'มีการส่งคำขอถี่เกินไป กรุณารอประมาณ 15 นาทีแล้วลองใหม่อีกครั้ง';
  if (!hasThai && status !== undefined && status >= 500) return fallback;

  return fromServer;
}

/** รหัสสถานะ HTTP ถ้ามี — ใช้แยก 404 (ยังไม่มีข้อมูล) ออกจากความผิดพลาดจริง */
export function getErrorStatus(err: unknown): number | undefined {
  const status = asErrorShape(err).response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * `code` ที่เซิร์ฟเวอร์แนบมากับ 409 — ใช้แยกว่าชนเพราะอะไร (เช่น `duplicate_document_no` ให้ถามยืนยัน
 * กับ `stale_request_file` ให้ดูไฟล์ใหม่) โดยไม่ต้องเทียบข้อความภาษาไทย
 */
export function getErrorCode(err: unknown): string | undefined {
  const data = asErrorShape(err).response?.data;
  const code = typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/** ชื่อชนิดของ error — ใช้ตรวจ `AbortError` ตอนผู้ใช้ออกจากหน้าไปก่อนโหลดเสร็จ */
export function getErrorName(err: unknown): string | undefined {
  const name = asErrorShape(err).name;
  return typeof name === 'string' ? name : undefined;
}
