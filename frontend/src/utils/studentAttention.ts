/**
 * ป้ายและข้อความของหน้า "ตรวจสอบสถานะนักศึกษา" — เซิร์ฟเวอร์ส่งแค่รหัส (`GET /api/students/status-board`)
 * กติกาจัดลำดับอยู่ที่ `backend/src/utils/studentAttention.ts` ที่เดียว หน้าจอไม่คิดเอง
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

export type AttentionIssueCode =
  | 'intent_rejected'
  | 'request_stale'
  | 'acceptance_overdue'
  | 'logs_stale'
  | 'no_request'
  | 'form03_missing'
  | 'form06_missing'
  | 'no_supervisor'
  | 'no_advisor';

export interface AttentionIssue {
  code: AttentionIssueCode;
  count?: number;
}

export interface StatusBoardStudent {
  student_id: number;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  profile_image: string | null;
  company_name: string | null;
  /** ใบความจำนงล่าสุด (ไม่นับ superseded) — null = ยังไม่เคยยื่น */
  intent_form_id: number | null;
  advisor_id: number | null;
  supervisor_id: number | null;
  step: StudentStep;
  tier: AttentionTier;
  issues: AttentionIssue[];
}

export interface StatusBoardPayload {
  counts: Record<AttentionTier, number>;
  students: StatusBoardStudent[];
}

export const TIER_ORDER: AttentionTier[] = ['urgent', 'attention', 'ontrack', 'done'];

export const TIER_LABEL: Record<AttentionTier, string> = {
  urgent: 'ต้องรีบ',
  attention: 'ติดขัด / รอ',
  ontrack: 'เป็นไปตามแผน',
  done: 'เสร็จสิ้น',
};

export const STEP_LABEL: Record<StudentStep, string> = {
  no_request: 'ยังไม่มีที่ฝึก',
  paper: 'รอลงนามบนกระดาษ',
  staff: 'รอเจ้าหน้าที่ตรวจ',
  letter: 'หนังสือขอความอนุเคราะห์ · รอบริษัทตอบรับ',
  awaiting_dispatch: 'รอออกหนังสือส่งตัว',
  placement: 'ปฏิบัติงานอยู่',
  rejected: 'ใบความจำนงไม่ผ่าน',
  done: 'เสร็จสิ้น',
  other: 'อยู่ระหว่างดำเนินการ',
};

/** เส้นสถานะของนักศึกษาหนึ่งคน (ลำดับตามขั้นจริง) — `rejected`/`other` ไม่อยู่บนเส้น */
export const STEP_LINE: { key: StudentStep; label: string }[] = [
  { key: 'paper', label: 'คำร้อง' },
  { key: 'staff', label: 'เจ้าหน้าที่ตรวจ' },
  { key: 'letter', label: 'หนังสือ/ตอบรับ' },
  { key: 'awaiting_dispatch', label: 'ส่งตัว' },
  { key: 'placement', label: 'ฝึกงาน' },
  { key: 'done', label: 'เสร็จสิ้น' },
];

export function issueText(issue: AttentionIssue): string {
  const n = issue.count ?? 0;
  switch (issue.code) {
    case 'intent_rejected':
      return 'ใบความจำนงถูกปฏิเสธ · ต้องยื่นใหม่';
    case 'request_stale':
      return `คำร้องค้าง ${n} วัน`;
    case 'acceptance_overdue':
      return 'เลยกำหนดส่งแบบตอบรับ';
    case 'logs_stale':
      return `ไม่ส่งบันทึก ${n} วัน`;
    case 'no_request':
      return 'ยังไม่ได้ยื่นใบความจำนง';
    case 'form03_missing':
      return `สหกิจ 03 ขาด ${n} ช่อง`;
    case 'form06_missing':
      return 'ยังไม่ส่งสหกิจ 06';
    case 'no_supervisor':
      return 'ยังไม่มีอาจารย์นิเทศ';
    case 'no_advisor':
      return 'ยังไม่มีอาจารย์ที่ปรึกษา';
  }
}

const URGENT_CODES: AttentionIssueCode[] = [
  'intent_rejected',
  'request_stale',
  'acceptance_overdue',
  'logs_stale',
];

export const isUrgentIssue = (issue: AttentionIssue): boolean => URGENT_CODES.includes(issue.code);

export const studentFullName = (s: { first_name?: string | null; last_name?: string | null }): string =>
  [s.first_name, s.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ';
