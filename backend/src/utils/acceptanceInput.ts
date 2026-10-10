import { query } from '../config/database';

/**
 * ด่านตรวจข้อมูลแบบตอบรับ (เอกสารหมายเลข 2) — **ที่เดียว** ใช้ร่วมกันทั้งสองทาง:
 *   · นักศึกษาอัปโหลดเอง  `AcceptanceController.acceptByStudent`
 *   · บริษัทตอบผ่านลิงก์  `PublicAcceptanceController.accept`
 * ⛔ ห้ามคัดลอกไปตรวจซ้ำที่อื่น — สองทางต้องตรวจเท่ากันทุกข้อ แก้ที่นี่แล้วมีผลทั้งคู่
 *
 * ตรวจตามลำดับ: มีไฟล์ → ใบมีอยู่ + คณบดีลงนามหนังสือแล้ว (409)
 * → ผู้ลงนาม (ชื่อ · ตำแหน่ง · วันที่ รูปแบบ ไม่อนาคต ไม่ก่อนวันคณบดีลงนาม)
 * · คืนธง `submittedLate` (เลยกำหนด ๑๕ วันทำการ) ให้ผู้เรียกเก็บลงใบ — เลยกำหนดยังรับ แต่ติดธง
 * ⛔ ไม่ตรวจและไม่รับช่องพี่เลี้ยงทั้งสองทาง — นักศึกษาระบุหลังใบ `accepted` ที่ `POST /intents/:id/mentor`
 * ⛔ ไม่ตรวจและไม่รับวันเริ่มปฏิบัติงานทั้งสองทาง (เอกสารหมายเลข 2 ไม่มีช่องนี้ · เจ้าของสั่ง 2026-10-10) —
 *    `start_date` ที่ส่งมาถูกเมิน ใบได้วันเริ่มจากปฏิทินสหกิจใน `IntentFormModel.acceptWithClient`
 */

export interface AcceptanceInputMessages {
  noFile: string;
}

/** ข้อความของทางนักศึกษา */
const DEFAULT_MESSAGES: AcceptanceInputMessages = {
  noFile: 'Required file upload: evidence.',
};

export interface AcceptanceInputRaw {
  hasFile: boolean;
  /** ค่าดิบของช่องผู้ลงนามจาก body */
  signer: Record<string, unknown>;
}

export type AcceptanceInputResult =
  | { ok: true; submittedLate: boolean; signer: { name: string; position: string; signedDate: string } }
  | { ok: false; status: number; message: string };

export async function validateAcceptanceInput(
  formId: number,
  input: AcceptanceInputRaw,
  messages: AcceptanceInputMessages = DEFAULT_MESSAGES
): Promise<AcceptanceInputResult> {
  const fail = (status: number, message: string): AcceptanceInputResult => ({ ok: false, status, message });

  if (!input.hasFile) return fail(400, messages.noFile);

  // แบบตอบรับ (เอกสารหมายเลข 2) ตอบ **หนังสือขอความอนุเคราะห์** ที่คณบดีลงนาม
  // ยังไม่ลงนาม = ยังไม่มีอะไรให้บริษัทตอบ · `acceptance_due_date` ถูกปั๊มตอนลงนาม
  // จึงใช้เป็นด่านลำดับได้ในตัว ไม่ต้อง join หา official_documents ซ้ำ
  const gate = await query(
    `SELECT i.acceptance_due_date::text AS due,
            (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
            doc.signed_on AS letter_signed_on
       FROM intent_forms i
       -- LATERAL เดียวกับ SEC-13 ด่าน 2 / ด่านลิงก์ (เทียบ officer_document_no) — ห้ามอ่านวันลงนามจากที่อื่น
       LEFT JOIN LATERAL (
         SELECT d.dean_signature_date::date::text AS signed_on
           FROM official_documents d
          WHERE d.student_id = i.student_id
            AND d.company_id = i.company_id
            AND d.type = 'cover_letter'
            AND d.status = 'signed'
            AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
          ORDER BY d.doc_id DESC
          LIMIT 1
       ) doc ON TRUE
      WHERE i.form_id = $1`,
    [formId]
  );
  if ((gate.rowCount ?? 0) === 0) return fail(404, 'ไม่พบใบแจ้งความจำนงที่ต้องการ');

  const { due, today, letter_signed_on } = gate.rows[0] as {
    due: string | null;
    today: string;
    letter_signed_on: string | null;
  };
  if (!due) {
    return fail(
      409,
      'ยังส่งแบบตอบรับไม่ได้ เพราะคณบดียังไม่ได้ลงนามหนังสือขอความอนุเคราะห์ — สถานประกอบการต้องได้รับหนังสือฉบับนั้นก่อนจึงจะตอบรับได้'
    );
  }

  // เลยกำหนดแล้ว **ยังรับ** แต่ติดธง — เจ้าหน้าที่ยืนยันเองว่าผ่อนผันเวลาได้
  // เพราะบางบริษัทเซ็นช้า · เทียบสตริง YYYY-MM-DD ล้วน ห้าม new Date()
  const submittedLate = today > due;

  // ผู้ลงนามบนแบบตอบรับ — ถูกพิมพ์ลงหนังสือส่งตัว จึงบังคับ · ผู้ตอบกรอกเองจากกระดาษที่ถืออยู่
  // (เจ้าของตัดสิน 2026-09-21: เดิมเจ้าหน้าที่คีย์จากกระดาษตอนตรวจ = ภาระซ้ำ)
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const signerName = text(input.signer.signer_name);
  const signerPosition = text(input.signer.signer_position);
  const signedDate = text(input.signer.signed_date);
  if (!signerName || !signerPosition || !signedDate) {
    return fail(400, 'กรุณากรอกชื่อ ตำแหน่ง และวันที่ของผู้ลงนาม ตามที่ปรากฏบนแบบตอบรับของสถานประกอบการ');
  }
  // เทียบสตริง YYYY-MM-DD ล้วน — ห้าม new Date() (เลื่อนวันตาม timezone)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedDate)) return fail(400, 'รูปแบบวันที่บนแบบตอบรับไม่ถูกต้อง');
  if (signedDate > today) {
    return fail(400, 'วันที่บนแบบตอบรับเป็นวันในอนาคต กรุณาตรวจสอบกับกระดาษอีกครั้ง');
  }
  if (letter_signed_on && signedDate < letter_signed_on) {
    return fail(
      400,
      `วันที่บนแบบตอบรับ (${signedDate}) มาก่อนวันที่คณบดีลงนามหนังสือขอความอนุเคราะห์ (${letter_signed_on}) ซึ่งเป็นไปไม่ได้ เพราะสถานประกอบการตอบรับหลังได้รับหนังสือฉบับนั้น`
    );
  }

  return { ok: true, submittedLate, signer: { name: signerName, position: signerPosition, signedDate } };
}
