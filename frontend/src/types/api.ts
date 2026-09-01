export interface User {
  userId: number;
  email: string;
  roles: string[];
}

/** ความสามารถทางภาษาหนึ่งรายการ ตามที่นักศึกษากรอกในหน้าประวัติ */
export interface LanguageProficiency {
  language: string;
  level: string;
}

/** ประกาศจากงานสหกิจ — ที่ปักหมุดจะขึ้นเป็นแบนเนอร์บนแดชบอร์ดนักศึกษา */
export interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
  image_url?: string | null;
  author_name?: string | null;
}

/**
 * ปฏิทินสหกิจศึกษา — ตอบจาก `GET /api/calendar`
 *
 * รายการกิจกรรมตายตัวและชื่อไทยของมันมาจาก backend (`utils/coopCalendar.ts`)
 * ฝั่งนี้จึงจงใจไม่ประกาศรายการซ้ำ เพิ่มกิจกรรมใหม่แล้วหน้าจอขึ้นเอง
 */
export type CalendarStatus = 'not_configured' | 'upcoming' | 'open' | 'late' | 'closed';

/** กิจกรรมตายตัว — คืนมาครบทุกตัวเสมอ รวมอันที่ยังไม่ได้ตั้งช่วง */
export interface CoopCalendarActivity {
  activity_key: string;
  label: string;
  event_id: number | null;
  start_date: string | null;
  end_date: string | null;
  /** วันสุดท้ายที่ยังรับแบบส่งช้า · null = ไม่เปิดผ่อนผัน (ปิดจริงที่ end_date) */
  late_end_date: string | null;
  note: string | null;
  status: CalendarStatus;
}

/** รายการที่เจ้าหน้าที่พิมพ์เอง — แสดงในปฏิทินอย่างเดียว ไม่ล็อกอะไร */
export interface CoopCalendarCustomEvent {
  event_id: number;
  title: string;
  start_date: string;
  end_date: string;
  late_end_date: string | null;
  note: string | null;
  status: CalendarStatus;
}

export interface CoopCalendarSemester {
  semester_id: number;
  academic_year: number;
  semester: string;
  is_active: boolean;
}

export interface CoopCalendarResponse {
  /** null เมื่อยังไม่มีภาคการศึกษาที่เปิดใช้งาน — ไม่ใช่ข้อผิดพลาด */
  semester: CoopCalendarSemester | null;
  /** วันนี้ตามเวลาไทย คิดที่ฐานข้อมูล ไม่ใช่นาฬิกาเบราว์เซอร์ */
  today: string;
  activities: CoopCalendarActivity[];
  custom_events: CoopCalendarCustomEvent[];
}

/** แถวในคิวอนุมัติประกาศงานของเจ้าหน้าที่ */
export interface JobPostRow {
  job_id: number;
  title: string;
  description?: string | null;
  company_name_th?: string | null;
  quota: number;
  applied_count: number;
  status: string;
  expire_date?: string | null;
  reject_reason?: string | null;
}

/** แถวในหน้าจัดการบัญชีผู้ใช้ */
export interface UserRow {
  user_id: number;
  email: string;
  is_active: boolean;
  roles: string[];
}

/** สาขาวิชาใน master data */
export interface MajorOption {
  major_id: number;
  major_name_th: string;
}

/** แถวรายชื่อบุคลากรที่นำเข้าไว้ล่วงหน้า รอการ claim */
export interface PreseedPersonnelRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  role_name: string;
  major_name_th?: string | null;
  is_claimed: boolean;
}

/** แถวนักศึกษาในรายชื่อของอาจารย์/หัวหน้าสาขา (มาจาก `GET /students`) */
export interface StudentRow {
  student_id: number;
  student_code: string;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  major_name_th?: string | null;
  cumulative_gpa?: number | string | null;
  is_eligible: boolean;
  is_orientation_passed: boolean;
}

/** โครงร่างรายงาน (สหกิจ 11) หนึ่งฉบับ ในคิวตรวจของพี่เลี้ยง/อาจารย์ */
export interface ReportOutlineRow {
  outline_id: number;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  company_name_th?: string | null;
  latest_file_path?: string | null;
  latest_submitted_at?: string | null;
  latest_rejection_comment?: string | null;
  status: string;
}

