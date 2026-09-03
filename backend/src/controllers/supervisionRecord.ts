import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';
import { AuditAction, writeAudit } from '../utils/audit';
import {
  ALL_ITEM_KEYS,
  COMPANY_SECTION,
  DOCUMENT_KEYS,
  REQUIRED_DOCUMENT_ITEMS,
  STUDENT_SECTION,
  SUPERVISION_SCALE_LABELS,
  SUPERVISION_VISITS,
  validateSupervisionScores,
} from '../config/supervisionRubric';

/**
 * สหกิจ 13 — แบบบันทึกการนิเทศงาน (อาจารย์นิเทศเป็นผู้กรอก) · **ระบบล้วน ไม่มีปุ่มพิมพ์**
 *
 * เจ้าของเคาะ 2026-09-02: *"ระบบมันก็เหมือนซองปิดผนึกลับอยู่แล้ว"* และคู่มือหน้า 51
 * ข้อ 8 ระบุว่า **คณะเป็นคนปริ้นเอกสาร 13 และ 15 ให้นักศึกษาเอง** ระบบจึงไม่ต้องมีปุ่ม
 *
 * ⛔ **ลายเซ็น 3 คนบนกระดาษแทนด้วย "อาจารย์นิเทศกดส่งคนเดียว"** (เจ้าของเคาะ 2026-09-03)
 * ตัวบันทึกเก็บ `supervisor_id` + `submitted_at` และลง `audit_log` ซึ่งตามย้อนได้ดีกว่า
 * ลายเซ็น · **ไม่มี flow รอพี่เลี้ยง/นักศึกษากดรับทราบ**
 */
export class SupervisionRecordController {
  /**
   * โครงของแบบฟอร์ม (หัวข้อ 37 ข้อ + สเกล + รายการเอกสาร)
   * Route: GET /api/supervision-records/form
   * Access: advisor, dept_head, staff
   *
   * ส่งจากเซิร์ฟเวอร์เพื่อให้ **หัวข้อมีแหล่งความจริงเดียว** — หน้าจอไม่ประกาศซ้ำ
   * (บรรทัดฐานเดียวกับ `GET /api/calendar` ที่ส่ง label ของกิจกรรมไปให้)
   */
  static async getForm(_req: Request, res: Response): Promise<void> {
    res.status(200).json({
      scale: SUPERVISION_SCALE_LABELS,
      visits: SUPERVISION_VISITS,
      company_section: COMPANY_SECTION,
      student_section: STUDENT_SECTION,
      document_items: REQUIRED_DOCUMENT_ITEMS,
    });
  }

  /**
   * บันทึกการนิเทศของนักศึกษาคนหนึ่ง (ทุกครั้งที่นิเทศ)
   * Route: GET /api/supervision-records/student/:studentId
   * Access: advisor / dept_head / staff ที่ดูแลนักศึกษาคนนั้น (SEC-06)
   *
   * ⛔ **บริษัทและนักศึกษาเข้าไม่ได้** — ส่วนที่ 1 คือความเห็นของอาจารย์ต่อ
   * *สถานประกอบการ* และส่วนที่ 2 คือความเห็นต่อ *ตัวนักศึกษาเอง* ทั้งสองอย่าง
   * เป็นข้อมูลภายในของคณะ (ตรรกะเดียวกับที่ผลประเมิน สหกิจ 15 ถูกกั้นไว้)
   */
  static async getByStudent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = parseInt(req.params.studentId, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);

