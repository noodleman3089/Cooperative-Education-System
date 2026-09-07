import { Request, Response } from 'express';
import { query } from '../config/database';
import { CoopCalendarModel } from '../models/coopCalendar';
import { calendarStatus } from '../utils/coopCalendar';
import { formatThaiDate } from '../utils/thaiDate';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import {
  EVALUATION_FORMS,
  FORM_LABEL,
  isFormCode,
  validateEvaluationPayload,
} from '../config/evaluationRubric';

/**
 * แบบประเมินสองใบของพนักงานที่ปรึกษา (พี่เลี้ยง)
 *
 *   สหกิจ 15 — แบบประเมินผลนักศึกษา 18 ข้อ เต็ม 100 → ใช้ตัดเกรด
 *   สหกิจ 16 — แบบประเมินรายงาน 14 ข้อ ระดับ 1-5 เต็ม 70 → เรตติ้ง ไม่รวมเกรด
 *
 * ทั้งสองใบเป็นของพี่เลี้ยงตามที่แบบฟอร์มจริงระบุ (`เอกสาร/ข้อมูล ขั้นตอนเอกสาร.txt:166`
 * เขียนไว้ตรงๆ ว่าผู้ให้ข้อมูลของ สหกิจ 16 คือ "พนักงานที่ปรึกษา (Job Supervisor)")
 * — เดิมระบบเอา สหกิจ 16 ไปให้อาจารย์ทำด้วย rubric 10 ข้อที่คิดขึ้นเอง
 *
 * **นักศึกษาดูผลของตัวเองได้ — แต่หลังสิ้นสุดช่วงปฏิบัติงานเท่านั้น** (`getMyResult`)
 *
 * บนกระดาษสองใบนี้ใส่ซองปิดผนึกประทับตรา "ลับ" (`เอกสาร/ข้อมูล ขั้นตอนเอกสาร.txt:158,167`)
 * เจตนาของซองคือกันนักศึกษาแก้คะแนนระหว่างถือซองมาส่งมหาวิทยาลัย ซึ่งในระบบนี้
 * พี่เลี้ยงกรอกเข้าฐานข้อมูลตรงๆ นักศึกษาแก้ไม่ได้อยู่แล้ว — เจตนาเดิมจึงถูกรักษาไว้
 * ด้วยกลไกอื่น (บรรทัดฐานเดียวกับ SEC-09) เจ้าของเคาะเรื่องนี้เมื่อ 2026-08-26
 *
 * ⛔ ที่ยังห้ามคือ **การเห็นคะแนนระหว่างยังปฏิบัติงานอยู่** เพราะพี่เลี้ยงกับนักศึกษา
 * ยังทำงานด้วยกันทุกวัน `getMyResult` จึงเปิดเผยเฉพาะเมื่อพ้นช่วงแล้วเท่านั้น
 */

export class FinalEvaluationController {
  /**
   * บันทึกแบบประเมินหนึ่งใบ
   * Route: POST /api/final-evaluations
   * Access: mentor เท่านั้น
   */
  static async submitEvaluation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { studentId, formCode, scoresDetail } = req.body;
      const targetStudentId = parseInt(studentId, 10);

      if (isNaN(targetStudentId) || !isFormCode(formCode)) {
        res.status(400).json({ message: 'ข้อมูลประเมินไม่ถูกต้อง' });
        return;
      }

      const evaluatorId = req.user.userId;

      // อาจารย์ประเมินไม่ได้อีกแล้ว — ไม่มีแบบฟอร์มไหนในชุด 01-16 ที่อาจารย์
      // เป็นผู้ประเมินผลนักศึกษาหรือเล่มรายงาน (ของอาจารย์คือ สหกิจ 13 บันทึกการนิเทศ)
      if (!req.user.roles.includes('mentor')) {
        res.status(403).json({ message: 'คุณไม่มีสิทธิ์ในการส่งประเมินผล' });
        return;
      }

      const mentorCheck = await query(
        `SELECT mentor_id FROM intent_forms
          WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted'`,
        [targetStudentId, evaluatorId]
      );
      if ((mentorCheck.rowCount ?? 0) === 0) {
        res
          .status(403)
          .json({ message: 'คุณไม่ได้รับมอบหมายให้เป็นพี่เลี้ยงสำหรับนักศึกษาคนนี้' });
        return;
      }

      const form = EVALUATION_FORMS[formCode];
      const checked = validateEvaluationPayload(form, scoresDetail);
      if (!checked.ok) {
        res.status(400).json({ message: checked.message });
        return;
      }

      await query(
        `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
         VALUES ($1, 'mentor', $2, $3, $4)
         ON CONFLICT (student_id, evaluator_role, form_code)
         DO UPDATE SET scores_detail = EXCLUDED.scores_detail,
                       total_score   = EXCLUDED.total_score,
                       submitted_at  = CURRENT_TIMESTAMP`,
        [targetStudentId, formCode, JSON.stringify(scoresDetail), checked.total]
      );

