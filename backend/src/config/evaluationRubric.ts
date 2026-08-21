/**
 * กติกาของแบบประเมินสองใบที่พนักงานที่ปรึกษา (พี่เลี้ยง) เป็นผู้กรอก
 *
 *   สหกิจ 15 — แบบประเมินผลนักศึกษา · 18 ข้อ · เต็ม 100 · ใช้ตัดเกรด
 *   สหกิจ 16 — แบบประเมินรายงาน   · 14 ข้อ · ระดับ 1-5 · เต็ม 70 · ไม่รวมเกรด
 *
 * ⚠️ ไฟล์นี้เก็บ **กติกา** เท่านั้น — คีย์ · เพดานคะแนนรายข้อ · ฟิลด์ข้อความ · ค่า enum
 * ป้ายภาษาไทยที่ผู้ใช้เห็นอยู่ที่ `frontend/src/pages/Company/evaluationRubric.ts`
 * และป้ายบนกระดาษฝังตายอยู่ใน `secure_private/templates/sahatkit_1{5,6}_template.html`
 * เพราะแบบฟอร์มราชการเป็นภาพพิมพ์ตายตัว ไม่ใช่ข้อมูล
 *
 * **รายชื่อคีย์คือสิ่งเดียวที่ซ้ำกับ frontend** — พิมพ์ผิดเมื่อไหร่ `validateEvaluationPayload`
 * ตอบ 400 พร้อมชื่อคีย์ทันทีที่กดส่ง ดังกัง ไม่เงียบ · แก้ที่นี่ต้องแก้อีกที่ด้วย
 *
 * เพดานคะแนนมาจากตัวแบบฟอร์มจริง ไม่ใช่ตัวเลขที่ระบบตั้งเอง:
 * สหกิจ 15 ข้อ 1.1/1.2 ข้อละ 10 ที่เหลือข้อละ 5 → 20+40+20+20 = 100
 */

export const FORM_CODES = ['sahatkit_15', 'sahatkit_16'] as const;
export type FormCode = (typeof FORM_CODES)[number];

export interface RubricItem {
  key: string;
  /** เพดานคะแนนของข้อนี้ตามแบบฟอร์มจริง */
  max: number;
}

export interface EnumField {
  key: string;
  values: readonly string[];
  required: boolean;
}

export interface RubricForm {
  formCode: FormCode;
  items: readonly RubricItem[];
  /** true = ยอมให้บางข้อเป็น null (ติ๊กช่อง "–" บนกระดาษ) */
  allowNoData: boolean;
  textFields: readonly string[];
  enumFields: readonly EnumField[];
  maxTotal: number;
}

/** ข้อความยาวสุดที่ยอมให้เก็บลง JSONB ต่อหนึ่งฟิลด์ — เดิมไม่จำกัดเลย */
const MAX_TEXT_LENGTH = 2000;

const FIVE = 5;

const SAHATKIT_15: RubricForm = {
  formCode: 'sahatkit_15',
  items: [
    // หมวด 1 ผลสำเร็จของงาน (Work Achievement) — เต็ม 20
    { key: 'work_quantity', max: 10 },
    { key: 'work_quality', max: 10 },
    // หมวด 2 ความรู้ความสามารถ (Knowledge and Ability) — เต็ม 40
    { key: 'academic_ability', max: FIVE },
    { key: 'learn_and_apply', max: FIVE },
    { key: 'practical_ability', max: FIVE },
    { key: 'judgment_decision', max: FIVE },
    { key: 'organization_planning', max: FIVE },
    { key: 'communication_skills', max: FIVE },
    { key: 'foreign_language_culture', max: FIVE },
    { key: 'job_suitability', max: FIVE },
    // หมวด 3 ความรับผิดชอบต่อหน้าที่ — เต็ม 20
    { key: 'responsibility_dependability', max: FIVE },
    { key: 'interest_in_work', max: FIVE },
    { key: 'initiative_self_starter', max: FIVE },
    { key: 'response_to_supervision', max: FIVE },
    // หมวด 4 ลักษณะส่วนบุคคล (Personality) — เต็ม 20
    { key: 'personality', max: FIVE },
    { key: 'interpersonal_skills', max: FIVE },
    { key: 'discipline_adaptability', max: FIVE },
    { key: 'ethics_morality', max: FIVE },
  ],
  // ไม่ยอมรับ "–" โดยตั้งใจ: ท้ายฟอร์มบังคับว่ากล่องสรุปต้องรวมได้ = 100 พอดี
  // ยอมให้ข้อไหนว่าง ตัวหารพังทันที และ "(100)" บนกระดานเจ้าหน้าที่จะโกหก
  allowNoData: false,
  textFields: ['strength', 'improvement', 'other_comments'],
  enumFields: [
    // "หากนักศึกษาผู้นี้สำเร็จการศึกษาแล้ว ท่านจะรับเข้าทำงานในสถานประกอบการนี้หรือไม่"
    // บนกระดาษมีช่องให้ติ๊กเสมอ จึงบังคับกรอก
    { key: 'would_hire', values: ['accept', 'unsure', 'reject'], required: true },
  ],
  maxTotal: 100,
};

