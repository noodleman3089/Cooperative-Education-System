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
  USER_DELETED: 'user.deleted',
  USER_AUTO_DEACTIVATED: 'user.auto_deactivated',
  PASSWORD_RESET: 'user.password_reset',
  // เอกสารหมายเลข 1 — ลายเซ็นอยู่บนกระดาษ เจ้าหน้าที่เป็นคนเดียวที่กดในระบบ
  // จึงเป็นจุดเดียวที่มีคนรับผิดชอบให้ตามย้อนได้ว่าใครปล่อยคำร้องใบไหนผ่าน
  INTENT_REQUEST_FORM_UPLOADED: 'intent.request_form_uploaded',
  INTENT_OFFICER_APPROVED: 'intent.officer_approved',
  INTENT_OFFICER_REJECTED: 'intent.officer_rejected',
  ACCEPTANCE_OFFICER_DECISION: 'acceptance.officer_decision',
  DOCUMENT_GENERATED: 'document.generated',
  DOCUMENT_SIGNED: 'document.signed',
  APPLICATION_EVALUATED: 'application.evaluated_by_advisor',
  APPLICATION_DECIDED: 'application.decided_by_dept_head',
  ELIGIBILITY_CHANGED: 'student.eligibility_changed',
  REGISTRY_CHANGED: 'student.registry_changed',
  JOB_POST_PUBLISHED: 'job_post.published',
  JOB_POST_REJECTED: 'job_post.rejected',
  // สหกิจ 02: การกดตรวจผ่านทั้งใบคือสิ่งเดียวที่พาตำแหน่งขึ้นกระดานหางาน
  // — เขียนเป็นบรรทัดเดียวพร้อม `published_job_ids` ไม่แตกเป็น job_post.published รายอัน
  //   เพราะที่ต้องตามย้อนคือ "ใครปล่อยใบนี้ผ่าน" ไม่ใช่ "แถวไหนถูก UPDATE"
  JOB_OFFER_REVIEWED: 'job_offer.reviewed',
  JOB_OFFER_REJECTED: 'job_offer.rejected',
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
