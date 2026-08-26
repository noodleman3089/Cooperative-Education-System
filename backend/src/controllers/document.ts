import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { CompanyModel } from '../models/company';
import { PersonnelModel } from '../models/personnel';
import { OfficialDocumentModel } from '../models/officialDocument';
import { UserModel } from '../models/user';
import { query } from '../config/database';
import { getErrorMessage } from '../utils/httpError';
import { DocuSignService } from '../utils/docusign';
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
 * ที่ยังอยู่คือฝั่ง **อ่านและลงนามของเดิม** ซึ่งไม่เคยพึ่งแม่แบบเลย:
 * `listDocuments` · `batchSignDocuments` (เซ็นไฟล์ที่ออกไว้แล้วใน uploads)
 * · `signingComplete` · `onboardCompanyAndSendEmail`
 * เอกสารที่ออกไปแล้วจึงยังเปิดดู ยังลงนาม และยังส่งอีเมลได้ตามปกติ
 */
export class DocumentController {
  /**
   * Secure E-Signature & Batch Approval for Official Documents.
   * Route: POST /api/documents/batch-sign
   * Access: dean (strict RBAC)
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

      // Fetch Dean Profile
      const deanUserId = req.user.userId;
      const deanProfile = await PersonnelModel.findByPersonnelId(deanUserId);

      if (!deanProfile) {
        res.status(404).json({ message: 'Dean profile not found.' });
        return;
      }

      // Validate Dean E-Signature before processing
      if (!deanProfile.e_signature_file) {
        res.status(400).json({
          message: "Dean e-signature file path not configured in profile. Please upload signature first.",
        });
        return;
      }

      /**
       * The signing route is chosen per document, not per environment.
       *
       * This used to be `if (DocuSignService.isConfigured())` around the whole
       * batch, with the local pdf-lib overlay sitting in its `else`. Generating
       * a document tolerates a failed DocuSign envelope (it logs and carries on,
       * leaving `docusign_envelope_id` NULL), so any document that lost its
       * envelope became permanently unsignable: the DocuSign branch rejected it
       * for having no envelope, and the fallback written for exactly that case
       * was unreachable because DocuSign *was* configured.
       */
      const docuSignAvailable = DocuSignService.isConfigured();

      const signingUrls: { doc_id: number; signing_url: string }[] = [];
      const signedDocIds: number[] = [];
      const failedDocs: { doc_id: number; error: string }[] = [];

      // Only documents taking the local route need the signature image, so it is
      // read on first use rather than up front.
      let cachedSigBytes: Buffer | null = null;
      const signatureBytes = (): Buffer => {
        if (cachedSigBytes) return cachedSigBytes;
        cachedSigBytes = fs.readFileSync(DocumentController.resolveDeanSignaturePath(deanProfile.e_signature_file!));
        return cachedSigBytes;
      };

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

          if (doc.status !== 'pending_sign') {
            failedDocs.push({
              doc_id: parsedDocId,
              error: `Document status must be 'pending_sign'. Current: '${doc.status}'`,
            });
            continue;
          }

          // ROUTE 1: this document has a DocuSign envelope waiting for the dean.
          if (docuSignAvailable && doc.docusign_envelope_id) {
            const secret = process.env.DOCUSIGN_WEBHOOK_SECRET || JWT_SECRET!;
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(`${parsedDocId}:${doc.docusign_envelope_id}`);
            const callbackToken = hmac.digest('hex');

            const returnUrl = (process.env.DOCUSIGN_RETURN_URL || 'http://localhost:5000/api/documents/signing-complete') + `?doc_id=${parsedDocId}&token=${callbackToken}`;
            
            const recipientName = req.user.email === 'dean1@test.com'
              ? 'Dean of Science and Technology'
              : req.user.email.split('@')[0];

            // Generate embedded signing URL for the dean
            const signingUrl = await DocuSignService.getEnvelopeSigningUrl(doc.docusign_envelope_id, {
              recipientName: recipientName,
              recipientEmail: req.user.email,
              returnUrl: returnUrl,
            });

            signingUrls.push({ doc_id: parsedDocId, signing_url: signingUrl });
            continue;
          }

