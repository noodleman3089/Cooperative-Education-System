import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import Handlebars from 'handlebars';
import { StudentModel } from '../models/student';
import { CompanyModel } from '../models/company';
import { PersonnelModel } from '../models/personnel';
import { DocumentTemplateModel } from '../models/documentTemplate';
import { OfficialDocumentModel } from '../models/officialDocument';
import { UserModel } from '../models/user';
import { query } from '../config/database';
import { DocuSignService } from '../utils/docusign';
import { GenerateDocumentBody, BatchSignDocumentsBody } from '../types';
import {
  notifyStudentStatusChangeByDocId,
  sendCompanyInviteEmail,
  sendSignedDocumentEmail,
} from '../utils/email';
import { createInviteLink } from '../utils/invite';
import { AuditAction, writeAudit } from '../utils/audit';

/**
 * puppeteer เป็น ESM ล้วนแล้ว (`"type": "module"` ใน package ของมัน) จึงถูก
 * `require` ตรงๆ จากไฟล์ CommonJS ไม่ได้ภายใต้ `moduleResolution: node16`
 * — ต้องโหลดแบบ dynamic import
 *
 * ผลพลอยได้: มันไม่ถูกโหลดตอนสตาร์ทเซิร์ฟเวอร์อีกต่อไป แต่โหลดตอนออกเอกสารจริง
 * เท่านั้น ซึ่งเป็นงานที่นานๆ ครั้งและกินหน่วยความจำมาก
 */
const loadPuppeteer = async () => (await import('puppeteer')).default;

// Fix Task 1.2: Enforce JWT_SECRET and exit if missing to eliminate hardcoded fallback secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not configured');
  process.exit(1);
}

/**
 * An intent must have cleared the department head before any official letter is
 * generated for it. 'accepted' is included so post-placement paperwork (dispatch
 * letters, contracts) can still be produced.
 */
const DOCUMENT_ELIGIBLE_INTENT_STATUSES = [
  'approved_by_dept_head',
  'pending_sign',
  'signed',
  'pending_acceptance',
  'pending_officer_approval',
  'accepted',
];

