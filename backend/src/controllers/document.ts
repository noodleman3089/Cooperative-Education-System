import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { CompanyModel } from '../models/company';
import { PersonnelModel } from '../models/personnel';
import { OfficialDocumentModel } from '../models/officialDocument';
import { UserModel } from '../models/user';
import { query } from '../config/database';
import { getErrorMessage } from '../utils/httpError';
import {
  buildCoverLetterPdf,
  fetchCoverLetterDataByDoc,
  toCoverLetterData,
} from '../utils/coverLetterPdf';
import { BatchSignDocumentsBody } from '../types';
import {
  notifyStudentStatusChangeByDocId,
  sendCompanyInviteEmail,
  sendSignedDocumentEmail,
} from '../utils/email';
import { createInviteLink } from '../utils/invite';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

// Fix Task 1.2: Enforce JWT_SECRET and exit if missing to eliminate hardcoded fallback secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not configured');
  process.exit(1);
}

/**
 * ⛔ การ **ออก** เอกสารราชการถูกโละทั้งเส้นเมื่อ 2026-08-26 พร้อมแม่แบบ HTML
 *
 * ที่หายไปคือ `generateDocument` · `generateDispatchLetter` · `getDispatchEligibleStudents`
 * · `listTemplates` — ทั้งหมดพึ่งไฟล์ใน `secure_private/templates/` ที่ไม่มีแล้ว
 * เจ้าของสั่งโละก่อนแล้วออกแบบวิธีออกเอกสารใหม่ทีหลัง
 *
 * ตั้งแต่ 2026-08-26 หนังสือขอความอนุเคราะห์ถูก **วาดจากโค้ด** (`utils/coverLetterPdf.ts`)
 * โดยเจ้าหน้าที่เป็นคนสั่งออกตอนรับคำร้อง (`controllers/intent.ts`) และคณบดีลงนามที่นี่
 * · DocuSign ถูกถอดออกทั้งหมด — ไม่มีเส้นทางเซ็นภายนอกอีก
 */