          // ROUTE 2: no envelope for this document — stamp the dean's stored
          // signature onto the PDF here. This is the path the system falls back
          // to when DocuSign is switched off entirely, and now also when a
          // single document never got an envelope.
          if (!doc.generated_file_path) {
            failedDocs.push({ doc_id: parsedDocId, error: 'Document does not have a generated file path.' });
            continue;
          }

          const absolutePdfPath = path.join(process.cwd(), doc.generated_file_path);
          if (!fs.existsSync(absolutePdfPath)) {
            failedDocs.push({ doc_id: parsedDocId, error: 'PDF file not found on disk.' });
            continue;
          }

          const sigImageBytes = signatureBytes();
          const pdfBytes = fs.readFileSync(absolutePdfPath);
          const pdfDoc = await PDFDocument.load(pdfBytes);
          const pages = pdfDoc.getPages();
          const firstPage = pages[0];

          // Embed signature image (PNG or JPEG) dynamically based on magic bytes
          let sigImage;
          const isPng = sigImageBytes[0] === 0x89 && sigImageBytes[1] === 0x50 && sigImageBytes[2] === 0x4e && sigImageBytes[3] === 0x47;
          if (isPng) {
            sigImage = await pdfDoc.embedPng(sigImageBytes);
          } else {
            sigImage = await pdfDoc.embedJpg(sigImageBytes);
          }

          firstPage.drawImage(sigImage, {
            x: 100,
            y: 165,
            width: 100,
            height: 50,
          });

          // Flatten PDF Form Fields
          pdfDoc.getForm().flatten();

          const finalizedBytes = await pdfDoc.save();
          fs.writeFileSync(absolutePdfPath, finalizedBytes);

          await OfficialDocumentModel.updateStatusAndSignature(parsedDocId, 'signed', new Date());
          signedDocIds.push(parsedDocId);

          writeAudit({
            action: AuditAction.DOCUMENT_SIGNED,
            entityType: 'official_document',
            entityId: parsedDocId,
            subjectId: doc.student_id,
            detail: { mode: 'local_overlay', type: doc.type, company_id: doc.company_id },
          }, req).catch(() => undefined);

          // Send email notification to student
          notifyStudentStatusChangeByDocId(parsedDocId, 'signed').catch(console.error);

