import { query } from '../config/database';

/**
 * คิว "รอคุณรับรอง" ของพี่เลี้ยง
 *
 * ⛔ **ไม่มีตาราง notification และจะไม่มี** — งานค้างของพี่เลี้ยงคือสถานะจริงของเอกสาร
 *    ที่มีอยู่แล้วในฐาน การสร้างตารางกลางมาเก็บซ้ำแปลว่าต้องมีคนคอยล้างให้ตรงกัน
 *    และวันที่มันไม่ตรง ผู้ใช้จะเชื่อตัวไหนก็ผิดทั้งคู่ · อ่านจากของจริงเสมอ
 *
 * ⛔ ทุกคิวรีในไฟล์นี้กรองด้วย `i.mentor_id = $1 AND i.status = 'accepted'` เสมอ
 *    (SEC-06) — พี่เลี้ยงเห็นเฉพาะนักศึกษาที่ผูกกับตัวเอง ไม่ใช่ทั้งบริษัท
 *
 * ⛔ วันที่คำนวณด้วย `CURRENT_DATE` ของ Postgres ไม่ใช่ของ Node — "วันนี้" ของระบบนี้
 *    คือวันที่ตามเวลาไทยจากฐานเสมอ
 */

/** ชนิดงานที่ขึ้นคิวได้ — ชื่อพวกนี้ถูกใช้เป็น `kind` ในสัญญา API ห้ามเปลี่ยนตามใจ */
export const MENTOR_QUEUE_KINDS = [
  'weekly_log',
  'monthly_log',
  'daily_log',
  'work_plan',
  'report_outline',
  'report_draft',
] as const;
export type MentorQueueKind = (typeof MENTOR_QUEUE_KINDS)[number];

/**
 * ชนิดที่ "รับรองรวดเดียวหลายใบ" ได้
 *
 * ⛔ มีแต่บันทึกการปฏิบัติงานเท่านั้น — แผนปฏิบัติงาน โครงร่างรายงาน และร่างรายงาน
 *    ต้องอ่านก่อนถึงจะเซ็นได้ การทำปุ่มรับรองรวดเดียวให้ของพวกนั้นคือการเชิญให้
 *    เซ็นโดยไม่อ่าน ซึ่งทำให้ลายเซ็นในระบบไม่มีความหมาย
 */
export const BATCH_CERTIFIABLE_KINDS: MentorQueueKind[] = ['weekly_log', 'monthly_log', 'daily_log'];

/** ตารางและคีย์ของบันทึกแต่ละชนิด — ใช้ประกอบคิวรีตอนรับรอง */
const LOG_TABLES: Record<string, { table: string; pk: string }> = {
  weekly_log: { table: 'weekly_logs', pk: 'weekly_log_id' },
  monthly_log: { table: 'monthly_logs', pk: 'monthly_log_id' },
  daily_log: { table: 'daily_logs', pk: 'daily_log_id' },
};

