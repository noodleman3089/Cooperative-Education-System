import { Request } from 'express';
import { query } from '../config/database';

/**
 * Append-only audit trail (SEC-07).
 *
 * The system mints signed official documents, grants roles and records grades but
 * kept no record of who did any of it. Every privileged or irreversible action
 * should leave a row in `audit_log`.
 *
 * There is deliberately no read API — inspect the table directly:
 *   SELECT created_at, actor_email, action, entity_id, detail
 *   FROM audit_log ORDER BY audit_id DESC LIMIT 50;
 */

export const AuditAction = {
  PERSONNEL_CLAIMED: 'personnel.claimed',
  PERSONNEL_CLAIM_REJECTED: 'personnel.claim_rejected',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  // หัวหน้าสาขามีคนเดียวต่อสาขา — ตั้งคนใหม่แล้วคนเก่าถูกถอดตำแหน่งอัตโนมัติ (SB-G2)
  USER_DEPT_HEAD_REPLACED: 'user.dept_head_replaced',
  USER_DELETED: 'user.deleted',
  USER_AUTO_DEACTIVATED: 'user.auto_deactivated',
  PASSWORD_RESET: 'user.password_reset',
  // พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์ในอีเมล (ไม่มีรหัสผ่าน) — ไม่มีผู้ใช้ที่ล็อกอินให้ตามย้อน
  // เก็บ token_id ไม่เก็บ token · ลิงก์ออกจาก 3 ทาง ดู detail.ttl ('requested' | 'resend' | 'system')
  MENTOR_LINK_ISSUED: 'auth.mentor_link_issued',
  MENTOR_LINK_LOGIN: 'auth.mentor_link_login',
  // คณะตามพี่เลี้ยง (Phase 2) — เตือนงานค้างรวม · เจ้าหน้าที่ส่งลิงก์เปล่า · เจ้าหน้าที่แก้อีเมล
  // อีเมลที่เปลี่ยนคือปลายทางของลิงก์เข้าสู่ระบบ จึงต้องตามย้อนได้ว่าใครเปลี่ยนจากอะไรเป็นอะไร
  MENTOR_REMINDER_SENT: 'mentor.reminder_sent',
  MENTOR_LINK_SENT_BY_STAFF: 'mentor.link_sent_by_staff',
  MENTOR_EMAIL_CHANGED: 'mentor.email_changed',
  // เจ้าหน้าที่ยืนยันพี่เลี้ยงที่นักศึกษาระบุ = จุดเดียวที่บัญชีพี่เลี้ยงถูกเปิดและลิงก์แรกถูกส่ง (SEC-03 · SEC-15)
  MENTOR_CONFIRMED: 'mentor.confirmed',
  // เฟส 3: ระบบเตือนพี่เลี้ยงเอง (ไม่มีผู้กด — actor = 'system') · detail เก็บ auto_count ของรอบนั้นไว้ตามย้อน
  MENTOR_REMINDER_AUTO_SENT: 'mentor.reminder_auto_sent',
  // เอกสารหมายเลข 1 — ลายเซ็นอยู่บนกระดาษ เจ้าหน้าที่เป็นคนเดียวที่กดในระบบ
  // จึงเป็นจุดเดียวที่มีคนรับผิดชอบให้ตามย้อนได้ว่าใครปล่อยคำร้องใบไหนผ่าน
  INTENT_REQUEST_FORM_UPLOADED: 'intent.request_form_uploaded',
  INTENT_OFFICER_APPROVED: 'intent.officer_approved',
  INTENT_OFFICER_REJECTED: 'intent.officer_rejected',
  // เจ้าหน้าที่แก้เลขที่หนังสือออกหลังรับคำร้อง (ก่อนคณบดีลงนาม) — detail เก็บเลขเก่าและเลขใหม่
  INTENT_DOCUMENT_NO_CHANGED: 'intent.document_no_changed',
  // นักศึกษายกเลิกคำร้องเองก่อนเจ้าหน้าที่รับ — ใบถูกลบทั้งใบ บรรทัด audit คือร่องรอยเดียวที่เหลือ
  INTENT_WITHDRAWN: 'intent.withdrawn',
  // นักศึกษาแก้สถานประกอบการของคำร้องก่อนอัปโหลดกระดาษที่ลงนาม (from = to คือแก้ข้อมูลในแถวร่างเดิม)
  INTENT_COMPANY_CHANGED: 'intent.company_changed',
  INTENT_COVER_LETTER_EMAILED: 'intent.cover_letter_emailed',
  // บริษัทตอบผ่านลิงก์ในอีเมล (ไม่มีบัญชี) — บรรทัดนี้คือสิ่งเดียวที่ตามย้อนได้ว่าคำตอบมาจากลิงก์ใบไหน (เก็บ token_id ไม่เก็บ token)
  INTENT_ACCEPTED_VIA_LINK: 'intent.accepted_via_link',
  INTENT_DECLINED_VIA_LINK: 'intent.declined_via_link',
  // นักศึกษาระบุพี่เลี้ยงบนใบที่ตอบรับแล้ว (ยังไม่เปิดบัญชี — เปิดตอนเจ้าหน้าที่ยืนยัน `mentor.confirmed`)
  INTENT_MENTOR_SET: 'intent.mentor_set',
  // ระบบปิดใบเองเมื่อพ้นปฏิทิน `acceptance_form` โดยยังไม่มีแบบตอบรับ (`utils/acceptanceAutoClose.ts`) — ไม่มีคนกด
  // บรรทัดนี้จึงเป็นหลักฐานเดียวว่าใบถูกปิดด้วยกติกา ไม่ใช่ด้วยมือใคร
  INTENT_AUTO_CLOSED: 'intent.auto_closed',
  ACCEPTANCE_OFFICER_DECISION: 'acceptance.officer_decision',
  DOCUMENT_GENERATED: 'document.generated',
  DOCUMENT_SIGNED: 'document.signed',
  // หนังสือขอความอนุเคราะห์ที่ยังไม่ลงนามถูกถอนกลับ (คณบดีตีกลับ / เจ้าหน้าที่ดึงกลับ) — แถวหนังสือถูกลบ
  // บรรทัดนี้คือร่องรอยเดียวของตัวหนังสือที่หายไป · detail: เลขที่หนังสือ + by ('dean' | 'staff') + เหตุผล
  DOCUMENT_COVER_LETTER_RETURNED: 'document.cover_letter_returned',
  // หนังสือส่งตัวที่ยังไม่ลงนามถูกถอนกลับ — detail แบบเดียวกับบรรทัดบน (ใบคงสถานะ accepted · เลขถูกล้าง)
  DOCUMENT_DISPATCH_LETTER_RETURNED: 'document.dispatch_letter_returned',
  // ⛔ APPLICATION_EVALUATED / APPLICATION_DECIDED (สหกิจ 01) ถูกลบ 2026-09-14 พร้อมทั้งชุด
  //    แถวเก่าใน audit_log ยังอยู่เป็นประวัติ ห้ามเอาชื่อ action สองอันนั้นไปใช้กับเรื่องอื่น
  // ⛔ ELIGIBILITY_CHANGED ('student.eligibility_changed') ถูกลบ 2026-09-14 พร้อม verify-eligibility
  //    — แถวเก่าในตารางยังอ่านได้ ห้ามเอาชื่อ action นี้ไปใช้กับเรื่องอื่น
  REGISTRY_CHANGED: 'student.registry_changed',
  // ⛔ 'job_post.*' และ 'job_offer.*' ถูกลบ 2026-10-05 พร้อมสายแบบเสนองาน (สหกิจ 02)
  //    — แถวเก่าใน audit_log ยังอยู่เป็นประวัติ ห้ามเอาชื่อ action พวกนี้ไปใช้กับเรื่องอื่น
  // ทะเบียนคณะ/สาขา: ชื่อคณะและชื่อสาขาถูกพิมพ์ลงหนังสือราชการที่คณบดีลงนาม
  // และการลบคณะพาสาขาใต้คณะหายไปด้วย (CASCADE) — "ใครแก้อะไรเมื่อไหร่" ต้องตามย้อนได้
  MASTER_FACULTY_CREATED: 'master_data.faculty_created',
  MASTER_FACULTY_UPDATED: 'master_data.faculty_updated',
  MASTER_FACULTY_DELETED: 'master_data.faculty_deleted',
  MASTER_MAJOR_CREATED: 'master_data.major_created',
  MASTER_MAJOR_UPDATED: 'master_data.major_updated',
  MASTER_MAJOR_DELETED: 'master_data.major_deleted',
  EVALUATION_SUBMITTED: 'evaluation.submitted',
  FINAL_REPORT_REVIEWED: 'final_report.reviewed',
  COMPANY_VERIFIED: 'company.verified',
  COMPANY_UNVERIFIED: 'company.unverified',
  COMPANY_CREATED: 'company.created',
  COMPANY_UPDATED: 'company.updated',
  COMPANY_DELETED: 'company.deleted',
  // ปฏิทินสหกิจ: ช่วงเวลาที่ตั้งตรงนี้ล็อกการทำรายการของนักศึกษาทั้งรุ่น
  // "ใครขยับวันปิดรับ" จึงเป็นคำถามที่จะมีคนถามจริง — UPDATE เก็บค่าเดิมไว้ใน detail.previous
  // (การถูกปฏิเสธเพราะอยู่นอกช่วงจงใจไม่บันทึก มันเป็น traffic ปกติ ไม่ใช่การกระทำที่ต้องรับผิดชอบ)
  CALENDAR_EVENT_CREATED: 'coop_calendar.created',
  CALENDAR_EVENT_UPDATED: 'coop_calendar.updated',
  CALENDAR_EVENT_DELETED: 'coop_calendar.deleted',
  // วงจรภาคเรียน: เปลี่ยนภาคที่เปิดอยู่ = เปลี่ยนหน้าต่างปฏิทินที่ล็อกนักศึกษาทั้งรุ่น
  // detail.open_forms_in_previous เก็บจำนวนใบที่ยังค้างในภาคก่อนตอนกดไว้ — ปิดภาคไม่แตะสถานะใบ
  SEMESTER_CREATED: 'semester.created',
  SEMESTER_ACTIVATED: 'semester.activated',
  SEMESTER_CLOSED: 'semester.closed',
  // รายชื่อรุ่น: ถอดคนที่ใส่ผิด · ยกยอดนักศึกษาที่ยังไม่ได้ที่ฝึกจากภาคก่อน (เจ้าหน้าที่กดเอง ไม่ยกเงียบ ๆ)
  SEMESTER_COHORT_REMOVED: 'semester.cohort_removed',
  SEMESTER_COHORT_CARRIED_OVER: 'semester.cohort_carried_over',
  // SEC-12: ลบเลขบัตรประชาชน/เชื้อชาติ/ศาสนาอัตโนมัติ ๙๐ วันหลังประเมินครบทั้งสองใบ
  // (สหกิจ 15+16) — เขียนตอนที่ตัวจริงกำลังจะถูกลบ ก่อนคำสั่ง UPDATE จะทำให้อ่านค่า
  // เดิมไม่ได้อีกแล้ว เพื่อให้ยังสืบย้อนได้ว่า "แถวนี้เคยมีข้อมูลอ่อนไหว ถูกลบเมื่อไหร่"
  // แม้ audit_log จะไม่เก็บค่าจริงไว้เลยก็ตาม (SEC-07 — เขียนอย่างเดียว ไม่มี read API)
  STUDENT_SENSITIVE_DATA_PURGED: 'student.sensitive_data_purged',
  // PDPA ม.26: ความยินยอมโดยชัดแจ้งให้เก็บเชื้อชาติ/ศาสนา — คอลัมน์บนแถวแก้ทับได้
  // แต่บรรทัดนี้แก้ไม่ได้ ตามย้อนได้ว่าให้ความยินยอมเมื่อไหร่จากเครื่องไหน
  SENSITIVE_DATA_CONSENT_GIVEN: 'student.sensitive_data_consent_given',
  // สหกิจ 13: ลายเซ็น 3 คนบนกระดาษถูกแทนด้วย "อาจารย์นิเทศกดส่งคนเดียว"
  // บรรทัดนี้คือสิ่งที่ทำหน้าที่แทนลายเซ็น — ตามย้อนได้ว่าใครส่ง เมื่อไหร่ จากเครื่องไหน
  SUPERVISION_RECORD_SUBMITTED: 'supervision_record.submitted',
  // สหกิจ 12: ร่างนัดนิเทศเป็นจุดเริ่มของอีเมลที่เจ้าหน้าที่ส่งถึงพี่เลี้ยง
  // — ต้องตามย้อนได้ว่าอาจารย์คนไหนร่างนัดให้นักศึกษาคนไหน
  APPOINTMENT_DRAFT_CREATED: 'appointment.draft_created',
  // อาจารย์แก้นัด (ทุกสถานะ · แก้แล้วกลับเป็นร่าง) — detail เก็บสถานะเดิม วันเดิม วันใหม่
  // วันที่ในนัดถูกพิมพ์ลงบันทึกขออนุมัติเดินทาง จึงต้องตามย้อนได้ว่าเปลี่ยนจากอะไรเป็นอะไร
  APPOINTMENT_UPDATED: 'appointment.updated',
  // ลบร่างนัด — แถวหายทั้งแถว บรรทัดนี้คือร่องรอยเดียวที่เหลือ
  APPOINTMENT_DRAFT_DELETED: 'appointment.draft_deleted',
  // สหกิจ 11: อาจารย์นิเทศส่งโครงร่างที่อนุมัติแล้วกลับให้แก้ — การอนุมัติถูกถอน ด่านอัปโหลดเล่มกลับมาล็อก
  // detail เก็บเหตุผล (เหตุผลบนแถวฉบับไม่ติดไปกับฉบับใหม่ที่นักศึกษาส่ง)
  OUTLINE_REOPENED: 'outline.reopened',
  // สหกิจ 11: อาจารย์นิเทศเห็นชอบแทนขณะพี่เลี้ยงยังไม่ตรวจ — ข้ามขั้นพี่เลี้ยงด้วยดุลยพินิจ จึงต้องตามย้อนได้ว่าใคร เมื่อไหร่ เพราะอะไร
  OUTLINE_APPROVED_WITHOUT_MENTOR: 'outline.approved_without_mentor',
  // สหกิจ 03: การพิมพ์ใบสมัครเป็นครั้งเดียวที่ระบบถอดรหัสเลขบัตร/เชื้อชาติ/ศาสนา
  // ออกมาเป็นค่าจริง (SEC-12) — ต้องรู้เสมอว่าค่าจริงถูกเปิดออกมาเมื่อไหร่ จากเครื่องไหน
  COOP_APPLICATION_PRINTED: 'student.coop_application_printed',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  action: AuditActionValue | string;
  entityType: string;
  entityId?: string | number | null;
  /** The user this action was performed *on* (e.g. the student being graded). */
  subjectId?: number | null;
  detail?: Record<string, unknown>;
}

