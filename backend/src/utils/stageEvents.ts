/**
 * เขียนเวลาที่ใบคำร้องเข้าขั้นใหม่ลง `intent_stage_events` (เฟส 2 R2-1 · migration 049)
 *
 * ⛔ เรียกที่จุดเปลี่ยนสถานะ **ในทรานแซกชันเดียวกับการเปลี่ยนนั้น** (ส่ง `client` ของทรานแซกชันเข้ามา) —
 *    ไม่งั้นใบกลับหลังถูกตีกลับแล้วเวลาไม่ตรงกับสถานะ · จุดที่ไม่มีทรานแซกชันส่ง `{ query }` ของ config/database
 * ⛔ ไม่ใช่ audit_log และไม่แทนมัน — ตารางนี้ไว้อ่านเอาอายุที่ค้าง (แดชบอร์ดเจ้าหน้าที่) ไม่มีข้อมูลส่วนตัว
 * ⛔ หน้าจอ/ตัวคำนวณอายุต้องถือว่า "ไม่มีแถว" = ไม่ทราบ (ใบเก่าก่อน 049 ขาดบางขั้น) ห้ามเดาเป็น 0 วัน
 *
 * ชื่อขั้น = "ขั้นที่ใบเพิ่งเข้า" ไม่ใช่ขั้นที่เพิ่งออก:
 *   form_created         ยื่นคำร้อง → รอนักศึกษาอัปโหลดกระดาษที่ลงนาม
 *   request_uploaded     อัปโหลดกระดาษแล้ว → รอเจ้าหน้าที่รับคำร้อง
 *   request_returned     เจ้าหน้าที่ตีกลับคำร้อง → กลับไปรอนักศึกษาอัปโหลดใหม่
 *   officer_approved     เจ้าหน้าที่รับคำร้อง → รอคณบดีลงนามหนังสือ
 *   dean_signed          คณบดีลงนามแล้ว → รอนักศึกษาส่งหนังสือให้บริษัท
 *   mail_sent            ส่งหนังสือถึงบริษัท → รอบริษัทตอบรับ
 *   acceptance_submitted ได้แบบตอบรับ (นักศึกษาอัปโหลด/บริษัทตอบทางลิงก์) → รอพี่เลี้ยง/เจ้าหน้าที่
 *   acceptance_returned  เจ้าหน้าที่ตีกลับแบบตอบรับ → กลับไปรอส่งใหม่
 *   mentor_set           นักศึกษาระบุพี่เลี้ยง → รอเจ้าหน้าที่ยืนยันแบบตอบรับ
 *   accepted             เจ้าหน้าที่ยืนยันแบบตอบรับ → ตอบรับแล้ว เตรียมเอกสารก่อนฝึก
 *   dispatch_issued      ออกหนังสือส่งตัว
 *   exited               ออกจากท่อ (บริษัทไม่รับ / นักศึกษายกเลิก)
 */
export type StageEvent =
  | 'form_created'
  | 'request_uploaded'
  | 'request_returned'
  | 'officer_approved'
  | 'dean_signed'
  | 'mail_sent'
  | 'acceptance_submitted'
  | 'acceptance_returned'
  | 'mentor_set'
  | 'accepted'
  | 'dispatch_issued'
  | 'exited';

interface Db {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export async function recordStageEvent(db: Db, formId: number, stage: StageEvent): Promise<void> {
  await db.query(`INSERT INTO intent_stage_events (form_id, stage) VALUES ($1, $2)`, [formId, stage]);
}
