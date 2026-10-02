import { query } from '../config/database';
import { AccessDeniedError, resolveMajorScope } from '../utils/access';
import { MENTOR_QUEUE_KINDS, MentorQueueKind, MentorQueueModel } from './mentorQueue';

/**
 * คณะตามพี่เลี้ยง (Phase 2) — มุมมอง "พี่เลี้ยงคนไหนมีงานค้าง" สำหรับเจ้าหน้าที่/หัวหน้าสาขา/อาจารย์
 *
 * ⛔ ไม่เขียน SQL คิวงานค้างซ้ำ — ใช้ `MentorQueueModel.pendingItems` แล้วกรองตามนักศึกษาในขอบเขต
 * ⛔ ขอบเขต fail closed (SEC-06): หัวหน้าสาขาไม่มีโปรไฟล์ = 403 · บทบาทอื่นนอกสามบทบาท = 403
 *    · ผู้ใช้หลายบทบาทได้ขอบเขตกว้างสุดตามลำดับ staff > dept_head > advisor
 * ⛔ "การจัดวาง (placement)" = `intent_forms` สถานะ 'accepted' ที่มี mentor_id — ที่เดียวกับที่ MentorQueueModel ใช้
 */

/**
 * เฟส 3 "เตือนอัตโนมัติ" — กติกาอยู่ที่นี่ที่เดียว (utils/mentorAutoRemind.ts re-export ให้)
 * ⛔ ประกาศที่โมเดลไม่ใช่ที่ util เพราะ util import โมเดลนี้อยู่แล้ว — กลับกันจะเป็นวงกลม
 */
export const AUTO_REMIND_AFTER_DAYS = 5; // งานรอ ≥ กี่วันถึงเข้าเกณฑ์เตือน
export const AUTO_REMIND_EVERY_DAYS = 7; // เตือนซ้ำห่างกันอย่างน้อยกี่วัน (นับทุกชนิดการเตือน)
export const AUTO_REMIND_MAX = 4; // เตือนอัตโนมัติได้กี่ครั้งต่อ "รอบ" (รอบ = นับจากครั้งล่าสุดที่พี่เลี้ยงใช้ลิงก์เข้าระบบ)

export type FollowupScope =
  | { kind: 'staff' }
  | { kind: 'dept_head'; majorId: number }
  | { kind: 'advisor'; userId: number };

export interface FollowupPlacement {
  mentor_id: number;
  student_id: number;
  student_name: string;
}

export interface FollowupMentorRow {
  mentor_id: number;
  name: string;
  email: string;
  company_name: string | null;
  is_active: boolean;
  student_count: number;
  students: { student_id: number; student_name: string }[];
  pending_total: number;
  pending_overdue: number;
  oldest_days_waiting: number | null;
  pending_by_kind: Record<MentorQueueKind, number>;
  eval_missing_students: number;
  last_reminded_at: string | null;
  reminder_count: number;
  last_login_at: string | null;
  /** เฟส 3: เตือนอัตโนมัติไปกี่ครั้งในรอบปัจจุบัน (นับตั้งแต่ลิงก์ที่พี่เลี้ยงใช้ล่าสุด) */
  auto_reminder_count: number;
  /** เฟส 3: เตือนอัตโนมัติครบเพดานแล้วแต่ยังมีงานค้างเข้าเกณฑ์ — คนนี้ต้องให้เจ้าหน้าที่ตามเอง */
  silent_after_max: boolean;
}

const toIso = (v: unknown): string | null => {
  if (!v) return null;
  return (v instanceof Date ? v : new Date(v as string)).toISOString();
};

export class MentorFollowupModel {
  /**
   * บทบาทของผู้เรียก → ขอบเขตที่เห็นพี่เลี้ยงได้ · โยน AccessDeniedError เมื่อไม่มีสิทธิ์/ไม่มีโปรไฟล์
   */
  static async resolveScope(userId: number, roles: string[]): Promise<FollowupScope> {
    if (roles.includes('staff')) return { kind: 'staff' };

    if (roles.includes('dept_head')) {
      // ส่งเฉพาะ 'dept_head' — ไม่งั้น `resolveMajorScope` เห็น 'dean' แล้วคืน "ไม่จำกัดสาขา" ให้ผู้ใช้สองบทบาท
      const { majorId } = await resolveMajorScope(userId, ['dept_head']);
      if (majorId === null) {
        throw new AccessDeniedError('ไม่พบข้อมูลสาขาวิชาที่ท่านสังกัด กรุณาติดต่อเจ้าหน้าที่เพื่อตั้งค่าโปรไฟล์บุคลากรก่อนใช้งาน');
      }
      return { kind: 'dept_head', majorId };
    }

    if (roles.includes('advisor')) return { kind: 'advisor', userId };

    throw new AccessDeniedError('Forbidden. You do not have access to this resource.');
  }

