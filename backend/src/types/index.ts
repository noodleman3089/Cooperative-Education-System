// JWT Payload structure (updated to support multiple roles as an array)
export interface JwtPayload {
  userId: number;
  email: string;
  roles: string[];
}

// Extend Express Request interface to include the authenticated user context
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// User Entity (updated to support nullable password_hash and multiple roles)
export interface User {
  user_id: number;
  email: string;
  password_hash: string | null;
  roles: string[];
  is_active: boolean;
}

// Student Profile Entity
export interface Student {
  student_id: number;
  student_code: string;
  major_id: number;
  province_id: number | null;
  cumulative_gpa: number | null;
  resume_file: string | null;
  is_eligible: boolean;
  is_orientation_passed: boolean;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  year_level: number | null;
  birth_date: Date | string | null;
  alt_email: string | null;
  phone: string | null;
  current_address: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  enrollment_year: number | null;
  skills_and_activities?: string | null;
  language_proficiency?: unknown;
  preferred_work_region?: string | null;
  interested_job_types?: unknown;
}

// Personnel Profile Entity
export interface Personnel {
  personnel_id: number;
  major_id: number;
  e_signature_file: string | null;
  status: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: Date | string | null;
}

// API Payloads
export interface LoginRequestBody {
  email?: string;
  password?: string;
}

export interface GoogleLoginRequestBody {
  token?: string;
}

export interface StudentProfileSetupBody {
  student_code: string;
  major_id: number;
  province_id?: number | null;
  cumulative_gpa?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  year_level?: number | null;
  birth_date?: Date | string | null;
  alt_email?: string | null;
  phone?: string | null;
  current_address?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  enrollment_year?: number | null;
}

export interface OptionalStudentProfileBody {
  skills_and_activities?: string;
  language_proficiency?: unknown;
  preferred_work_region?: string;
  interested_job_types?: unknown;
}

export interface PersonnelProfileSetupBody {
  major_id: number;
  e_signature_file?: string;
  role?: string; // Optional specified base role
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: Date | string | null;
}

// Sprint 2 Entities

export interface Company {
  company_id: number;
  name_th: string;
  name_en: string | null;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  google_place_id: string | null;
  is_verified: boolean;
  created_by: number;
  contact_person?: string | null;
  contact_position?: string | null;
  email?: string | null;
}

export interface CoopSemester {
  semester_id: number;
  academic_year: number;
  semester: string;
  is_active: boolean;
}

export interface JobPost {
  job_id: number;
  company_id: number;
  title: string;
  description: string;
  image_path: string | null;
  created_by: number;
  quota: number;
  applied_count: number;
  expire_date: Date | string;
  status: 'pending_approval' | 'published' | 'closed' | 'rejected';
  /** Set only when status is 'rejected'; this is what the company is shown. */
  reject_reason?: string | null;
}

export interface IntentForm {
  form_id: number;
  student_id: number;
  company_id: number;
  semester_id: number;
  job_id: number | null;
  status: string;
  mentor_id?: number | null;
  start_date?: Date | string | null;
  acceptance_evidence_path?: string | null;
}

// Sprint 2 API Request Bodies

export interface GoogleSearchCompanyBody {
  google_place_id: string;
  name_th: string;
  name_en?: string;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
}

export interface CreateJobPostBody {
  company_id: number;
  title: string;
  description: string;
  image_path?: string;
  quota: number;
  expire_date: string; // ISO date string or YYYY-MM-DD
}

export interface SubmitIntentBody {
  company_id: number;
  semester_id: number;
  job_id?: number | null;
}

// Sprint 3 Entities

export interface DocumentTemplate {
  template_id: number;
  name: string;
  file_path: string;
  type: string;
}

export interface OfficialDocument {
  doc_id: number;
  document_number?: string | null;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: 'created' | 'pending_sign' | 'signed' | 'rejected';
  dean_signature_date: Date | string | null;
  docusign_envelope_id?: string | null;
}

// Sprint 3 Request Bodies

export interface UpdateCompanyContactInfoBody {
  contact_person: string;
  contact_position: string;
  email: string;
}

export interface GenerateDocumentBody {
  student_id: number;
  company_id: number;
  template_id: number;
}

export interface BatchSignDocumentsBody {
  doc_ids: number[];
}

// Sprint 4 Entities

export interface Mentor {
  mentor_id: number;
  company_id: number;
  name: string;
  position: string | null;
  department: string | null;
  phone: string;
}

// Sprint 4 Request Bodies

export interface CompanyAcceptPayload {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
  start_date: string; // YYYY-MM-DD
}

export interface CompanyRejectPayload {
  rejection_reason?: string;
}

export interface StudentAcceptPayload {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
  start_date: string; // YYYY-MM-DD
}

export interface VerifyEligibilityBody {
  is_eligible: boolean;
  is_orientation_passed: boolean;
}

// Sprint 5 (System 2) Entities

export interface Accommodation {
  student_id: number;
  address: string;
  phone?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
}

export interface WeeklyWorkPlan {
  plan_id: number;
  student_id: number;
  week_number: number;
  start_date: Date | string;
  end_date: Date | string;
  tasks: string;
  status: string;
}



