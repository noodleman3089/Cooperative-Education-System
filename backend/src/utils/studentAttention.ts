/**
 * จัดลำดับความสำคัญของนักศึกษาสำหรับหน้า "ตรวจสอบสถานะนักศึกษา" (อาจารย์ที่ปรึกษา · หัวหน้าสาขา)
 *
 * กติกาอยู่ที่นี่ที่เดียว — หน้าจอแค่แสดงผล ไม่คิดเอง (เจ้าของเคาะเกณฑ์ 2026-10-18)
 *   urgent    ต้องรีบ   : ถูกปฏิเสธ · คำร้องค้างเกิน 14 วัน · เลยกำหนดส่งแบบตอบรับ · ไม่ส่งบันทึกเกิน 21 วัน
 *   attention ติดขัด/รอ : ยังไม่ยื่นใบความจำนง · สหกิจ 03 ไม่ครบ · ยังไม่ส่ง 06 · ยังไม่มีอาจารย์
 *   ontrack   เป็นไปตามแผน
 *   done      เสร็จสิ้น  : พี่เลี้ยงส่งสหกิจ 15 และ 16 ครบ
 *
 * ⛔ ทุกตัวเลข "วัน" คำนวณใน SQL จาก `(NOW() AT TIME ZONE 'Asia/Bangkok')::date` — ไม่เทียบวันใน JS
 * ⛔ `intent_age_days` เป็น NULL ได้ (ใบก่อน migration 030 ไม่มีใครรู้อายุ) → ห้ามนับเป็นค้าง
 * ⛔ ดูแค่ "มีค่า / จำนวนช่องที่ขาด" ไม่ถอดรหัสและไม่ส่งเนื้อ 03 (SEC-12)
 */

export type AttentionTier = 'urgent' | 'attention' | 'ontrack' | 'done';

export type StudentStep =
  | 'no_request'
  | 'paper'
  | 'staff'
  | 'letter'
  | 'awaiting_dispatch'
  | 'placement'
  | 'rejected'
  | 'done'
  | 'other';

export interface AttentionIssue {
  code:
    | 'intent_rejected'
    | 'request_stale'
    | 'acceptance_overdue'
    | 'logs_stale'
    | 'no_request'
    | 'form03_missing'
    | 'form06_missing'
    | 'no_supervisor'
    | 'no_advisor';
  /** จำนวนวัน หรือจำนวนช่องที่ขาด ตามความหมายของ code */
  count?: number;
}

export const REQUEST_STALE_DAYS = 14;
export const LOGS_STALE_DAYS = 21;

export interface AttentionInput {
  intent_status: string | null;
  dispatch_document_no: string | null;
  intent_age_days: number | null;
  acceptance_overdue: boolean | null;
  placement_started: boolean | null;
  log_gap_days: number | null;
  coop03_missing_count: number;
  accommodation_submitted: boolean;
  mentor_forms_done: number;
  advisor_id: number | null;
  supervisor_id: number | null;
}

const URGENT: AttentionIssue['code'][] = [
  'intent_rejected',
  'request_stale',
  'acceptance_overdue',
  'logs_stale',
];

export function stepOf(r: AttentionInput): StudentStep {
  if (r.mentor_forms_done >= 2) return 'done';
  switch (r.intent_status) {
    case null:
      return 'no_request';
    case 'rejected':
    case 'company_rejected':
      return 'rejected';
    case 'pending_advisor':
      return 'paper';
    case 'pending_officer_request':
    case 'pending_officer_approval':
      return 'staff';
    case 'approved_by_dept_head':
      return 'letter';
    case 'accepted':
      return r.dispatch_document_no ? 'placement' : 'awaiting_dispatch';
    default:
      return 'other';
  }
}

export function classifyStudent(r: AttentionInput): {
  step: StudentStep;
  tier: AttentionTier;
  issues: AttentionIssue[];
} {
  const step = stepOf(r);
  const issues: AttentionIssue[] = [];

  if (step === 'rejected') issues.push({ code: 'intent_rejected' });
  if (
    (step === 'paper' || step === 'staff') &&
    r.intent_age_days !== null &&
    r.intent_age_days > REQUEST_STALE_DAYS
  ) {
    issues.push({ code: 'request_stale', count: r.intent_age_days });
  }
  if (step === 'letter' && r.acceptance_overdue) issues.push({ code: 'acceptance_overdue' });
  if (
    step === 'placement' &&
    r.placement_started &&
    r.log_gap_days !== null &&
    r.log_gap_days > LOGS_STALE_DAYS
  ) {
    issues.push({ code: 'logs_stale', count: r.log_gap_days });
  }

  if (step === 'no_request') issues.push({ code: 'no_request' });
  if (step === 'awaiting_dispatch' || step === 'placement') {
    if (r.coop03_missing_count > 0) issues.push({ code: 'form03_missing', count: r.coop03_missing_count });
    if (!r.accommodation_submitted) issues.push({ code: 'form06_missing' });
  }
  if (step !== 'done') {
    if (r.supervisor_id === null) issues.push({ code: 'no_supervisor' });
    if (r.advisor_id === null) issues.push({ code: 'no_advisor' });
  }

  const tier: AttentionTier = issues.some((i) => URGENT.includes(i.code))
    ? 'urgent'
    : issues.length > 0
      ? 'attention'
      : step === 'done'
        ? 'done'
        : 'ontrack';

  return { step, tier, issues };
}

export const TIER_ORDER: Record<AttentionTier, number> = { urgent: 0, attention: 1, ontrack: 2, done: 3 };
