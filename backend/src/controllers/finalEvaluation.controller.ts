import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import { launchPdfBrowser } from '../utils/browser';
import {
  EVALUATION_FORMS,
  FORM_LABEL,
  FormCode,
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
 * ทั้งสองใบเป็นเอกสารที่ต้องใส่ซองประทับตรา "ลับ" → นักศึกษาต้องเข้าไม่ถึง
 * `authorizeRoles` ของทุก route ในไฟล์นี้จึงไม่มี `student` และห้ามใส่เพิ่ม
 */

/** โฟลเดอร์แม่แบบ — อ่านไฟล์ตรงๆ แบบเดียวกับ travel-request ไม่ผ่าน document_templates */
const TEMPLATE_DIR = path.join(process.cwd(), 'secure_private', 'templates');

/** หมวดของ สหกิจ 15 สำหรับกล่องสรุปท้ายฟอร์ม — ลำดับและป้ายตรงกับกระดาษ */
const SAHATKIT_15_SECTIONS: { no: number; label: string; keys: string[]; max: number }[] = [
  { no: 1, label: 'ผลสำเร็จของงาน (ข้อ 1.1 – 1.2)', keys: ['work_quantity', 'work_quality'], max: 20 },
  {
    no: 2,
    label: 'ความรู้ความสามารถ (ข้อ 2.1 – 2.8)',
    keys: [
      'academic_ability',
      'learn_and_apply',
      'practical_ability',
      'judgment_decision',
      'organization_planning',
      'communication_skills',
      'foreign_language_culture',
      'job_suitability',
    ],
    max: 40,
  },
  {
    no: 3,
    label: 'ความรับผิดชอบต่อหน้าที่ (ข้อ 3.1 – 3.4)',
    keys: [
      'responsibility_dependability',
      'interest_in_work',
      'initiative_self_starter',
      'response_to_supervision',
    ],
    max: 20,
  },
  {
    no: 4,
    label: 'ลักษณะส่วนบุคคล (ข้อ 4.1 – 4.4)',
    keys: ['personality', 'interpersonal_skills', 'discipline_adaptability', 'ethics_morality'],
    max: 20,
  },
];

/**
 * ป้ายข้อของ สหกิจ 16 เรียงตรงกับ `EVALUATION_FORMS.sahatkit_16.items`
 *
 * อยู่ที่นี่แทนที่จะฝังใน template เพราะตาราง 14 แถวเป็น `{{#each}}` — การพิมพ์
 * ป้ายลง HTML ตรงๆ จะต้องเขียน 14 แถวซ้ำกันทั้งหมดพร้อมช่องติ๊ก 6 ช่องต่อแถว
 * (ต่างจาก สหกิจ 15 ที่แต่ละข้อมีคำอธิบายยาวไม่เท่ากัน จึงเขียนเป็นแถวจริงคุ้มกว่า)
 */
const SAHATKIT_16_LABELS = [
  'เลือกหัวข้อมีความเหมาะสมในระดับใด',
  'เนื้อหารายละเอียดบทที่ 1',
  'เนื้อหารายละเอียดบทที่ 2',
  'เนื้อหารายละเอียดบทที่ 3',
  'เนื้อหารายละเอียดบทที่ 4',
  'ความเหมาะสมของเนื้อหาโดยภาพรวม',
  'การใช้ภาษามีความเหมาะสม',
  'ความสมบูรณ์ของรายงาน ในส่วนสารบัญ',
  'ความสมบูรณ์ของรายงาน ในส่วนบรรณานุกรม การอ้างอิง',
  'ความสมบูรณ์ของรายงาน',
  'ความถูกต้องของรูปแบบที่กำหนด',
  'ความเหมาะสมของระยะเวลาในการทำรายงาน',
  'การใช้ภาพประกอบสอดคล้องกับเนื้อหา',
  'โดยภาพรวมของการจัดทำรายงานสหกิจ',
];

/** อ่านคะแนนหนึ่งข้อจาก JSONB — คืน null เมื่อเป็น "–" หรือไม่มีค่า */
const readScore = (detail: Record<string, unknown>, key: string): number | null => {
  const raw = detail[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** ข้อความจาก JSONB — คืนสตริงว่างเพื่อให้ Handlebars ไม่พิมพ์คำว่า undefined */
const readText = (detail: Record<string, unknown>, key: string): string => {
  const raw = detail[key];
  return typeof raw === 'string' ? raw : '';
};

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
   * ออกแบบประเมินที่กรอกแล้วเป็น PDF ตามหน้าตาแบบฟอร์มราชการ
   * Route: GET /api/final-evaluations/pdf/:formCode/:studentId
   * Access: mentor (ของตัวเอง) · advisor / staff / dept_head (ตาม SEC-06)
   *
   * จงใจไม่ใช้ `POST /api/documents/generate` — ตัวนั้นเป็น staff-only บังคับ
   * ให้บริษัทผ่านการรับรอง และเขียน `official_documents` เข้าคิวรอคณบดีลงนาม
   * ซึ่งผิดกับเอกสารลับที่พี่เลี้ยงลงนามคนเดียว
   */
  static async exportEvaluationPdf(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { formCode } = req.params;
      const targetStudentId = parseInt(req.params.studentId, 10);
      if (isNaN(targetStudentId) || !isFormCode(formCode)) {
        res.status(400).json({ message: 'ข้อมูลที่ร้องขอไม่ถูกต้อง' });
        return;
      }

      const { userId, roles } = req.user;
      if (roles.includes('mentor')) {
        const own = await query(
          `SELECT mentor_id FROM intent_forms
            WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted'`,
          [targetStudentId, userId]
        );
        if ((own.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'คุณไม่มีสิทธิ์เข้าถึงผลประเมินของนักศึกษาคนนี้' });
          return;
        }
      } else {
        // SEC-06: คะแนนที่ปิดผนึกเปิดได้เฉพาะคนที่รับผิดชอบนักศึกษาคนนี้
        await assertCanReviewStudentWork(userId, roles, targetStudentId);
      }

      const dataRes = await query(
        `SELECT s.student_code, s.first_name, s.last_name,
                mj.major_name_th, f.faculty_name_th,
                c.name_th AS company_name,
                men.name AS evaluator_name,
                men.position AS evaluator_position,
                men.department AS evaluator_department,
                ev.scores_detail, ev.total_score, ev.submitted_at
           FROM final_evaluations ev
           JOIN students s       ON ev.student_id = s.student_id
           JOIN master_major mj  ON s.major_id = mj.major_id
           JOIN master_faculty f ON mj.faculty_id = f.faculty_id
           LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status = 'accepted'
           LEFT JOIN companies c ON i.company_id = c.company_id
           LEFT JOIN mentors men ON i.mentor_id = men.mentor_id
          WHERE ev.student_id = $1 AND ev.form_code = $2 AND ev.evaluator_role = 'mentor'`,
        [targetStudentId, formCode]
      );

      if ((dataRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: `ยังไม่มีแบบประเมิน ${FORM_LABEL[formCode]} ของนักศึกษาคนนี้` });
        return;
      }

      const row = dataRes.rows[0];
      const detail = (row.scores_detail ?? {}) as Record<string, unknown>;

      const templatePath = path.join(TEMPLATE_DIR, `${formCode}_template.html`);
      if (!fs.existsSync(templatePath)) {
        res.status(404).json({ message: 'ไม่พบแม่แบบเอกสาร' });
        return;
      }

      const compiled = Handlebars.compile(fs.readFileSync(templatePath, 'utf8'));
      const context = FinalEvaluationController.buildPdfContext(formCode, row, detail);
      const renderedHtml = compiled(context);

      const browser = await launchPdfBrowser();
      const page = await browser.newPage();
      await page.setContent(renderedHtml, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '15mm' },
      });
      await browser.close();

      writeAudit(
        {
          action: AuditAction.EVALUATION_PDF_EXPORTED,
          entityType: 'final_evaluation',
          entityId: `${targetStudentId}:${formCode}`,
          subjectId: targetStudentId,
          detail: { form_code: formCode },
        },
        req
      ).catch(() => undefined);

      res.contentType('application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${formCode}_${row.student_code}.pdf"`
      );
      // puppeteer v23+ คืน Uint8Array — ไม่ห่อ Buffer แล้ว Express จะ serialize
      // เป็น JSON โดย status ยังเป็น 200 ผู้ใช้จึงได้ไฟล์ขยะแทน PDF
      res.send(Buffer.from(pdfBuffer));
    } catch (error) {
      if (sendAccessError(res, error)) return;
      next(error);
    }
  }

  /** ประกอบ context ให้ Handlebars — ยอดรวมคิดที่นี่เพราะ Handlebars บวกเลขไม่ได้ */
  private static buildPdfContext(
    formCode: FormCode,
    row: Record<string, unknown>,
    detail: Record<string, unknown>
  ): Record<string, unknown> {
    const submittedAt = row.submitted_at instanceof Date ? row.submitted_at : new Date();
    const base: Record<string, unknown> = {
      student_name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
      student_code: row.student_code ?? '',
      major_name: row.major_name_th ?? '',
      faculty_name: row.faculty_name_th ?? '',
      company_name: row.company_name ?? '',
      evaluator_name: row.evaluator_name ?? '',
      evaluator_position: row.evaluator_position ?? '',
      evaluator_department: row.evaluator_department ?? '',
      submitted_date: submittedAt.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      other_comments: readText(detail, 'other_comments'),
    };

    if (formCode === 'sahatkit_15') {
      const scores: Record<string, number | null> = {};
      for (const item of EVALUATION_FORMS.sahatkit_15.items) {
        scores[item.key] = readScore(detail, item.key);
      }
      const sectionTotals = SAHATKIT_15_SECTIONS.map((section) => ({
        no: section.no,
        label: section.label,
        max: section.max,
        got: section.keys.reduce((sum, key) => sum + (scores[key] ?? 0), 0),
      }));

      const wouldHire = readText(detail, 'would_hire');
      return {
        ...base,
        s: scores,
        section_totals: sectionTotals,
        grand_total: sectionTotals.reduce((sum, s) => sum + s.got, 0),
        strength: readText(detail, 'strength'),
        improvement: readText(detail, 'improvement'),
        hire_accept: wouldHire === 'accept',
        hire_unsure: wouldHire === 'unsure',
        hire_reject: wouldHire === 'reject',
      };
    }

    // สหกิจ 16 — ตารางเป็นช่องติ๊ก 5/4/3/2/1/– จึงแปลงคะแนนเป็นธงก่อน
    // ทำใน TS แทนการลงทะเบียน Handlebars helper ตัวใหม่
    const rows = EVALUATION_FORMS.sahatkit_16.items.map((item, index) => {
      const value = readScore(detail, item.key);
      return {
        no: index + 1,
        label: SAHATKIT_16_LABELS[index],
        v5: value === 5,
        v4: value === 4,
        v3: value === 3,
        v2: value === 2,
        v1: value === 1,
        dash: value === null,
      };
    });

    return {
      ...base,
      rows,
      report_title_th: readText(detail, 'report_title_th'),
      report_title_en: readText(detail, 'report_title_en'),
      grand_total: row.total_score ?? 0,
    };
  }
}