  /** นักศึกษาที่ฝึกงานอยู่กับพี่เลี้ยง (ในขอบเขตของผู้เรียก) — ใส่ `mentorId` เพื่อจำกัดเหลือพี่เลี้ยงคนเดียว */
  static async placementsInScope(scope: FollowupScope, mentorId?: number): Promise<FollowupPlacement[]> {
    const params: unknown[] = [];
    let scopeSql = '';
    if (scope.kind === 'dept_head') {
      params.push(scope.majorId);
      scopeSql = ` AND s.major_id = $${params.length}`;
    } else if (scope.kind === 'advisor') {
      params.push(scope.userId);
      scopeSql = ` AND (s.advisor_id = $${params.length} OR s.supervisor_id = $${params.length})`;
    }
    let mentorSql = '';
    if (mentorId !== undefined) {
      params.push(mentorId);
      mentorSql = ` AND i.mentor_id = $${params.length}`;
    }

    const res = await query(
      `SELECT DISTINCT i.mentor_id, s.student_id,
              btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS student_name
         FROM intent_forms i
         JOIN students s ON s.student_id = i.student_id
        WHERE i.status = 'accepted' AND i.mentor_id IS NOT NULL${scopeSql}${mentorSql}`,
      params
    );
    return res.rows.map((r) => ({
      mentor_id: Number(r.mentor_id),
      student_id: Number(r.student_id),
      student_name: r.student_name as string,
    }));
  }

  /**
   * นักศึกษาที่ส่งเล่มรายงาน (ฉบับของอาจารย์ reviewer_kind='advisor' — แบบเดียวกับที่อีเมลแจ้งประเมินใช้)
   * แล้วแต่พี่เลี้ยงยังกรอก สหกิจ 15 หรือ 16 ไม่ครบ
   */
  static async evalMissingStudentIds(studentIds: number[]): Promise<Set<number>> {
    if (studentIds.length === 0) return new Set();
    const res = await query(
      `SELECT s.student_id
         FROM students s
        WHERE s.student_id = ANY($1::int[])
          AND EXISTS (SELECT 1 FROM final_reports r
                       WHERE r.student_id = s.student_id AND r.reviewer_kind = 'advisor')
          AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
                WHERE e.student_id = s.student_id AND e.evaluator_role = 'mentor'
                  AND e.form_code IN ('sahatkit_15', 'sahatkit_16')) < 2`,
      [studentIds]
    );
    return new Set(res.rows.map((r) => Number(r.student_id)));
  }

  /** รายการพี่เลี้ยงสำหรับหน้า "คณะตามพี่เลี้ยง" — หนึ่งแถวต่อพี่เลี้ยง นับเฉพาะนักศึกษาในขอบเขต */
  static async list(scope: FollowupScope): Promise<FollowupMentorRow[]> {
    const placements = await MentorFollowupModel.placementsInScope(scope);
    if (placements.length === 0) return [];

    const byMentor = new Map<number, FollowupPlacement[]>();
    for (const p of placements) {
      const list = byMentor.get(p.mentor_id) ?? [];
      list.push(p);
      byMentor.set(p.mentor_id, list);
    }
    const mentorIds = [...byMentor.keys()];

    const infoRes = await query(
      `SELECT m.mentor_id, m.name, u.email, u.is_active, c.name_th AS company_name,
              (SELECT COUNT(*)::int FROM mentor_reminders r WHERE r.mentor_id = m.mentor_id) AS reminder_count,
              (SELECT MAX(r.created_at) FROM mentor_reminders r WHERE r.mentor_id = m.mentor_id) AS last_reminded_at,
              (SELECT MAX(t.used_at) FROM mentor_login_tokens t WHERE t.user_id = m.mentor_id) AS last_login_at
         FROM mentors m
         JOIN users u ON u.user_id = m.mentor_id
         LEFT JOIN companies c ON c.company_id = m.company_id
        WHERE m.mentor_id = ANY($1::int[])`,
      [mentorIds]
    );

    const missing = await MentorFollowupModel.evalMissingStudentIds([...new Set(placements.map((p) => p.student_id))]);
    const autoCounts = await MentorFollowupModel.autoCycleCounts(mentorIds);

    const rows = await Promise.all(
      infoRes.rows.map(async (info): Promise<FollowupMentorRow> => {
        const mentorId = Number(info.mentor_id);
        const mine = (byMentor.get(mentorId) ?? []).sort((a, b) => a.student_name.localeCompare(b.student_name, 'th'));
        const inScope = new Set(mine.map((p) => p.student_id));

        const allItems = await MentorQueueModel.pendingItems(mentorId);
        const items = allItems.filter((it) => inScope.has(Number(it.student_id)));
        const autoCount = autoCounts.get(mentorId) ?? 0;
        // "ยังเข้าเกณฑ์" คิดจากคิวทั้งหมดของพี่เลี้ยง ไม่ใช่เฉพาะนักศึกษาในขอบเขตของผู้ดู — ทุกคนต้องเห็นธงตรงกัน
        let silent = false;
        if (autoCount >= AUTO_REMIND_MAX) {
          const wait = await MentorFollowupModel.autoTriggerWait(mentorId, allItems);
          silent = wait !== null && wait >= AUTO_REMIND_AFTER_DAYS;
        }
        const byKind = Object.fromEntries(MENTOR_QUEUE_KINDS.map((k) => [k, 0])) as Record<MentorQueueKind, number>;
        let oldest: number | null = null;
        for (const it of items) {
          byKind[it.kind] += 1;
          if (it.days_waiting !== null && (oldest === null || it.days_waiting > oldest)) oldest = it.days_waiting;
        }

        return {
          mentor_id: mentorId,
          name: info.name,
          email: info.email,
          company_name: info.company_name ?? null,
          is_active: info.is_active === true,
          student_count: mine.length,
          students: mine.map((p) => ({ student_id: p.student_id, student_name: p.student_name })),
          pending_total: items.length,
          pending_overdue: items.filter((it) => it.is_overdue).length,
          oldest_days_waiting: oldest,
          pending_by_kind: byKind,
          eval_missing_students: mine.filter((p) => missing.has(p.student_id)).length,
          last_reminded_at: toIso(info.last_reminded_at),
          reminder_count: Number(info.reminder_count),
          last_login_at: toIso(info.last_login_at),
          auto_reminder_count: autoCount,
          silent_after_max: silent,
        };
      })
    );

    return rows.sort(
      (a, b) =>
        b.pending_overdue - a.pending_overdue ||
        b.pending_total - a.pending_total ||
        String(a.name).localeCompare(String(b.name), 'th')
    );
  }

