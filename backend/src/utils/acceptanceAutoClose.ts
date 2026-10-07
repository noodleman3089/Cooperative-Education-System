import pool, { query } from '../config/database';
import { isCalendarClosed } from '../middlewares/calendarGate';
import { AuditAction, writeAudit } from './audit';
import { notifyStudentStatusChange } from './email';
import { recordStageEvent } from './stageEvents';

/**
 * ปิดใบคำร้องที่บริษัทไม่ตอบจนพ้นปฏิทินคณะ — เรียกจาก `runAutoDeactivation` (ตอนสตาร์ท + ทุก 24 ชม.)
 *
 * ปิดเฉพาะใบที่ครบสามข้อ:
 *   · `status = 'approved_by_dept_head'` และ `acceptance_due_date IS NOT NULL` (คณบดีลงนามแล้ว รอแบบตอบรับ)
 *   · ปฏิทิน `acceptance_form` ของ **ภาคของใบ** เป็น `closed` (พ้นช่วงผ่อนผันด้วย)
 * ⛔ ไม่ปิด: ใบที่ยังรอคณบดี · `pending_officer_approval` (คำตอบมาถึงแล้ว) · ภาคที่ปฏิทินไม่ได้ตั้ง · ช่วงผ่อนผัน
 *    — ปฏิทินเป็นเรื่องกำหนดการ ไม่รู้ = ไม่ทำ (fail-open แบบเดียวกับ `calendarGate`)
 * ⛔ ไม่ปิดที่ ๑๕ วันทำการ — ระบบนับวันทำการข้ามแค่เสาร์-อาทิตย์ ไม่รู้จักวันหยุดนักขัตฤกษ์ (`workingDays.ts`)
 *    กำหนดนั้นทำให้ลิงก์ตายอย่างเดียว ใบยังรับกระดาษจากนักศึกษาได้จนพ้นปฏิทิน
 *
 * ไม่เพิ่มสถานะใหม่: ใบเป็น `rejected` + `reject_reason` ประโยคตายตัวข้างล่าง
 * (`rejected` ที่ไม่มีเหตุผล = นักศึกษาแจ้งเองว่าไม่ได้ที่ฝึก — `IntentFormModel.failByStudent`)
 */

export const AUTO_CLOSE_REASON =
  'ระบบปิดคำร้องนี้ เพราะพ้นกำหนดส่งแบบตอบรับตามปฏิทินสหกิจศึกษาแล้วโดยยังไม่มีแบบตอบรับ';

/** ปิดหนึ่งใบในทรานแซกชันของตัวเอง — คืน false ถ้าใบเปลี่ยนไปแล้วระหว่างทาง (เช่น บริษัทเพิ่งตอบ) */
async function closeOne(formId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ล็อกแถวก่อน แล้วเช็คสถานะซ้ำใต้ล็อก — ระหว่างคัดรายชื่อกับตรงนี้ใบอาจได้คำตอบไปแล้ว
    const locked = await client.query(
      `SELECT student_id, status, acceptance_due_date FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
      [formId]
    );
    const row = locked.rows[0];
    if (!row || row.status !== 'approved_by_dept_head' || !row.acceptance_due_date) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(`UPDATE intent_forms SET status = 'rejected', reject_reason = $2 WHERE form_id = $1`, [
      formId,
      AUTO_CLOSE_REASON,
    ]);
    await recordStageEvent(client, formId, 'exited');
    await writeAudit(
      {
        action: AuditAction.INTENT_AUTO_CLOSED,
        entityType: 'intent_form',
        entityId: formId,
        subjectId: row.student_id,
        detail: { reason: 'acceptance_calendar_closed' },
      },
      undefined,
      client
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

/** คืนจำนวนใบที่ปิดในรอบนี้ */
export async function runAcceptanceAutoClose(): Promise<number> {
  const candidates = await query(
    `SELECT form_id, semester_id FROM intent_forms
      WHERE status = 'approved_by_dept_head' AND acceptance_due_date IS NOT NULL
      ORDER BY form_id`
  );

  const closedBySemester = new Map<number, boolean>();
  let closed = 0;
  for (const { form_id, semester_id } of candidates.rows as { form_id: number; semester_id: number }[]) {
    if (!closedBySemester.has(semester_id)) {
      closedBySemester.set(semester_id, await isCalendarClosed('acceptance_form', semester_id));
    }
    if (!closedBySemester.get(semester_id)) continue;

    try {
      if (!(await closeOne(form_id))) continue;
      closed += 1;
      // หลัง COMMIT เท่านั้น — อีเมลล้มไม่ย้อนการปิดใบ (ฟังก์ชันนี้กลืน error ของ SMTP เองอยู่แล้ว)
      await notifyStudentStatusChange(form_id, 'auto_closed');
    } catch (error) {
      // ใบเดียวพังต้องไม่หยุดทั้งรอบ — รอบถัดไป (24 ชม.) ลองใหม่
      console.error(`[AcceptanceAutoClose] Failed to close intent ${form_id}:`, error);
    }
  }
  return closed;
}