/** แผนปฏิบัติงานหนึ่งสัปดาห์ในแผน 16 สัปดาห์ */
export interface WeeklyPlan {
  plan_id?: number;
  week_number: number;
  start_date: string;
  end_date: string;
  tasks: string;
}

/** สรุปผลการนำเข้าไฟล์รายชื่อ — ใช้ทั้งฝั่งนักศึกษาและบุคลากร */
export interface ImportSummary {
  totalProcessed: number;
  importedCount: number;
  updatedCount: number;
  unchangedCount?: number;
  invalidRows?: string[];
  skippedCodes?: string[];
}

export interface StudentProfile {
  student_id: number;
  student_code: string;
  major_id: number;
  major_name_th?: string;
  major_code?: string;
  faculty_name_th?: string;
  province_id: number | null;
  province_name_th?: string;
  cumulative_gpa?: number | null;
  resume_file: string | null;
  is_eligible: boolean;
  is_orientation_passed: boolean;
  advisor_id?: number | null;
  advisor_email?: string | null;
  supervisor_id?: number | null;
  supervisor_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  year_level?: number | null;
  birth_date?: string | null;
  alt_email?: string | null;
  phone?: string | null;
  current_address?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  enrollment_year?: number | null;
  company_name?: string | null;
  company_province?: string | null;
  skills_and_activities?: string | null;
  /** JSONB — เก็บเป็น [{ language, level }] · ดู `StudentProfileExtra.tsx` */
  language_proficiency?: LanguageProficiency[] | null;
  preferred_work_region?: string | null;
  /** JSONB — รายชื่อประเภทงานที่สนใจ */
  interested_job_types?: string[] | null;
}

export interface PersonnelProfile {
  personnel_id: number;
  major_id: number;
  e_signature_file: string | null;
  status: string;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
}

export interface Company {
  company_id: number;
  name_th: string;
  name_en?: string | null;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  google_place_id?: string | null;
  is_verified: boolean;
  contact_person?: string | null;
  contact_position?: string | null;
  email?: string | null;
}

export interface Job {
  job_id: number;
  company_id: number;
  title: string;
  description: string;
  image_path?: string | null;
  quota: number;
  applied_count: number;
  expire_date: string;
  status: string;
  company_name_th?: string;
  company_name_en?: string;
}

export interface IntentForm {
  form_id: number;
  student_id: number;
  company_id: number;
  semester_id: number;
  job_id?: number | null;
  status: string;
  mentor_id?: number | null;
  start_date?: string | null;
  acceptance_evidence_path?: string | null;
  // เอกสารหมายเลข 1 — กระดาษที่ลงนามแล้ว และสิ่งที่เจ้าหน้าที่อ่านจากกระดาษนั้น
  request_form_path?: string | null;
  reject_reason?: string | null;
  officer_document_no?: string | null;
  advisor_signer_name?: string | null;
  advisor_signed_date?: string | null;
  dept_head_signer_name?: string | null;
  dept_head_signed_date?: string | null;
  /**
   * สถานะของ **หนังสือขาออก** ไม่ใช่ของใบความจำนง — `null` เมื่อยังไม่ออกหนังสือ
   *
   * ใบความจำนงหยุดที่ `approved_by_dept_head` ตั้งแต่เจ้าหน้าที่กดรับ ความคืบหน้า
   * ที่เหลือ (`pending_sign` → `signed`) อยู่บนหนังสือ · หน้าจอที่แสดงสถานะให้
   * บุคลากรดูต้องหยิบค่านี้มาแทนเมื่อมี ไม่งั้นจะค้างคำว่า "รอออกหนังสือ" ตลอดไป
   */
  cover_letter_status?: string | null;
  student_code?: string;
  student_name?: string;
  major_name_th?: string;
  company_name_th?: string;
  job_title?: string;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  student_phone?: string | null;
  alt_email?: string | null;
  year_level?: number | null;
  current_address?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  company_phone?: string | null;
  company_contact_person?: string | null;
}

export interface Semester {
  semester_id: number;
  academic_year: number;
  semester: string;
  is_active: boolean;
}

export interface DocumentTemplate {
  template_id: number;
  name: string;
  file_path: string;
  type: string;
}

export interface OfficialDocument {
  doc_id: number;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path?: string | null;
  status: string;
  dean_signature_date?: string | null;
  docusign_envelope_id?: string | null;
}