      writeAudit(
        {
          action: AuditAction.EVALUATION_SUBMITTED,
          entityType: 'final_evaluation',
          entityId: `${targetStudentId}:${formCode}`,
          subjectId: targetStudentId,
          detail: { form_code: formCode, total_score: checked.total },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: `บันทึกแบบประเมิน ${FORM_LABEL[formCode]} เรียบร้อยแล้ว`,
        data: { form_code: formCode, total_score: checked.total, max_total: form.maxTotal },
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Submit Evaluation Error',
        'เกิดข้อผิดพลาดขณะบันทึกแบบประเมิน'
      );
    }
  }

  /**
   * รายชื่อนักศึกษาบนหน้าจอประเมิน
   * Route: GET /api/final-evaluations/my-students
   * Access: mentor (ของตัวเอง ให้คะแนนได้) · company (ทั้งบริษัท อ่านอย่างเดียว)
   *
   * บัญชีบริษัทกับพี่เลี้ยงเป็นคนละบัญชี (SEC-03 ปฏิเสธการแปะ role `mentor` ทับ
   * บัญชีที่มีอยู่) ฝ่ายบุคคลจึงได้แค่ดูว่าใครถูกประเมินแล้ว — `canEvaluate` บอกว่า
   * กำลังเสิร์ฟใคร ส่วนการให้คะแนนถูกกันไว้ที่ `submitEvaluation` อีกชั้น
   */
  static async getMyStudents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const userId = req.user.userId;
      const { roles } = req.user;

      const isMentor = roles.includes('mentor');
      const isCompanyRep = roles.includes('company');

      if (!isMentor && !isCompanyRep) {
        res.status(403).json({
          message: 'Forbidden. Only mentors and company representatives can access this list.',
        });
        return;
      }

      const scopeClause = isMentor
        ? 'i.mentor_id = $1'
        : 'i.company_id = (SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1)';

      const studentsRes = await query(
        `SELECT
          s.student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          m.major_name_th,
          c.name_th as company_name,
          men.name as mentor_name,
          eval15.total_score as sahatkit15_score,
          eval16.total_score as sahatkit16_score,
          fr.status as final_report_status,
          fr.file_path as final_report_path
         FROM intent_forms i
         JOIN students s ON i.student_id = s.student_id
         JOIN master_major m ON s.major_id = m.major_id
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN mentors men ON i.mentor_id = men.mentor_id
         LEFT JOIN final_reports fr ON s.student_id = fr.student_id AND fr.version = (
             SELECT COALESCE(MAX(version), 1) FROM final_reports WHERE student_id = s.student_id
         )
         LEFT JOIN final_evaluations eval15 ON s.student_id = eval15.student_id
              AND eval15.evaluator_role = 'mentor' AND eval15.form_code = 'sahatkit_15'
         LEFT JOIN final_evaluations eval16 ON s.student_id = eval16.student_id
              AND eval16.evaluator_role = 'mentor' AND eval16.form_code = 'sahatkit_16'
         WHERE ${scopeClause} AND i.status = 'accepted'`,
        [userId]
      );

      res.status(200).json({
        success: true,
        canEvaluate: isMentor,
        data: studentsRes.rows,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Get Mentor Students Error',
        'An internal server error occurred.'
      );
    }
  }

  /**
   * ผลประเมินของนักศึกษาเอง
   * Route: GET /api/final-evaluations/my-result
   * Access: student เท่านั้น
   *
   * ⛔ ไม่มีพารามิเตอร์ให้ระบุนักศึกษาโดยตั้งใจ — `students.student_id` เป็น PK
   * เดียวกับ `users.user_id` อยู่แล้ว การอ่าน id จาก token จึงไม่มีทางชี้ไปที่คนอื่น
   * ได้เลย ไม่ต้องมีชั้นตรวจสิทธิ์เพิ่ม และไม่มีช่องให้ลองสุ่ม id (SEC-06)
   */
  static async getMyResult(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      if (!req.user.roles.includes('student')) {
        res.status(403).json({ message: 'หน้านี้สำหรับนักศึกษาเท่านั้น' });
        return;
      }

      const studentId = req.user.userId;

      // ไม่มีแถวใน students = ยังไม่กรอกประวัติ → ปฏิเสธ ไม่ใช่คืนผลว่างเปล่า (SEC-06)
      const profile = await query(`SELECT student_id FROM students WHERE student_id = $1`, [
        studentId,
      ]);
      if ((profile.rowCount ?? 0) === 0) {
        res.status(403).json({
          message: 'ยังไม่มีข้อมูลประวัตินักศึกษาในระบบ กรุณากรอกประวัติให้ครบก่อน',
        });
        return;
      }

      // ⚠️ ด่านนี้ **fail-closed** ซึ่งตรงข้ามกับ middlewares/calendarGate.ts โดยตั้งใจ
      //
      //   calendarGate เป็นเรื่อง *กำหนดการทำรายการ* — ไม่ได้ตั้งช่วง = ยังไม่มีกฎ = ผ่าน
      //                 เพราะเดาผิดคือปิดระบบใส่นักศึกษาทั้งรุ่น
      //   ตัวนี้เป็นเรื่อง *การเปิดเผยคะแนนลับ* — ไม่รู้ว่าจบช่วงหรือยัง = ยังไม่เปิด
      //                 เพราะเดาผิดคือนักศึกษาเห็นคะแนนขณะยังนั่งทำงานกับพี่เลี้ยงอยู่
      //
      // ใช้ `coop_end` = "วันสิ้นสุดการปฏิบัติงาน" ซึ่งเป็นแถวจริงบนปฏิทินคณะ
      // (แถว 9) · ก่อน 2026-09-04 ตรงนี้ยืมช่วง `weekly_log` มาใช้แทน เพราะตอนนั้น
      // ยังไม่มีคีย์ของวันสิ้นสุดจริงๆ — ตอนนี้มีแล้วจึงเลิกใช้ตัวแทน
      // ⛔ **ห้ามส่ง late_end_date เข้า calendarStatus ตรงนี้** — ช่วงผ่อนผันเป็นเรื่อง
      //   ของการ "ส่งงานช้า" ไม่ใช่การยืดเวลาปกปิดคะแนน และด่านนี้ fail-closed
      const window = await CoopCalendarModel.findActiveWindow('coop_end');
      const status = window
        ? calendarStatus(window.today, window.start_date, window.end_date)
        : 'not_configured';

      // Fetch student intent (start_date, end_date, mentor name, company name)
      const intentRes = await query(
        `SELECT i.start_date, i.end_date, m.name as mentor_name, c.name_th as company_name
         FROM intent_forms i
         LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
         LEFT JOIN companies c ON i.company_id = c.company_id
         WHERE i.student_id = $1 AND i.status = 'accepted'
         ORDER BY i.form_id DESC LIMIT 1`,
        [studentId]
      );
      const intent = intentRes.rows[0] || null;

      if (status !== 'closed') {
        const message =
          status === 'not_configured' || !window?.end_date
            ? 'ระบบจะเปิดให้ดูผลประเมินหลังสิ้นสุดช่วงปฏิบัติงานตามปฏิทินสหกิจศึกษา — ตอนนี้เจ้าหน้าที่ยังไม่ได้ตั้ง "วันสิ้นสุดการปฏิบัติงาน" ไว้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา'
            : `ผลประเมินจะเปิดให้ดูหลังสิ้นสุดช่วงปฏิบัติงาน คือหลังวันที่ ${formatThaiDate(
                window.end_date
              )} ตามปฏิทินสหกิจศึกษา`;
        res.status(403).json({
          message,
          data: {
            is_open: false,
            end_date: intent?.end_date || null,
            start_date: intent?.start_date || null,
            mentor_name: intent?.mentor_name || null,
            company_name: intent?.company_name || null,
          }
        });
        return;
      }

      const evalRes = await query(
        `SELECT form_code, scores_detail, total_score, submitted_at
           FROM final_evaluations
          WHERE student_id = $1 AND evaluator_role = 'mentor'`,
        [studentId]
      );

      const byForm: Record<string, unknown> = {};
      for (const row of evalRes.rows) {
        const formCode: unknown = row.form_code;
        // แถวที่ form_code ไม่รู้จักถูกข้ามทิ้ง ไม่ใช่ส่งออกไปพร้อม max_total = null
        // เพราะหน้าจอคิดเปอร์เซ็นต์จากตัวหารนั้น — ตัวหารว่างจะกลายเป็นคะแนนที่โกหก
        if (!isFormCode(formCode)) continue;
        byForm[formCode] = {
          form_code: formCode,
          scores_detail: row.scores_detail ?? {},
          // total_score เป็น NUMERIC ซึ่ง `pg` คืนมาเป็นสตริง ("100.00") — ส่งดิบไป
          // หน้าจอจะพิมพ์ "100.00 / 100" ให้นักศึกษาอ่าน
          total_score: row.total_score === null ? null : Number(row.total_score),
          max_total: EVALUATION_FORMS[formCode].maxTotal,
          submitted_at: row.submitted_at,
        };
      }

      res.status(200).json({
        success: true,
        data: {
          is_open: true,
          end_date: intent?.end_date || null,
          start_date: intent?.start_date || null,
          mentor_name: intent?.mentor_name || null,
          company_name: intent?.company_name || null,
          sahatkit_15: byForm.sahatkit_15 ?? null,
          sahatkit_16: byForm.sahatkit_16 ?? null,
        },
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Get My Evaluation Result Error',
        'เกิดข้อผิดพลาดขณะดึงผลประเมิน'
      );
    }
  }
}
