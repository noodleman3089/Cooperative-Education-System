import { query } from '../config/database';
import { decryptSensitive } from './encryption';
import { coop03MissingKeys, Coop03RequiredKey } from './coop03Required';

/**
 * สหกิจ 03 — ใบสมัครงานสหกิจศึกษา สำหรับ **ผู้ตรวจ** (เจ้าหน้าที่ · อาจารย์นิเทศ/ที่ปรึกษา · หัวหน้าสาขา)
 *
 * ⛔⛔ **นี่คือจุดเดียวในระบบที่เห็นค่าจริงของเลขบัตรประชาชน เชื้อชาติ และศาสนา**
 * (เจ้าของสั่ง 2026-10-18 — แทนที่ `coopApplicationPdf.ts` ที่ถูกถอดพร้อมปุ่มพิมพ์)
 * ทุกที่อื่นเห็นแค่มาสก์ (`GET /students/coop-application`) หรือไม่เห็นเลย
 * (`…/company-view` ตัดชั้น C ออกทั้งหมด) · ผลที่ตามมา:
 *   1. endpoint ที่เรียกไฟล์นี้ **ต้องผ่าน `assertCanReviewStudentWork` ก่อนเสมอ** (SEC-06 fail closed)
 *   2. ทุกครั้งที่ถูกเรียก ต้องมีแถวใน `audit_log` (ผู้เรียกเป็นคนเขียน ไม่ใช่ที่นี่)
 *   3. ห้ามเปิดให้บริษัท/พี่เลี้ยง/นักศึกษาคนอื่น
 */

type Row = Record<string, string>;

export interface CoopApplicationViewData {
  // ─ ใบความจำนงล่าสุด (ไม่จำกัดสถานะ — ตรงกับตอนนักศึกษากำลังจะสมัคร)
  company_name: string | null;
  start_date: string | null;
  end_date: string | null;
  // ─ ตัวตน
  first_name: string | null;
  last_name: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  advisor_name: string | null;
  cumulative_gpa: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส */
  national_id: string | null;
  national_id_issued_district: string | null;
  national_id_expiry_date: string | null;
  birth_date: string | null;
  gender: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส */
  ethnicity: string | null;
  nationality: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส */
  religion: string | null;
  current_address: string | null;
  phone: string | null;
  mobile_phone: string | null;
  fax: string | null;
  alt_email: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_address: string | null;
  emergency_phone: string | null;
  profile_image: string | null;
  // ─ JSONB
  family_info: Record<string, unknown> | null;
  career_objective: string | null;
  interested_job_types: string[] | null;
  activity_history: Row[] | null;
  language_proficiency: Row[] | null;
  education_history: Row[] | null;
  training_history: Row[] | null;
  none_sections: string[];
  /** ช่องบังคับที่ยังว่าง — กติกาอยู่ที่ `utils/coop03Required.ts` ที่เดียว */
  missing_required: Coop03RequiredKey[];
  /** `resumes/<ชื่อไฟล์>` — บังคับมีก่อนยื่นคำร้อง (2026-10-18) · เปิดไฟล์ผ่าน `/files/download/resumes/…` (เจ้าหน้าที่/อาจารย์) */
  resume_file: string | null;
}

/** ถอดรหัสให้ปลอดภัยต่อการล้มเหลว — กุญแจเปลี่ยนแล้วต้องไม่ทำให้ทั้งหน้าเปิดไม่ได้ */
const tryDecrypt = (ciphertext: unknown, iv: unknown, authTag: unknown): string | null => {
  if (!ciphertext || !iv || !authTag) return null;
  try {
    return decryptSensitive({
      ciphertext: ciphertext as string,
      iv: iv as string,
      authTag: authTag as string,
    });
  } catch {
    return null;
  }
};

export async function fetchCoopApplicationView(
  studentId: number
): Promise<CoopApplicationViewData | null> {
  const res = await query(
    `SELECT s.first_name, s.last_name, s.first_name_en, s.last_name_en,
            s.student_code, s.year_level, s.cumulative_gpa::text AS cumulative_gpa,
            s.birth_date::text AS birth_date, s.gender, s.nationality,
            s.current_address, s.phone, s.mobile_phone, s.fax, s.alt_email,
            s.emergency_contact_name, s.emergency_relationship,
            s.emergency_address, s.emergency_phone, s.profile_image,
            s.national_id_issued_district,
            s.national_id_expiry_date::text AS national_id_expiry_date,
            s.national_id_ciphertext, s.national_id_iv, s.national_id_tag,
            s.ethnicity_ciphertext, s.ethnicity_iv, s.ethnicity_tag,
            s.religion_ciphertext, s.religion_iv, s.religion_tag,
            s.resume_file,
            s.family_info, s.career_objective, s.interested_job_types,
            s.activity_history, s.language_proficiency,
            s.education_history, s.training_history, s.coop03_none_sections,
            mj.major_name_th,
            NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') AS advisor_name,
            c.name_th AS company_name,
            i.start_date::text AS start_date,
            i.end_date::text   AS end_date
       FROM students s
       JOIN master_major mj ON s.major_id = mj.major_id
       LEFT JOIN personnel p ON p.personnel_id = s.advisor_id
       LEFT JOIN LATERAL (
         SELECT company_id, start_date, end_date
           FROM intent_forms
          WHERE student_id = s.student_id
          ORDER BY form_id DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN companies c ON c.company_id = i.company_id
      WHERE s.student_id = $1`,
    [studentId]
  );
  if ((res.rowCount ?? 0) === 0) return null;

  const r = res.rows[0] as Record<string, unknown>;
  // ⛔ ตัด ciphertext/iv/tag ออกจากผลลัพธ์ — ส่งออกไปแค่ค่าที่ถอดแล้ว
  const {
    national_id_ciphertext, national_id_iv, national_id_tag,
    ethnicity_ciphertext, ethnicity_iv, ethnicity_tag,
    religion_ciphertext, religion_iv, religion_tag,
    coop03_none_sections,
    ...rest
  } = r;

  return {
    ...(rest as unknown as CoopApplicationViewData),
    national_id: tryDecrypt(national_id_ciphertext, national_id_iv, national_id_tag),
    ethnicity: tryDecrypt(ethnicity_ciphertext, ethnicity_iv, ethnicity_tag),
    religion: tryDecrypt(religion_ciphertext, religion_iv, religion_tag),
    none_sections: Array.isArray(coop03_none_sections) ? (coop03_none_sections as string[]) : [],
    missing_required: coop03MissingKeys(r),
  };
}
