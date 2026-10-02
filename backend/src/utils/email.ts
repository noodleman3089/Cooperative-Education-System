import nodemailer from 'nodemailer';
import path from 'path';
import { buildAcceptanceFormPdf, AcceptanceFormData } from './acceptanceFormPdf';
import { escapeHtml as esc } from '../middlewares/validation';
import { INVITE_TTL_LABEL, companyLoginUrl } from './invite';
import { JOB_OFFER_TOKEN_TTL_LABEL } from './jobOfferToken';
import { formatThaiDate } from './thaiDate';
import { mentorLoginPageUrl } from './mentorLoginLink';
import { query } from '../config/database';

/**
 * These emails are assembled as HTML strings, and several of the values that go
 * into them are typed by users — a student picks the company name and contact
 * address on a self-found placement, and reviewers write free-text rejection
 * reasons. Anything interpolated into the markup below therefore goes through
 * `esc()` first. Plain-text fields (mail subjects, the `to:` address) are left
 * verbatim, since escaping there would show entities to the reader.
 */

// Configure transporter
// MAIL_DRY_RUN=true → ไม่ออกเน็ตเลย (คืน JSON ของเมลแทน) ไว้ให้ E2E ส่งเมลทางสำเร็จได้
// โดยไม่มีจดหมายจริงออกไป · production ห้ามเปิด (`config/validateEnv.ts` ปฏิเสธสตาร์ท)
const transporter =
  process.env.MAIL_DRY_RUN === 'true'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
        port: parseInt(process.env.SMTP_PORT || '2525', 10),
        auth: {
          user: process.env.SMTP_USER || 'mock_user',
          pass: process.env.SMTP_PASS || 'mock_pass',
        },
      });

const SMTP_FROM = process.env.SMTP_FROM || 'coop-system@rmutto.ac.th';