  /**
   * งานค้างทั้งหมดของพี่เลี้ยงคนนี้ (ไม่จำกัดขอบเขต — เป็นงานของพี่เลี้ยงเอง) ไว้ประกอบอีเมลเตือน
   * `evalMissingStudents` นับจากนักศึกษาทุกคนที่ผูกกับพี่เลี้ยง
   */
  static async fullSummary(mentorId: number) {
    const items = await MentorQueueModel.pendingItems(mentorId);
    const byKind: Record<string, number> = Object.fromEntries(MENTOR_QUEUE_KINDS.map((k) => [k, 0]));
    for (const it of items) byKind[it.kind] += 1;

    const all = await MentorFollowupModel.placementsInScope({ kind: 'staff' }, mentorId);
    const missing = await MentorFollowupModel.evalMissingStudentIds(all.map((p) => p.student_id));

    return {
      byKind,
      evalMissingStudents: missing.size,
      items: items.map((it) => ({ studentName: it.student_name, label: it.label })),
    };
  }

  /**
   * จำนวนครั้งที่เตือนอัตโนมัติในรอบปัจจุบันของพี่เลี้ยงแต่ละคน
   * รอบ = นับจากครั้งล่าสุดที่พี่เลี้ยง "ใช้" ลิงก์เข้าระบบ (`mentor_login_tokens.used_at`) · ไม่เคยใช้ = นับตั้งแต่ต้น
   * พี่เลี้ยงที่ไม่มีแถวเตือนเลยไม่อยู่ใน Map (ผู้เรียกใช้ `?? 0`)
   */
  static async autoCycleCounts(mentorIds: number[]): Promise<Map<number, number>> {
    if (mentorIds.length === 0) return new Map();
    const res = await query(
      `SELECT r.mentor_id, COUNT(*)::int AS n
         FROM mentor_reminders r
        WHERE r.mentor_id = ANY($1::int[]) AND r.kind = 'auto'
          AND r.created_at > COALESCE(
                (SELECT MAX(t.used_at) FROM mentor_login_tokens t WHERE t.user_id = r.mentor_id),
                '-infinity'::timestamptz)
        GROUP BY r.mentor_id`,
      [mentorIds]
    );
    return new Map(res.rows.map((r) => [Number(r.mentor_id), Number(r.n)]));
  }