const SAHATKIT_16: RubricForm = {
  formCode: 'sahatkit_16',
  items: [
    { key: 'topic_selection', max: FIVE },
    { key: 'chapter1', max: FIVE },
    { key: 'chapter2', max: FIVE },
    { key: 'chapter3', max: FIVE },
    { key: 'chapter4', max: FIVE },
    { key: 'content_overall', max: FIVE },
    { key: 'language_use', max: FIVE },
    { key: 'table_of_contents', max: FIVE },
    { key: 'bibliography_citation', max: FIVE },
    { key: 'completeness', max: FIVE },
    { key: 'format_correctness', max: FIVE },
    { key: 'time_appropriateness', max: FIVE },
    { key: 'illustrations', max: FIVE },
    { key: 'overall_report', max: FIVE },
  ],
  // ฟอร์มระบุเองว่า "–" = ไม่มีข้อมูล เป็นตัวเลือกข้างๆ 1-5
  // และเจ้าของเคาะว่าแสดง x/70 ไม่รวมเกรด ตัวหารจึงไม่เป็นตาย
  allowNoData: true,
  textFields: ['report_title_th', 'report_title_en', 'other_comments'],
  enumFields: [],
  maxTotal: 70,
};

export const EVALUATION_FORMS: Record<FormCode, RubricForm> = {
  sahatkit_15: SAHATKIT_15,
  sahatkit_16: SAHATKIT_16,
};

export function isFormCode(value: unknown): value is FormCode {
  return typeof value === 'string' && (FORM_CODES as readonly string[]).includes(value);
}

/** ชื่อไทยของฟอร์ม สำหรับประกอบข้อความตอบกลับ */
export const FORM_LABEL: Record<FormCode, string> = {
  sahatkit_15: 'สหกิจ 15',
  sahatkit_16: 'สหกิจ 16',
};

export type ValidationResult =
  | { ok: true; total: number }
  | { ok: false; message: string };

/**
 * ตรวจ payload แบบ allow-list เข้ม แล้วคืนผลรวมคะแนน
 *
 * ของเดิมหลวมมาก: บวกทุกคีย์ที่ไม่อยู่ใน NON_SCORE_KEYS เข้า total และยอมให้
 * ทุกข้อมีค่าได้ถึง 100 ทั้งที่ฟอร์มจริงเพดานข้อละ 5 หรือ 10 → พี่เลี้ยงยิง
 * `{"anything": 100}` เข้ามาก็ได้คะแนนเต็ม
 */
export function validateEvaluationPayload(
  form: RubricForm,
  raw: unknown
): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'ข้อมูลประเมินไม่ถูกต้อง' };
  }
  const payload = raw as Record<string, unknown>;

  const itemKeys = new Set(form.items.map((i) => i.key));
  const textKeys = new Set(form.textFields);
  const enumKeys = new Set(form.enumFields.map((e) => e.key));

  // 1. คีย์แปลกปลอม — ปฏิเสธก่อนอย่างอื่น ไม่งั้นมันจะถูกเก็บลง JSONB เงียบๆ
  for (const key of Object.keys(payload)) {
    if (!itemKeys.has(key) && !textKeys.has(key) && !enumKeys.has(key)) {
      return {
        ok: false,
        message: `พบหัวข้อที่ไม่มีในแบบประเมิน ${FORM_LABEL[form.formCode]}: '${key}'`,
      };
    }
  }

  // 2-4. คะแนนรายข้อ — ต้องครบ อยู่ในเพดาน และเป็นจำนวนเต็ม
  let total = 0;
  for (const item of form.items) {
    const value = payload[item.key];

    if (value === null || value === undefined) {
      if (form.allowNoData && value === null) continue; // ติ๊ก "–"
      return {
        ok: false,
        message: `กรุณาให้คะแนนหัวข้อ '${item.key}' ให้ครบทุกข้อ`,
      };
    }

    const score = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(score) || score < 1 || score > item.max) {
      return {
        ok: false,
        message: `คะแนนหัวข้อ '${item.key}' ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง ${item.max}`,
      };
    }
    total += score;
  }

  // 5. ฟิลด์ข้อความ
  for (const key of form.textFields) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return { ok: false, message: `ฟิลด์ '${key}' ต้องเป็นข้อความ` };
    }
    if (value.length > MAX_TEXT_LENGTH) {
      return {
        ok: false,
        message: `ฟิลด์ '${key}' ยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร`,
      };
    }
  }

  // 6. ฟิลด์ตัวเลือก
  for (const field of form.enumFields) {
    const value = payload[field.key];
    if (value === undefined || value === null || value === '') {
      if (!field.required) continue;
      return { ok: false, message: `กรุณาเลือกคำตอบของ '${field.key}'` };
    }
    if (typeof value !== 'string' || !field.values.includes(value)) {
      return { ok: false, message: `ค่าของ '${field.key}' ไม่ถูกต้อง` };
    }
  }

  return { ok: true, total };
}