/**
 * Record an audit entry. Never throws — an unwritable audit log must not take
 * down the request it describes.
 *
 * @param req    omit for actions with no HTTP caller (schedulers, callbacks);
 *               the entry is then attributed to 'system'.
 * @param client pass the transaction client when the entry must commit or roll
 *               back together with the change it describes.
 */
export async function writeAudit(
  entry: AuditEntry,
  req?: Request,
  client?: { query: (text: string, params?: unknown[]) => Promise<unknown> }
): Promise<void> {
  const sql = `INSERT INTO audit_log
      (actor_id, actor_email, actor_roles, action, entity_type, entity_id, subject_id, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

  const params = [
    req?.user?.userId ?? null,
    req?.user?.email ?? 'system',
    req?.user?.roles ? req.user.roles.join(',') : 'system',
    entry.action,
    entry.entityType,
    entry.entityId !== undefined && entry.entityId !== null ? String(entry.entityId) : null,
    entry.subjectId ?? null,
    entry.detail ? JSON.stringify(entry.detail) : null,
    // Requires TRUST_PROXY to be set behind a reverse proxy to be meaningful.
    req?.ip ?? null,
  ];

  try {
    if (client) {
      await client.query(sql, params);
    } else {
      await query(sql, params);
    }
  } catch (error) {
    console.error('[AUDIT] Failed to write audit entry', entry.action, error);
  }
}