export class MentorQueueModel {
  /**
   * งานทั้งหมดที่รอพี่เลี้ยงคนนี้อยู่ เรียงจากค้างนานที่สุด
   *
   * บันทึกรายวันรวมเป็นชิ้นเดียวต่อหนึ่งสัปดาห์โดยตั้งใจ — ถ้าแตกเป็นรายวัน
   * พี่เลี้ยงจะเห็นคิวยาว ~90 บรรทัดต่อนักศึกษาหนึ่งคน ซึ่งไม่มีใครไล่ไหว
   * `id` ที่ส่งออกไปคือ `daily_log_id` ของวันแรกในสัปดาห์นั้น และตอนรับรอง
   * ระบบจะขยายกลับเป็นทั้งสัปดาห์ให้เอง
   */
  static async pendingItems(mentorId: number) {
    const res = await query(
      `WITH mine AS (
         SELECT i.form_id, i.student_id, i.start_date, i.end_date,
                btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS full_name,
                s.student_code
           FROM intent_forms i
           JOIN students s ON s.student_id = i.student_id
          WHERE i.mentor_id = $1 AND i.status = 'accepted'
       )
       SELECT q.*,
              -- ⛔ นับวันด้วยนาฬิกาของ Postgres ตามเวลาไทยเสมอ ห้ามให้ Node คิดเอง
              --    (เคยมีบั๊กวันเพี้ยนจาก timezone มาแล้ว)
              ((NOW() AT TIME ZONE 'Asia/Bangkok')::date
                 - (q.submitted_at AT TIME ZONE 'Asia/Bangkok')::date) AS days_waiting,
              (q.due_date IS NOT NULL
                 AND q.due_date < (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS is_overdue
         FROM (
       SELECT 'weekly_log' AS kind, w.weekly_log_id AS id, m.student_id, m.full_name,
              'บันทึกประจำสัปดาห์ที่ ' || w.week_number || ' (สหกิจ 09)' AS label,
              w.start_date AS period_start, w.end_date AS period_end,
              w.submitted_at, NULL::date AS due_date
         FROM weekly_logs w JOIN mine m ON m.student_id = w.student_id
        WHERE w.status = 'submitted' AND w.mentor_certified_at IS NULL

       UNION ALL
       SELECT 'monthly_log', ml.monthly_log_id, m.student_id, m.full_name,
              'บันทึกประจำเดือน (สหกิจ 10)',
              ml.start_date, ml.end_date, ml.submitted_at, NULL::date
         FROM monthly_logs ml JOIN mine m ON m.student_id = ml.student_id
        WHERE ml.status = 'submitted' AND ml.mentor_certified_at IS NULL

       UNION ALL
       SELECT 'daily_log', d.first_id, m.student_id, m.full_name,
              'บันทึกรายวัน สัปดาห์ที่ ' || d.week_number || ' (สหกิจ 08) · ' || d.day_count || ' วัน',
              d.first_date, d.last_date, d.submitted_at, NULL::date
         FROM (
              SELECT student_id, week_number,
                     MIN(daily_log_id) AS first_id, COUNT(*)::int AS day_count,
                     MIN(log_date) AS first_date, MAX(log_date) AS last_date,
                     MAX(submitted_at) AS submitted_at
                FROM daily_logs
               WHERE status = 'submitted' AND mentor_certified_at IS NULL
               GROUP BY student_id, week_number
         ) d JOIN mine m ON m.student_id = d.student_id

       UNION ALL
       SELECT 'work_plan', a.approval_id, m.student_id, m.full_name,
              'แผนปฏิบัติงาน (สหกิจ 07 หน้า 3)',
              NULL::date, NULL::date, a.created_at,
              (m.start_date + 13)   -- กระดาษกำหนด "ภายในสัปดาห์ที่ 2 ของการปฏิบัติงาน"
         FROM work_plan_approvals a JOIN mine m ON m.student_id = a.student_id
        WHERE a.approver_role = 'mentor' AND a.status = 'pending'

       UNION ALL
       SELECT 'report_outline', o.outline_id, m.student_id, m.full_name,
              'โครงร่างรายงาน (สหกิจ 11)',
              NULL::date, NULL::date, o.updated_at, NULL::date
         FROM report_outlines o JOIN mine m ON m.student_id = o.student_id
        WHERE o.status = 'pending_mentor'

       UNION ALL
       SELECT 'report_draft', r.report_id, m.student_id, m.full_name,
              'ร่างรายงานฉบับสมบูรณ์ ครั้งที่ ' || r.version,
              NULL::date, NULL::date, r.submitted_at,
              (m.end_date - 14)     -- คู่มือ สหกิจ 16: ส่งให้พี่เลี้ยงอย่างน้อย 2 สัปดาห์ก่อนจบ
         FROM final_reports r JOIN mine m ON m.student_id = r.student_id
        WHERE r.reviewer_kind = 'mentor' AND r.reviewed_at IS NULL
          AND r.version = (SELECT MAX(r2.version) FROM final_reports r2
                            WHERE r2.student_id = r.student_id AND r2.reviewer_kind = 'mentor')

       ) q
       ORDER BY q.submitted_at NULLS LAST`,
      [mentorId]
    );

    return res.rows.map((r) => ({
      kind: r.kind as MentorQueueKind,
      id: Number(r.id),
      student_id: r.student_id,
      student_name: r.full_name,
      label: r.label,
      period_start: toIsoDate(r.period_start),
      period_end: toIsoDate(r.period_end),
      submitted_at: r.submitted_at,
      due_date: toIsoDate(r.due_date),
      days_waiting: r.days_waiting === null ? null : Number(r.days_waiting),
      is_overdue: r.is_overdue === true,
    }));
  }