// ponytail: Shared template helper to avoid duplicate email layout boilerplate.
const renderEmailHtml = (options: {
  title: string;
  themeColor?: string;
  content: string;
  highlightBox?: string;
  footnote?: string;
  /** แทนบรรทัด "กรุณาอย่าตอบกลับอีเมลนี้" — ข้อความตายตัวของผู้เรียก ห้ามใส่ข้อมูลผู้ใช้ */
  replyNote?: string;
}) => {
  const theme = options.themeColor || '#1a73e8';
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
      <h2 style="color: ${theme}; border-bottom: 2px solid ${theme}; padding-bottom: 10px;">${options.title}</h2>
      ${options.content}
      ${options.highlightBox ? `
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; border-left: 5px solid ${theme}; margin: 15px 0;">
          ${options.highlightBox}
        </div>
      ` : ''}
      ${options.footnote || ''}
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 0.85em; color: #888; text-align: center;">
        จดหมายข่าวส่งอัตโนมัติโดยระบบบริหารจัดการงานสหกิจศึกษา RMUTTO<br>
        ${options.replyNote ?? 'กรุณาอย่าตอบกลับอีเมลนี้'}
      </p>
    </div>
  `;
};

/**
 * Renders the "set your password" call to action shared by both invitation
 * emails. The link is the only credential these emails carry — no password is
 * ever mailed, so nothing usable is left behind in the recipient's inbox.
 */
const inviteCallToAction = (inviteLink: string, buttonColor: string) => `
  <div style="text-align: center; margin: 24px 0;">
    <a href="${inviteLink}"
       style="display: inline-block; padding: 12px 32px; background-color: ${buttonColor}; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
      ตั้งรหัสผ่านและเข้าใช้งาน
    </a>
  </div>
`;

const inviteFootnote = (loginUrl: string) => `
  <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
    ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุใน ${INVITE_TTL_LABEL}<br/>
    หากลิงก์หมดอายุแล้ว กรุณาไปที่ <a href="${loginUrl}" style="color: #2563eb;">หน้าเข้าสู่ระบบสถานประกอบการ</a>
    แล้วกด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่<br/>
    หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่ดูแลงานสหกิจศึกษา
  </p>
`;

/**
 * Invites a company representative to set their own password.
 */
export const sendCompanyInviteEmail = async (
  toEmail: string,
  inviteLink: string
): Promise<void> => {
  const content = `
    <p>ท่านได้รับสิทธิ์การเข้าใช้งาน <b>ระบบบริหารจัดการงานสหกิจศึกษาออนไลน์ (Online Cooperative Education Management System)</b> ของ มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO)</p>
    <p>บัญชีของท่านคือ <b>${esc(toEmail)}</b> กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านด้วยตัวท่านเอง แล้วเข้าใช้งานระบบ</p>
    ${inviteCallToAction(inviteLink, '#2563eb')}
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: 'เชิญเปิดใช้งานบัญชีสำหรับสถานประกอบการ - ระบบสหกิจศึกษาออนไลน์',
    html: renderEmailHtml({
      title: 'สวัสดีครับ/ค่ะ ตัวแทนสถานประกอบการ',
      themeColor: '#1a73e8',
      content,
      footnote: inviteFootnote(companyLoginUrl())
    })
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Company invitation email successfully sent to: ${toEmail}`);
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] COMPANY INVITE (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error(`  Link: ${inviteLink}`);
    console.error('════════════════════════════════════════════════════');
  }
};

/**
 * Invites a mentor to set their own password.
 */
export const sendMentorInviteEmail = async (
  toEmail: string,
  inviteLink: string
): Promise<void> => {
  const content = `
    <p>ท่านได้รับการลงทะเบียนเป็น <b>พี่เลี้ยงดูแลนักศึกษาฝึกปฏิบัติสหกิจศึกษา (Coop Mentor)</b> ในระบบบริหารจัดการงานสหกิจศึกษาออนไลน์ ของ มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO)</p>
    <p>บัญชีของท่านคือ <b>${esc(toEmail)}</b> กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านด้วยตัวท่านเอง แล้วเข้าใช้งานเพื่อประเมินและติดตามนักศึกษา</p>
    ${inviteCallToAction(inviteLink, '#2e7d32')}
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: 'เชิญเปิดใช้งานบัญชีสำหรับพี่เลี้ยงนักศึกษาสหกิจ - ระบบสหกิจศึกษาออนไลน์',
    html: renderEmailHtml({
      title: 'สวัสดีครับ/ค่ะ พี่เลี้ยงนักศึกษา (Mentor)',
      themeColor: '#2e7d32',
      content,
      footnote: inviteFootnote(companyLoginUrl())
    })
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Mentor invitation email successfully sent to: ${toEmail}`);
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] MENTOR INVITE (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error(`  Link: ${inviteLink}`);
    console.error('════════════════════════════════════════════════════');
  }
};

/**
 * Tells an account holder their password was just set or changed.
 *
 * An invitation link is delivered to a mailbox that is often shared, so there
 * is a window in which someone other than the intended recipient could claim
 * the account. This is what closes it: the real owner finds out the moment it
 * happens rather than the next time they fail to log in.
 */
export const sendPasswordSetNoticeEmail = async (
  toEmail: string,
  isFirstActivation: boolean
): Promise<void> => {
  const title = isFirstActivation ? 'บัญชีของท่านเปิดใช้งานแล้ว' : 'รหัสผ่านของท่านถูกเปลี่ยน';
  const what = isFirstActivation
    ? 'บัญชีของท่านถูกเปิดใช้งานและตั้งรหัสผ่านเรียบร้อยแล้ว'
    : 'รหัสผ่านของบัญชีของท่านถูกเปลี่ยนเรียบร้อยแล้ว';

  const content = `
    <p>เรียน ผู้ใช้งาน <b>${esc(toEmail)}</b></p>
    <p>${what} เมื่อ ${new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' })}</p>
    <p style="color: #b45309;"><b>หากไม่ใช่ท่านเป็นผู้ดำเนินการ</b> กรุณาติดต่อเจ้าหน้าที่ดูแลงานสหกิจศึกษาโดยด่วน เพื่อระงับบัญชีและออกลิงก์ใหม่ให้ท่าน</p>
  `;

  try {
    await transporter.sendMail({
      from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
      to: toEmail,
      subject: `${title} - ระบบสหกิจศึกษาออนไลน์`,
      html: renderEmailHtml({ title, themeColor: '#1e3a5f', content }),
    });
    console.log(`[Email] Password-set notice sent to: ${toEmail}`);
  } catch {
    console.error(`[Email] Failed to send password-set notice to ${toEmail}`);
  }
};

/**
 * นักศึกษาสั่งระบบส่งหนังสือขอความอนุเคราะห์ (ลงนามแล้ว) + แบบตอบรับ (เอกสารหมายเลข 2)
 * ไปยังสถานประกอบการ — เรียกจาก `IntentFormController.sendCoverLetterToCompany`
 *
 * ⛔ **ไม่กลืน error** — ต่างจากฟังก์ชันส่งเมลอื่นในไฟล์นี้โดยตั้งใจ ถ้าส่งไม่ออกแล้วเงียบ
 *    นักศึกษาจะเห็นว่า "ส่งแล้ว" ทั้งที่บริษัทไม่ได้รับอะไร · ปล่อยให้ controller ตอบ 502
 * ⛔ เนื้อความเป็นแม่แบบตายตัว ไม่มีข้อความอิสระ · ทุกค่าที่แทรกในมาร์กอัปผ่าน `esc()`
 *    (ชื่อบริษัทมาจากที่นักศึกษาพิมพ์) · `replyTo` = อีเมลมหาวิทยาลัยของนักศึกษา
 *    บริษัทจึงตอบกลับถึงนักศึกษาโดยตรง
 */
export const sendCoverLetterToCompany = async (params: {
  toEmail: string;
  replyTo: string;
  studentName: string;
  studentCode?: string | null;
  majorName: string;
  companyName: string;
  /** พาธของหนังสือที่ลงนามแล้ว (`official_documents.generated_file_path`) */
  coverLetterPath: string;
  acceptanceForm: AcceptanceFormData;
  /** ลิงก์ตอบรับออนไลน์ (`utils/acceptanceLinkToken.ts`) + วันสุดท้ายที่ใช้ได้ YYYY-MM-DD — url สร้างจากค่าของระบบล้วน */
  acceptanceLink: { url: string; expiresOn: string };
}): Promise<void> => {
  const absolutePath = path.isAbsolute(params.coverLetterPath)
    ? params.coverLetterPath
    : path.resolve(process.cwd(), params.coverLetterPath);
  const acceptancePdf = await buildAcceptanceFormPdf(params.acceptanceForm);

  const studentLabel = params.studentCode
    ? `${params.studentName} (รหัสนักศึกษา ${params.studentCode})`
    : params.studentName;

  const content = `
    <p>เรียน ผู้เกี่ยวข้อง ${esc(params.companyName)}</p>
    <p>มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO) ขอความอนุเคราะห์รับนักศึกษาเข้าฝึกปฏิบัติงานสหกิจศึกษา
       โดย <b>${esc(studentLabel)}</b> สาขาวิชา ${esc(params.majorName)}
       เป็นผู้ประสานงานและส่งเอกสารฉบับนี้ถึงท่านด้วยตนเองผ่านระบบงานสหกิจศึกษา</p>
    <p>ได้แนบเอกสารมาพร้อมอีเมลนี้ 2 ฉบับ</p>
    <ol>
      <li>หนังสือขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา (ลงนามโดยคณบดีแล้ว)</li>
      <li>แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา (เอกสารหมายเลข ๒)</li>
    </ol>
    <p>ขอความกรุณาท่านกรอกและลงนามพร้อมประทับตราในแบบยืนยันแบบตอบรับ (เอกสารหมายเลข ๒)
       ภายใน ๑๕ วันทำการหลังจากได้รับหนังสือฯ <b>ตอบรับออนไลน์ได้ที่ปุ่มด้านล่าง</b>
       (แนบไฟล์แบบตอบรับที่ลงนามแล้วและกรอกแบบแจ้งรายละเอียดงาน สหกิจ 07 ในหน้าเดียวกัน)
       หรือส่งกลับมายังนักศึกษาโดยตรงก็ได้ (ตอบกลับอีเมลฉบับนี้ ข้อความจะถึงนักศึกษา)</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${esc(params.acceptanceLink.url)}"
         style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        ตอบรับออนไลน์
      </a>
    </div>
    <p style="color: #6b7280; font-size: 13px;">ลิงก์ใช้ได้ครั้งเดียว หมดอายุสิ้นวันที่ <b>${esc(formatThaiDate(params.acceptanceLink.expiresOn))}</b>
       · ถ้านักศึกษาส่งหนังสือให้ท่านอีกครั้ง ลิงก์ในอีเมลฉบับก่อนจะใช้ไม่ได้ ให้ใช้ลิงก์ในฉบับล่าสุด</p>
    <p>ขอบพระคุณเป็นอย่างสูงมา ณ โอกาสนี้</p>
  `;

  await transporter.sendMail({
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: params.toEmail,
    replyTo: params.replyTo,
    subject: `หนังสือขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา - ${params.companyName}`,
    html: renderEmailHtml({
      title: 'ขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา',
      themeColor: '#1a73e8',
      content,
      replyNote: 'หากต้องการตอบกลับ ตอบกลับอีเมลนี้ได้โดยตรง ข้อความจะถึงนักศึกษาผู้ส่ง',
    }),
    attachments: [
      { filename: 'cover-letter-signed.pdf', path: absolutePath },
      { filename: 'acceptance-form.pdf', content: acceptancePdf, contentType: 'application/pdf' },
    ],
  });
  console.log(`[Email] Cover letter + acceptance form sent to company address by student`);
};

/**
 * Sends a password reset email with a clickable link.
 * Falls back to console logging if SMTP fails.
 */
export const sendPasswordResetEmail = async (
  toEmail: string,
  resetLink: string
): Promise<void> => {
  const content = `
    <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
      ท่านได้ขอรีเซ็ตรหัสผ่านสำหรับระบบสหกิจศึกษา RMUTTO<br/>
      กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:
    </p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${resetLink}" 
         style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        ตั้งรหัสผ่านใหม่
      </a>
    </div>
  `;

  const footnote = `
    <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
      ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง<br/>
      หากท่านไม่ได้ร้องขอ กรุณาเพิกเฉยอีเมลนี้
    </p>
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: 'รีเซ็ตรหัสผ่าน — ระบบสหกิจศึกษา RMUTTO',
    html: renderEmailHtml({
      title: '🔑 รีเซ็ตรหัสผ่าน',
      themeColor: '#1e3a5f',
      content,
      footnote
    }),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Password reset email sent to: ${toEmail}`);
  } catch {
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] PASSWORD RESET (SMTP failed — dev console fallback)`);
    console.error(`  To: ${toEmail}`);
    console.error(`  Link: ${resetLink}`);
    console.error('════════════════════════════════════════════════════');
  }
};

