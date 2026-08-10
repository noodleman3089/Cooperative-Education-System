import { Request, Response } from 'express';
import pool from '../config/database';
import { sanitizeCsvCell } from '../middlewares/validation';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class StaffImportController {
  /**
   * Import eligible students from a CSV payload.
   * Route: POST /api/students/import
   * Access: staff, dept_head
   */
  static async importStudents(req: Request, res: Response): Promise<void> {
    try {
      interface StudentImportRow {
        student_code: string;
        cumulative_gpa: number | null;
        is_eligible: boolean;
        email: string | null;
      }

      let studentsToImport: StudentImportRow[] = [];
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
        const startIdx = lines[0].toLowerCase().includes('student_code') ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(',');
          if (parts.length >= 1) {
            const student_code = sanitizeCsvCell(parts[0] || '');
            if (!student_code) continue;

            // is_eligible parses 'true', '1', 'yes' as true, others as false
            const isEligibleStr = parts[1] ? sanitizeCsvCell(parts[1]).toLowerCase() : '';
            const is_eligible = isEligibleStr ? ['true', '1', 'yes', 'y'].includes(isEligibleStr) : true;

            // DATA-01: the GPA column used to be ignored and every imported row was
            // written as a flat 3.00, overwriting real transcript values on re-import.
            // It is now parsed, range-checked, and left untouched when the cell is blank.
            const gpaStr = parts[2] ? sanitizeCsvCell(parts[2]) : '';
            let cumulative_gpa: number | null = null;
            if (gpaStr) {
              const parsedGpa = parseFloat(gpaStr);
              if (isNaN(parsedGpa) || parsedGpa < 0 || parsedGpa > 4.0) {
                invalidRows.push(`${student_code} (GPA '${gpaStr}' ไม่อยู่ในช่วง 0.00-4.00)`);
                continue;
              }
              cumulative_gpa = parsedGpa;
            }

            // SEC-02: binds this student_code to one account at profile-setup time.
            const emailStr = parts[3] ? sanitizeCsvCell(parts[3]).toLowerCase() : '';
            if (emailStr && !EMAIL_REGEX.test(emailStr)) {
              invalidRows.push(`${student_code} (รูปแบบอีเมลไม่ถูกต้อง)`);
              continue;
            }

            studentsToImport.push({
              student_code,
              cumulative_gpa,
              is_eligible,
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
          const isEligible = row.is_eligible;

          // Start a transaction for each student upsert to ensure isolation
          try {
            await client.query('BEGIN');

            // 1. UPSERT into staging table eligible_students_list.
            //    COALESCE keeps a previously imported GPA when this row omits one,
            //    so a roster-only re-import never destroys transcript data.
            await client.query(
               `INSERT INTO eligible_students_list (student_code, cumulative_gpa, is_eligible, email)
               VALUES ($1, COALESCE($2, 0.00), $3, $4)
               ON CONFLICT (student_code)
               DO UPDATE SET
                 cumulative_gpa = COALESCE($2, eligible_students_list.cumulative_gpa),
                 is_eligible = EXCLUDED.is_eligible,
                 email = COALESCE(EXCLUDED.email, eligible_students_list.email)
               RETURNING student_code`,
              [studentCode, gpa, isEligible, row.email]
            );

            // 2. Sync to students table if the profile already exists
            const profileCheck = await client.query(
              'SELECT student_id FROM students WHERE student_code = $1 LIMIT 1',
              [studentCode]
            );

            let wasAlreadyRegistered = false;

            if ((profileCheck.rowCount ?? 0) > 0) {
              wasAlreadyRegistered = true;
              await client.query(
                `UPDATE students
                 SET cumulative_gpa = COALESCE($2, cumulative_gpa), is_eligible = $3
                 WHERE student_code = $1`,
                [studentCode, gpa, isEligible]
              );
            }

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
          totalProcessed: studentsToImport.length,
          importedCount,
          updatedCount,
          skippedCount,
          skippedCodes,
          invalidRows,
        },
      });
    } catch (error) {
      console.error('Staff Import Students General Error:', error);
      res.status(500).json({ message: 'An internal server error occurred during student import.' });
    }
  }
}
