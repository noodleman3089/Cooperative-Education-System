/**
 * `details` ที่ POST /api/memos ต้องแนบตามหัวข้อ (ดีไซน์ B · 2026-10-18)
 *
 * `parseMemoDetails` ฝั่ง backend: early_departure ต้องมี `start_date` · late_submission ต้องมี
 * `activities` (≥1 และ roundable) + `expected_date` · อีกสองหัวข้อไม่บังคับ
 * spec ที่ยิง POST /memos ตรง ๆ ใช้ค่าชุดนี้ เพื่อไม่ต้องเขียนซ้ำและไม่โดน 400
 * ค่าทั้งหมดเป็นของปลอม
 */
export const MEMO_DETAILS: Record<string, Record<string, unknown>> = {
  early_departure: { start_date: '2027-01-15' },
  late_submission: { activities: ['intent_submission'], expected_date: '2027-01-20' },
  change_company: { new_company: 'บริษัท ตัวอย่าง เทคโนโลยี จำกัด' },
  terminated: { end_date: '2027-02-01' },
};

export const memoDetailsFor = (memoType: string): Record<string, unknown> => MEMO_DETAILS[memoType] ?? {};
