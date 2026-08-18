import { Request, Response } from 'express';
import pool from '../config/database';
import { sanitizeCsvCell } from '../middlewares/validation';
import { sendUnexpectedError } from '../utils/httpError';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PersonnelImportController {
  /**
   * Import personnel list for SSO onboarding from a CSV payload.
   * Route: POST /api/personnel/import
   * Access: staff, dept_head
   */
  static async importPersonnel(req: Request, res: Response): Promise<void> {
    try {
      interface PersonnelImportRow {
        employee_code: string;
        role_name: string;
        major_id: number | null;
        first_name: string;
        last_name: string;
        email: string | null;
      }

      let personnelToImport: PersonnelImportRow[] = [];
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
        const startIdx = lines[0].toLowerCase().includes('employee_code') ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(',');
          if (parts.length >= 5) {
            const employee_code = sanitizeCsvCell(parts[0] || '');
            const role_name = sanitizeCsvCell(parts[1] || '').toLowerCase();
            const majorStr = sanitizeCsvCell(parts[2] || '');
            const first_name = sanitizeCsvCell(parts[3] || '');
            const last_name = sanitizeCsvCell(parts[4] || '');
            // SEC-01: optional 6th column binds the code to one account at claim time.
            const email = parts[5] ? sanitizeCsvCell(parts[5]).toLowerCase() : '';

            if (!employee_code || !role_name || !first_name || !last_name) continue;

            // Basic role validation based on schema constraint
            if (!['advisor', 'dean', 'staff', 'dept_head'].includes(role_name)) continue;

            if (email && !EMAIL_REGEX.test(email)) continue;

            const major_id = majorStr ? parseInt(majorStr, 10) : null;

            personnelToImport.push({
              employee_code,
              role_name,
              major_id: isNaN(major_id as number) ? null : major_id,
              first_name,
              last_name,
              email: email || null
            });
          }
        }
      }

      if (personnelToImport.length === 0) {
        res.status(400).json({ message: 'No valid personnel records found to import. Check CSV format.' });
        return;
      }

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const skippedCodes: string[] = [];

      const client = await pool.connect();

      try {
        for (const row of personnelToImport) {
          try {
            await client.query('BEGIN');

            const checkRes = await client.query(
              'SELECT employee_code FROM personnel_preseed_list WHERE employee_code = $1',
              [row.employee_code]
            );
            const isUpdate = (checkRes.rowCount ?? 0) > 0;

            await client.query(
              `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (employee_code)
               DO UPDATE SET
                 role_name = EXCLUDED.role_name,
                 major_id = EXCLUDED.major_id,
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 email = EXCLUDED.email
               WHERE personnel_preseed_list.is_claimed = FALSE
               RETURNING employee_code`,
              [row.employee_code, row.role_name, row.major_id, row.first_name, row.last_name, row.email]
            );

            await client.query('COMMIT');

            if (isUpdate) {
              updatedCount++;
            } else {
              importedCount++;
            }
          } catch (rowErr) {
            await client.query('ROLLBACK');
            console.error(`Failed to import personnel row: code=${row.employee_code}`, rowErr);
            skippedCount++;
            skippedCodes.push(row.employee_code);
          }
        }
      } finally {
        client.release();
      }

      res.status(200).json({
        message: 'Personnel import completed.',
        summary: {
          totalProcessed: personnelToImport.length,
          importedCount,
          updatedCount,
          skippedCount,
          skippedCodes,
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Personnel Import General Error', 'An internal server error occurred during personnel import.');
    }
  }

  /**
   * Add a single personnel record for SSO onboarding manually.
   * Route: POST /api/personnel/add
   * Access: staff only
   */
  static async addSinglePersonnel(req: Request, res: Response): Promise<void> {
    try {
      const { employee_code, role_name, major_id, first_name, last_name, email } = req.body;

      if (!employee_code || !role_name || !first_name || !last_name) {
        res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (รหัสบุคลากร, บทบาท, ชื่อ, นามสกุล)' });
        return;
      }

      if (!['advisor', 'dean', 'staff', 'dept_head'].includes(role_name)) {
        res.status(400).json({ message: 'บทบาทไม่ถูกต้อง (ต้องเป็น advisor, dean, staff, หรือ dept_head)' });
        return;
      }

      // SEC-01: the email is what ties this code to a single person at claim time.
      const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
        res.status(400).json({ message: 'กรุณาระบุอีเมลของบุคลากรให้ถูกต้อง (ใช้ผูกกับบัญชีตอนยืนยันสิทธิ์)' });
        return;
      }

      const parsedMajorId = major_id ? parseInt(major_id, 10) : null;
      const finalMajorId = isNaN(parsedMajorId as number) ? null : parsedMajorId;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const checkRes = await client.query(
          'SELECT employee_code, is_claimed FROM personnel_preseed_list WHERE employee_code = $1',
          [employee_code]
        );

        if (checkRes.rowCount && checkRes.rowCount > 0 && checkRes.rows[0].is_claimed) {
          res.status(400).json({ message: 'รหัสบุคลากรนี้ถูกใช้เปิดสิทธิ์เข้าใช้งานไปแล้ว ไม่สามารถแก้ไขได้' });
          return;
        }

        await client.query(
          `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (employee_code)
           DO UPDATE SET
             role_name = EXCLUDED.role_name,
             major_id = EXCLUDED.major_id,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = EXCLUDED.email
           WHERE personnel_preseed_list.is_claimed = FALSE
           RETURNING employee_code`,
          [employee_code, role_name, finalMajorId, first_name, last_name, cleanEmail]
        );

        await client.query('COMMIT');
        
        res.status(200).json({ message: 'เพิ่ม/อัปเดตข้อมูลบุคลากรเรียบร้อยแล้ว' });
      } catch (dbErr) {
        await client.query('ROLLBACK');
        sendUnexpectedError(res, dbErr, 'Failed to add personnel manually', 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลงฐานข้อมูล');
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Add single personnel general error', 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
    }
  }

  /**
   * Get all preseeded personnel list.
   * Route: GET /api/personnel/preseed
   * Access: staff only
   */
  static async getPreseededPersonnel(_req: Request, res: Response): Promise<void> {
    try {
      const result = await pool.query(
        `SELECT p.*, m.major_name_th 
         FROM personnel_preseed_list p 
         LEFT JOIN master_major m ON p.major_id = m.major_id 
         ORDER BY p.employee_code ASC`
      );
      res.status(200).json(result.rows);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get preseeded personnel error', 'เกิดข้อผิดพลาดในการดึงข้อมูลรายชื่อบุคลากรล่วงหน้า');
    }
  }

  /**
   * Delete a preseeded personnel entry.
   * Route: DELETE /api/personnel/preseed/:employee_code
   * Access: staff only
   */
  static async deletePreseededPersonnel(req: Request, res: Response): Promise<void> {
    try {
      const { employee_code } = req.params;
      if (!employee_code) {
        res.status(400).json({ message: 'กรุณาระบุรหัสประจำตัวบุคลากร' });
        return;
      }

      const checkRes = await pool.query(
        'SELECT is_claimed FROM personnel_preseed_list WHERE employee_code = $1',
        [employee_code]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบข้อมูลรหัสประจำตัวบุคลากรนี้ในระบบ' });
        return;
      }

      if (checkRes.rows[0].is_claimed) {
        res.status(400).json({ message: 'ไม่สามารถลบได้เนื่องจากรหัสนี้ถูกใช้ยืนยันสิทธิ์เข้าใช้งานไปแล้ว' });
        return;
      }

      await pool.query('DELETE FROM personnel_preseed_list WHERE employee_code = $1', [employee_code]);
      res.status(200).json({ message: 'ลบข้อมูลรายชื่อบุคลากรล่วงหน้าสำเร็จ' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete preseeded personnel error', 'เกิดข้อผิดพลาดในการลบข้อมูลบุคลากรล่วงหน้า');
    }
  }
}