  /** การ์ดนักศึกษารายคนบนหน้าแรกของพี่เลี้ยง */
  static async myStudents(mentorId: number) {
    const res = await query(
      `SELECT i.form_id AS intent_form_id, s.student_id, s.student_code,
              btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS full_name,
              mj.major_name_th,
              i.start_date, i.end_date, i.daily_log_required, i.uses_company_log_form,
              (i.end_date - 14) AS draft_due_date,
              -- จำนวนสัปดาห์คำนวณจากวันจริงเสมอ ⛔ ห้ามฮาร์ดโค้ด 16
              GREATEST(1, CEIL((i.end_date - i.start_date + 1) / 7.0))::int AS week_total,
              LEAST(
                GREATEST(1, CEIL((i.end_date - i.start_date + 1) / 7.0))::int,
                GREATEST(1, FLOOR(((NOW() AT TIME ZONE 'Asia/Bangkok')::date - i.start_date) / 7.0)::int + 1)
              ) AS week_current,
              (SELECT COUNT(*)::int FROM weekly_logs w
                WHERE w.student_id = s.student_id AND w.status = 'submitted') AS submitted_count,
              (SELECT COUNT(*)::int FROM weekly_logs w
                WHERE w.student_id = s.student_id AND w.mentor_certified_at IS NOT NULL) AS certified_count,
              EXISTS (SELECT 1 FROM final_evaluations e
                       WHERE e.student_id = s.student_id AND e.form_code = 'sahatkit_15') AS eval15_submitted,
              EXISTS (SELECT 1 FROM final_evaluations e
                       WHERE e.student_id = s.student_id AND e.form_code = 'sahatkit_16') AS eval16_submitted
         FROM intent_forms i
         JOIN students s ON s.student_id = i.student_id
         LEFT JOIN master_major mj ON mj.major_id = s.major_id
        WHERE i.mentor_id = $1 AND i.status = 'accepted'
        ORDER BY s.student_code`,
      [mentorId]
    );
    return res.rows.map((r) => ({
      ...r,
      start_date: toIsoDate(r.start_date),
      end_date: toIsoDate(r.end_date),
      draft_due_date: toIsoDate(r.draft_due_date),
    }));
  }

  /**
   * รับรองบันทึกหลายใบพร้อมกัน
   *
   * ⛔ ล้มทั้งชุดถ้ามีใบใดใบหนึ่งไม่ใช่ของนักศึกษาที่ผู้เรียกดูแล — ไม่ใช่ "ข้ามใบนั้น
   *    แล้วทำที่เหลือ" เพราะการเงียบ ๆ ข้ามไปคือการปิดบังว่ามีคำขอที่ไม่ควรเกิด
   *
   * คืนจำนวนใบที่รับรองจริง (บันทึกรายวันหนึ่งชิ้นในคิว = ทั้งสัปดาห์ จึงนับได้มากกว่า 1)
   */
  static async certifyBatch(
    client: { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> },
    mentorId: number,
    items: { kind: string; id: number }[]
  ): Promise<number> {
    let certified = 0;

    for (const item of items) {
      const target = LOG_TABLES[item.kind];
      if (!target) {
        throw new Error(`รับรองรวดเดียวได้เฉพาะบันทึกการปฏิบัติงานเท่านั้น (พบ: ${item.kind})`);
      }

      // ตรวจความเป็นเจ้าของก่อนเสมอ แล้วค่อยเขียน
      const owned = await client.query(
        `SELECT l.student_id FROM ${target.table} l
           JOIN intent_forms i ON i.student_id = l.student_id
          WHERE l.${target.pk} = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
        [item.id, mentorId]
      );
      if ((owned.rowCount ?? 0) === 0) {
        throw new Error('มีบันทึกที่ไม่ใช่ของนักศึกษาที่ท่านดูแลอยู่ในรายการที่เลือก');
      }

      if (item.kind === 'daily_log') {
        // ขยายกลับเป็นทั้งสัปดาห์ — พี่เลี้ยงรับรอง "สัปดาห์" ไม่ใช่ "วัน"
        const res = await client.query(
          `UPDATE daily_logs SET mentor_certified_by = $2, mentor_certified_at = NOW(), updated_at = NOW()
            WHERE status = 'submitted' AND mentor_certified_at IS NULL
              AND (student_id, week_number) = (
                    SELECT student_id, week_number FROM daily_logs WHERE daily_log_id = $1
                  )`,
          [item.id, mentorId]
        );
        certified += res.rowCount ?? 0;
      } else {
        const res = await client.query(
          `UPDATE ${target.table}
              SET mentor_certified_by = $2, mentor_certified_at = NOW(), updated_at = NOW()
            WHERE ${target.pk} = $1 AND status = 'submitted' AND mentor_certified_at IS NULL`,
          [item.id, mentorId]
        );
        certified += res.rowCount ?? 0;
      }
    }

    return certified;
  }
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return (value as Date).toISOString().slice(0, 10);
}
