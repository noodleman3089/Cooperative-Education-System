import fs from 'fs';
import path from 'path';
import pool from '../config/database';
import { buildCoverLetterPdf, fetchCoverLetterData, toCoverLetterData } from './coverLetterPdf';

/** ออกหนังสือไม่ได้เพราะ "สภาพของใบ" ไม่ใช่เพราะระบบล้ม — controller ตอบด้วย `status` นี้ */
export class CoverLetterConflictError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 = 409
  ) {
    super(message);
  }
}

const LETTER_DATA_MISSING = 'ไม่พบข้อมูลสำหรับวาดหนังสือ';

/**
 * วาดหนังสือขอความอนุเคราะห์ (ฉบับยังไม่ลงนาม) + เขียนไฟล์ + ทำให้มีแถว `official_documents` ที่จับคู่กับใบ
 *
 * ที่เดียวที่ทำสามอย่างนี้ ใช้ร่วม 3 ทาง: เจ้าหน้าที่รับคำร้อง · ออกใหม่เมื่อรอบแรกล้ม · แก้เลขที่หนังสือ
 *   ยังไม่มีแถวหนังสือ        → สร้างแถวใหม่ (เข้าคิวคณบดี)
 *   มีแถวที่ยังรอลงนาม        → วาดไฟล์ใหม่แล้วชี้แถวเดิมไปที่ไฟล์นั้น (เลขที่หนังสือเปลี่ยน)
 *   มีแถวที่คณบดีลงนามแล้ว    → ปฏิเสธ (409)
 *
 * ⛔ เรียก **หลัง** ทรานแซกชันที่เปลี่ยนสถานะ/เลขของใบ COMMIT แล้วเสมอ — ไฟล์บนดิสก์ย้อนกลับพร้อมฐานไม่ได้
 *    ล้มที่นี่ ใบที่รับแล้วต้องไม่ย้อนกลับไปหานักศึกษา เจ้าหน้าที่กดสร้างใหม่ได้ (`POST /intents/:id/cover-letter/reissue`)
 * ⛔ จับคู่หนังสือกับใบด้วยเงื่อนไขเดียวกับ LATERAL ทั้งระบบ (นักศึกษา + สถานประกอบการ + เลขที่หนังสือ)
 *    ล็อกแถวใบไว้ระหว่างทำ กดซ้อนสองครั้งจึงไม่ได้หนังสือสองแถว
 */
export async function issueCoverLetter(
  formId: number,
  options: { onlyIfMissing?: boolean } = {}
): Promise<{ docId: number }> {
  const client = await pool.connect();
  let writtenPath: string | null = null;
  try {
    await client.query('BEGIN');

    const formRes = await client.query(
      `SELECT student_id, company_id, status, officer_document_no
         FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
      [formId]
    );
    if ((formRes.rowCount ?? 0) === 0) throw new CoverLetterConflictError('ไม่พบคำร้องที่ต้องการ', 404);
    const form = formRes.rows[0];
    if (form.status !== 'approved_by_dept_head') {
      throw new CoverLetterConflictError(
        'สร้างหนังสือขอความอนุเคราะห์ได้เฉพาะคำร้องที่เจ้าหน้าที่รับแล้วและยังรอคณบดีลงนาม'
      );
    }

    const docRes = await client.query(
      `SELECT doc_id, status FROM official_documents
        WHERE student_id = $1 AND company_id = $2 AND type = 'cover_letter'
          AND document_number IS NOT DISTINCT FROM $3
        ORDER BY doc_id DESC LIMIT 1
          FOR UPDATE`,
      [form.student_id, form.company_id, form.officer_document_no]
    );
    const existing = docRes.rows[0] as { doc_id: number; status: string } | undefined;
    if (existing && options.onlyIfMissing) {
      throw new CoverLetterConflictError('คำร้องนี้มีหนังสือขอความอนุเคราะห์อยู่แล้ว');
    }
    if (existing && existing.status !== 'pending_sign') {
      throw new CoverLetterConflictError('คณบดีลงนามหนังสือฉบับนี้แล้ว จึงวาดใหม่ไม่ได้');
    }

    // หาข้อมูลไม่เจอ = หนังสือยังไม่ออก ต้องบอก ห้ามข้ามเงียบ (ของเดิม `if (letterRow) {…}` ข้ามไปเฉย ๆ)
    const letterRow = await fetchCoverLetterData(formId);
    if (!letterRow) throw new Error(LETTER_DATA_MISSING);

    const pdfBytes = await buildCoverLetterPdf(toCoverLetterData(letterRow));
    const relativePath = path.posix.join(
      'secure_private',
      'documents',
      `cover_letter_${formId}_${Date.now()}.pdf`
    );
    const absolutePath = path.join(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, pdfBytes);
    writtenPath = absolutePath;

    let docId: number;
    if (existing) {
      await client.query('UPDATE official_documents SET generated_file_path = $1 WHERE doc_id = $2', [
        relativePath,
        existing.doc_id,
      ]);
      docId = existing.doc_id;
    } else {
      // ไม่มี template_id — หนังสือถูกวาดจากโค้ด ไม่ได้มาจากแม่แบบ (migration 005)
      const inserted = await client.query(
        `INSERT INTO official_documents (document_number, type, student_id, company_id, generated_file_path, status)
         VALUES ($1, 'cover_letter', $2, $3, $4, 'pending_sign')
         RETURNING doc_id`,
        [form.officer_document_no, form.student_id, form.company_id, relativePath]
      );
      docId = inserted.rows[0].doc_id as number;
    }

    await client.query('COMMIT');
    return { docId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    // ฐานไม่รับ = ไฟล์ที่เพิ่งเขียนไม่มีแถวไหนชี้ถึง ลบทิ้งไม่ให้ค้าง
    if (writtenPath) fs.promises.unlink(writtenPath).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * สาเหตุที่วาด/บันทึกหนังสือล้ม เป็นคำที่เจ้าหน้าที่อ่านแล้วรู้ว่าต้องแจ้งใคร
 * ⛔ ไม่ส่งข้อความดิบของ error ออกไป — มี path ของเครื่องแม่ข่ายอยู่ในนั้น (ตัวเต็มอยู่ใน log)
 */
export function coverLetterFailureReason(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | undefined;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (error instanceof CoverLetterConflictError) return message;
  if (message === LETTER_DATA_MISSING) {
    return 'ไม่พบข้อมูลสำหรับวาดหนังสือ (ภาคเรียน สาขาวิชา หรือสถานประกอบการของคำร้องนี้ขาดหาย)';
  }
  if (message.includes('ไม่พบฟอนต์')) return 'ไม่พบไฟล์ฟอนต์ภาษาไทยของระบบ (THSarabunNew.ttf)';
  if (e?.code === '22001') return 'เลขที่หนังสือยาวเกินที่ระบบเก็บได้';
  if (typeof e?.code === 'string' && /^E[A-Z]+$/.test(e.code)) {
    return 'เขียนไฟล์หนังสือลงเครื่องแม่ข่ายไม่ได้';
  }
  return 'ระบบสร้างไฟล์หนังสือไม่สำเร็จ';
}