/**
 * Sends a status update email to a student's primary and (optional) alternative emails.
 */
export const sendStudentStatusUpdateEmail = async (
  studentId: number,
  studentName: string,
  subject: string,
  statusLabel: string,
  /** Already-built markup — callers must escape any user data they put in it. */
  detailsHtml: string
): Promise<void> => {
  try {
    const studentQuery = await query(
      `SELECT u.email as primary_email, s.alt_email
       FROM students s
       JOIN users u ON s.student_id = u.user_id
       WHERE s.student_id = $1`,
      [studentId]
    );

    if ((studentQuery.rowCount ?? 0) === 0) {
      console.warn(`[Email] Student ID ${studentId} not found, skipping email notification.`);
      return;
    }

    const { primary_email, alt_email } = studentQuery.rows[0];
    const recipients: string[] = [];
    if (primary_email) recipients.push(primary_email.trim());
    if (alt_email && alt_email.trim()) recipients.push(alt_email.trim());

    if (recipients.length === 0) {
      console.warn(`[Email] Student ID ${studentId} has no emails configured, skipping email notification.`);
      return;
    }

    const highlightBox = `
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 35%; font-weight: bold; padding: 5px 0;">สถานะปัจจุบัน:</td>
          <td style="padding: 5px 0; color: #1a73e8; font-weight: bold;">${esc(statusLabel)}</td>
        </tr>
      </table>
    `;

    const content = `
      <p>ระบบงานสหกิจศึกษาออนไลน์ มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO) ขอแจ้งสถานะการดำเนินการคำขอฝึกปฏิบัติสหกิจศึกษาของท่าน ดังนี้:</p>
      <div style="margin: 15px 0;">
        ${detailsHtml}
      </div>
      <p>ท่านสามารถเข้าสู่ระบบสหกิจศึกษาเพื่อตรวจสอบรายละเอียดเพิ่มเติมและดำเนินการในขั้นตอนต่อไปได้ที่เว็บไซต์ของระบบ</p>
    `;

    const mailOptions = {
      from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
      to: recipients.join(', '),
      subject: subject,
      html: renderEmailHtml({
        title: `สวัสดีครับ/ค่ะ คุณ ${esc(studentName)}`,
        themeColor: '#1a73e8',
        content,
        highlightBox
      }),
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email] Student status update email successfully sent to: ${recipients.join(', ')}`);
  } catch (error) {
    console.error(`[Email] FAILED TO SEND student status update email for Student ID ${studentId}:`, error);
  }
};

/**
 * Helper to notify student of a status change on an intent form.
 */
export const notifyStudentStatusChange = async (
  intentId: number,
  status: string,
  reason?: string
): Promise<void> => {
  try {
    const intentQuery = await query(
      `SELECT 
        i.student_id,
        s.first_name,
        s.last_name,
        c.name_th as company_name,
        j.title as job_title
       FROM intent_forms i
       JOIN students s ON i.student_id = s.student_id
       JOIN companies c ON i.company_id = c.company_id
       LEFT JOIN job_posts j ON i.job_id = j.job_id
       WHERE i.form_id = $1`,
      [intentId]
    );

    if ((intentQuery.rowCount ?? 0) === 0) {
      console.warn(`[Email] Intent Form ID ${intentId} not found, skipping student status notification.`);
      return;
    }

    const { student_id, first_name, last_name, company_name, job_title } = intentQuery.rows[0];
    // studentName is escaped by sendStudentStatusUpdateEmail; do not escape twice.
    const studentName = `${first_name || ''} ${last_name || ''}`.trim() || 'นักศึกษา';

    // Escaped once here so every branch below is safe. company_name is typed by
    // the student on a self-found placement and `reason` is reviewer free text.
    const safeCompanyName = esc(company_name || '');
    const safeReason = reason ? esc(reason) : '';

    const subject = 'อัปเดตสถานะการพิจารณาคำขอสหกิจศึกษา — RMUTTO';
    let statusLabel = '';
    let detailsHtml = '';

    const jobInfo = job_title ? `ตำแหน่งงาน: ${esc(job_title)}` : 'สมัครงานทั่วไป';

    // ⛔ สาขา 'approved_by_advisor' และ 'rejected_by_dept_head' ถูกลบ 2026-08-27
    //    — ไม่มีใบไหนไปถึงสองสถานะนั้นอีกแล้วตั้งแต่ลายเซ็นย้ายไปอยู่บนกระดาษ
    if (status === 'rejected') {
      statusLabel = 'อาจารย์ที่ปรึกษาตีกลับใบคำร้อง';
      detailsHtml = `
        <p>ใบความจำนงขอฝึกงานที่ <b>${safeCompanyName}</b> (${jobInfo}) ได้ถูก<b>ตีกลับ / ปฏิเสธ</b>โดยอาจารย์ที่ปรึกษาสหกิจศึกษา</p>
        ${reason ? `<p style="color: #d93025; font-weight: bold;">เหตุผลการตีกลับ: ${safeReason}</p>` : ''}
        <p>กรุณาเข้าระบบเพื่อตรวจสอบรายละเอียด ปรับปรุงข้อมูล หรือทำเรื่องเลือกสถานประกอบการอื่นใหม่</p>
      `;
    } else if (status === 'approved_by_dept_head') {
      // ชื่อสถานะยังเป็น `approved_by_dept_head` เพราะทุกอย่างท้ายน้ำอ่านค่านี้ แต่
      // **คนที่กดคือเจ้าหน้าที่** ลายเซ็นที่ปรึกษา/หัวหน้าสาขาอยู่บนกระดาษไปแล้ว
      statusLabel = 'เจ้าหน้าที่รับคำร้องแล้ว';
      detailsHtml = `
        <p>เจ้าหน้าที่งานสหกิจศึกษาได้<b>รับแบบคำร้องที่ลงนามครบ</b>ของท่านสำหรับ <b>${safeCompanyName}</b> (${jobInfo}) และออกเลขที่หนังสือเรียบร้อยแล้ว</p>
        <p>ขณะนี้หนังสือขอความอนุเคราะห์อยู่ในคิวรอคณบดีลงนาม เมื่อลงนามแล้วท่านจะดาวน์โหลดไปยื่นสถานประกอบการได้เอง</p>
      `;
    } else if (status === 'accepted') {
      statusLabel = 'ตอบรับเข้าปฏิบัติงานสหกิจศึกษาเรียบร้อยแล้ว';
      detailsHtml = `
        <p>ยินดีด้วย! สถานประกอบการ <b>${safeCompanyName}</b> ได้ดำเนินการ<b>ตอบรับคุณเข้าปฏิบัติงานสหกิจศึกษา</b>เป็นที่เรียบร้อยแล้ว</p>
        <p>ระบบได้ทำการบันทึกข้อมูลพี่เลี้ยง (Mentor) และวันเริ่มงานของคุณในระบบเรียบร้อยแล้ว กรุณาเข้าตรวจสอบข้อมูลและเตรียมพร้อมก่อนเริ่มปฏิบัติงาน</p>
      `;
    } else if (status === 'company_rejected') {
      statusLabel = 'สถานประกอบการปฏิเสธคำขอ';
      detailsHtml = `
        <p>ใบสมัครฝึกงานที่ <b>${safeCompanyName}</b> ของคุณได้รับการ<b>ปฏิเสธ</b>จากทางสถานประกอบการ</p>
        ${reason ? `<p style="color: #d93025; font-weight: bold;">เหตุผลที่สถานประกอบการแจ้ง: ${safeReason}</p>` : ''}
        <p>ระบบได้ดำเนินการ<b>ปลดล็อกสิทธิ์</b>เรียบร้อยแล้ว คุณสามารถเข้าสู่ระบบเพื่อเลือกและยื่นความจำนงสมัครงานที่บริษัทอื่นใหม่ได้ทันที</p>
      `;
    } else if (status === 'pending_officer_approval') {
      statusLabel = 'รอเจ้าหน้าที่ตรวจสอบเอกสารตอบรับ';
      detailsHtml = `
        <p>คุณได้ทำการอัปโหลดหลักฐานเอกสารใบตอบรับสำหรับ <b>${safeCompanyName}</b> เรียบร้อยแล้ว</p>
        <p>ขณะนี้อยู่ในขั้นตอน<b>รอเจ้าหน้าที่ตรวจสอบเอกสารตอบรับและเปิดใช้งานบัญชีพี่เลี้ยง</b>ในระบบ</p>
      `;
    } else if (status === 'evidence_rejected') {
      statusLabel = 'เจ้าหน้าที่ตีกลับเอกสารตอบรับ';
      detailsHtml = `
        <p>เอกสารหลักฐานการตอบรับเข้าฝึกงานที่ <b>${safeCompanyName}</b> ที่คุณอัปโหลดได้รับการ<b>ตีกลับ / ปฏิเสธ</b>โดยเจ้าหน้าที่งานสหกิจศึกษา</p>
        ${reason ? `<p style="color: #d93025; font-weight: bold;">เหตุผลการตีกลับ: ${safeReason}</p>` : ''}
        <p>กรุณาเข้าระบบเพื่อตรวจสอบความถูกต้องของเอกสาร อัปโหลดไฟล์หลักฐานใหม่ หรือทำการยื่นเรื่องเลือกสถานประกอบการอื่นต่อไป</p>
      `;
    } else {
      statusLabel = status.replace(/_/g, ' ');
      detailsHtml = `<p>มีการเปลี่ยนแปลงสถานะใบคำร้องของคุณที่ <b>${safeCompanyName}</b> เป็นสถานะ: <b>${statusLabel}</b></p>`;
    }

    await sendStudentStatusUpdateEmail(student_id, studentName, subject, statusLabel, detailsHtml);
  } catch (error) {
    console.error(`[Email] Error in notifyStudentStatusChange for Intent ID ${intentId}:`, error);
  }
};

/**
 * Helper to notify student of a document status update (signed by Dean).
 */
export const notifyStudentStatusChangeByDocId = async (
  docId: number,
  status: string
): Promise<void> => {
  try {
    const docQuery = await query(
      `SELECT 
        d.student_id,
        s.first_name,
        s.last_name,
        c.name_th as company_name,
        d.type as doc_type
       FROM official_documents d
       JOIN students s ON d.student_id = s.student_id
       JOIN companies c ON d.company_id = c.company_id
       WHERE d.doc_id = $1`,
      [docId]
    );

    if ((docQuery.rowCount ?? 0) === 0) {
      console.warn(`[Email] Document ID ${docId} not found, skipping student document status notification.`);
      return;
    }

    const { student_id, first_name, last_name, company_name, doc_type } = docQuery.rows[0];
    const studentName = `${first_name || ''} ${last_name || ''}`.trim() || 'นักศึกษา';
    const safeCompanyName = esc(company_name || '');
    const docTypeLabel = doc_type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์รับนักศึกษา' : 'หนังสือส่งตัวนักศึกษา';

    const subject = 'เอกสารทางการสหกิจศึกษาได้รับการลงนามแล้ว — RMUTTO';
    let statusLabel = '';
    let detailsHtml = '';

    if (status === 'signed') {
      statusLabel = 'คณบดีลงนามเอกสารเรียบร้อยแล้ว';
      detailsHtml = `
        <p>เอกสารราชการ <b>${docTypeLabel}</b> สำหรับการฝึกงานของคุณที่ <b>${safeCompanyName}</b> ได้รับการ<b>ลงนามอนุมัติอิเล็กทรอนิกส์โดยคณบดี</b>เป็นที่เรียบร้อยแล้ว</p>
        <p>คุณสามารถเข้าไปดาวน์โหลดเอกสาร PDF ดังกล่าวได้จากหน้าแดชบอร์ดนักศึกษาของคุณ${
          doc_type === 'cover_letter'
            ? ' และส่งหนังสือพร้อมแบบตอบรับให้สถานประกอบการเองได้จากหน้าแดชบอร์ดเช่นกัน'
            : ''
        }</p>
      `;
    } else {
      statusLabel = status.replace(/_/g, ' ');
      detailsHtml = `<p>เอกสาร ${docTypeLabel} ได้รับการเปลี่ยนสถานะเป็น: ${statusLabel}</p>`;
    }

    await sendStudentStatusUpdateEmail(student_id, studentName, subject, statusLabel, detailsHtml);
  } catch (error) {
    console.error(`[Email] Error in notifyStudentStatusChangeByDocId for Doc ID ${docId}:`, error);
  }
};

/**
 * Helper to notify student, advisor, and supervisor of an assignment.
 */
export const sendPersonnelAssignmentEmail = async (
  studentId: number,
  advisorId: number,
  supervisorId: number
): Promise<void> => {
  try {
    const dataQuery = await query(
      `SELECT 
        s.first_name as student_fname, s.last_name as student_lname, u_s.email as student_email,
        a.first_name as adv_fname, a.last_name as adv_lname, u_a.email as adv_email,
        sup.first_name as sup_fname, sup.last_name as sup_lname, u_sup.email as sup_email,
        c.name_th as company_name
       FROM students s
       JOIN users u_s ON s.student_id = u_s.user_id
       LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status NOT IN ('rejected', 'company_rejected')
       LEFT JOIN companies c ON i.company_id = c.company_id
       JOIN personnel a ON a.personnel_id = $2
       JOIN users u_a ON a.personnel_id = u_a.user_id
       JOIN personnel sup ON sup.personnel_id = $3
       JOIN users u_sup ON sup.personnel_id = u_sup.user_id
       WHERE s.student_id = $1`,
      [studentId, advisorId, supervisorId]
    );

    if ((dataQuery.rowCount ?? 0) === 0) return;

    const row = dataQuery.rows[0];
    // Escaped for the markup below; names and company come from user input.
    const studentName = esc(`${row.student_fname || ''} ${row.student_lname || ''}`.trim());
    const advName = esc(`${row.adv_fname || ''} ${row.adv_lname || ''}`.trim());
    const supName = esc(`${row.sup_fname || ''} ${row.sup_lname || ''}`.trim());
    const company = esc(row.company_name || 'สถานประกอบการ');

    const subject = 'การมอบหมายอาจารย์ที่ปรึกษาและอาจารย์นิเทศสหกิจศึกษา — RMUTTO';
    const highlightBox = `
      <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
        <tr>
          <td style="width: 35%; font-weight: bold; padding: 5px 0;">ชื่อนักศึกษา:</td>
          <td style="padding: 5px 0;">${studentName}</td>
        </tr>
        <tr>
          <td style="width: 35%; font-weight: bold; padding: 5px 0;">สถานประกอบการ:</td>
          <td style="padding: 5px 0;">${company}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; padding: 5px 0;">อาจารย์ที่ปรึกษาสหกิจ:</td>
          <td style="padding: 5px 0; color: #1a73e8;">${advName}</td>
        </tr>
        <tr>
          <td style="font-weight: bold; padding: 5px 0;">อาจารย์นิเทศสหกิจ:</td>
          <td style="padding: 5px 0; color: #d93025;">${supName}</td>
        </tr>
      </table>
    `;

    // 1. Notify Student
    if (row.student_email) {
      const studentHtml = `
        <p>หัวหน้าสาขาวิชาได้ทำการมอบหมาย <b>อาจารย์ที่ปรึกษา</b> และ <b>อาจารย์นิเทศ</b> ประจำตัวสำหรับการออกปฏิบัติสหกิจศึกษาของท่านเรียบร้อยแล้ว</p>
        <p>ท่านสามารถติดต่อประสานงานกับอาจารย์ทั้งสองท่านในกรณีที่มีข้อสงสัย ปรึกษาแผนปฏิบัติงาน หรือรายงานตัวได้ตามรายละเอียดที่แสดงในแดชบอร์ดนักศึกษาของท่าน</p>
      `;
      await transporter.sendMail({
        from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
        to: row.student_email,
        subject,
        html: renderEmailHtml({ title: `สวัสดีคุณ ${studentName}`, content: studentHtml, highlightBox })
      });
    }

    // 2. Notify Personnel (Advisor and Supervisor)
    const personnelEmails = [];
    if (row.adv_email) personnelEmails.push(row.adv_email);
    if (row.sup_email && row.sup_email !== row.adv_email) personnelEmails.push(row.sup_email);

    if (personnelEmails.length > 0) {
      const personnelHtml = `
        <p>ท่านได้รับการมอบหมายให้ดูแลนักศึกษาสหกิจศึกษาประจำปีการศึกษานี้เรียบร้อยแล้ว</p>
        <p>กรุณาเข้าสู่ระบบเพื่อตรวจสอบข้อมูลนักศึกษา แผนปฏิบัติงาน และข้อมูลติดต่อสถานประกอบการที่เมนู <b>"นิเทศและติดตามนักศึกษา"</b></p>
      `;
      await transporter.sendMail({
        from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
        to: personnelEmails.join(', '),
        subject: `[Notification] ได้รับมอบหมายดูแลนักศึกษาสหกิจ - ${studentName}`,
        html: renderEmailHtml({ title: `เรียน อาจารย์ที่ปรึกษา/อาจารย์นิเทศ`, content: personnelHtml, highlightBox })
      });
    }

    console.log(`[Email] Personnel assignment emails sent successfully for Student ID ${studentId}.`);
  } catch (error) {
    console.error(`[Email] Error in sendPersonnelAssignmentEmail for Student ID ${studentId}:`, error);
  }
};

/**
 * Sends a supervision appointment email to the mentor.
 */
export const sendSupervisionAppointmentEmail = async (
  mentorEmail: string,
  appointmentDetails: {
    studentName: string;
    companyName: string;
    appointmentDate: string;
    studentTime: string;
    mentorTime: string;
    tourRequested: boolean;
  },
  tokenLink: string,
  // ลิงก์เข้าสู่ระบบใช้ครั้งเดียวของพี่เลี้ยง (ไม่ส่ง = มีแค่ปุ่มตอบรับเดิม)
  loginLink?: string
): Promise<void> => {
  const subject = 'ขอนัดหมายนิเทศนักศึกษาสหกิจศึกษา — RMUTTO';

  // studentTime / mentorTime are free-text fields typed by the advisor.
  const d = {
    studentName: esc(appointmentDetails.studentName || ''),
    companyName: esc(appointmentDetails.companyName || ''),
    appointmentDate: esc(appointmentDetails.appointmentDate || ''),
    studentTime: esc(appointmentDetails.studentTime || ''),
    mentorTime: esc(appointmentDetails.mentorTime || ''),
    tourRequested: appointmentDetails.tourRequested,
  };

  const highlightBox = `
    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
      <tr>
        <td style="width: 35%; font-weight: bold; padding: 5px 0;">ชื่อนักศึกษา:</td>
        <td style="padding: 5px 0;">${d.studentName}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; padding: 5px 0;">วันที่ขอนัดหมาย:</td>
        <td style="padding: 5px 0; color: #1a73e8; font-weight: bold;">${d.appointmentDate}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; padding: 5px 0;">เวลาสำหรับนักศึกษา:</td>
        <td style="padding: 5px 0;">${d.studentTime}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; padding: 5px 0;">เวลาสำหรับพี่เลี้ยง:</td>
        <td style="padding: 5px 0; color: #d93025;">${d.mentorTime}</td>
      </tr>
      ${d.tourRequested ? `
      <tr>
        <td style="font-weight: bold; padding: 5px 0;">หมายเหตุ:</td>
        <td style="padding: 5px 0; color: #e67e22;">อาจารย์นิเทศขอความอนุเคราะห์เข้าเยี่ยมชมสถานประกอบการ (ถ้าเป็นไปได้)</td>
      </tr>
      ` : ''}
    </table>
  `;

  const content = `
    <p>เรียน พี่เลี้ยงนักศึกษาสหกิจศึกษา บริษัท <b>${d.companyName}</b></p>
    <p>มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO) ขอความอนุเคราะห์นัดหมายเพื่อออกนิเทศและติดตามความก้าวหน้าการปฏิบัติงานของนักศึกษาสหกิจศึกษา ตามรายละเอียดด้านล่างนี้</p>
    
    <div style="text-align: center; margin: 24px 0;">
      <a href="${tokenLink}" 
         style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        ตอบรับ / ขอเลื่อนนัด
      </a>
    </div>
    
    <p>ท่านสามารถคลิกปุ่มด้านบนเพื่อ <b>ตอบรับการนัดหมาย</b> หรือ <b>เสนอเวลาใหม่</b> ได้โดยไม่ต้องเข้าสู่ระบบ</p>
    ${loginLink ? `
    <div style="text-align: center; margin: 16px 0 4px;">
      <a href="${esc(loginLink)}"
         style="display: inline-block; padding: 8px 20px; background-color: #ffffff; color: #2e7d32; border: 1px solid #2e7d32; font-weight: bold; font-size: 13px; text-decoration: none; border-radius: 8px;">
        เข้าสู่ระบบสหกิจศึกษา
      </a>
    </div>
    <p style="text-align: center; font-size: 12px; color: #666;">ลิงก์เข้าสู่ระบบนี้ใช้ได้ครั้งเดียว</p>
    ` : ''}
  `;

  try {
    await transporter.sendMail({
      from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
      to: mentorEmail,
      subject,
      html: renderEmailHtml({ title: 'นัดหมายนิเทศสหกิจศึกษา', themeColor: '#1a73e8', content, highlightBox })
    });
    console.log(`[Email] Supervision appointment email sent successfully to ${mentorEmail}`);
  } catch (error) {
    console.error(`[Email] Error sending supervision appointment email to ${mentorEmail}:`, error);
  }
};

/**
 * Sends a notification email to a mentor when a student submits their final report.
 */
export const sendFinalReportNotificationEmail = async (
  mentorEmail: string,
  mentorName: string,
  studentName: string,
  studentCode: string,
  // ลิงก์เข้าสู่ระบบใช้ครั้งเดียวของพี่เลี้ยง — ไม่ส่งก็ชี้ไปหน้าที่พี่เลี้ยงขอลิงก์เอง
  loginLink?: string
): Promise<void> => {
  // Subject is plain text and stays verbatim; the markup below gets escaped.
  const subject = `แจ้งเตือนทำแบบประเมินผลการฝึกงานของนักศึกษา: ${studentName} - ระบบสหกิจศึกษาออนไลน์`;
  const safeStudentName = esc(studentName || '');
  const safeStudentCode = esc(studentCode || '');
  const safeMentorName = esc(mentorName || '');
  const highlightBox = `
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="width: 30%; font-weight: bold; padding: 5px 0;">ชื่อนักศึกษา:</td>
        <td style="padding: 5px 0;">${safeStudentName} (รหัส: ${safeStudentCode})</td>
      </tr>
      <tr>
        <td style="font-weight: bold; padding: 5px 0;">สถานะงาน:</td>
        <td style="padding: 5px 0; color: #2e7d32; font-weight: bold;">ส่งเล่มรายงานสมบูรณ์แล้ว</td>
      </tr>
    </table>
  `;

  const content = `
    <p>เรียน พี่เลี้ยงคุณ <b>${safeMentorName}</b>,</p>
    <p>นักศึกษาในความดูแลของท่าน ได้ทำการอัปโหลด <b>รายงานปฏิบัติงานสหกิจศึกษาฉบับสมบูรณ์ (Final Report)</b> เข้าสู่ระบบเรียบร้อยแล้ว</p>
    <p>ขอความอนุเคราะห์ท่านเข้าสู่ระบบสหกิจศึกษา RMUTTO เพื่อทำ <b>แบบประเมินพฤติกรรมและผลงานของนักศึกษา (สหกิจ 15 & 16)</b> เพื่อที่ทางมหาวิทยาลัยจะได้นำคะแนนไปประมวลผลการตัดเกรดต่อไป</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${esc(loginLink ?? mentorLoginPageUrl())}"
         style="display: inline-block; padding: 12px 32px; background-color: #2e7d32; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        เข้าสู่ระบบเพื่อประเมิน
      </a>
    </div>
    <p style="text-align: center; font-size: 12px; color: #666;">${loginLink
      ? 'ลิงก์นี้ใช้ได้ครั้งเดียว หากหมดอายุขอลิงก์ใหม่ได้ที่หน้าเข้าสู่ระบบพี่เลี้ยง'
      : 'กรอกอีเมลของท่านที่หน้านี้ ระบบจะส่งลิงก์เข้าสู่ระบบให้ทางอีเมล'}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
      to: mentorEmail,
      subject,
      html: renderEmailHtml({ title: 'แบบประเมินผลการฝึกงานของนักศึกษา', themeColor: '#2e7d32', content, highlightBox })
    });
    console.log(`[Email] Final report notification email sent successfully to ${mentorEmail}`);
  } catch (error) {
    console.error(`[Email] Error sending final report email to ${mentorEmail}:`, error);
  }
};

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02) — ลิงก์ตอบแบบสำรวจโดยไม่ต้องเข้าสู่ระบบ
 *
 * ⛔ อีเมลฉบับนี้ **ต้องไม่มีข้อมูลนักศึกษาแม้แต่ตัวเดียว** — ปลายทางคือกล่องรวมของ
 *    ฝ่ายบุคคล (hr@, contact@) ที่มีคนเข้าถึงหลายคน และหน้าที่ลิงก์นี้เปิดก็เป็นหน้า
 *    ที่ไม่มีข้อมูลนักศึกษาเช่นกัน
 * ⛔ ปลายทางมาจากทะเบียนเสมอ ห้ามรับจากคำขอ (ดู `JobOfferModel.contactEmail`)
 *
 * คืน `true` เมื่อ SMTP รับจดหมายไปแล้ว · `false` เมื่อส่งไม่ออก — **ไม่โยน error**
 * เพราะการส่งเมลล้มเหลวไม่ควรทำให้สิ่งที่บันทึกลงฐานไปแล้วกลายเป็น 500
 * ตอนเจ้าหน้าที่ส่งเป็นชุด ค่านี้คือตัวที่ทำให้ตัวเลข `emailed` พูดความจริง
 * (ผู้เรียกที่ไม่สนใจก็ไม่ต้องรับค่า — พฤติกรรมเดิมไม่เปลี่ยน)
 */
