import { dbExec, dbValue, withDb } from './db';

/**
 * ของกลางของเทสต์วงจรภาคเรียน (`staff/semester-lifecycle` · `staff/semester-cohort-summary`)
 * seed มี 2569/1 (active) กับ 2569/2 (ไม่ active)
 */

export const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

export const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export async function twoSemesters(): Promise<{ a: number; b: number }> {
  const a = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active'))!;
  const b = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE NOT is_active ORDER BY semester_id LIMIT 1'))!;
  return { a, b };
}

export const userId = (email: string) =>
  dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;

let seq = 0;

/** นักศึกษาใหม่ที่มีแถว students (บัญชี student1 ใน seed ไม่มีแถวนี้) · คืนอีเมลกับรหัสนักศึกษา */
export async function newStudent(): Promise<{ email: string; code: string }> {
  seq += 1;
  const email = `sem-student-${seq}@test.com`;
  const code = `6592${String(seq).padStart(4, '0')}`;
  await withDb(async (db) => {
    const id = (await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id`, [email])).rows[0].user_id;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [id]);
    // enrollment_year ใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
       VALUES ($1, $2, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569, 'ทดสอบ', 'ภาคเรียน')`,
      [id, code]
    );
  });
  return { email, code };
}

/** ใบของนักศึกษาในภาคที่ระบุ · คืน form_id */
export async function putForm(
  email: string,
  semesterId: number,
  status: string,
  dueOffset: number | null = null
): Promise<number> {
  return withDb(async (db) => {
    const sid = await userId(email);
    const company = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0].company_id as number;
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'Asia/Bangkok')::date + $5::int END)
       RETURNING form_id`,
      [sid, company, semesterId, status, dueOffset]
    );
    return res.rows[0].form_id as number;
  });
}

/** เวลาเข้าขั้นของใบ — `daysAgo` วันก่อนวันนี้ (ตามเวลาไทย) */
export const putEvent = (formId: number, stage: string, daysAgo: number) =>
  dbExec(
    `INSERT INTO intent_stage_events (form_id, stage, entered_at)
     VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Bangkok')::date::timestamp AT TIME ZONE 'Asia/Bangkok' - make_interval(days => $3::int) + INTERVAL '12 hours')`,
    [formId, stage, daysAgo]
  );