export class DocumentController {
  /**
   * Prep data and generate a PDF using Mail Merge overlay.
   * Route: POST /api/documents/generate
   * Access: staff
   */
  static async generateDocument(req: Request, res: Response): Promise<void> {
    try {
      const { student_id, company_id, template_id } = req.body as GenerateDocumentBody;

      // 1. Validation
      if (student_id === undefined || company_id === undefined || template_id === undefined) {
        res.status(400).json({ message: 'Required fields: student_id, company_id, template_id.' });
        return;
      }

      const parsedStudentId = parseInt(student_id as any, 10);
      const parsedCompanyId = parseInt(company_id as any, 10);
      const parsedTemplateId = parseInt(template_id as any, 10);

      if (isNaN(parsedStudentId) || isNaN(parsedCompanyId) || isNaN(parsedTemplateId)) {
        res.status(400).json({ message: 'student_id, company_id, and template_id must be valid integers.' });
        return;
      }

      // 2. Fetch Profiles and Templates
      const [student, company, template] = await Promise.all([
        StudentModel.findByStudentId(parsedStudentId),
        CompanyModel.findById(parsedCompanyId),
        DocumentTemplateModel.findById(parsedTemplateId),
      ]);

      if (!student) {
        res.status(404).json({ message: `Student profile not found for ID: ${parsedStudentId}.` });
        return;
      }

      if (!company) {
        res.status(404).json({ message: `Company not found for ID: ${parsedCompanyId}.` });
        return;
      }

      if (!template) {
        res.status(404).json({ message: `Document template not found for ID: ${parsedTemplateId}.` });
        return;
      }

      // SEC-04: an official letter may only be produced for a placement that has
      // actually cleared the advisor and the department head. Without this check
      // staff could mint a signed-ready document for any student/company pair and
      // the dean's batch-sign step would happily stamp it.
      const approvedIntent = await query(
        `SELECT form_id, status FROM intent_forms
         WHERE student_id = $1 AND company_id = $2 AND status = ANY($3::text[])
         ORDER BY form_id DESC LIMIT 1`,
        [parsedStudentId, parsedCompanyId, DOCUMENT_ELIGIBLE_INTENT_STATUSES]
      );

      if ((approvedIntent.rowCount ?? 0) === 0) {
        res.status(409).json({
          message:
            'ไม่พบแบบแจ้งความจำนงที่ผ่านการอนุมัติของหัวหน้าสาขาวิชาสำหรับนักศึกษาและสถานประกอบการคู่นี้ ไม่สามารถออกเอกสารได้',
          student_id: parsedStudentId,
          company_id: parsedCompanyId,
        });
        return;
      }

      // 3. Check for missing company contact information
      if (!company.contact_person || !company.contact_position || !company.email) {
        res.status(400).json({
          message: 'Company contact info (contact_person, contact_position, email) must be filled by staff before generating PDF.',
          company_id: parsedCompanyId,
        });
        return;
      }

      // 4. Resolve Template File Path
      let templateFilePath = path.isAbsolute(template.file_path)
        ? template.file_path
        : path.join(process.cwd(), template.file_path);

      if (!fs.existsSync(templateFilePath)) {
        // Try fallback in secure_private/templates/
        const fallbackPath = path.join(process.cwd(), 'secure_private', 'templates', path.basename(template.file_path));
        if (fs.existsSync(fallbackPath)) {
          templateFilePath = fallbackPath;
        } else {
          res.status(400).json({ message: `Template PDF file not found at path: ${template.file_path}` });
          return;
        }
      }

      // 5. Process Template and Generate PDF (supporting HTML and PDF templates)
      let pdfBytes: Uint8Array;

      if (templateFilePath.endsWith('.html')) {
        console.log('Rendering HTML template using Handlebars and Puppeteer...');
        
        // 5.1 The students this letter is about.
        //
        // This filtered on `status = 'accepted'`, which is backwards for the two
        // letters that carry a name list. สหกิจ 04 (แบบแจ้งรายชื่อ) is what the
        // faculty sends *so that* the company can select students — it goes out
        // before anyone has been accepted, so the old filter produced an empty
        // list exactly when the document was needed. The same set the SEC-04
        // guard above already accepts is the right one: cleared the department
        // head, up to and including a finished placement.
        const studentsQuery = await query(
          `SELECT s.student_code,
                  COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '') as student_name,
                  m.major_name_th
           FROM intent_forms i
           JOIN students s ON i.student_id = s.student_id
           JOIN master_major m ON s.major_id = m.major_id
           WHERE i.company_id = $1 AND i.status = ANY($2::text[])
           ORDER BY s.student_code ASC`,
          [parsedCompanyId, DOCUMENT_ELIGIBLE_INTENT_STATUSES]
        );

        // No empty-list fallback: the SEC-04 check above already proved this
        // student/company pair has an intent in exactly this status set, so the
        // query cannot come back empty. The fallback that used to sit here
        // invented a major from the first two digits of the student code
        // (`startsWith('64') ? 'วิทยาการคอมพิวเตอร์' : 'เทคโนโลยีสารสนเทศ'`) and
        // printed the guess onto an official letter the dean then signed.
        const studentList = studentsQuery.rows.map((row, index) => ({
          no: index + 1,
          student_code: row.student_code,
          student_name: row.student_name,
          major_name: row.major_name_th
        }));

        // 5.2 Compile HTML using Handlebars
        const htmlSource = fs.readFileSync(templateFilePath, 'utf8');
        const compiledTemplate = Handlebars.compile(htmlSource);

        const thaiDate = new Date().toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const startDateFormatted = new Date().toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const endDateObj = new Date();
        endDateObj.setMonth(endDateObj.getMonth() + 4);
        const endDateFormatted = endDateObj.toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const renderedHtml = compiledTemplate({
          document_number: `ศธ ๐๖๒๒/ว ${(Math.floor(Math.random() * 900) + 100).toString()}`,
          company_name: company.name_th,
          recipient_name: company.contact_person || 'ผู้จัดการฝ่ายทรัพยากรบุคคล',
          job_position: company.contact_position || 'ผู้จัดการฝ่ายทรัพยากรบุคคล',
          students: studentList,
          academic_year: '๒๕๖๘',
          start_date: startDateFormatted,
          end_date: endDateFormatted,
          staff_name: 'หัวหน้างานสหกิจศึกษา',
          staff_position: 'เจ้าหน้าที่ประสานงานสหกิจศึกษา',
          current_date: thaiDate
        });

        // 5.3 Convert rendered HTML to PDF Buffer via Puppeteer
        const browser = await (await loadPuppeteer()).launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(renderedHtml, { waitUntil: 'load' });
        const pdfBuffer = await page.pdf({ 
          format: 'A4',
          margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
        });
        await browser.close();

        pdfBytes = new Uint8Array(pdfBuffer);
      } else {
        // PDF Mail Merge Fallback
        const templateBytes = fs.readFileSync(templateFilePath);
        const pdfDoc = await PDFDocument.load(templateBytes);
        pdfDoc.registerFontkit(fontkit);

        const fontPath = path.join(process.cwd(), 'secure_private', 'fonts', 'Srabun-Regular.ttf');
        let customFont;
        if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 0) {
          try {
            const fontBytes = fs.readFileSync(fontPath);
            customFont = await pdfDoc.embedFont(fontBytes);
          } catch (err) {
            console.error('Failed to embed Thai font in document generator:', err);
          }
        }

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        // Mail Merge Overlay coordinates (GPA displays N/A if null)
        firstPage.drawText(student.student_code, { x: 250, y: 650, size: 11, font: customFont });
        firstPage.drawText(student.cumulative_gpa ? Number(student.cumulative_gpa).toFixed(2) : 'N/A', { x: 250, y: 630, size: 11, font: customFont });
        firstPage.drawText(company.name_th, { x: 250, y: 610, size: 11, font: customFont });
        firstPage.drawText(company.contact_person || '', { x: 250, y: 590, size: 11, font: customFont });
        firstPage.drawText(company.contact_position || '', { x: 250, y: 570, size: 11, font: customFont });

        pdfBytes = await pdfDoc.save();
      }

      // 6. Save Generated PDF in secure folder
      const secureDocsDir = path.join(process.cwd(), 'secure_private', 'documents');
      if (!fs.existsSync(secureDocsDir)) {
        fs.mkdirSync(secureDocsDir, { recursive: true });
      }

      const uniqueFileName = `doc_${student.student_id}_${company.company_id}_${Date.now()}.pdf`;
      const relativeFilePath = path.join('secure_private', 'documents', uniqueFileName).replace(/\\/g, '/');
      const absoluteFilePath = path.join(process.cwd(), relativeFilePath);

      fs.writeFileSync(absoluteFilePath, pdfBytes);

      // 7. Insert official_documents record in DB
      let officialDoc = await OfficialDocumentModel.create({
        type: template.type,
        student_id: parsedStudentId,
        company_id: parsedCompanyId,
        template_id: parsedTemplateId,
        generated_file_path: relativeFilePath,
        status: 'pending_sign',
      });

      // 8. DocuSign Integration (if configured)
      if (DocuSignService.isConfigured()) {
        try {
          console.log('DocuSign is configured. Sending envelope...');

          const envelopeId = await DocuSignService.sendEnvelopeForSigning({
            pdfPath: relativeFilePath,
            recipientName: 'Dean of Science and Technology',
            recipientEmail: 'dean1@test.com', // In production, this would be fetched from Dean's user profile
            studentCode: student.student_code,
            companyName: company.name_th,
          });

          await OfficialDocumentModel.updateEnvelopeId(officialDoc.doc_id, envelopeId);
          officialDoc.docusign_envelope_id = envelopeId;
          console.log(`DocuSign Envelope ID ${envelopeId} linked successfully.`);
        } catch (dsError) {
          console.error('DocuSign envelope submission failed, continuing with local sign status:', dsError);
        }
      }

      writeAudit({
        action: AuditAction.DOCUMENT_GENERATED,
        entityType: 'official_document',
        entityId: officialDoc.doc_id,
        subjectId: parsedStudentId,
        detail: {
          type: template.type,
          template_id: parsedTemplateId,
          company_id: parsedCompanyId,
          intent_form_id: approvedIntent.rows[0].form_id,
        },
      }, req).catch(() => undefined);

      res.status(201).json({
        message: DocuSignService.isConfigured()
          ? 'Official document generated and uploaded to DocuSign (pending signature).'
          : 'Official document generated successfully and is pending Dean signature (Local mode).',
        document: officialDoc,
      });
    } catch (error) {
      console.error('Generate Document Error:', error);
      res.status(500).json({ message: 'An internal server error occurred during document generation.' });
    }
  }

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
          const parsedDocId = parseInt(docId as any, 10);
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
          
          // Trigger onboarding email to company representative / mentor
          await DocumentController.onboardCompanyAndSendEmail(doc.company_id, parsedDocId);
        } catch (err: any) {
          console.error(`Error processing doc_id: ${docId}`, err);
          failedDocs.push({ doc_id: docId, error: err.message || 'Unknown error while signing.' });
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
      console.error('Batch Sign Documents Error:', error);
      res.status(500).json({ message: 'An internal server error occurred during batch signature.' });
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
    } catch (error: any) {
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
      console.error('List Documents Error:', error);
      res.status(500).json({ message: 'An internal server error occurred while retrieving documents.' });
    }
  }

  /**
   * List all document templates.
   * Route: GET /api/documents/templates
   * Access: staff, advisor, dept_head, dean
   */
  static async listTemplates(_req: Request, res: Response): Promise<void> {
    try {
      const templates = await DocumentTemplateModel.findAll();
      res.status(200).json(templates);
    } catch (error) {
      console.error('List Templates Error:', error);
      res.status(500).json({ message: 'An internal server error occurred while retrieving templates.' });
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
  /**
   * Get students who are accepted and eligible for dispatch letter (Staff only)
   * Route: GET /api/documents/dispatch-eligible
   */
  static async getDispatchEligibleStudents(_req: Request, res: Response): Promise<void> {
    try {
      // Find intent forms with status = 'accepted' where the student does NOT have a pending or signed dispatch_letter yet
      const eligibleQuery = await query(`
        SELECT i.form_id, i.student_id, i.company_id, i.start_date,
               s.student_code, s.first_name as student_first_name, s.last_name as student_last_name,
               c.name_th as company_name_th,
               m.name as mentor_name
        FROM intent_forms i
        JOIN students s ON i.student_id = s.student_id
        JOIN companies c ON i.company_id = c.company_id
        LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
        LEFT JOIN official_documents d ON d.student_id = i.student_id AND d.type = 'dispatch_letter'
        WHERE i.status = 'accepted' AND d.doc_id IS NULL
      `);
      res.status(200).json(eligibleQuery.rows);
    } catch (error) {
      console.error('getDispatchEligibleStudents error:', error);
      res.status(500).json({ message: 'Error retrieving dispatch eligible students' });
    }
  }

  /**
   * Generate dispatch letter (mock 1-to-1) for a list of students (Staff only)
   * Route: POST /api/documents/generate-dispatch
   */
  static async generateDispatchLetter(req: Request, res: Response): Promise<void> {
    try {
      const { studentIds, documentNumber } = req.body;
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        res.status(400).json({ message: 'Required field: studentIds array' });
        return;
      }
      if (!documentNumber || typeof documentNumber !== 'string') {
        res.status(400).json({ message: 'Required field: documentNumber string' });
        return;
      }

      const generatedDocs = [];

      const browser = await (await loadPuppeteer()).launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      try {
        for (const studentId of studentIds) {
          // Mock generation - 1 student per document
          const parsedStudentId = parseInt(studentId as any, 10);
          if (isNaN(parsedStudentId)) continue;
          
          // Check if student exists and has an accepted intent form
          const intentRes = await query(`
            SELECT i.company_id, c.name_th as company_name, s.student_code, s.first_name, s.last_name
            FROM intent_forms i
            JOIN students s ON i.student_id = s.student_id
            JOIN companies c ON i.company_id = c.company_id
            WHERE i.student_id = $1 AND i.status = 'accepted'
          `, [parsedStudentId]);

          if (intentRes.rowCount === 0) continue;
          
          const intent = intentRes.rows[0];
          const parsedCompanyId = intent.company_id;
          
          // Load official transfer letter HTML template
          const templatePath = path.join(process.cwd(), 'secure_private', 'templates', 'transfer_letter_template.html');
          let htmlSource = '';
          if (fs.existsSync(templatePath)) {
            const rawTemplate = fs.readFileSync(templatePath, 'utf8');
            const compiled = Handlebars.compile(rawTemplate);
            htmlSource = compiled({
              document_number: documentNumber,
              current_date: new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }),
              recipient_name: 'ผู้จัดการฝ่ายทรัพยากรบุคคล',
              company_name: intent.company_name,
              start_date: '๑๖ พฤษภาคม ๒๕๖๙',
              end_date: '๑๖ กันยายน ๒๕๖๙',
              students: [
                {
                  no: 1,
                  student_code: intent.student_code,
                  student_name: `${intent.first_name} ${intent.last_name}`,
                  major_name: 'วิทยาการคอมพิวเตอร์'
                }
              ]
            });
          } else {
            // The inline fallback that used to live here built HTML by string
            // concatenation from student-supplied data (company name, document
            // number) and fed it to Puppeteer running with --no-sandbox. The
            // template file is version-controlled and always present, so the
            // fallback was dead code carrying real HTML-injection risk. Fail
            // loudly instead of rendering an unescaped document.
            throw new Error(
              `ไม่พบไฟล์เทมเพลตหนังสือส่งตัว: ${templatePath} กรุณาตรวจสอบโฟลเดอร์ secure_private/templates`
            );
          }

          const page = await browser.newPage();
          await page.setContent(htmlSource, { waitUntil: 'load' });
          const pdfBuffer = await page.pdf({ 
            format: 'A4',
            margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
          });
          await page.close();

          const pdfBytes = new Uint8Array(pdfBuffer);
          const uniqueFileName = `dispatch_${parsedStudentId}_${parsedCompanyId}_${Date.now()}.pdf`;
          const relativeFilePath = path.posix.join('secure_private', 'documents', uniqueFileName);
          const absoluteFilePath = path.join(process.cwd(), 'secure_private', 'documents', uniqueFileName);

          const secureDocsDir = path.dirname(absoluteFilePath);
          if (!fs.existsSync(secureDocsDir)) {
            fs.mkdirSync(secureDocsDir, { recursive: true });
          }
          fs.writeFileSync(absoluteFilePath, pdfBytes);

          // create official_document
          // Find a fallback template_id since this is mocked and we don't have a dispatch template row strictly guaranteed
          const templateRes = await query(`SELECT template_id FROM document_templates LIMIT 1`);
          const templateId = (templateRes.rowCount ?? 0) > 0 ? templateRes.rows[0].template_id : 1;

          const officialDoc = await OfficialDocumentModel.create({
            document_number: documentNumber,
            type: 'dispatch_letter',
            student_id: parsedStudentId,
            company_id: parsedCompanyId,
            template_id: templateId,
            generated_file_path: relativeFilePath,
            status: 'pending_sign'
          });

          generatedDocs.push(officialDoc);
        }
      } finally {
        await browser.close();
      }

      res.status(201).json({ message: 'Dispatch letters generated successfully', documents: generatedDocs });

    } catch (error) {
      console.error('generateDispatchLetter error:', error);
      res.status(500).json({ message: 'Error generating dispatch letter' });
    }
  }
}