      const result = await query(
        `SELECT r.record_id, r.visit_number, r.visit_date::text AS visit_date,
                r.scores, r.remarks, r.documents_required, r.additional_notes,
                r.submitted_at, r.supervisor_id,
                p.first_name AS supervisor_first_name, p.last_name AS supervisor_last_name,
                c.name_th AS company_name
           FROM supervision_records r
           JOIN personnel p ON r.supervisor_id = p.personnel_id
           JOIN companies c ON r.company_id = c.company_id
          WHERE r.student_id = $1
          ORDER BY r.visit_number ASC`,
        [studentId]
      );

      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(
        res,
        error,
        'Get Supervision Records Error',
        'เกิดข้อผิดพลาดขณะดึงบันทึกการนิเทศ'
      );
    }
  }

  /**
   * อาจารย์นิเทศส่งบันทึก (ส่งทับได้ = แก้ไข)
   * Route: PUT /api/supervision-records/student/:studentId
   * Access: advisor, dept_head (ที่ดูแลนักศึกษาคนนั้น)
   *
   * ⛔ **ไม่บังคับให้ตอบครบทุกข้อ** — สเกลของใบนี้มี `-` (ไม่มีข้อมูล/ไม่ประเมิน)
   * ซึ่งเป็นคำตอบที่ถูกต้องได้จริง · ต่างจาก สหกิจ 15/16 ที่บังคับครบเพราะเอาไปตัดเกรด
   */
  static async submit(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = parseInt(req.params.studentId, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);

      const body = req.body ?? {};
      const visitNumber = Number(body.visit_number);
      if (!SUPERVISION_VISITS.includes(visitNumber as 1 | 2)) {
        res.status(400).json({ message: 'ครั้งที่นิเทศต้องเป็น 1 หรือ 2' });
        return;
      }

      const visitDate = typeof body.visit_date === 'string' ? body.visit_date.trim() : '';
      // วันที่เป็นสตริง YYYY-MM-DD ล้วน — ห้าม new Date() (เลื่อนวันตาม timezone)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
        res.status(400).json({ message: 'กรุณาระบุวันที่นิเทศในรูปแบบ ปี-เดือน-วัน (YYYY-MM-DD)' });
        return;
      }

      const today = (
        await query(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today`)
      ).rows[0].today as string;
      if (visitDate > today) {
        res.status(400).json({ message: 'วันที่นิเทศเป็นวันในอนาคต กรุณาตรวจสอบอีกครั้ง' });
        return;
      }

      const { scores, error } = validateSupervisionScores(body.scores);
      if (error) {
        res.status(400).json({ message: error });
        return;
      }

      // หมายเหตุรายข้อ — คีย์ต้องอยู่ในชุดเดียวกับคะแนน ค่าถูกบังคับเป็นสตริงและตัดความยาว
      const allowedItems = new Set(ALL_ITEM_KEYS);
      const remarks: Record<string, string> = {};
      if (body.remarks && typeof body.remarks === 'object' && !Array.isArray(body.remarks)) {
        for (const [key, value] of Object.entries(body.remarks as Record<string, unknown>)) {
          if (!allowedItems.has(key)) {
            res.status(400).json({ message: `พบหมายเหตุของหัวข้อที่ไม่รู้จัก: ${key}` });
            return;
          }
          const text = typeof value === 'string' ? value.trim().slice(0, 500) : '';
          if (text) remarks[key] = text;
        }
      }

      // checkbox เอกสาร — เก็บเฉพาะคีย์ที่รู้จัก และเป็น boolean เสมอ
      const documents: Record<string, boolean> = {};
      if (
        body.documents_required &&
        typeof body.documents_required === 'object' &&
        !Array.isArray(body.documents_required)
      ) {
        for (const key of DOCUMENT_KEYS) {
          documents[key] = (body.documents_required as Record<string, unknown>)[key] === true;
        }
      }

      // สถานประกอบการมาจากใบความจำนงที่ตอบรับแล้ว ไม่ใช่ให้ผู้เรียกส่งมา —
      // ⛔ ถ้ารับจากผู้เรียก บันทึกจะชี้ไปบริษัทไหนก็ได้ ซึ่งเป็นหลักฐานที่เชื่อไม่ได้
      const intent = await query(
        `SELECT company_id FROM intent_forms
          WHERE student_id = $1 AND status = 'accepted'
          ORDER BY form_id DESC LIMIT 1`,
        [studentId]
      );
      if ((intent.rowCount ?? 0) === 0) {
        res.status(409).json({
          message:
            'นักศึกษาคนนี้ยังไม่มีสถานประกอบการที่ตอบรับแล้ว จึงยังบันทึกการนิเทศไม่ได้',
        });
        return;
      }

      const result = await query(
        `INSERT INTO supervision_records
           (student_id, supervisor_id, company_id, visit_number, visit_date,
            scores, remarks, documents_required, additional_notes, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, NOW())
         ON CONFLICT (student_id, visit_number) DO UPDATE SET
           supervisor_id = EXCLUDED.supervisor_id,
           company_id = EXCLUDED.company_id,
           visit_date = EXCLUDED.visit_date,
           scores = EXCLUDED.scores,
           remarks = EXCLUDED.remarks,
           documents_required = EXCLUDED.documents_required,
           additional_notes = EXCLUDED.additional_notes,
           submitted_at = NOW()
         RETURNING record_id`,
        [
          studentId,
          req.user.userId,
          intent.rows[0].company_id,
          visitNumber,
          visitDate,
          JSON.stringify(scores),
          JSON.stringify(remarks),
          JSON.stringify(documents),
          typeof body.additional_notes === 'string'
            ? body.additional_notes.trim().slice(0, 2000) || null
            : null,
        ]
      );

      writeAudit(
        {
          action: AuditAction.SUPERVISION_RECORD_SUBMITTED,
          entityType: 'supervision_record',
          entityId: result.rows[0].record_id,
          subjectId: studentId,
          detail: { visit_number: visitNumber, visit_date: visitDate },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: `บันทึกการนิเทศครั้งที่ ${visitNumber} เรียบร้อยแล้ว`,
        record_id: result.rows[0].record_id,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(
        res,
        error,
        'Submit Supervision Record Error',
        'เกิดข้อผิดพลาดขณะบันทึกการนิเทศ'
      );
    }
  }
}
