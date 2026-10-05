import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { CoopSemesterModel } from '../models/semester';
import { sanitizeCsvCell } from '../middlewares/validation';
import { sendUnexpectedError } from '../utils/httpError';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ตำแหน่งคอลัมน์เมื่อไฟล์ไม่มีหัวตาราง: `student_code,cumulative_gpa,email`
 *
 * ⛔ **เดิมเป็น 4 คอลัมน์ (`student_code,is_eligible,cumulative_gpa,email`)** — สิทธิ์สหกิจถูกตัด
 *    ออก 2026-09-14 (SEC-02) · ไฟล์ที่มีหัวตารางอ่านตาม **ชื่อคอลัมน์** จึงใช้ไฟล์ 4 คอลัมน์เก่าต่อได้
 *    (คอลัมน์ is_eligible ถูกเมิน) แต่ไฟล์ **ไม่มีหัว** แบบ 4 คอลัมน์จะอ่านเกรดผิดช่อง —
 *    ไฟล์แบบนั้นต้องมีหัวตาราง
 */
const POSITIONAL = { student_code: 0, cumulative_gpa: 1, email: 2 };

export class StaffImportController {
  /**
   * Import the student roster (registry GPA + account-binding email) from a CSV payload.
   * Route: POST /api/students/import
   * Access: staff, dept_head
   */
  static async importStudents(req: Request, res: Response): Promise<void> {
    try {
      interface StudentImportRow {
        student_code: string;
        cumulative_gpa: number | null;
        email: string | null;
      }

      // ภาคที่จะเติมรายชื่อรุ่นให้ — ไม่ระบุ = ภาคที่เปิดอยู่ (ไม่มี = ไม่เติมรุ่น รายชื่อยังผูกบัญชีได้ตามเดิม)
      // รับได้ทั้ง query และ field ของ multipart (เฟส 1 R1-1) · ภาคที่ปิดแล้วเติมได้ (แก้รุ่นย้อนหลัง)
      const rawSemester =
        (typeof req.query.semester_id === 'string' && req.query.semester_id) ||
        (req.body && typeof req.body === 'object' && typeof req.body.semester_id === 'string' && req.body.semester_id) ||
        '';
      let targetSemesterId: number | null = null;
      if (rawSemester) {
        const parsed = Number(rawSemester);
        const found = Number.isInteger(parsed) && parsed > 0
          ? await query('SELECT semester_id FROM coop_semesters WHERE semester_id = $1', [parsed])
          : null;
        if (!found || (found.rowCount ?? 0) === 0) {
          res.status(400).json({ message: 'ไม่พบภาคเรียนที่เลือกสำหรับนำเข้ารายชื่อ' });
          return;
        }
        targetSemesterId = parsed;
      } else {
        const active = await CoopSemesterModel.findActiveSemester();
        targetSemesterId = active?.semester_id ?? null;
      }

      const studentsToImport: StudentImportRow[] = [];
      const invalidRows: string[] = [];

      // 1. Parse CSV from request body (raw text) or file upload if provided
      let csvContent = '';

      if (req.file) {
        csvContent = req.file.buffer.toString('utf8');
      } else if (typeof req.body === 'string') {
        csvContent = req.body;
      } else if (req.body && typeof req.body.csv === 'string') {
        csvContent = req.body.csv;
      }

      if (csvContent) {
        const lines = csvContent.split(/\r?\n/);
        const hasHeader = lines[0].toLowerCase().includes('student_code');
        const startIdx = hasHeader ? 1 : 0;

        // มีหัวตาราง = อ่านตามชื่อคอลัมน์ · คอลัมน์ที่ไม่รู้จัก (เช่น is_eligible ของไฟล์เก่า) ถูกเมิน
        let col = POSITIONAL;
        if (hasHeader) {
          const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
          col = {
            student_code: header.indexOf('student_code'),
            cumulative_gpa: header.indexOf('cumulative_gpa'),
            email: header.indexOf('email'),
          };
        }
        const cell = (parts: string[], idx: number): string =>
          idx >= 0 && parts[idx] ? sanitizeCsvCell(parts[idx]) : '';

        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(',');
          if (parts.length >= 1) {
            const student_code = cell(parts, col.student_code);
            if (!student_code) continue;

            // DATA-01: the GPA column used to be ignored and every imported row was
            // written as a flat 3.00, overwriting real transcript values on re-import.
            // It is now parsed, range-checked, and left untouched when the cell is blank.
            const gpaStr = cell(parts, col.cumulative_gpa);
            let cumulative_gpa: number | null = null;
            if (gpaStr) {
              const parsedGpa = parseFloat(gpaStr);
              if (isNaN(parsedGpa) || parsedGpa < 0 || parsedGpa > 4.0) {
                invalidRows.push(`${student_code} (GPA '${gpaStr}' ไม่อยู่ในช่วง 0.00-4.00)`);
                continue;
              }
              cumulative_gpa = parsedGpa;
            }

            // binds this student_code to one account at profile-setup time, so a
            // classmate cannot claim the code to inherit its registry GPA.
            const emailStr = cell(parts, col.email).toLowerCase();
            if (emailStr && !EMAIL_REGEX.test(emailStr)) {
              invalidRows.push(`${student_code} (รูปแบบอีเมลไม่ถูกต้อง)`);
              continue;
            }

            studentsToImport.push({
              student_code,
              cumulative_gpa,
              email: emailStr || null,
            });
          }
        }
      }

      if (studentsToImport.length === 0) {
        res.status(400).json({
          message: 'No valid student records found to import.',
          invalidRows,
        });
        return;
      }

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const skippedCodes: string[] = [];

      const client = await pool.connect();

      try {
        for (const row of studentsToImport) {
          const studentCode = row.student_code;
          const gpa = row.cumulative_gpa; // null means "leave the existing value alone"

          // Start a transaction for each student upsert to ensure isolation
          try {
            await client.query('BEGIN');

            // 1. UPSERT into staging table eligible_students_list.
            //    COALESCE keeps a previously imported GPA when this row omits one,
            //    so a roster-only re-import never destroys transcript data.
            await client.query(
               `INSERT INTO eligible_students_list (student_code, cumulative_gpa, email)
               VALUES ($1, COALESCE($2, 0.00), $3)
               ON CONFLICT (student_code)
               DO UPDATE SET
                 cumulative_gpa = COALESCE($2, eligible_students_list.cumulative_gpa),
                 email = COALESCE(EXCLUDED.email, eligible_students_list.email)
               RETURNING student_code`,
              [studentCode, gpa, row.email]
            );

            // 1.1 เข้ารุ่นของภาคที่เลือก (`semester_cohort`) — ตัวหารของแดชบอร์ด "นักศึกษาตอนนี้"
            //     ⛔ ไม่ใช่การตัดสินสิทธิ์ (SEC-02) · คนที่อยู่ในรุ่นอื่นอยู่แล้ว (เช่นยกยอด) ไม่ถูกแก้ที่มา
            if (targetSemesterId !== null) {
              await client.query(
                `INSERT INTO semester_cohort (semester_id, student_code, source)
                 VALUES ($2, $1, 'import')
                 ON CONFLICT DO NOTHING`,
                [studentCode, targetSemesterId]
              );
            }

            // 2. ตรวจว่านักศึกษาคนนี้ลงทะเบียนในระบบแล้วหรือยัง — ใช้รายงานผลเท่านั้น
            //
            //    ⛔ การนำเข้าไฟล์ *ไม่* เขียนทับ students.cumulative_gpa — เกรดของคนที่ลงทะเบียนแล้ว
            //    แก้ที่ PUT /students/:id/registry ซึ่งลง audit_log (SEC-05) · ไฟล์นี้เติมได้แค่
            //    ตอนนักศึกษาตั้งโปรไฟล์ครั้งแรก (profile.ts อ่าน eligible_students_list)
            const profileCheck = await client.query(
              'SELECT student_id FROM students WHERE student_code = $1 LIMIT 1',
              [studentCode]
            );

            const wasAlreadyRegistered = (profileCheck.rowCount ?? 0) > 0;

            await client.query('COMMIT');

            if (wasAlreadyRegistered) {
              updatedCount++;
            } else {
              importedCount++;
            }
          } catch (rowErr) {
            await client.query('ROLLBACK');
            console.error(`Failed to import staging student row: code=${studentCode}`, rowErr);
            skippedCount++;
            skippedCodes.push(studentCode);
          }
        }
      } finally {
        client.release();
      }

      res.status(200).json({
        message: 'Student import and synchronization completed.',
        summary: {
          semesterId: targetSemesterId,
          totalProcessed: studentsToImport.length,
          importedCount,
          updatedCount,
          skippedCount,
          skippedCodes,
          invalidRows,
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Staff Import Students General Error', 'An internal server error occurred during student import.');
    }
  }
}