export const sendJobOfferSurveyEmail = async (
  toEmail: string,
  answerLink: string,
  info: { companyName: string; semesterLabel: string; dueDate: string | null }
): Promise<boolean> => {
  const content = `
    <p>งานสหกิจศึกษาและการฝึกงานวิชาชีพประจำคณะ ขอสำรวจความต้องการรับนักศึกษาสหกิจศึกษา
       ของ <b>${esc(info.companyName)}</b> ประจำ<b>${esc(info.semesterLabel)}</b></p>
    <p>ท่านตอบแบบเสนองานสหกิจศึกษา (สหกิจ 02) ได้จากลิงก์ด้านล่างโดย<b>ไม่ต้องเข้าสู่ระบบ</b>
       — ระบบกรอกคำตอบของภาคเรียนที่แล้วไว้ให้แล้ว หากไม่มีอะไรเปลี่ยน กดยืนยันได้ทันที</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${answerLink}"
         style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        ตอบแบบเสนองานสหกิจศึกษา
      </a>
    </div>
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: `แบบเสนองานสหกิจศึกษา (สหกิจ 02) ${info.semesterLabel} - มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก`,
    html: renderEmailHtml({
      title: 'ขอสำรวจความต้องการรับนักศึกษาสหกิจศึกษา',
      themeColor: '#1a73e8',
      content,
      highlightBox: info.dueDate
        ? `กรุณาส่งคำตอบกลับ<b>ก่อนวันที่ ${esc(formatThaiDate(info.dueDate))}</b>`
        : undefined,
      footnote: `
        <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
          ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุใน ${JOB_OFFER_TOKEN_TTL_LABEL}<br/>
          หากลิงก์หมดอายุแล้ว ให้เปิดลิงก์เดิมแล้วกดขอลิงก์ใหม่ ระบบจะส่งกลับมาที่อีเมลฉบับนี้เท่านั้น<br/>
          หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษาประจำคณะ
        </p>
      `,
    }),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Job offer survey email successfully sent to: ${toEmail}`);
    return true;
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] JOB OFFER SURVEY (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error(`  Link: ${answerLink}`);
    console.error('════════════════════════════════════════════════════');
    return false;
  }
};