          // ⚠️ fire-and-forget เหมือนบรรทัดบน — **ห้ามใส่ await กลับ**
          //
          // ของเดิม `await` การส่งอีเมลไว้กลางลูปลงนาม คณบดีจึงต้องรอ SMTP ตอบ
          // ต่อเอกสารหนึ่งใบก่อนที่หน้าจอจะขึ้นว่าลงนามสำเร็จ — ลงนาม 10 ใบก็รอ
          // 10 รอบ ทั้งที่การลงนามในฐานข้อมูลเสร็จไปแล้ว
          // อาการที่เห็นคือแถบ "ลงนามแบบกลุ่มสำเร็จ" ไม่ขึ้นภายใน 10 วินาที
          // (coop-workflow Scenario 1 แดงเป็นครั้งคราวเพราะเหตุนี้)
          DocumentController.onboardCompanyAndSendEmail(doc.company_id, parsedDocId).catch(
            console.error
          );
        } catch (err) {
          console.error(`Error processing doc_id: ${docId}`, err);
          failedDocs.push({ doc_id: docId, error: getErrorMessage(err, 'Unknown error while signing.') });
        }
      }

      // `signed_count` counts documents that are actually signed now. It used to
      // be set to the number of DocuSign URLs handed out, which are only an
      // invitation to go and sign — nothing was signed at that point.
      res.status(200).json({
        message: 'Batch signature process completed.',
        mode: signingUrls.length > 0 ? (signedDocIds.length > 0 ? 'mixed' : 'docusign') : 'local',
        signing_urls: signingUrls,
        signed_count: signedDocIds.length,
        signed_doc_ids: signedDocIds,
        failed_documents: failedDocs,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Batch Sign Documents Error', 'An internal server error occurred during batch signature.');
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

  /**
   * Handle redirect callback from DocuSign embedded signing ceremony.
   * Route: GET /api/documents/signing-complete
   */
  static async signingComplete(req: Request, res: Response): Promise<void> {
    try {
      const docIdStr = req.query.doc_id as string;
      const event = req.query.event as string; // 'signing_complete', 'decline', etc.
      const token = req.query.token as string;

      if (!docIdStr) {
        res.status(400).send('<h1>Missing Parameter</h1><p>Required query parameter: doc_id.</p>');
        return;
      }

      const docId = parseInt(docIdStr, 10);
      if (isNaN(docId)) {
        res.status(400).send('<h1>Invalid Parameter</h1><p>doc_id must be an integer.</p>');
        return;
      }

      const doc = await OfficialDocumentModel.findById(docId);
      if (!doc) {
        res.status(404).send('<h1>Document Not Found</h1>');
        return;
      }

      // Verify HMAC token
      const secret = process.env.DOCUSIGN_WEBHOOK_SECRET || JWT_SECRET!;
      const expectedHmac = crypto.createHmac('sha256', secret);
      expectedHmac.update(`${docId}:${doc.docusign_envelope_id}`);
      const expectedToken = expectedHmac.digest('hex');

      if (!token || token !== expectedToken) {
        res.status(403).send('<h1>Access Denied</h1><p>Invalid or missing verification token.</p>');
        return;
      }

      // Sanitize event to prevent Reflected XSS
      const cleanEvent = (event || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');

      if (cleanEvent !== 'signing_complete') {
        res.status(200).send(`
          <h1>Signing Terminated</h1>
          <p>The signing process was not completed. Event status: ${cleanEvent}</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        `);
        return;
      }

      // Download the signed file from DocuSign and update DB status
      if (doc.docusign_envelope_id) {
        console.log(`Downloading signed document for docId: ${docId}, Envelope ID: ${doc.docusign_envelope_id}`);
        await DocuSignService.downloadSignedDocument(doc.docusign_envelope_id, doc.generated_file_path!);
      }

      await OfficialDocumentModel.updateStatusAndSignature(docId, 'signed', new Date());

      writeAudit({
        action: AuditAction.DOCUMENT_SIGNED,
        entityType: 'official_document',
        entityId: docId,
        subjectId: doc.student_id,
        detail: { mode: 'docusign', envelope_id: doc.docusign_envelope_id, type: doc.type },
      }).catch(() => undefined);

      // Send email notification to student
      notifyStudentStatusChangeByDocId(docId, 'signed').catch(console.error);

      // Trigger onboarding email to company representative / mentor
      await DocumentController.onboardCompanyAndSendEmail(doc.company_id, docId);

      res.status(200).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 10%;">
          <h1 style="color: #2e7d32;">✓ Signing Complete!</h1>
          <p>The official document has been cryptographically signed via DocuSign and archived securely.</p>
          <p style="color: #666; font-size: 14px;">This window will close automatically in 3 seconds...</p>
        </div>
        <script>setTimeout(() => window.close(), 3000)</script>
      `);
    } catch (error) {
      // ไม่ใช้ sendUnexpectedError ที่นี่ — ปลายทางคือเบราว์เซอร์ของผู้เซ็นซึ่งรอ HTML
      // ไม่ใช่ JSON · เป็นหนึ่งใน status(500) ดิบ 2 จุดที่เหลือโดยตั้งใจ
      console.error('DocuSign Callback Error:', error);
      // The message is not reflected back: it can carry database text (company
      // names, document titles) that a student supplied, and this response is
      // rendered as HTML in the signer's browser. It is logged above instead.
      res.status(500).send('<h1>Callback Sync Error</h1><p>An unexpected error occurred. Please contact the co-op office.</p>');
    }
  }

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
