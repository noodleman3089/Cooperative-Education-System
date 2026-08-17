import React, { useContext, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import OnboardMentorModal from './OnboardMentorModal';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { useDashboardData } from '../hooks/useDashboardData';
import StatusBadge from './ui/StatusBadge';
import { getErrorMessage } from '../utils/errors';
import { Input, Select, Textarea } from './ui/Input';

interface CompanyDashboardProps {
  activeMenu?: string;
  defaultTab?: string;
}

interface CompanyProfile {
  company_id: number;
  name_th: string;
  name_en: string | null;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  is_verified: boolean;
  contact_person: string | null;
  contact_position: string | null;
  email: string | null;
}

/**
 * Exactly what the server sends a company, and no more.
 *
 * These are the fields of สหกิจ 04 (แบบแจ้งรายชื่อนักศึกษาสหกิจศึกษา) — the name
 * list the faculty posts to a company so it can choose — plus what this screen
 * needs to work. Everything personal about a student reaches the company the
 * way it does on paper: inside สหกิจ 03, the application the student filled in
 * and attached, which is the resume file linked from each row.
 */
interface ApplicantIntent {
  form_id: number;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  major_name_th: string;
  job_title?: string;
  status: string;
  resume_file: string | null;
  /** Present once the company has turned the applicant down. */
  reject_reason?: string | null;
}

/**
 * The statuses at which a company may accept or reject, mirroring
 * `COMPANY_DECISION_FROM` in `backend/src/models/intent.ts`.
 *
 * This list used to start at `approved_by_advisor`, one stage earlier than the
 * server allows, so the buttons appeared on rows the backend would refuse with
 * a 400. It matches the paperwork too: nothing reaches the company until the
 * department head has signed off and สหกิจ 04 goes out.
 */
const COMPANY_CAN_DECIDE_ON = [
  'approved_by_dept_head',
  'pending_sign',
  'signed',
  'pending_acceptance',
];

/** Today as YYYY-MM-DD, for date fields that cannot sensibly point backwards. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};

/** Name if the registry has one, student code if it does not. */
const applicantName = (app: { first_name: string | null; last_name: string | null; student_code: string }): string =>
  `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim() || app.student_code;

/**
 * Grounded in what a company actually knows at this point. The other three
 * rejection paths have been made to state a reason (advisor round 12, department
 * head round 13, staff round 17); this was the last one that could refuse a
 * student in silence.
 */
const REJECT_REASONS = [
  'คุณสมบัติหรือทักษะยังไม่ตรงกับตำแหน่งที่เปิดรับ',
  'ตำแหน่งนี้มีผู้ผ่านการคัดเลือกครบตามจำนวนแล้ว',
  'ช่วงเวลาปฏิบัติงานไม่ตรงกับที่สถานประกอบการกำหนด',
  'นักศึกษาไม่มาสัมภาษณ์ หรือติดต่อไม่ได้',
  'สถานประกอบการงดรับนักศึกษาสหกิจศึกษาในภาคการศึกษานี้',
];

interface JobPosting {
  job_id: number;
  title: string;
  description: string;
  quota: number;
  applied_count: number;
  expire_date: string;
  status: string;
  /** Present only when status is 'rejected'. */
  reject_reason?: string | null;
}

interface ReportOutlineItem {
  outline_id: number;
  student_id: number;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  major_name_th: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_file_path: string | null;
  latest_submitted_at: string | null;
  latest_rejection_comment: string | null;
}

const CompanyDashboard: React.FC<CompanyDashboardProps> = ({ activeMenu = 'dashboard', defaultTab }) => {
  const currentTab = defaultTab || (['jobs', 'profile', 'report_outlines'].includes(activeMenu) ? activeMenu : 'dashboard');

  // A mentor is routed here for the outline queue, but is not a company
  // representative: /companies/my-company, /intents and /jobs are all
  // company-only. Which of the two is looking decides what may be requested.
  const auth = useContext(AuthContext);
  const isCompanyRep = auth?.user?.roles?.includes('company') ?? false;

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [applicants, setApplicants] = useState<ApplicantIntent[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [outlines, setOutlines] = useState<ReportOutlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Outline Review modal state
  const [reviewingOutline, setReviewingOutline] = useState<ReportOutlineItem | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Job post form state
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [jobQuota, setJobQuota] = useState<number | ''>('');
  const [jobExpireDate, setJobExpireDate] = useState('');
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  // Accept / reject applicant modal state. Both hold the whole applicant, not
  // just an id: "นักศึกษาท่านนี้" in a confirmation is no help when the table
  // has ten rows.
  const [acceptingApplicant, setAcceptingApplicant] = useState<ApplicantIntent | null>(null);
  const [rejectingApplicant, setRejectingApplicant] = useState<ApplicantIntent | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  /** Kept apart from `error` so it appears inside the dialog, not behind it. */
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Company Profile form state
  const [contactPerson, setContactPerson] = useState('');
  const [contactPosition, setContactPosition] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // `isBackground` follows the other dashboards: a poll must not clear the
  // banner an action just produced, nor flip the screen back to its skeleton.
  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }

      // Everything a mentor cannot ask for is skipped rather than requested and
      // caught. This used to `await api.get('/companies/my-company')` first, so
      // a mentor's 403 threw before the Promise.all was ever reached and the
      // outline queue — the only screen a mentor has — never loaded at all.
      // The outline request is deliberately NOT swallowed: it is the point of
      // the page, and an empty table hid every failure it ever had.
      const [profileRes, applicantsRes, jobsRes, outlinesRes] = await Promise.all([
        isCompanyRep ? api.get('/companies/my-company') : Promise.resolve(null),
        isCompanyRep ? api.get('/intents') : Promise.resolve([]),
        isCompanyRep ? api.get('/jobs') : Promise.resolve([]),
        api.get('/outlines/company')
      ]);

      setCompanyProfile(profileRes);

      if (profileRes) {
        setContactPerson(profileRes.contact_person || '');
        setContactPosition(profileRes.contact_position || '');
        setContactEmail(profileRes.email || '');
      }

      const outlineList = Array.isArray(outlinesRes) ? outlinesRes : (outlinesRes?.data || []);
      setApplicants(applicantsRes || []);
      setJobs(jobsRes || []);
      setOutlines(outlineList);
    } catch (err) {
      console.error('Failed to load Company dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลของบริษัทได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // Both screens here wait on somebody else — a student uploading an outline, a
  // student applying — so they were the wrong two to leave on a bare
  // useEffect([]) that never looked again.
  useDashboardData(loadData, [currentTab]);

  const handleReviewOutline = async (status: 'pending_advisor' | 'rejected') => {
    if (!reviewingOutline) return;
    if (status === 'rejected' && !reviewComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะในการตีกลับแก้ไขโครงร่างรายงาน');
      return;
    }

    try {
      setIsSubmittingReview(true);
      setError(null);
      await api.put(`/outlines/${reviewingOutline.outline_id}/status`, {
        status,
        comment: reviewComment
      });

      setSuccess(
        status === 'pending_advisor'
          ? 'อนุมัติโครงร่างรายงาน (สหกิจ 11) และส่งต่อให้อาจารย์ที่ปรึกษาพิจารณาเรียบร้อยแล้ว'
          : 'ตีกลับโครงร่างรายงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
      );
      setReviewingOutline(null);
      setReviewComment('');
      await loadData();
    } catch (err) {
      console.error('Review outline error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการตรวจอนุมัติโครงร่าง'));
    } finally {
      setIsSubmittingReview(false);
    }
  };


  // Create new job posting
  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyProfile) return;

    if (!jobTitle || !jobDescription || jobQuota === '' || !jobExpireDate) {
      setError('กรุณากรอกข้อมูลตำแหน่งงานว่างให้ครบทุกฟิลด์');
      return;
    }

    setIsCreatingJob(true);
    setError(null);
    setSuccess(null);

    try {
      await api.post('/jobs', {
        company_id: companyProfile.company_id,
        title: jobTitle,
        description: jobDescription,
        quota: Number(jobQuota),
        expire_date: jobExpireDate
      });

      setSuccess('สร้างข้อมูลประกาศรับสมัครงานสหกิจศึกษาสำเร็จ (รอเจ้าหน้าที่ตรวจสอบอนุมัติเผยแพร่)');
      setJobTitle('');
      setJobDescription('');
      setJobQuota('');
      setJobExpireDate('');
      
      // Reload jobs
      const jobsRes = await api.get('/jobs');
      setJobs(jobsRes || []);
    } catch (err) {
      console.error('Create job error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถลงประกาศรับสมัครงานได้'));
    } finally {
      setIsCreatingJob(false);
    }
  };

  // Reject applicant
  const handleRejectApplicant = async () => {
    if (!rejectingApplicant) return;

    const reason = rejectReason === 'other' ? rejectReasonOther.trim() : rejectReason;
    if (!reason) {
      setRejectError('กรุณาเลือกหรือระบุเหตุผลที่ไม่รับนักศึกษาเข้าปฏิบัติงาน');
      return;
    }

    setRejectError(null);
    setError(null);
    setSuccess(null);
    setRejectBusy(true);

    try {
      await api.patch(`/acceptances/company/${rejectingApplicant.form_id}/status`, {
        status: 'rejected',
        reason
      });
      setRejectingApplicant(null);
      setSuccess('ปฏิเสธการรับเข้างานของนักศึกษาแล้ว ระบบได้แจ้งเหตุผลให้นักศึกษาทราบทางอีเมล และปลดล็อกให้สมัครงานที่อื่นได้');
      await loadData();
    } catch (err) {
      console.error('Reject applicant error:', err);
      setRejectError(getErrorMessage(err, 'การปฏิเสธใบสมัครงานล้มเหลว'));
    } finally {
      setRejectBusy(false);
    }
  };

  // Update contact profile info
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyProfile) return;

    if (!contactPerson || !contactPosition || !contactEmail) {
      setError('กรุณากรอกรายละเอียดผู้ประสานงานหลักให้ครบถ้วน');
      return;
    }

    setIsUpdatingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      await api.put(`/companies/my-company/contact-info`, {
        contact_person: contactPerson,
        contact_position: contactPosition,
        email: contactEmail
      });

      setSuccess('บันทึกปรับปรุงข้อมูลการติดต่อประสานงานบริษัทสำเร็จเรียบร้อย');
      await loadData();
    } catch (err) {
      console.error('Update company profile error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถแก้ไขข้อมูลผู้ติดต่อได้'));
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant={skeletonFor('company', currentTab)} />
    );
  }

  return (
    <div className="space-y-6 page-enter">
      {/* Top Header Card */}
      {companyProfile && (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <span className="text-xs font-semibold text-brand-blue uppercase tracking-wider dark:text-blue-400">สถานประกอบการ</span>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {companyProfile.name_th} {companyProfile.name_en ? `(${companyProfile.name_en})` : ''}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              ที่ตั้ง: {companyProfile.address} {companyProfile.district} {companyProfile.province} {companyProfile.postal_code}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
            companyProfile.is_verified 
              ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
              : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400'
          }`}>
            {companyProfile.is_verified ? 'สถานะ: ผ่านการยืนยันข้อมูลแล้ว' : 'สถานะ: รอตรวจสอบข้อมูล'}
          </span>
        </div>
      )}

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {currentTab === 'jobs' ? (
        /* Job Posting Management */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Post Form */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 md:col-span-1">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">ลงข้อมูลตำแหน่งรับนักศึกษาใหม่</h3>
            <form onSubmit={handleCreateJob} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  ชื่อตำแหน่งงาน (เช่น Full-Stack Web Developer)
                </label>
                <Input
                  type="text"
                  required
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  รายละเอียดหน้าที่งาน & สวัสดิการ
                </label>
                <Textarea
                  rows={4}
                  required
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    จำนวนรับ (โควตาคน)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    required
                    value={jobQuota}
                    onChange={(e) => setJobQuota(e.target.value !== '' ? Number(e.target.value) : '')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    ปิดรับสมัครเมื่อใด
                  </label>
                  {/* A closing date in the past would publish a posting that is
                      already expired. */}
                  <Input
                    type="date"
                    required
                    min={todayIso()}
                    value={jobExpireDate}
                    onChange={(e) => setJobExpireDate(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" size="lg" loading={isCreatingJob} loadingLabel="กำลังส่งข้อมูล...">
                สร้างประกาศรับสมัครงาน
              </Button>
            </form>
          </div>

          {/* Job lists */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
                <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  ตำแหน่งงานว่างที่ลงประกาศไว้ ({jobs.length} รายการ)
                </span>
              </div>

              {jobs.length > 0 ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {jobs.map((job) => (
                    <div key={job.job_id} className="p-6 text-xs flex justify-between items-start gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-800 dark:text-white">{job.title}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            job.status === 'published'
                              ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                              : job.status === 'rejected'
                              ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                              : job.status === 'closed'
                              ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                              : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400'
                          }`}>
                            {job.status === 'published'
                              ? 'เผยแพร่อยู่'
                              : job.status === 'rejected'
                              ? 'เจ้าหน้าที่ไม่อนุมัติ'
                              : job.status === 'closed'
                              ? 'ปิดรับสมัครแล้ว'
                              : 'รอเจ้าหน้าที่ตรวจอนุมัติ'}
                          </span>
                        </div>
                        {/* A refusal the author cannot act on is the same as the
                            system losing their posting. */}
                        {job.status === 'rejected' && job.reject_reason && (
                          <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700 dark:border-red-950/40 dark:bg-red-950/20 dark:text-red-300">
                            <span className="font-bold">เหตุผลที่ไม่อนุมัติ:</span> {job.reject_reason}
                            <div className="mt-1 text-red-600/80 dark:text-red-400/80">
                              แก้ไขตามนี้แล้วสร้างประกาศใหม่ได้ทันที
                            </div>
                          </div>
                        )}
                        <p className="text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-line">{job.description}</p>
                        <div className="flex gap-4 text-gray-500 dark:text-gray-400 text-xs pt-2">
                          <span>จำนวนโควตาที่เปิดรับ: {job.quota} คน</span>
                          <span>วันสิ้นสุด: {new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(job.expire_date))}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">ยังไม่ได้ลงข้อมูลประกาศงาน</div>
              )}
            </div>
          </div>
        </div>
      ) : currentTab === 'profile' ? (
        /* Company Profile Edit */
        <div className="max-w-xl space-y-6">
        {/* The menu says "ข้อมูลและประวัติบริษัท" but the screen held three
            contact fields and nothing else — the company could not so much as
            read the address and phone number the university has on file for it.
            They are shown read-only: those fields carry `is_verified`, and
            letting the account rewrite its own verified identity is a different
            question from letting it correct who answers the phone. */}
        {companyProfile && (
          <div className="bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ข้อมูลสถานประกอบการในทะเบียนของมหาวิทยาลัย</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
              หากข้อมูลส่วนนี้ไม่ถูกต้อง กรุณาแจ้งเจ้าหน้าที่งานสหกิจศึกษาเพื่อแก้ไข
              เนื่องจากเป็นข้อมูลที่ผ่านการตรวจสอบและใช้พิมพ์ลงหนังสือราชการ
            </p>

            <dl className="space-y-3 text-xs">
              {[
                ['ชื่อสถานประกอบการ (ไทย)', companyProfile.name_th],
                ['ชื่อสถานประกอบการ (อังกฤษ)', companyProfile.name_en || '-'],
                ['ที่ตั้ง', `${companyProfile.address} ${companyProfile.district} ${companyProfile.province} ${companyProfile.postal_code}`],
                ['โทรศัพท์', companyProfile.phone || '-'],
                ['สถานะการตรวจสอบ', companyProfile.is_verified ? 'ผ่านการยืนยันข้อมูลแล้ว' : 'รอเจ้าหน้าที่ตรวจสอบข้อมูล'],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col sm:flex-row sm:gap-4">
                  <dt className="sm:w-48 shrink-0 font-medium text-gray-500 dark:text-gray-400">{label}</dt>
                  <dd className="text-gray-800 dark:text-gray-200">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ตั้งค่าผู้ติดต่อประสานงานหลัก</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">ข้อมูลตรงนี้เจ้าหน้าที่จำเป็นต้องใช้ในการนำฟิลด์ไปกรอกจดหมายราชการส่งตัวคณบดี</p>
          
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อ-นามสกุล ผู้ประสานงานหลักฝ่าย HR
              </label>
              <Input
                type="text"
                required
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ตำแหน่งงาน
              </label>
              <Input
                type="text"
                required
                value={contactPosition}
                onChange={(e) => setContactPosition(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                อีเมลผู้ติดต่อประสานงาน (รับเอกสารตอบรับส่งตัว)
              </label>
              <Input
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>

            <Button type="submit" loading={isUpdatingProfile} loadingLabel="กำลังบันทึก...">
              บันทึกข้อมูลติดต่อหลัก
            </Button>
          </form>
        </div>
        </div>
      ) : currentTab === 'report_outlines' ? (
        /* Report Outline Review Tab (สหกิจ 11) */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                ตรวจสอบความถูกต้องของหัวข้อวัตถุประสงค์และแผนการทำรายงานของนักศึกษาฝึกงาน
              </p>
            </div>
            <span className="px-3 py-1 bg-brand-blue/10 text-brand-blue rounded-full text-xs font-bold dark:text-blue-400">
              {outlines.filter(o => o.status === 'pending_mentor').length} รายการรอพี่เลี้ยงตรวจ
            </span>
          </div>

          {outlines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สาขาวิชา</th>
                    <th className="p-4 font-semibold">วันที่อัปโหลดล่าสุด</th>
                    <th className="p-4 font-semibold text-center">สถานะโครงร่าง</th>
                    <th className="p-4 font-semibold text-right">เอกสาร & ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {outlines.map((item) => (
                    <tr key={item.outline_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4">
                        <div className="font-bold text-gray-800 dark:text-gray-200">
                          {item.first_name ? `${item.first_name} ${item.last_name}` : `รหัสนักศึกษา: ${item.student_code}`}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {item.student_code}
                        </div>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">{item.major_name_th}</td>
                      {/* No font-mono: Intl.DateTimeFormat('th-TH') returns Thai
                          month names, and a monospace family has no Thai glyphs,
                          so the browser silently falls back mid-string and the
                          typeface changes inside one sentence. */}
                      <td className="p-4 text-gray-500 text-xs dark:text-gray-400">
                        {item.latest_submitted_at
                          ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.latest_submitted_at))
                          : '-'}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${
                          item.status === 'pending_mentor'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900'
                            : item.status === 'pending_advisor'
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900'
                            : item.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
                            : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900'
                        }`}>
                          {item.status === 'pending_mentor'
                            ? 'รอพี่เลี้ยงตรวจ'
                            : item.status === 'pending_advisor'
                            ? 'พี่เลี้ยงอนุมัติแล้ว (รอ อ.ที่ปรึกษา)'
                            : item.status === 'approved'
                            ? 'อนุมัติสมบูรณ์'
                            : 'ตีกลับแก้ไข'}
                        </span>
                      </td>
                      <td className="p-4 text-right flex items-center justify-end gap-2">
                        {item.latest_file_path && (
                          <a
                            href={`${API_BASE_URL}/files/${item.latest_file_path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all active:scale-[0.97] dark:border-gray-800 dark:hover:text-blue-400"
                            title="เปิดไฟล์ PDF โครงร่าง"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </a>
                        )}

                        <Button
                          size="sm"
                          variant={item.status === 'pending_mentor' ? 'primary' : 'secondary'}
                          onClick={() => {
                            setReviewingOutline(item);
                            setReviewComment(item.latest_rejection_comment || '');
                          }}
                        >
                          {item.status === 'pending_mentor' ? 'ตรวจอนุมัติ' : 'ดูรายละเอียด/ผลตรวจ'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
              ยังไม่มีนักศึกษายื่นโครงร่างรายงานเข้ามา
            </div>
          )}
        </div>
      ) : (
        /* Applicant review tab */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              รายชื่อนักศึกษาที่ยื่นความจำนงสมัครงานเข้ามา ({applicants.length} คน)
            </span>
          </div>

          {applicants.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                    <th className="p-4 font-semibold">ผู้สมัคร</th>
                    <th className="p-4 font-semibold">สาขาวิชา</th>
                    <th className="p-4 font-semibold">ตำแหน่งงานยื่นสมัคร</th>
                    <th className="p-4 font-semibold text-center">สถานะความคืบหน้า</th>
                    <th className="p-4 font-semibold text-right">เรซูเม่ & คัดเลือก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {applicants.map((app) => (
                    <tr key={app.form_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      {/* The name has always been in the response; the table
                          just never read it, so applicants were shortlisted by
                          student number alone. */}
                      <td className="p-4">
                        <div className="font-bold text-gray-800 dark:text-gray-200">
                          {applicantName(app)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{app.student_code}</div>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">{app.major_name_th}</td>
                      <td className="p-4 text-gray-700 dark:text-gray-300">{app.job_title || 'ฝึกงานทั่วไป'}</td>
                      <td className="p-4 text-center">
                        <StatusBadge status={app.status} />
                        {app.status === 'company_rejected' && app.reject_reason && (
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-48 mx-auto">
                            เหตุผล: {app.reject_reason}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-right flex items-center justify-end gap-2">
                        {app.resume_file ? (
                          <a
                            href={`${API_BASE_URL}/files/${app.resume_file}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
                            title="เปิดอ่านเรซูเม่"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">ไม่มีไฟล์</span>
                        )}

                        {COMPANY_CAN_DECIDE_ON.includes(app.status) && (
                          <>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setRejectingApplicant(app);
                                setRejectReason('');
                                setRejectReasonOther('');
                                setRejectError(null);
                              }}
                            >
                              ปฏิเสธ
                            </Button>
                            <Button size="sm" onClick={() => setAcceptingApplicant(app)}>
                              ตอบรับเข้างาน
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
              ไม่มีคำขอสมัครงานเข้ามาในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* Review Outline Modal for Mentor. `pending_mentor` is the only state the
          mentor may act on — reportOutline.ts:129 answers 400 for anything else. */}
      {reviewingOutline && (() => {
        const canReviewOutline = reviewingOutline.status === 'pending_mentor';
        return (
        <Modal
          onClose={() => setReviewingOutline(null)}
          size="lg"
          closeOnBackdrop={false}
          title="พิจารณาโครงร่างรายงาน (สหกิจ 11)"
        >
          <ModalBody className="space-y-4">
            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
              <p>
                <span className="font-semibold text-gray-500 dark:text-gray-400">นักศึกษา:</span>{' '}
                {reviewingOutline.first_name ? `${reviewingOutline.first_name} ${reviewingOutline.last_name}` : reviewingOutline.student_code} ({reviewingOutline.student_code})
              </p>
              <p>
                <span className="font-semibold text-gray-500 dark:text-gray-400">สาขาวิชา:</span> {reviewingOutline.major_name_th}
              </p>
              {reviewingOutline.latest_file_path && (
                <div className="pt-2">
                  <a
                    href={`${API_BASE_URL}/files/${reviewingOutline.latest_file_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-blue text-brand-blue hover:bg-blue-50 dark:hover:bg-blue-950/30 font-bold transition-all"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    คลิกเพื่อเปิดอ่านไฟล์ PDF โครงร่างรายงาน
                  </a>
                </div>
              )}
            </div>

            {/* Past pending_mentor the decision is no longer this reader's to
                make — the backend refuses it — so the dialog says where the
                outline has got to instead of offering buttons that would 400. */}
            {!canReviewOutline && (
              <AlertBanner
                variant="info"
                message={
                  reviewingOutline.status === 'pending_advisor'
                    ? 'ท่านได้ให้ความเห็นชอบโครงร่างฉบับนี้แล้ว ขณะนี้อยู่ระหว่างการพิจารณาของอาจารย์ที่ปรึกษา'
                    : reviewingOutline.status === 'approved'
                    ? 'โครงร่างฉบับนี้ได้รับการอนุมัติสมบูรณ์จากอาจารย์ที่ปรึกษาแล้ว'
                    : 'โครงร่างฉบับนี้ถูกตีกลับให้นักศึกษาแก้ไข เมื่อนักศึกษาส่งฉบับใหม่จะกลับเข้ามาให้ท่านพิจารณาอีกครั้ง'
                }
              />
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                {canReviewOutline
                  ? 'ความคิดเห็น / ข้อแนะนำการแก้ไข (จำเป็นกรณีตีกลับแก้ไข)'
                  : 'ความคิดเห็นล่าสุดที่บันทึกไว้'}
              </label>
              <Textarea
                rows={4}
                readOnly={!canReviewOutline}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={canReviewOutline
                  ? 'กรอกข้อเสนอแนะในการปรับปรุงหัวข้อ วัตถุประสงค์ หรือโครงสร้างรายงาน...'
                  : 'ไม่มีความคิดเห็นบันทึกไว้'}
                className="read-only:opacity-70" size="sm"
              />
            </div>

          </ModalBody>

          <ModalFooter>
            {canReviewOutline ? (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  loading={isSubmittingReview}
                  loadingLabel="กำลังส่งข้อมูล..."
                  onClick={() => handleReviewOutline('rejected')}
                >
                  ตีกลับให้นักศึกษาแก้ไข
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  loading={isSubmittingReview}
                  loadingLabel="กำลังส่งข้อมูล..."
                  onClick={() => handleReviewOutline('pending_advisor')}
                >
                  อนุมัติและส่งต่ออาจารย์ที่ปรึกษา
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setReviewingOutline(null)}>
                ปิดหน้าต่าง
              </Button>
            )}
          </ModalFooter>
        </Modal>
        );
      })()}

      <OnboardMentorModal
        isOpen={acceptingApplicant !== null}
        intentId={acceptingApplicant?.form_id ?? null}
        studentLabel={acceptingApplicant ? `${applicantName(acceptingApplicant)} (${acceptingApplicant.student_code})` : null}
        onClose={() => setAcceptingApplicant(null)}
        onSuccess={async (msg) => {
          setSuccess(msg);
          setAcceptingApplicant(null);
          await loadData();
        }}
      />

      {/* Was a bare ConfirmDialog saying "นักศึกษาท่านนี้" and asking for no
          reason at all — the student was told they had been turned down and
          never why, which is the one thing they need in order to apply
          somewhere else. */}
      {rejectingApplicant && (
        <Modal
          onClose={() => setRejectingApplicant(null)}
          size="md"
          closeOnBackdrop={false}
          title="ไม่รับนักศึกษาเข้าปฏิบัติงาน"
        >
          <ModalBody className="space-y-4">
            <AlertBanner variant="error" message={rejectError} />

            <p className="text-xs text-gray-600 dark:text-gray-300">
              นักศึกษา:{' '}
              <span className="font-bold text-gray-800 dark:text-gray-100">
                {applicantName(rejectingApplicant)} ({rejectingApplicant.student_code})
              </span>
              {rejectingApplicant.job_title ? ` · ตำแหน่ง ${rejectingApplicant.job_title}` : ''}
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เหตุผลที่ไม่รับ (ระบบจะแจ้งข้อความนี้ให้นักศึกษาทราบ)
              </label>
              <Select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)} size="sm"
              >
                <option value="">-- เลือกเหตุผล --</option>
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
                <option value="other">ระบุเหตุผลเอง</option>
              </Select>
            </div>

            {rejectReason === 'other' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ระบุเหตุผล
                </label>
                <Textarea
                  rows={3}
                  value={rejectReasonOther}
                  onChange={(e) => setRejectReasonOther(e.target.value)}
                  placeholder="อธิบายเหตุผลที่ไม่รับนักศึกษาคนนี้เข้าปฏิบัติงาน..." size="sm"
                />
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              เมื่อยืนยันแล้ว นักศึกษาจะถูกปลดล็อกให้ไปยื่นสมัครที่สถานประกอบการอื่นได้ทันที
            </p>
          </ModalBody>

          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setRejectingApplicant(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={rejectBusy}
              loadingLabel="กำลังบันทึก..."
              onClick={handleRejectApplicant}
            >
              ยืนยันไม่รับนักศึกษา
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default CompanyDashboard;
