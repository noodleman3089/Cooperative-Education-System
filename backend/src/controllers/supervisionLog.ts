import { Request, Response } from 'express';
import { query } from '../config/database';
import { sendUnexpectedError } from '../utils/httpError';

export class SupervisionLogController {
  /**
   * Save draft or submit final supervision log
   * Route: POST /api/supervision-logs
   * Access: advisor
   */
  static async saveLog(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { appointment_id, preliminary_score, behavior_notes, evidence_photos, status } = req.body;

      if (!appointment_id || !status) {
        res.status(400).json({ message: 'Missing required fields: appointment_id, status.' });
        return;
      }

      if (!['draft', 'submitted'].includes(status)) {
        res.status(400).json({ message: 'Status must be either draft or submitted.' });
        return;
      }

      // Check if appointment exists and belongs to this advisor
      const advisorId = req.user.userId;
      const appRes = await query(
        `SELECT status FROM supervision_appointments WHERE appointment_id = $1 AND advisor_id = $2`,
        [appointment_id, advisorId]
      );

      if ((appRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Appointment not found or you do not have permission.' });
        return;
      }

      // UPSERT logic: check if log exists for this appointment and its status
      const existingLogRes = await query(
        `SELECT log_id, status FROM supervision_logs WHERE appointment_id = $1`,
        [appointment_id]
      );

      let logId;
      const photosJson = evidence_photos ? JSON.stringify(evidence_photos) : null;

      if ((existingLogRes.rowCount ?? 0) > 0) {
        const existingLog = existingLogRes.rows[0];
        if (existingLog.status === 'submitted') {
          res.status(400).json({ message: 'ไม่สามารถแก้ไขบันทึกผลการนิเทศงานที่ได้รับการส่งเรียบร้อยแล้ว' });
          return;
        }

        // Update
        logId = existingLog.log_id;
        await query(
          `UPDATE supervision_logs 
           SET preliminary_score = $1, behavior_notes = $2, evidence_photos = $3, status = $4, updated_at = CURRENT_TIMESTAMP
           WHERE log_id = $5`,
          [preliminary_score, behavior_notes, photosJson, status, logId]
        );
      } else {
        // Insert
        const insertRes = await query(
          `INSERT INTO supervision_logs (appointment_id, preliminary_score, behavior_notes, evidence_photos, status) 
           VALUES ($1, $2, $3, $4, $5) RETURNING log_id`,
          [appointment_id, preliminary_score, behavior_notes, photosJson, status]
        );
        logId = insertRes.rows[0].log_id;
      }

      res.status(200).json({
        success: true,
        message: status === 'submitted' ? 'Log submitted successfully.' : 'Draft saved successfully.',
        data: { log_id: logId }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Save Supervision Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Upload evidence photos
   * Route: POST /api/supervision-logs/upload-evidence
   * Access: advisor
   */
  static async uploadEvidence(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        res.status(400).json({ message: 'Required file upload: evidence photos.' });
        return;
      }

      const files = req.files as Express.Multer.File[];
      const filePaths = files.map(f => `supervision_photos/${f.filename}`);

      res.status(201).json({
        success: true,
        message: 'Evidence photos uploaded successfully.',
        data: { file_paths: filePaths }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Upload Evidence Photos Error', 'An internal server error occurred.');
    }
  }
}
