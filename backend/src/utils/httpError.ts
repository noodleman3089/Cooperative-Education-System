import { Response } from 'express';

/**
 * แปลง error ที่ *เกิดจากคำขอ* ให้เป็น 4xx แทนที่จะเหมาเป็น 500
 *
 * การยิง fuzz เจอว่าการกรอกข้อความยาวเกินความกว้างคอลัมน์ (เช่นชื่อ 5,000 ตัวอักษร
 * ลงช่อง VARCHAR(255)) ทำให้ผู้ใช้ได้ 500 + "เกิดข้อผิดพลาดของระบบ" ซึ่งไม่บอกว่า
 * ต้องแก้อะไร และทำให้ log เต็มไปด้วยคำว่า unhandled ทั้งที่เป็นคำขอที่ผิดธรรมดา
 *
 * `index.ts` มีตัวจัดการแบบเดียวกันสำหรับ error ที่หลุดไปถึง middleware ตัวสุดท้าย
 * แต่ controller ส่วนใหญ่ catch เองแล้วตอบ 500 ตรงนั้นเลย จึงต้องมีตัวนี้ให้เรียก
 *
 * ใช้ในจุดที่ผู้ใช้กรอกข้อความลงคอลัมน์ที่มีความกว้างจำกัด — ฟอร์มโปรไฟล์
 * ข้อมูลบริษัท และใบสมัคร · จุดที่รับเฉพาะตัวเลขหรือ enum ไม่จำเป็นต้องใช้
 */
export function sendUnexpectedError(
  res: Response,
  error: unknown,
  logLabel: string,
  fallbackMessage = 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
): void {
  const pgCode = (error as { code?: string } | undefined)?.code;

  // 22001 = value too long for type · 22P02 = invalid text representation
  if (pgCode === '22001' || pgCode === '22P02') {
    res.status(400).json({ message: 'ข้อมูลที่กรอกยาวเกินกำหนดหรือมีรูปแบบไม่ถูกต้อง' });
    return;
  }

  console.error(`${logLabel}:`, error);
  res.status(500).json({ message: fallbackMessage });
}
