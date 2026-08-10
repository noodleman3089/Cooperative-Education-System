export interface User {
  userId: number;
  email: string;
  roles: string[];
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
  language_proficiency?: any | null;
  preferred_work_region?: string | null;
  interested_job_types?: any | null;
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
  parental_consent_path?: string | null;
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