  /**
   * ที่รอนานที่สุดของพี่เลี้ยง (จำนวนวัน) ที่เข้าเกณฑ์เตือนอัตโนมัติ — null = ไม่มีงานค้างเลย
   *  (ก) งานในคิวที่ค้างนานสุด (`days_waiting` ของ pendingItems) หรือ
   *  (ข) นักศึกษาที่ส่งเล่มรายงานฉบับของอาจารย์แล้วแต่พี่เลี้ยงยังกรอก สหกิจ 15/16 ไม่ครบ — นับจากวันที่ส่งเล่มครั้งแรก
   * ⛔ นับวันที่ Postgres ตามเวลาไทย ไม่ใช่นาฬิกา Node · ผู้เรียกที่โหลดคิวมาแล้วส่ง `items` มาเพื่อไม่ต้องคิวรีซ้ำ
   */
  static async autoTriggerWait(
    mentorId: number,
    items?: { days_waiting: number | null }[]
  ): Promise<number | null> {
    const queue = items ?? (await MentorQueueModel.pendingItems(mentorId));
    let oldest: number | null = null;
    for (const it of queue) {
      if (it.days_waiting !== null && (oldest === null || it.days_waiting > oldest)) oldest = it.days_waiting;
    }

    const res = await query(
      `SELECT MAX((NOW() AT TIME ZONE 'Asia/Bangkok')::date - (f.first_at AT TIME ZONE 'Asia/Bangkok')::date) AS days
         FROM (SELECT DISTINCT i.student_id FROM intent_forms i
                WHERE i.mentor_id = $1 AND i.status = 'accepted') p
         JOIN LATERAL (SELECT MIN(r.submitted_at) AS first_at FROM final_reports r
                        WHERE r.student_id = p.student_id AND r.reviewer_kind = 'advisor') f
           ON f.first_at IS NOT NULL
        WHERE (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
                WHERE e.student_id = p.student_id AND e.evaluator_role = 'mentor'
                  AND e.form_code IN ('sahatkit_15', 'sahatkit_16')) < 2`,
      [mentorId]
    );
    const evalWait = res.rows[0]?.days === null || res.rows[0]?.days === undefined ? null : Number(res.rows[0].days);
    if (evalWait !== null && (oldest === null || evalWait > oldest)) oldest = evalWait;
    return oldest;
  }

  /** เตือนล่าสุดภายใน 24 ชม. หรือไม่ (ทุกชนิด) */
  static async remindedWithin24h(mentorId: number): Promise<boolean> {
    const res = await query(
      `SELECT 1 FROM mentor_reminders
        WHERE mentor_id = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [mentorId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * จองสิทธิ์เตือนหนึ่งครั้ง — INSERT เงื่อนไข cooldown เดียวกันในคำสั่งเดียว (กันสองคำขอซ้อนที่ผ่านด่านอ่านพร้อมกัน)
   * คืน null = มีคนเตือนไปแล้วภายใน 24 ชม. · ผู้เรียกต้อง `releaseReminder` ถ้าส่งเมลไม่สำเร็จ
   * (READ COMMITTED ไม่ serialize สองคำสั่งที่เริ่มพร้อมกันเป๊ะ — ช่องแคบมาก ผลคือเมลเตือนซ้ำหนึ่งฉบับ ไม่ใช่การข้ามด่านสิทธิ์)
   *
   * เฟส 3: `kind: 'auto'` + `sentBy: null` + `spacingHours` กว้างขึ้น (7 วัน) สำหรับระบบเตือนเอง · ค่าเริ่มต้น = ปุ่มของเจ้าหน้าที่ (summary · 24 ชม.)
   * ⛔ ด่านห่างกัน "นับทุกชนิด" เสมอ — ระบบไม่เตือนซ้ำทับที่คนเพิ่งกดเตือน และกลับกัน
   */
  static async claimReminder(
    mentorId: number,
    sentBy: number | null,
    opts: { kind?: 'summary' | 'auto'; spacingHours?: number } = {}
  ): Promise<{ reminderId: number; createdAt: Date } | null> {
    const res = await query(
      `INSERT INTO mentor_reminders (mentor_id, kind, sent_by)
       SELECT $1::int, $2::varchar, $3::int
        WHERE NOT EXISTS (
                SELECT 1 FROM mentor_reminders r
                 WHERE r.mentor_id = $1::int AND r.created_at > NOW() - ($4::int * INTERVAL '1 hour')
              )
       RETURNING reminder_id, created_at`,
      [mentorId, opts.kind ?? 'summary', sentBy, opts.spacingHours ?? 24]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return { reminderId: Number(res.rows[0].reminder_id), createdAt: res.rows[0].created_at as Date };
  }

  static async releaseReminder(reminderId: number): Promise<void> {
    await query(`DELETE FROM mentor_reminders WHERE reminder_id = $1`, [reminderId]);
  }

  static async reminderStats(mentorId: number): Promise<{ count: number; last_at: string | null }> {
    const res = await query(
      `SELECT COUNT(*)::int AS count, MAX(created_at) AS last_at FROM mentor_reminders WHERE mentor_id = $1`,
      [mentorId]
    );
    return { count: Number(res.rows[0].count), last_at: toIso(res.rows[0].last_at) };
  }
}
