export type Tone = 'waiting' | 'progress' | 'review' | 'done' | 'rejected' | 'neutral';

/**
 * Every status the backend can put on a row, and what a person should read
 * instead. This existed as three partial copies — AdvisorDashboard knew nine,
 * CompanyDashboard eight, IntentReviewModal nine, ApplicationReview three — and
 * each fell back to `status.replace(/_/g, ' ')`. There are seventeen, so on any
 * given screen several of them reached the user as "pending officer approval":
 * an English database value, spelled out on a Thai page, telling a co-op
 * officer nothing about what to do next.
 */
export const STATUS_LABELS: Record<string, { text: string; tone: Tone }> = {
  // intent_forms.
  // Each of these says two things on purpose: how far the form has got, and
  // who it is now waiting on. A student reading only "รอหัวหน้าสาขาวิชา" cannot
  // tell whether their advisor has looked at it yet, and that is the question
  // they open the page to answer.
  // ⚠️ `pending_advisor` ถูกใช้ **สองโดเมน**: intent_forms (ใบความจำนง) · report_outlines
  // (สหกิจ 11) — โครงร่างย้ายไปให้อาจารย์นิเทศกด ส่วนใบความจำนงย้ายไปลงนามบนกระดาษเมื่อ 2026-08-26
  // (เดิมมีโดเมนที่สามคือ coop_applications ของ สหกิจ 01 ซึ่งถูกตัดทั้งชุด 2026-09-14)
  // ข้อความกลางจึงเป็นของโครงร่าง "รออาจารย์นิเทศ" และให้ใบความจำนงทับด้วย
  // `DOMAIN_OVERRIDES` ข้างล่างแทน (นี่คือกับดัก key ชนข้ามโดเมนที่ CLAUDE.md เตือนไว้)
  pending_advisor: { text: 'รออาจารย์นิเทศพิจารณา', tone: 'waiting' },
  pending_officer_request: { text: 'ส่งคำร้องที่ลงนามแล้ว · รอเจ้าหน้าที่ตรวจสอบ', tone: 'review' },
  approved_by_dept_head: { text: 'สาขาวิชาอนุมัติแล้ว · รอออกหนังสือ', tone: 'waiting' },
  pending_sign: { text: 'ออกหนังสือแล้ว · รอคณบดีลงนาม', tone: 'waiting' },
  signed: { text: 'คณบดีลงนามแล้ว · รอสถานประกอบการตอบรับ', tone: 'progress' },
  pending_acceptance: { text: 'รอสถานประกอบการตอบรับ', tone: 'waiting' },
  pending_officer_approval: { text: 'ส่งหลักฐานแล้ว · รอเจ้าหน้าที่ตรวจสอบ', tone: 'review' },
  accepted: { text: 'สถานประกอบการตอบรับแล้ว', tone: 'done' },
  rejected: { text: 'อาจารย์ที่ปรึกษาตีกลับ', tone: 'rejected' },
  company_rejected: { text: 'สถานประกอบการปฏิเสธ', tone: 'rejected' },


  // report outlines / documents
  draft: { text: 'ฉบับร่าง', tone: 'neutral' },
  submitted: { text: 'ส่งแล้ว', tone: 'progress' },
  pending_mentor: { text: 'รอพี่เลี้ยงตรวจ', tone: 'waiting' },
  approved: { text: 'อนุมัติแล้ว', tone: 'done' },
};

/** The Thai wording on its own, for prose rather than a chip. */
/**
 * โดเมนที่มี key ชนกับโดเมนอื่นแต่ความหมายไม่เหมือนกัน
 *
 * ตอนนี้มีตัวเดียวคือใบความจำนง (`intent_forms`) ที่สถานะ `pending_advisor`
 * **ไม่ได้แปลว่ารออาจารย์กดปุ่ม** อีกแล้วตั้งแต่ 2026-08-26 — มันแปลว่านักศึกษา
 * ต้องเอาแบบคำร้องไปให้ลงนามด้วยปากกาแล้วอัปโหลดกลับ
 *
 * ⛔ อย่าย้ายข้อความนี้ขึ้นไปทับใน `STATUS_LABELS` — โครงร่างรายงาน
 * ใช้ key เดียวกันและยังรออาจารย์กดจริงๆ
 */
export type StatusDomain = 'intent';

export const DOMAIN_OVERRIDES: Record<StatusDomain, Record<string, { text: string; tone: Tone }>> = {
  intent: {
    pending_advisor: {
      text: 'ยื่นคำร้องแล้ว · นำแบบคำร้องไปให้ลงนามแล้วอัปโหลดกลับ',
      tone: 'waiting',
    },
    // ชื่อคอลัมน์ยังเป็น `approved_by_dept_head` เพราะทุกอย่างท้ายน้ำอ่านค่านี้ แต่
    // **คนที่กดคือเจ้าหน้าที่** ไม่ใช่หัวหน้าสาขา (ลายเซ็นหัวหน้าสาขาอยู่บนกระดาษ)
    // ข้อความกลางที่เขียนว่า "สาขาวิชาอนุมัติแล้ว" จึงบอกชื่อผิดคน
    // · ใบที่ออกหนังสือแล้ว `StudentDashboard` จะส่งสถานะของหนังสือมาแทน ข้อความนี้
    //   เหลือไว้สำหรับช่วงสั้นๆ ที่ยังไม่มีแถวเอกสาร
    approved_by_dept_head: {
      text: 'เจ้าหน้าที่รับคำร้องแล้ว · รอออกหนังสือ',
      tone: 'waiting',
    },
    // ใบความจำนงเป็น `rejected` ได้ทางเดียวคือนักศึกษากด "สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ" เอง
    // (`failByStudent`) — ข้อความกลาง "อาจารย์ที่ปรึกษาตีกลับ" เป็นของโครงร่างรายงาน อาจารย์ไม่ได้กดอะไรกับใบนี้
    rejected: {
      text: 'นักศึกษาแจ้งว่าไม่ได้ที่ฝึกงานนี้ · ยื่นที่ใหม่ได้',
      tone: 'rejected',
    },
  },
};

// `intentDisplayStatus` ย้ายไป `utils/intentStatus.ts` — ดูเหตุผลในไฟล์นั้น

export const lookup = (status: string, domain?: StatusDomain) =>
  (domain ? DOMAIN_OVERRIDES[domain]?.[status] : undefined) ?? STATUS_LABELS[status];

export const statusText = (status: string, domain?: StatusDomain): string =>
  lookup(status, domain)?.text ?? status;
