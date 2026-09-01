import { Request, Response } from 'express';
import { StudentMemoModel } from '../models/studentMemo';
import { MEMO_TYPES, isMemoType } from '../config/memoTypes';
import { buildStudentMemoPdf, missingMemoFields, StudentMemoData } from '../utils/memoPdf';
import { CoopSemesterModel } from '../models/semester';
import { query } from '../config/database';
import { assertCanAccessStudent, resolveMajorScope, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * บันทึกข้อความของนักศึกษา (กรณียกเว้น 4 หัวข้อ)
 *
 * เจ้าของเคาะ 2026-09-01 ว่า **หัวข้อเป็นสิ่งที่นักศึกษาเลือกเอง** ระบบมีหน้าที่
 * เติมทุกอย่างที่เหลือให้ (ชื่อ รหัส สาขา เบอร์โทร วันที่ ถ้อยคำราชการ) เหลือช่องเดียว
 * ให้พิมพ์คือ *เหตุผล* ซึ่งไม่มีระบบไหนเดาแทนได้ เพราะคณบดีอ่านตรงนั้น
 *
 * ไม่มี endpoint แก้ไข/ลบ โดยตั้งใจ — บันทึกที่พิมพ์ออกไปแล้วเป็นหลักฐานที่เดินอยู่
 * บนกระดาษ ถ้าเขียนผิดให้ยื่นใบใหม่ (คนละใบ คนละเรื่อง) เหมือนงานสารบรรณจริง
 */

/** ต้องยาวพอที่คณบดีอ่านแล้วเข้าใจเหตุผล — กติกาหน้าจอ ไม่ใช่ข้อบังคับของฐาน */
const REASON_MIN_LENGTH = 20;

export class StudentMemoController {
  /**
   * หัวข้อทั้งหมดที่เลือกได้ + ชื่อไทย + คำอธิบาย
   * Route: GET /api/memos/types
   * Access: ผู้ใช้ที่ล็อกอินทุก role (นักศึกษาต้องอ่านได้ ไม่งั้น dropdown ว่างเปล่า)
   */
  static getTypes(_req: Request, res: Response): void {
    res.status(200).json({ types: MEMO_TYPES });
  }

  /**
   * Route: POST /api/memos
   * Access: student
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const body = req.body as Record<string, unknown>;

      if (!isMemoType(body.memo_type)) {
        res.status(400).json({ message: 'กรุณาเลือกหัวข้อของบันทึกข้อความ' });
        return;
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < REASON_MIN_LENGTH) {
        res.status(400).json({
          message: `กรุณาเขียนเหตุผลอย่างน้อย ${REASON_MIN_LENGTH} ตัวอักษร ข้อความนี้จะถูกพิมพ์ลงบันทึกที่เสนอถึงคณบดี`,
        });
        return;
      }

      const semester = await CoopSemesterModel.findActiveSemester();
      if (!semester) {
        res.status(400).json({ message: 'ยังไม่มีภาคการศึกษาที่เปิดใช้งาน จึงยังยื่นบันทึกข้อความไม่ได้' });
        return;
      }

      // ด่านเดียวกับที่หนังสือขาออกใช้: ห้ามออกเอกสารราชการที่มีช่องว่างเปล่า
      // ตรวจตั้งแต่ตอนสร้าง ไม่ใช่ตอนกดพิมพ์ ผู้ใช้จะได้ไม่เขียนเหตุผลเสียเที่ยว
      const profile = await query(
        `SELECT s.student_code, s.first_name, s.last_name, s.phone AS student_phone,
                maj.major_name_th
           FROM students s
           JOIN master_major maj ON s.major_id = maj.major_id
          WHERE s.student_id = $1`,
        [req.user.userId]
      );
      if ((profile.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบข้อมูลประวัตินักศึกษา กรุณากรอกประวัติให้ครบก่อน' });
        return;
      }
      const missing = missingMemoFields(profile.rows[0] as StudentMemoData);
      if (missing.length > 0) {
        res.status(400).json({
          message: `กรอกประวัติให้ครบก่อนยื่นบันทึกข้อความ — ยังขาด ${missing.join(' · ')} ซึ่งต้องถูกพิมพ์ลงเอกสารที่เสนอถึงคณบดี`,
        });
        return;
      }

      // ใบความจำนงที่อ้างถึงต้องเป็นของผู้เรียกเอง ไม่งั้นจะแนบเลขใบของคนอื่นได้
      let intentFormId: number | null = null;
      if (body.intent_form_id !== undefined && body.intent_form_id !== null) {
        const parsed = parseInt(String(body.intent_form_id), 10);
        if (isNaN(parsed)) {
          res.status(400).json({ message: 'รหัสใบแจ้งความจำนงไม่ถูกต้อง' });
          return;
        }
        const owned = await query(
          'SELECT 1 FROM intent_forms WHERE form_id = $1 AND student_id = $2',
          [parsed, req.user.userId]
        );
        if ((owned.rowCount ?? 0) === 0) {
          res.status(404).json({ message: 'ไม่พบใบแจ้งความจำนงที่อ้างถึงในรายการของท่าน' });
          return;
        }
        intentFormId = parsed;
      }

      const memo = await StudentMemoModel.create({
        student_id: req.user.userId,
        semester_id: semester.semester_id,
        memo_type: body.memo_type,
        intent_form_id: intentFormId,
        reason,
      });

      res.status(201).json({
        message: 'บันทึกข้อความเรียบร้อยแล้ว — กดพิมพ์แล้วนำไปลงลายมือชื่อเพื่อเสนอตามขั้นตอน',
        memo,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create memo error', 'เกิดข้อผิดพลาดขณะบันทึกข้อความ');
    }
  }

  /**
   * Route: GET /api/memos/me
   * Access: student
   */
  static async listMine(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      res.status(200).json(await StudentMemoModel.listByStudent(req.user.userId));
    } catch (error) {
      sendUnexpectedError(res, error, 'List my memos error', 'เกิดข้อผิดพลาดขณะดึงบันทึกข้อความ');
    }
  }

  /**
   * Route: GET /api/memos
   * Access: advisor, dept_head, staff, dean — SEC-06: ขอบเขตสาขามาจาก resolveMajorScope
   * ซึ่ง fail closed ถ้าไม่มีโปรไฟล์บุคลากร (ไม่ใช่คืนทุกสาขา)
   */
  static async listForPersonnel(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const { majorId } = await resolveMajorScope(req.user.userId, req.user.roles);
      res.status(200).json(await StudentMemoModel.listForPersonnel(majorId));
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'List memos error', 'เกิดข้อผิดพลาดขณะดึงบันทึกข้อความ');
    }
  }

  /**
   * ไฟล์ PDF ของบันทึกหนึ่งใบ — วาดสดทุกครั้ง ไม่เก็บไฟล์ลงดิสก์
   *
   * ต่างจากหนังสือขาออกที่คณบดีลงนาม (ต้องเก็บเพราะลายเซ็นอยู่บนไฟล์นั้น) ใบนี้
   * ลายมือชื่ออยู่บนกระดาษที่พิมพ์ออกไป ไฟล์จึงเป็นแค่ผลลัพธ์ของข้อมูลในฐาน
   * — ไม่มีอะไรให้เก็บ และไม่มีโฟลเดอร์ที่โตขึ้นทุกครั้งที่มีคนกดพิมพ์ซ้ำ
   *
   * Route: GET /api/memos/:id/pdf
   * Access: เจ้าของใบ · บุคลากรที่ดูแลนักศึกษาคนนั้น
   */
  static async getPdf(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const memoId = parseInt(req.params.id, 10);
      if (isNaN(memoId)) {
        res.status(400).json({ message: 'รหัสบันทึกข้อความไม่ถูกต้อง' });
        return;
      }

      const memo = await StudentMemoModel.findById(memoId);
      if (!memo) {
        res.status(404).json({ message: 'ไม่พบบันทึกข้อความที่ต้องการ' });
        return;
      }

      const { userId, roles } = req.user;
      if (roles.includes('student')) {
        if (memo.student_id !== userId) {
          res.status(403).json({ message: 'ไม่มีสิทธิ์เปิดบันทึกข้อความของนักศึกษาคนอื่น' });
          return;
        }
      } else {
        await assertCanAccessStudent(userId, roles, memo.student_id);
      }

      const pdf = await buildStudentMemoPdf({
        memo_type: memo.memo_type,
        reason: memo.reason,
        faculty_name_th: memo.faculty_name_th,
        first_name: memo.first_name,
        last_name: memo.last_name,
        student_code: memo.student_code,
        major_name_th: memo.major_name_th,
        student_phone: memo.student_phone,
        academic_year: memo.academic_year,
        semester: memo.semester,
        issued_date: memo.created_at?.toString().slice(0, 10),
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="memo-${memoId}.pdf"`);
      res.status(200).send(pdf);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Memo PDF error', 'เกิดข้อผิดพลาดขณะสร้างไฟล์บันทึกข้อความ');
    }
  }
}