export class DocumentController {
  /**
   * คณบดีลงนามหนังสือขอความอนุเคราะห์
   * Route: POST /api/documents/batch-sign
   * Access: dean เท่านั้น
   *
   * ⛔ **วาดหนังสือใหม่ทั้งใบพร้อมลายเซ็น ไม่ใช่แปะรูปลงไฟล์เดิม**
   *
   * ของเดิม `drawImage(sig, {x:100, y:165, …})` บน PDF ที่ตัวเองไม่ได้วาด จึงพลาดได้
   * สี่ทาง: ที่อยู่ยาวขึ้นแล้วลายเซ็นทับข้อความ · หนังสือสองหน้าแต่แปะหน้าแรกเสมอ
   * · รูปถูกยืดตามกรอบตายตัว · **เขียนทับไฟล์เดิม** จึงไม่มีต้นฉบับให้ถอยและกดซ้ำ
   * = แปะซ้อน · ตอนนี้เราวาดเองจากข้อมูลในฐาน ตำแหน่งลายเซ็นจึงมาจากบรรทัดสุดท้ายจริง
   *
   * ฉบับลงนามเป็น **ไฟล์ใหม่** ต้นฉบับที่ยังไม่ลงนามอยู่ครบ — ตีกลับได้ กดซ้ำไม่ซ้อน
   */
  static async batchSignDocuments(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { doc_ids } = req.body as BatchSignDocumentsBody;
      if (!doc_ids || !Array.isArray(doc_ids) || doc_ids.length === 0) {
        res.status(400).json({ message: 'Required field: doc_ids (non-empty array of integers).' });
        return;
      }

      const deanProfile = await PersonnelModel.findByPersonnelId(req.user.userId);
      if (!deanProfile) {
        res.status(404).json({ message: 'Dean profile not found.' });
        return;
      }
      if (!deanProfile.e_signature_file) {
        res.status(400).json({
          message: 'ยังไม่ได้อัปโหลดลายมือชื่อดิจิทัล กรุณาตั้งค่าลายมือชื่อก่อนลงนาม',
        });
        return;
      }
      // ชื่อคณบดีถูก **พิมพ์ลงหนังสือราชการ** ใต้ลายเซ็น ถ้าโปรไฟล์ไม่มีชื่อ หนังสือจะ
      // ออกไปพร้อมวงเล็บที่มีแต่เส้นประ และย้อนกลับไม่ได้เพราะเลขที่หนังสือออกไปแล้ว
      // — ด่านนี้คู่กับด่านลายมือชื่อด้านบน (เจอตอนเดินเส้นทางจริง 2026-08-27)
      if (![deanProfile.first_name, deanProfile.last_name].filter(Boolean).join(' ').trim()) {
        res.status(400).json({
          message: 'โปรไฟล์ของท่านยังไม่มีชื่อ-นามสกุล ซึ่งต้องพิมพ์ลงในหนังสือ กรุณากรอกที่หน้าตั้งค่าโปรไฟล์ก่อนลงนาม',
        });
        return;
      }

      const signedDocIds: number[] = [];
      const failedDocs: { doc_id: number; error: string }[] = [];

      for (const docId of doc_ids) {
        try {
          const parsedDocId = parseInt(String(docId), 10);
          if (isNaN(parsedDocId)) {
            failedDocs.push({ doc_id: docId, error: 'Invalid document ID format.' });
            continue;
          }

          const doc = await OfficialDocumentModel.findById(parsedDocId);
          if (!doc) {
            failedDocs.push({ doc_id: parsedDocId, error: 'Official document not found.' });
            continue;
          }

          // กันเซ็นซ้ำที่ **สถานะ** ไม่ใช่ที่ไฟล์ — กดสองครั้งติดกันต้องได้ผลเดียว
          if (doc.status === 'signed') {
            failedDocs.push({ doc_id: parsedDocId, error: 'เอกสารนี้ลงนามไปแล้ว' });
            continue;
          }

          const letterRow = await fetchCoverLetterDataByDoc(parsedDocId);
          if (!letterRow) {
            failedDocs.push({ doc_id: parsedDocId, error: 'ไม่พบข้อมูลคำร้องของเอกสารนี้' });
            continue;
          }

          const signedBytes = await buildCoverLetterPdf(toCoverLetterData(letterRow), {
            signatureFile: DocumentController.resolveDeanSignaturePath(deanProfile.e_signature_file),
            signedDate: new Date(),
          });

          const fileName = `cover_letter_signed_${parsedDocId}_${Date.now()}.pdf`;
          const relativePath = path.posix.join('secure_private', 'documents', fileName);
          const absolutePath = path.join(process.cwd(), relativePath);
          fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
          fs.writeFileSync(absolutePath, signedBytes);

          await OfficialDocumentModel.updateFilePath(parsedDocId, relativePath);
          await OfficialDocumentModel.updateStatusAndSignature(parsedDocId, 'signed', new Date());
          signedDocIds.push(parsedDocId);

          writeAudit(
            {
              action: AuditAction.DOCUMENT_SIGNED,
              entityType: 'official_document',
              entityId: parsedDocId,
              subjectId: doc.student_id,
              detail: { type: doc.type, company_id: doc.company_id },
            },
            req
          ).catch(() => undefined);

          // ⚠️ fire-and-forget — **ห้ามใส่ await** การส่งอีเมลไม่ควรทำให้คณบดีรอ
          // (ของเดิม await ไว้กลางลูป ทำให้แถบ "ลงนามสำเร็จ" ไม่ขึ้นภายใน 10 วินาที)
          notifyStudentStatusChangeByDocId(parsedDocId, 'signed').catch(console.error);
        } catch (err) {
          console.error(`Error processing doc_id: ${docId}`, err);
          failedDocs.push({
            doc_id: docId,
            error: getErrorMessage(err, 'Unknown error while signing.'),
          });
        }
      }

      res.status(200).json({
        message: 'Batch signature process completed.',
        mode: 'local',
        signing_urls: [],
        signed_count: signedDocIds.length,
        signed_doc_ids: signedDocIds,
        failed_documents: failedDocs,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Batch Sign Documents Error',
        'เกิดข้อผิดพลาดขณะลงนามเอกสาร'
      );
    }
  }

