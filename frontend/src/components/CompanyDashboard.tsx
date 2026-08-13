import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import OnboardMentorModal from './OnboardMentorModal';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';

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

interface ApplicantIntent {
  form_id: number;
  student_id: number;
  student_code: string;
  cumulative_gpa: number;
  major_name_th: string;
  job_title?: string;
  status: string;
  resume_file: string | null;
}

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

  // Accept applicant modal state
  const [acceptingIntentId, setAcceptingIntentId] = useState<number | null>(null);
  const [rejectingIntentId, setRejectingIntentId] = useState<number | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);

  // Company Profile form state
  const [contactPerson, setContactPerson] = useState('');
  const [contactPosition, setContactPosition] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

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
      setError('ไม่สามารถโหลดข้อมูลของบริษัทได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentTab]);

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
    } catch (err: any) {
      console.error('Review outline error:', err);
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาดในการตรวจอนุมัติโครงร่าง');
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
    } catch (err: any) {
      console.error('Create job error:', err);
      setError(err.response?.data?.message || 'ไม่สามารถลงประกาศรับสมัครงานได้');
    } finally {
      setIsCreatingJob(false);
    }
  };

  // Reject applicant
  const handleRejectApplicant = async () => {
    if (rejectingIntentId === null) return;
    setError(null);
    setSuccess(null);
    setRejectBusy(true);

    try {
      await api.patch(`/acceptances/company/${rejectingIntentId}/status`, {
        status: 'rejected'
      });
      setRejectingIntentId(null);
      setSuccess('ปฏิเสธการรับเข้างานของนักศึกษาแล้ว นักศึกษาจะถูกปลดล็อกให้สมัครงานที่อื่นได้');
      await loadData();
    } catch (err: any) {
      console.error('Reject applicant error:', err);
      setRejectingIntentId(null);
      setError(err.response?.data?.message || 'การปฏิเสธใบสมัครงานล้มเหลว');
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
    } catch (err: any) {
      console.error('Update company profile error:', err);
      setError(err.response?.data?.message || 'ไม่สามารถแก้ไขข้อมูลผู้ติดต่อได้');
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
            <p className="text-xs text-gray-400 mt-1">
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
                <input
                  type="text"
                  required
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  รายละเอียดหน้าที่งาน & สวัสดิการ
                </label>
                <textarea
                  rows={4}
                  required
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    จำนวนรับ (โควตาคน)
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={jobQuota}
                    onChange={(e) => setJobQuota(e.target.value !== '' ? Number(e.target.value) : '')}
                    className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    ปิดรับสมัครเมื่อใด
                  </label>
                  <input
                    type="date"
                    required
                    value={jobExpireDate}
                    onChange={(e) => setJobExpireDate(e.target.value)}
                    className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreatingJob}
                className="w-full py-2 rounded-xl bg-brand-blue hover:bg-blue-600 text-white font-bold text-xs transition-all shadow-md shadow-blue-500/10"
              >
                {isCreatingJob ? 'กำลังส่งข้อมูล...' : 'สร้างประกาศรับสมัครงาน'}
              </button>
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
                        <div className="flex gap-4 text-gray-400 text-xs pt-2">
                          <span>จำนวนโควตาที่เปิดรับ: {job.quota} คน</span>
                          <span>วันสิ้นสุด: {new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(job.expire_date))}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">ยังไม่ได้ลงข้อมูลประกาศงาน</div>
              )}
            </div>
          </div>
        </div>
      ) : currentTab === 'profile' ? (
        /* Company Profile Edit */
        <div className="max-w-xl bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ตั้งค่าผู้ติดต่อประสานงานหลัก</h3>
          <p className="text-xs text-gray-400 mb-6">ข้อมูลตรงนี้เจ้าหน้าที่จำเป็นต้องใช้ในการนำฟิลด์ไปกรอกจดหมายราชการส่งตัวคณบดี</p>
          
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อ-นามสกุล ผู้ประสานงานหลักฝ่าย HR
              </label>
              <input
                type="text"
                required
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ตำแหน่งงาน
              </label>
              <input
                type="text"
                required
                value={contactPosition}
                onChange={(e) => setContactPosition(e.target.value)}
                className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                อีเมลผู้ติดต่อประสานงาน (รับเอกสารตอบรับส่งตัว)
              </label>
              <input
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={isUpdatingProfile}
              className="py-2 px-6 rounded-xl bg-brand-blue hover:bg-blue-600 text-white font-bold text-xs transition-all shadow-md shadow-blue-500/10"
            >
              {isUpdatingProfile ? 'กำลังบันทึก...' : 'บันทึกข้อมูลติดต่อหลัก'}
            </button>
          </form>
        </div>
      ) : currentTab === 'report_outlines' ? (
        /* Report Outline Review Tab (สหกิจ 11) */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
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
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
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
                        <div className="text-xs text-gray-400 font-mono">
                          {item.student_code}
                        </div>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">{item.major_name_th}</td>
                      <td className="p-4 text-gray-500 font-mono text-xs dark:text-gray-400">
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

                        <button
                          type="button"
                          onClick={() => {
                            setReviewingOutline(item);
                            setReviewComment(item.latest_rejection_comment || '');
                          }}
                          className="py-1 px-3 rounded-lg bg-brand-blue text-white hover:bg-blue-600 font-bold text-xs transition-all active:scale-[0.97] shadow-sm shadow-blue-500/10"
                        >
                          {item.status === 'pending_mentor' ? 'ตรวจอนุมัติ' : 'ดูรายละเอียด/ผลตรวจ'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
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
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
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
                      <td className="p-4 font-bold text-gray-800 dark:text-gray-300">
                        รหัส: {app.student_code}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">{app.major_name_th}</td>
                      <td className="p-4 text-gray-700 dark:text-gray-300">{app.job_title || 'ฝึกงานทั่วไป'}</td>
                      <td className="p-4 text-center">
                        <StatusBadge status={app.status} />
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
                          <span className="text-xs text-gray-400 mr-2">ไม่มีไฟล์</span>
                        )}

                        {['approved_by_advisor', 'approved_by_dept_head'].includes(app.status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => setRejectingIntentId(app.form_id)}
                              className="py-1 px-2.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 font-bold transition-all"
                            >
                              ปฏิเสธ
                            </button>
                            <button
                              type="button"
                              onClick={() => setAcceptingIntentId(app.form_id)}
                              className="py-1 px-2.5 rounded-lg bg-brand-blue text-white hover:bg-blue-600 font-bold transition-all shadow-sm"
                            >
                              ตอบรับเข้างาน
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              ไม่มีคำขอสมัครงานเข้ามาในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* Review Outline Modal for Mentor */}
      {reviewingOutline && (
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

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ความคิดเห็น / ข้อแนะนำการแก้ไข (จำเป็นกรณีตีกลับแก้ไข)
              </label>
              <textarea
                rows={4}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="กรอกข้อเสนอแนะในการปรับปรุงหัวข้อ วัตถุประสงค์ หรือโครงสร้างรายงาน..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:border-brand-blue"
              />
            </div>

          </ModalBody>

          <ModalFooter>
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
          </ModalFooter>
        </Modal>
      )}

      <OnboardMentorModal
        isOpen={acceptingIntentId !== null}
        intentId={acceptingIntentId}
        onClose={() => setAcceptingIntentId(null)}
        onSuccess={async (msg) => {
          setSuccess(msg);
          setAcceptingIntentId(null);
          await loadData();
        }}
      />

      <ConfirmDialog
        open={rejectingIntentId !== null}
        title="ปฏิเสธผู้สมัคร"
        message="ยืนยันปฏิเสธคำขอสมัครสหกิจของนักศึกษาท่านนี้? นักศึกษาจะถูกปลดล็อกให้ไปยื่นสมัครที่สถานประกอบการอื่นได้ทันที"
        confirmLabel="ยืนยันปฏิเสธ"
        destructive
        busy={rejectBusy}
        onConfirm={handleRejectApplicant}
        onCancel={() => setRejectingIntentId(null)}
      />
    </div>
  );
};

export default CompanyDashboard;
