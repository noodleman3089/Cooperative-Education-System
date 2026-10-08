/**
 * เขียนเวลาที่ใบคำร้องเข้าขั้นใหม่ลง `intent_stage_events` (เฟส 2 R2-1 · migration 049)
 *
 * ⛔ เรียกที่จุดเปลี่ยนสถานะ **ในทรานแซกชันเดียวกับการเปลี่ยนนั้น** (ส่ง `client` ของทรานแซกชันเข้ามา) —
 *    ไม่งั้นใบกลับหลังถูกตีกลับแล้วเวลาไม่ตรงกับสถานะ · จุดที่ไม่มีทรานแซกชันส่ง `{ query }` ของ config/database
 * ⛔ ไม่ใช่ audit_log และไม่แทนมัน — ตารางนี้ไว้อ่านเอาอายุที่ค้าง (แดชบอร์ดเจ้าหน้าที่) ไม่มีข้อมูลส่วนตัว
 *    (ยกเว้น `request_returned` ที่เก็บเหตุผลตีกลับและผู้กด — ดู `recordStageEvent`)
 * ⛔ หน้าจอ/ตัวคำนวณอายุต้องถือว่า "ไม่มีแถว" = ไม่ทราบ (ใบเก่าก่อน 049 ขาดบางขั้น) ห้ามเดาเป็น 0 วัน
 *
 * ชื่อขั้น = "ขั้นที่ใบเพิ่งเข้า" ไม่ใช่ขั้นที่เพิ่งออก:
 *   form_created         ยื่นคำร้อง → รอนักศึกษาอัปโหลดกระดาษที่ลงนาม
 *   request_uploaded     อัปโหลดกระดาษแล้ว → รอเจ้าหน้าที่รับคำร้อง
 *   request_returned     เจ้าหน้าที่ตีกลับคำร้อง → กลับไปรอนักศึกษาอัปโหลดใหม่
 *   officer_approved     เจ้าหน้าที่รับคำร้อง → รอคณบดีลงนามหนังสือ
 *   dean_returned        คณบดีตีกลับหนังสือที่ยังไม่ลงนาม → กลับไปรอเจ้าหน้าที่รับคำร้อง (หนังสือถูกลบ)
 *   staff_recalled       เจ้าหน้าที่ดึงหนังสือที่ยังไม่ลงนามกลับ → กลับไปรอเจ้าหน้าที่รับคำร้อง (หนังสือถูกลบ)
 *   dean_signed         คณบดีลงนามแล้ว → รอนักศึกษาส่งหนังสือให้บริษัท
 *   mail_sent            ส่งหนังสือถึงบริษัท → รอบริษัทตอบรับ
 *   acceptance_submitted ได้แบบตอบรับ (นักศึกษาอัปโหลด/บริษัทตอบทางลิงก์) → รอพี่เลี้ยง/เจ้าหน้าที่
 *   acceptance_returned  เจ้าหน้าที่ตีกลับแบบตอบรับ → กลับไปรอส่งใหม่
 *   mentor_set           นักศึกษาระบุพี่เลี้ยง → รอเจ้าหน้าที่ยืนยันแบบตอบรับ
 *   accepted             เจ้าหน้าที่ยืนยันแบบตอบรับ → ตอบรับแล้ว เตรียมเอกสารก่อนฝึก
 *   dispatch_issued      ออกหนังสือส่งตัว
 *   dispatch_dean_returned   คณบดีตีกลับหนังสือส่งตัวที่ยังไม่ลงนาม → ใบคง `accepted` กลับไปรอออกหนังสือส่งตัว (หนังสือถูกลบ)
 *   dispatch_staff_recalled  เจ้าหน้าที่ดึงหนังสือส่งตัวที่ยังไม่ลงนามกลับ → เหมือนบรรทัดบน
 *     ⛔ คนละค่ากับ `dean_returned` / `staff_recalled` โดยตั้งใจ — สองค่านั้นคือ "เข้าคิวคำร้องรอรับ" (ดูค่าคงที่ด้านล่าง)
 *   exited               ออกจากท่อ (บริษัทไม่รับ / นักศึกษายกเลิก / ระบบปิดเมื่อพ้นปฏิทินรับแบบตอบรับ)
 */
export type StageEvent =
  | 'form_created'
  | 'request_uploaded'
  | 'request_returned'
  | 'officer_approved'
  | 'dean_returned'
  | 'staff_recalled'
  | 'dean_signed'
  | 'mail_sent'
  | 'acceptance_submitted'
  | 'acceptance_returned'
  | 'mentor_set'
  | 'accepted'
  | 'dispatch_issued'
  | 'dispatch_dean_returned'
  | 'dispatch_staff_recalled'
  | 'exited';

interface Db {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * `extra` ใช้กับ `request_returned` · `dean_returned` · `staff_recalled` · `dispatch_dean_returned` · `dispatch_staff_recalled` เท่านั้น — เหตุผลและผู้กด (migration 051)
 * เก็บที่นี่เพราะ `intent_forms.reject_reason` ถูกล้างเมื่อนักศึกษาส่งใหม่ และ audit_log ไม่มี read API (SEC-07)
 * ⛔ สองค่านี้ให้เจ้าหน้าที่เห็นเท่านั้น (`GET /intents/:id` ตัดตามบทบาท)
 */
export async function recordStageEvent(
  db: Db,
  formId: number,
  stage: StageEvent,
  extra: { note?: string | null; actorId?: number | null } = {}
): Promise<void> {
  await db.query(
    `INSERT INTO intent_stage_events (form_id, stage, note, actor_id) VALUES ($1, $2, $3, $4)`,
    [formId, stage, extra.note ?? null, extra.actorId ?? null]
  );
}

/** เหตุการณ์ที่ทำให้ใบ "เข้า" คิวรอเจ้าหน้าที่รับคำร้อง — อัปโหลดกระดาษ · หนังสือถูกถอนกลับมา (คณบดี/เจ้าหน้าที่) */
export const REQUEST_QUEUE_ENTRY_STAGES_SQL = `'request_uploaded', 'dean_returned', 'staff_recalled'`;

/**
 * เวลาที่ใบเข้าคิว "รอเจ้าหน้าที่รับคำร้อง" = เหตุการณ์เข้าคิวครั้งล่าสุด (อัปโหลดกระดาษ หรือหนังสือถูกถอนกลับ)
 * ใบเก่าที่ไม่มีเหตุการณ์ (ก่อน migration 049) ถอยไปใช้วันที่สร้างใบ · ไม่มีทั้งคู่ = NULL = ไม่ทราบ ห้ามเดา
 * ⛔ ต้องนับการถอนกลับด้วย ไม่งั้นใบที่กลับเข้าคิวจะแดง "เลยกำหนด" ทันทีจากวันอัปโหลดเดิม
 *
 * ⛔ ที่มาเดียวของ "รอมากี่วัน" และ "เลยกำหนด" ของคิวคำร้อง — หน้าแรกเจ้าหน้าที่ · รายการคิว (`GET /intents`)
 *    · `staffPipeline.ts` (`age_request ?? age_created`) ต้องตอบตรงกัน
 */
export const requestQueuedAtSql = (alias: string): string =>
  `COALESCE((SELECT MAX(e.entered_at) FROM intent_stage_events e
              WHERE e.form_id = ${alias}.form_id AND e.stage IN (${REQUEST_QUEUE_ENTRY_STAGES_SQL})), ${alias}.created_at)`;

/** คำร้องที่รอเจ้าหน้าที่เกินกี่วันนับเป็นเลยกำหนด */
export const REQUEST_OVERDUE_DAYS = 7;