  /**
   * Locate the dean's signature image. The stored value has been written by
   * three different code paths over time, so all three locations are tried
   * before giving up. Throws so the caller records it against the document it
   * was signing rather than failing a whole batch.
   */
  private static resolveDeanSignaturePath(storedPath: string): string {
    const candidates = [
      storedPath,
      path.join(process.cwd(), 'secure_private', 'signatures', path.basename(storedPath)),
      path.join(process.cwd(), 'uploads', storedPath),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      throw new Error(`Dean e-signature file not found in secure storage: ${storedPath}`);
    }
    return found;
  }

  // ⛔ signingComplete (DocuSign callback) ถูกลบเมื่อ 2026-08-26 — คณบดีกดยืนยัน
  //    ในระบบแล้วระบบวาดหนังสือพร้อมลายเซ็นให้เลย ไม่มีเส้นทางเซ็นภายนอกอีก

  /**
   * List all official documents in the system.
   * Route: GET /api/documents
   */
  static async listDocuments(_req: Request, res: Response): Promise<void> {
    try {
      const documents = await OfficialDocumentModel.listAll();
      res.status(200).json(documents);
    } catch (error) {
      sendUnexpectedError(res, error, 'List Documents Error', 'An internal server error occurred while retrieving documents.');
    }
  }

  /**
   * Helper to automatically create a company/mentor user account and email them
   * login credentials once the Dean signs a placement document.
   */
  static async onboardCompanyAndSendEmail(companyId: number, docId?: number): Promise<void> {
    try {
      const company = await CompanyModel.findById(companyId);
      if (!company || !company.email) {
        console.log(`Company ID ${companyId} has no contact email configured. Skipping onboarding email.`);
        return;
      }

      const companyEmail = company.email.trim().toLowerCase();

      // Look up existing user by email
      let user = await UserModel.findByEmail(companyEmail);
      let inviteLink: string | undefined;

      if (!user) {
        // Opened with no password — the representative sets their own through
        // the invitation link, so no credential is ever mailed.
        user = await UserModel.createUser(companyEmail, null, 'company');
        inviteLink = await createInviteLink(user.user_id);
        console.log(`Created new company user account: ${companyEmail}`);
      } else if (!user.roles.includes('company')) {
        // SEC-03: `company.email` on a self-found placement is typed in by the
        // student. Granting 'company' to whatever account already owns that
        // address let a student hand themselves a company representative role
        // (and with it, the ability to accept their own placement and read other
        // applicants' resumes). Escalation is refused; staff resolve it manually.
        console.error(
          `[SEC-03] Refused to grant 'company' role to existing account ${companyEmail} while onboarding company ID ${companyId}. Staff must verify the contact address.`
        );
        return;
      }

      // Link the company record to this user by updating created_by.
      // Only ever claim a company that has no representative yet — never transfer
      // an existing representative's ownership as a side effect of signing.
      if (company.created_by !== user.user_id) {
        const ownerCheck = await query(
          `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_name = 'company' LIMIT 1`,
          [company.created_by]
        );
        if ((ownerCheck.rowCount ?? 0) > 0) {
          console.warn(
            `[SEC-03] Company ID ${companyId} already has representative user ${company.created_by}; leaving created_by unchanged.`
          );
        } else {
          await query('UPDATE companies SET created_by = $1 WHERE company_id = $2', [user.user_id, companyId]);
          console.log(`Updated company ID ${companyId} created_by to user ID ${user.user_id}`);
        }
      }

      // Retrieve signed document if docId is provided
      let doc = null;
      if (docId) {
        doc = await OfficialDocumentModel.findById(docId);
      }

      if (doc && doc.generated_file_path) {
        // Always send the signed PDF to the company. A brand new account also
        // carries its invitation link in the same message.
        const absolutePdfPath = path.isAbsolute(doc.generated_file_path)
          ? doc.generated_file_path
          : path.resolve(process.cwd(), doc.generated_file_path);

        await sendSignedDocumentEmail(
          companyEmail,
          company.name_th,
          doc.type,
          absolutePdfPath,
          inviteLink
        );
        console.log(`Sent signed document email with PDF attachment to ${companyEmail}`);
      } else if (inviteLink) {
        // Fallback: only invite if there is no PDF doc generated but a new user was created
        await sendCompanyInviteEmail(companyEmail, inviteLink);
        console.log(`Sent invitation email to ${companyEmail} (no PDF attached)`);
      }
    } catch (error) {
      console.error(`Error in onboardCompanyAndSendEmail for company ID ${companyId}:`, error);
    }
  }
}