/**
 * ส่งลิงก์เข้าสู่ระบบให้พี่เลี้ยง (ไม่มีรหัสผ่าน — ลิงก์ใช้ครั้งเดียวคือ credential ตัวเดียวในเมลนี้)
 *
 * 'welcome' = ระบบส่งให้เองตอนเจ้าหน้าที่กดรับแบบตอบรับ (อายุยาว) ·
 * 'requested' = พี่เลี้ยงกดขอเองที่หน้าเข้าสู่ระบบ/ขอใหม่จากลิงก์เดิม (อายุ 30 นาที)
 *
 * คืน `true` เมื่อ SMTP รับจดหมายไปแล้ว · `false` เมื่อส่งไม่ออก — ไม่โยน error
 * ⛔ ล้มแล้วไม่ log ลิงก์ — ผู้เรียกต้องเพิกถอนลิงก์ทิ้ง (`revokeMentorLoginLink`) และลิงก์เข้าสู่ระบบ
 *    ไม่ควรไปนอนใน log
 */
export const sendMentorLoginLinkEmail = async (
  toEmail: string,
  url: string,
  opts: { expiresAt: Date; kind: 'welcome' | 'requested' }
): Promise<boolean> => {
  const tz = 'Asia/Bangkok';
  const expiresLabel =
    `${formatThaiDate(opts.expiresAt.toLocaleDateString('en-CA', { timeZone: tz }))} ` +
    `เวลา ${opts.expiresAt.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })} น.`;

  const button = `
    <div style="text-align: center; margin: 24px 0;">
      <a href="${esc(url)}"
         style="display: inline-block; padding: 12px 32px; background-color: #2e7d32; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        เข้าสู่ระบบ
      </a>
    </div>
  `;

  const welcome = opts.kind === 'welcome';
  const content = welcome
    ? `
      <p>บัญชี<b>พี่เลี้ยงนักศึกษาสหกิจศึกษา (Coop Mentor)</b> ของท่านในระบบบริหารจัดการงานสหกิจศึกษาออนไลน์
         มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก (RMUTTO) พร้อมใช้งานแล้ว</p>
      <p>บัญชีของท่านคือ <b>${esc(toEmail)}</b> กดปุ่มด้านล่างเพื่อเข้าสู่ระบบได้ทันที <b>ไม่ต้องตั้งรหัสผ่าน</b></p>
      ${button}
    `
    : `
      <p>ท่านขอลิงก์เข้าสู่ระบบสหกิจศึกษา RMUTTO ในฐานะพี่เลี้ยงนักศึกษา กดปุ่มด้านล่างเพื่อเข้าสู่ระบบ</p>
      ${button}
    `;

  const footnote = welcome
    ? `
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
        ลิงก์นี้ใช้ได้ครั้งเดียวและใช้ได้ถึง ${esc(expiresLabel)}<br/>
        หากลิงก์หมดอายุแล้ว ท่านขอลิงก์ใหม่ได้ที่ ${esc(mentorLoginPageUrl())} ระบบจะส่งกลับมาที่อีเมลฉบับนี้เท่านั้น<br/>
        อย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น เพราะผู้ที่ถือลิงก์เข้าสู่ระบบแทนท่านได้
      </p>
    `
    : `
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
        ลิงก์นี้ใช้ได้ครั้งเดียวและมีอายุ 30 นาที (ถึง ${esc(expiresLabel)})<br/>
        หากท่านไม่ได้เป็นผู้ขอลิงก์นี้ ไม่ต้องทำอะไร และอย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น
      </p>
    `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: welcome
      ? 'บัญชีพี่เลี้ยงพร้อมใช้งานแล้ว - ระบบสหกิจศึกษาออนไลน์'
      : 'ลิงก์เข้าสู่ระบบสหกิจศึกษาออนไลน์ของท่าน',
    html: renderEmailHtml({
      title: welcome ? 'บัญชีพี่เลี้ยงพร้อมใช้งานแล้ว' : 'ลิงก์เข้าสู่ระบบของท่าน',
      themeColor: '#2e7d32',
      content,
      footnote,
    }),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Mentor login link email successfully sent to: ${toEmail}`);
    return true;
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] MENTOR LOGIN LINK (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error('════════════════════════════════════════════════════');
    return false;
  }
};

/** ชื่อชนิดงานค้างของพี่เลี้ยงในอีเมลเตือน — คีย์ตรงกับ `MENTOR_QUEUE_KINDS` ใน models/mentorQueue.ts */
const MENTOR_REMINDER_KIND_LABELS: Record<string, string> = {
  weekly_log: 'บันทึกประจำสัปดาห์',
  monthly_log: 'บันทึกประจำเดือน',
  daily_log: 'บันทึกรายวัน',
  work_plan: 'แผนปฏิบัติงาน',
  report_outline: 'โครงร่างรายงาน',
  report_draft: 'ร่างรายงาน',
};

export interface MentorReminderSummary {
  /** จำนวนงานค้างต่อชนิด (คีย์ตาม MENTOR_QUEUE_KINDS) */
  byKind: Record<string, number>;
  /** นักศึกษาที่ส่งเล่มรายงานแล้วแต่พี่เลี้ยงยังไม่ได้กรอกแบบประเมิน สหกิจ 15 และ 16 */
  evalMissingStudents: number;
  /** รายการงานค้างเรียงตามที่ควรโชว์ก่อน — โชว์ไม่เกิน 10 บรรทัดที่เหลือสรุปเป็น "และอีก N รายการ" */
  items: { studentName: string; label: string }[];
}

/** ที่ขึ้นบรรทัดสูงสุดในอีเมลเตือน */
const MENTOR_REMINDER_MAX_LINES = 10;

/**
 * เตือนพี่เลี้ยงว่ามีงานค้าง — อีเมลสรุปฉบับเดียว + ลิงก์เข้าสู่ระบบใช้ครั้งเดียว (คณะตามพี่เลี้ยง Phase 2)
 *
 * ข้อความตายตัว ไม่รับข้อความอิสระจากผู้กด · ทุกค่าที่แทรกลง HTML ผ่าน `esc()`
 * คืน `true` เมื่อ SMTP รับจดหมายไปแล้ว · `false` เมื่อส่งไม่ออก — ไม่โยน error
 * ⛔ ล้มแล้วไม่ log ลิงก์ — ผู้เรียกต้องเพิกถอนลิงก์ทิ้ง (`revokeMentorLoginLink`)
 */
export const sendMentorReminderEmail = async (
  toEmail: string,
  mentorName: string,
  summary: MentorReminderSummary,
  loginUrl: string,
  expiresAt: Date,
  /** เฟส 3: ระบบส่งเอง — เพิ่มบรรทัดตายตัวบอกเหตุผล (ไม่รับข้อความจากภายนอก) */
  auto?: boolean
): Promise<boolean> => {
  const tz = 'Asia/Bangkok';
  const expiresLabel =
    `${formatThaiDate(expiresAt.toLocaleDateString('en-CA', { timeZone: tz }))} ` +
    `เวลา ${expiresAt.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })} น.`;

  const countLines = Object.entries(MENTOR_REMINDER_KIND_LABELS)
    .filter(([kind]) => (summary.byKind[kind] ?? 0) > 0)
    .map(([kind, label]) => `<li>${esc(label)} ${esc(String(summary.byKind[kind]))} รายการ</li>`);
  if (summary.evalMissingStudents > 0) {
    countLines.push(
      `<li>แบบประเมิน สหกิจ 15 และ 16 ของนักศึกษา ${esc(String(summary.evalMissingStudents))} คน</li>`
    );
  }

  const shown = summary.items.slice(0, MENTOR_REMINDER_MAX_LINES);
  const rest = summary.items.length - shown.length;
  const itemLines = shown.map((it) => `<li>${esc(it.studentName)} — ${esc(it.label)}</li>`);
  const detail = itemLines.length
    ? `
      <ul style="padding-left: 20px; margin: 8px 0;">${itemLines.join('')}</ul>
      ${rest > 0 ? `<p style="margin: 4px 0;">และอีก ${esc(String(rest))} รายการ</p>` : ''}
    `
    : '';

  const content = `
    <p>เรียน พี่เลี้ยงคุณ <b>${esc(mentorName || '')}</b>,</p>
    <p>มีงานที่รอท่านดำเนินการในระบบสหกิจศึกษา RMUTTO ดังนี้</p>
    ${auto ? '<p style="color: #6b7280; font-size: 13px; margin: 4px 0;">อีเมลฉบับนี้ส่งโดยระบบอัตโนมัติ เนื่องจากมีงานค้างเกิน 5 วัน</p>' : ''}
    <ul style="padding-left: 20px; margin: 8px 0;">${countLines.join('')}</ul>
    ${detail}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${esc(loginUrl)}"
         style="display: inline-block; padding: 12px 32px; background-color: #2e7d32; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        เข้าสู่ระบบเพื่อดำเนินการ
      </a>
    </div>
  `;

  const footnote = `
    <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
      ลิงก์นี้ใช้ได้ครั้งเดียวและใช้ได้ถึง ${esc(expiresLabel)}<br/>
      หากลิงก์หมดอายุแล้ว ท่านขอลิงก์ใหม่ได้ที่ ${esc(mentorLoginPageUrl())} ระบบจะส่งกลับมาที่อีเมลฉบับนี้เท่านั้น<br/>
      อย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น เพราะผู้ที่ถือลิงก์เข้าสู่ระบบแทนท่านได้
    </p>
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: 'มีงานรอท่านอยู่ - ระบบสหกิจศึกษาออนไลน์',
    html: renderEmailHtml({ title: 'มีงานรอท่านอยู่', themeColor: '#2e7d32', content, footnote }),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Mentor reminder email successfully sent to: ${toEmail}`);
    return true;
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] MENTOR REMINDER (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error('════════════════════════════════════════════════════');
    return false;
  }
};

export interface SilentMentorDigestRow {
  name: string;
  companyName: string | null;
  email: string;
  oldestDaysWaiting: number;
  /** เตือนล่าสุด (ทุกชนิด) — null = ไม่มีแถวเตือนเลย */
  lastRemindedAt: Date | null;
}

/** ที่ขึ้นบรรทัดสูงสุดในอีเมลสรุปประจำสัปดาห์ถึงเจ้าหน้าที่ */
const SILENT_DIGEST_MAX_LINES = 50;

/**
 * สรุปประจำสัปดาห์ถึงเจ้าหน้าที่: พี่เลี้ยงที่ระบบเตือนครบเพดานแล้วแต่ยังเงียบ (เฟส 3 เตือนอัตโนมัติ)
 *
 * ข้อความตายตัว · ทุกค่าที่แทรกลง HTML ผ่าน `esc()` · ปลายทางมาจากทะเบียน (ผู้ใช้บทบาท staff) ไม่ใช่จากคำขอ
 * คืน `true` เมื่อ SMTP รับจดหมายไปแล้ว · `false` เมื่อส่งไม่ออก — ไม่โยน error
 */
export const sendMentorSilentDigestEmail = async (
  toEmail: string,
  rows: SilentMentorDigestRow[],
  followupUrl: string
): Promise<boolean> => {
  const tz = 'Asia/Bangkok';
  const shown = rows.slice(0, SILENT_DIGEST_MAX_LINES);
  const rest = rows.length - shown.length;
  const lines = shown.map((r) => {
    const last = r.lastRemindedAt
      ? formatThaiDate(r.lastRemindedAt.toLocaleDateString('en-CA', { timeZone: tz }))
      : '-';
    return `
      <tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(r.name)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(r.companyName ?? '-')}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(r.email)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align: right;">${esc(String(r.oldestDaysWaiting))} วัน</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(last)}</td>
      </tr>`;
  });

  const content = `
    <p>เรียน เจ้าหน้าที่ดูแลงานสหกิจศึกษา,</p>
    <p>ระบบเตือนพี่เลี้ยงอัตโนมัติครบจำนวนครั้งสูงสุดแล้ว แต่พี่เลี้ยง <b>${esc(String(rows.length))} คน</b> ด้านล่างนี้ยังมีงานค้างและยังไม่เข้าระบบ
       กรุณาติดต่อพี่เลี้ยงโดยตรง</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <tr style="background-color: #f5f5f5; text-align: left;">
        <th style="padding: 6px 8px;">พี่เลี้ยง</th>
        <th style="padding: 6px 8px;">สถานประกอบการ</th>
        <th style="padding: 6px 8px;">อีเมล</th>
        <th style="padding: 6px 8px; text-align: right;">ค้างนานสุด</th>
        <th style="padding: 6px 8px;">เตือนล่าสุด</th>
      </tr>
      ${lines.join('')}
    </table>
    ${rest > 0 ? `<p style="margin: 4px 0;">และอีก ${esc(String(rest))} คน</p>` : ''}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${esc(followupUrl)}"
         style="display: inline-block; padding: 12px 32px; background-color: #1a73e8; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 8px;">
        เปิดหน้าติดตามพี่เลี้ยง
      </a>
    </div>
  `;

  const mailOptions = {
    from: `"ระบบงานสหกิจศึกษา RMUTTO" <${SMTP_FROM}>`,
    to: toEmail,
    subject: 'พี่เลี้ยงที่ยังเงียบหลังระบบเตือนครบแล้ว - ระบบสหกิจศึกษาออนไลน์',
    html: renderEmailHtml({ title: 'พี่เลี้ยงที่ยังเงียบหลังระบบเตือนครบแล้ว', themeColor: '#1a73e8', content }),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Mentor silent digest email successfully sent to: ${toEmail}`);
    return true;
  } catch (err: unknown) {
    const error = err as { message?: string; response?: string };
    console.error('════════════════════════════════════════════════════');
    console.error(`[Email] MENTOR SILENT DIGEST (SMTP failed: ${error?.message || err})`);
    if (error?.response) console.error(`  SMTP Response: ${error.response}`);
    console.error(`  To: ${toEmail}`);
    console.error('════════════════════════════════════════════════════');
    return false;
  }
};
