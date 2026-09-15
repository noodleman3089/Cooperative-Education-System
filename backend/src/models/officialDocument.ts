import { query } from '../config/database';
import { OfficialDocument } from '../types';

export class OfficialDocumentModel {
  /**
   * Find an official document by its ID.
   */
  static async findById(docId: number): Promise<OfficialDocument | null> {
    const res = await query(
      `SELECT doc_id, document_number, type, student_id, company_id, template_id, generated_file_path, status, dean_signature_date, docusign_envelope_id 
       FROM official_documents 
       WHERE doc_id = $1`,
      [docId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as OfficialDocument;
  }

  /**
   * Create a new official document record.
   */
  static async create(docData: {
    document_number?: string;
    type: string;
    student_id: number;
    company_id: number;
    /** NULL สำหรับหนังสือที่วาดจากโค้ด (ไม่มีแม่แบบ) — ดู migration 005 */
    template_id?: number | null;
    generated_file_path: string;
    status: 'created' | 'pending_sign' | 'signed' | 'rejected';
  }): Promise<OfficialDocument> {
    const res = await query(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, template_id, generated_file_path, status, dean_signature_date, docusign_envelope_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
       RETURNING doc_id, document_number, type, student_id, company_id, template_id, generated_file_path, status, dean_signature_date, docusign_envelope_id`,
      [
        docData.document_number || null,
        docData.type,
        docData.student_id,
        docData.company_id,
        docData.template_id ?? null,
        docData.generated_file_path,
        docData.status,
      ]
    );
    return res.rows[0] as OfficialDocument;
  }

  /**
   * Update document status and signature timestamp.
   */
  /**
   * ชี้เอกสารไปที่ไฟล์ใหม่ — ใช้ตอนคณบดีลงนาม ซึ่งวาดหนังสือใหม่ทั้งใบพร้อมลายเซ็น
   * เป็นคนละไฟล์กับต้นฉบับ (ของเดิมเขียนทับไฟล์เดิม กดซ้ำแล้วลายเซ็นซ้อน)
   */
  static async updateFilePath(docId: number, filePath: string): Promise<boolean> {
    const res = await query(
      'UPDATE official_documents SET generated_file_path = $1 WHERE doc_id = $2',
      [filePath, docId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async updateStatusAndSignature(
    docId: number,
    status: 'created' | 'pending_sign' | 'signed' | 'rejected',
    signatureDate: Date | null
  ): Promise<boolean> {
    const res = await query(
      `UPDATE official_documents 
       SET status = $1, dean_signature_date = $2 
       WHERE doc_id = $3`,
      [status, signatureDate, docId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Update DocuSign envelope ID.
   */
  static async updateEnvelopeId(docId: number, envelopeId: string): Promise<boolean> {
    const res = await query(
      `UPDATE official_documents 
       SET docusign_envelope_id = $1 
       WHERE doc_id = $2`,
      [envelopeId, docId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Find official document with joined details.
   */
  static async findWithDetails(docId: number) {
    const res = await query(
      `SELECT d.doc_id, d.document_number, d.type, d.student_id, d.company_id, d.template_id, d.generated_file_path, d.status, d.dean_signature_date, d.docusign_envelope_id,
              s.student_code, s.cumulative_gpa,
              c.name_th as company_name_th, c.contact_person, c.contact_position, c.email as company_email
       FROM official_documents d
       JOIN students s ON d.student_id = s.student_id
       JOIN companies c ON d.company_id = c.company_id
       WHERE d.doc_id = $1`,
      [docId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0];
  }

  /**
   * Find all official documents with student and company details.
   */
  static async listAll() {
    const res = await query(
      `SELECT d.doc_id, d.document_number, d.type, d.student_id, d.company_id, d.template_id, d.generated_file_path, d.status, d.dean_signature_date, d.docusign_envelope_id,
              d.created_at,
              -- "ค้างที่คณบดีมากี่วัน" — คิดที่ฐานด้วยวันของไทย หน้าจอห้ามคำนวณเอง
              -- ⛔ created_at เป็น NULL ได้ (ใบก่อน migration 030) = ไม่ทราบ ไม่ใช่ 0 วัน
              CASE WHEN d.status = 'pending_sign' AND d.created_at IS NOT NULL
                   THEN ((NOW() AT TIME ZONE 'Asia/Bangkok')::date - (d.created_at AT TIME ZONE 'Asia/Bangkok')::date)
                   ELSE NULL END AS days_pending,
              s.student_code, s.first_name, s.last_name,
              c.name_th as company_name_th
       FROM official_documents d
       JOIN students s ON d.student_id = s.student_id
       JOIN companies c ON d.company_id = c.company_id
       ORDER BY d.doc_id DESC`
    );
    return res.rows;
  }
}
