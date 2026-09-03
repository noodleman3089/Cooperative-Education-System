/**
 * สหกิจ 03 — ตรวจรูปทรงของประวัติที่เก็บเป็น JSONB (ครอบครัว · การศึกษา · ฝึกอบรม · กิจกรรม)
 *
 * JSONB รับอะไรก็ได้ ซึ่งเป็นทั้งข้อดีและกับดัก — ถ้าไม่ตรวจอะไรเลย วันหนึ่งจะมี
 * ก้อนข้อมูลรูปทรงแปลกๆ นอนอยู่ในคอลัมน์แล้วหน้าจอที่อ่านมันพังโดยไม่มีใครรู้ว่าใครใส่ไว้
 *
 * กติกาที่ใช้ **ตั้งใจให้หลวมพอดี**:
 *   - คีย์ต้องอยู่ใน allow-list (คีย์แปลกปลอมถูก *ตัดทิ้ง* ไม่ใช่ปฏิเสธทั้งคำขอ —
 *     หน้าจอเวอร์ชันใหม่กว่าส่งคีย์เกินมาไม่ควรทำให้ผู้ใช้บันทึกไม่ได้)
 *   - ค่าทุกตัวถูกบังคับเป็น **สตริง** และตัดความยาว (กันคนยัดข้อความยาวเป็นเมกะไบต์)
 *   - จำกัดจำนวนแถว (กัน payload บวมไม่มีเพดาน)
 *
 * ⛔ **ไม่บังคับว่าต้องกรอกครบทุกช่อง** — ใบนี้เป็นใบสมัครงาน นักศึกษาบางคนไม่มี
 * ประวัติฝึกอบรมเลยก็เป็นเรื่องปกติ · การบังคับกรอกคือการแต่งกติกาที่กระดาษไม่ได้มี
 */

/** เพดานความยาวของค่าหนึ่งช่อง — ยาวกว่านี้คือคนกำลังใช้ช่องผิดวัตถุประสงค์ */
const MAX_VALUE_LENGTH = 500;

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim().slice(0, MAX_VALUE_LENGTH);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

/** เก็บเฉพาะคีย์ที่รู้จัก แล้วบังคับค่าให้เป็นสตริง */
function pickRow(row: unknown, allowedKeys: readonly string[]): Record<string, string> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = asText(source[key]);
    if (value) out[key] = value;
  }
  // แถวที่ไม่มีอะไรเลยไม่ต้องเก็บ — ฟอร์มมีแถวว่างติดมาเป็นเรื่องปกติ
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * ตารางหนึ่งชุด → อาร์เรย์ของแถวที่สะอาดแล้ว
 * คืน `null` เมื่อผู้เรียกไม่ได้ส่งฟิลด์นี้มาเลย (= ไม่ได้แก้) ต่างจาก `[]` ที่แปลว่า "ล้างทิ้ง"
 */
export function sanitizeRows(
  value: unknown,
  allowedKeys: readonly string[],
  maxRows: number
): Record<string, string>[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxRows)
    .map((row) => pickRow(row, allowedKeys))
    .filter((row): row is Record<string, string> => row !== null);
}

export const EDUCATION_KEYS = ['level', 'institution', 'start_year', 'end_year', 'degree', 'major'] as const;
export const TRAINING_KEYS = ['period', 'institution', 'topic'] as const;
export const ACTIVITY_KEYS = ['period', 'position', 'duty'] as const;
export const SIBLING_KEYS = ['name', 'occupation'] as const;
const PARENT_KEYS = ['name', 'age', 'occupation', 'phone'] as const;

export const MAX_EDUCATION_ROWS = 10;
export const MAX_TRAINING_ROWS = 20;
export const MAX_ACTIVITY_ROWS = 20;
export const MAX_SIBLING_ROWS = 20;

export interface FamilyInfo {
  father?: Record<string, string>;
  mother?: Record<string, string>;
  sibling_count?: string;
  birth_order?: string;
  siblings?: Record<string, string>[];
}

/**
 * ครอบครัวมีรูปทรงต่างจากอีกสามก้อน (เป็น object ไม่ใช่อาร์เรย์) จึงมีตัวตรวจของตัวเอง
 * คืน `null` เมื่อไม่ได้ส่งมา · คืน object ว่างไม่ได้ เพราะแปลว่า "ล้างทิ้ง" ซึ่งต่างกัน
 */
export function sanitizeFamilyInfo(value: unknown): FamilyInfo | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const result: FamilyInfo = {};

  const father = pickRow(source.father, PARENT_KEYS);
  if (father) result.father = father;
  const mother = pickRow(source.mother, PARENT_KEYS);
  if (mother) result.mother = mother;

  const siblingCount = asText(source.sibling_count);
  if (siblingCount) result.sibling_count = siblingCount;
  const birthOrder = asText(source.birth_order);
  if (birthOrder) result.birth_order = birthOrder;

  const siblings = sanitizeRows(source.siblings, SIBLING_KEYS, MAX_SIBLING_ROWS);
  if (siblings && siblings.length > 0) result.siblings = siblings;

  return result;
}
