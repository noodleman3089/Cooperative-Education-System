/**
 * ร่างของใบสมัครงานสหกิจ (สหกิจ 03) ที่ยังไม่ได้กดบันทึก — กันข้อมูลหายตอนสลับเมนู/รีเฟรช (เจ้าของแจ้ง 2026-10-18)
 *
 * ⛔ **ข้อมูลอ่อนไหว (SEC-12) ห้ามลงที่เก็บของเบราว์เซอร์เด็ดขาด** — เลขบัตรประชาชน · เชื้อชาติ · ศาสนา
 *    อยู่ในหน่วยความจำของแท็บนี้เท่านั้น (ตัวแปรโมดูล) · สลับเมนูแล้วกลับมายังอยู่ แต่รีเฟรช/ปิดแท็บแล้วหาย
 *    ที่เหลือเก็บใน `sessionStorage` (หายเมื่อปิดแท็บ ไม่ค้างบนเครื่องสาธารณะ — ต่างจาก localStorage ของร่างสหกิจ 06)
 * ⛔ ความยินยอมข้อมูลอ่อนไหวไม่เก็บในร่าง — ต้องติ๊กใหม่ทุกครั้งที่บันทึก
 */

/** คีย์ของฟอร์มที่เป็นข้อมูลอ่อนไหว — ไม่ลง sessionStorage */
const SENSITIVE_KEYS = ['national_id', 'ethnicity', 'religion'] as const;

export interface Coop03Draft {
  form: Record<string, string>;
  family: unknown;
  education: unknown;
  training: unknown;
  activities: unknown;
  languages: unknown;
  /** หมวดที่ติ๊ก "ไม่มีข้อมูล" — ร่างเก่าก่อนมีช่องนี้ไม่มีคีย์ (อ่านเป็น []) */
  noneSections?: string[];
}

/** ส่วนอ่อนไหวของร่าง แยกตามนักศึกษา — อยู่ในหน่วยความจำเท่านั้น */
const sensitiveInMemory = new Map<string, Record<string, string>>();

const storageKey = (userId: number | string) => `coop03_draft_${userId}`;

export function saveCoop03Draft(userId: number | string, draft: Coop03Draft): void {
  const publicForm: Record<string, string> = {};
  const sensitive: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.form)) {
    if ((SENSITIVE_KEYS as readonly string[]).includes(key)) sensitive[key] = value;
    else publicForm[key] = value;
  }
  sensitiveInMemory.set(String(userId), sensitive);
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify({ ...draft, form: publicForm }));
  } catch {
    /* sessionStorage ใช้ไม่ได้ (โหมดส่วนตัว/เต็ม) — ร่างหายตอนรีเฟรชเท่านั้น ไม่กระทบการบันทึกจริง */
  }
}

export function loadCoop03Draft(userId: number | string): Coop03Draft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Coop03Draft;
    return { ...parsed, form: { ...parsed.form, ...(sensitiveInMemory.get(String(userId)) ?? {}) } };
  } catch {
    return null;
  }
}

export function clearCoop03Draft(userId: number | string): void {
  sensitiveInMemory.delete(String(userId));
  try {
    sessionStorage.removeItem(storageKey(userId));
  } catch {
    /* ไม่มีอะไรให้ล้าง */
  }
}
