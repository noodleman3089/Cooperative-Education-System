import React, { useState } from 'react';
import api, { API_BASE_URL } from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Select, Textarea } from '../../components/ui/Input';
import OnboardMentorModal from '../../components/OnboardMentorModal';
import StatusBadge from '../../components/ui/StatusBadge';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';

interface CompanyHomeProps {
  onNavigate?: (menu: string) => void;
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
  contact_person?: string | null;
  contact_position?: string | null;
  email?: string | null;
}

interface ApplicantIntent {
  form_id: number;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  major_name_th: string;
  job_title?: string;
  status: string;
  resume_file: string | null;
  reject_reason?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface JobOfferItem {
  job_id: number | null;
  title: string;
  description?: string;
  quota: number;
  applied_count?: number;
  major_ids?: number[];
  major_names?: string[];
  duration_term?: string;
  pay_amount?: number | null;
  pay_unit?: string | null;
  accommodation?: string;
  welfare_other?: string;
}

interface JobOfferCurrent {
  semester?: { semester_id: number; label: string };
  offer?: {
    offer_id: number;
    status: 'draft' | 'submitted' | 'reviewed' | 'declined';
    due_date?: string | null;
    days_left?: number | null;
    is_overdue?: boolean;
    informant_name?: string | null;
    informant_position?: string | null;
    copied_from_offer_id?: number | null;
  } | null;
  company?: CompanyProfile;
  items?: JobOfferItem[];
  previous?: {
    offer_id: number;
    semester_label: string;
    item_count: number;
    quota_total: number;
    accepted_count: number;
    items?: JobOfferItem[];
  } | null;
}

interface HistoryRow {
  semester_label: string;
  offered_quota: number;
  accepted_count: number;
  evaluated_count: number;
  details?: string;
}

const COMPANY_CAN_DECIDE_ON = [
  'approved_by_dept_head',
  'pending_sign',
  'signed',
  'pending_acceptance',
];

const REJECT_REASONS = [
  'คุณสมบัติหรือทักษะยังไม่ตรงกับตำแหน่งที่เปิดรับ',
  'ตำแหน่งนี้มีผู้ผ่านการคัดเลือกครบตามจำนวนแล้ว',
  'ช่วงเวลาปฏิบัติงานไม่ตรงกับที่สถานประกอบการกำหนด',
  'นักศึกษาไม่มาสัมภาษณ์ หรือติดต่อไม่ได้',
  'สถานประกอบการงดรับนักศึกษาสหกิจศึกษาในภาคการศึกษานี้',
];

const applicantName = (app: { first_name: string | null; last_name: string | null; student_code: string }): string =>
  `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim() || app.student_code;

const CompanyHome: React.FC<CompanyHomeProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [currentOfferData, setCurrentOfferData] = useState<JobOfferCurrent | null>(null);
  const [applicants, setApplicants] = useState<ApplicantIntent[]>([]);
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);

  // Modals for applicant onboarding / rejecting (E2E critical)
  const [acceptingApplicant, setAcceptingApplicant] = useState<ApplicantIntent | null>(null);
  const [rejectingApplicant, setRejectingApplicant] = useState<ApplicantIntent | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Modal for survey decline
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [isSubmittingDecline, setIsSubmittingDecline] = useState(false);
  const [isSubmittingSame, setIsSubmittingSame] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch company profile, current job offer, intents, and history
      // Fail-open for missing or 404 endpoints so company dashboard never crashes
      const [profileRes, offerRes, intentsRes, historyRes] = await Promise.allSettled([
        api.get('/companies/my-company'),
        api.get('/job-offers/current'),
        api.get('/intents'),
        api.get('/job-offers/history')
      ]);

      if (profileRes.status === 'fulfilled') {
        setCompanyProfile(profileRes.value);
      }

      if (offerRes.status === 'fulfilled') {
        setCurrentOfferData(offerRes.value);
      } else {
        setCurrentOfferData(null);
      }

      if (intentsRes.status === 'fulfilled') {
        setApplicants(intentsRes.value || []);
      } else {
        setApplicants([]);
      }

      if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value)) {
        setHistoryList(historyRes.value);
      } else {
        setHistoryList([]);
      }
    } catch (err) {
      console.error('Failed to load CompanyHome data:', err);
      setError('ไม่สามารถโหลดข้อมูลหน้าแรกสถานประกอบการได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useDashboardData(loadData);

  // Determine the 6 seasons (Spec D 2.1)
  // 1: overdue -> 有เลยกำหนด
  // 2: survey -> ยังไม่ตอบแบบสำรวจ
  // 3: select -> มีผู้สมัครรอคัดเลือก
  // 4: during -> อยู่ระหว่างฝึก
  // 5: end -> ปลายภาค มีประเมินค้าง
  // 6: idle -> อื่นๆ
  const pendingDecisions = applicants.filter((app) => COMPANY_CAN_DECIDE_ON.includes(app.status));
  const acceptedStudents = applicants.filter((app) => app.status === 'accepted');

  const offer = currentOfferData?.offer;
  const isOverdue = offer?.is_overdue ?? false;
  const isSurveyPending = offer?.status === 'draft' || offer?.status === undefined;

  const currentSeason: 'overdue' | 'survey' | 'select' | 'during' | 'end' | 'idle' = (() => {
    if (isOverdue) return 'overdue';
    if (isSurveyPending && offer?.due_date) return 'survey';
    if (pendingDecisions.length > 0) return 'select';
    if (offer?.days_left !== undefined && offer?.days_left !== null && offer.days_left <= 14 && acceptedStudents.length > 0) return 'end';
    if (acceptedStudents.length > 0) return 'during';
    return 'idle';
  })();

  // Handle "รับเหมือนเดิม ส่งคำตอบเลย"
  const handleOfferSame = async () => {
    if (!offer?.offer_id) return;
    try {
      setIsSubmittingSame(true);
      setError(null);
      await api.post(`/job-offers/${offer.offer_id}/submit`);
      setSuccess('ส่งแบบเสนองานสหกิจศึกษาให้มหาวิทยาลัยเรียบร้อยแล้ว');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถส่งแบบเสนองานสหกิจศึกษาได้'));
    } finally {
      setIsSubmittingSame(false);
    }
  };

  // Handle decline survey offer
  const handleConfirmDecline = async () => {
    if (!offer?.offer_id) return;
    try {
      setIsSubmittingDecline(true);
      setError(null);
      await api.post(`/job-offers/${offer.offer_id}/decline`, { reason: declineReason });
      setSuccess('แจ้งไม่รับนักศึกษาในภาคเรียนนี้เรียบร้อยแล้ว');
      setIsDeclineModalOpen(false);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกการงดรับนักศึกษาในภาคเรียนนี้ได้'));
      setIsDeclineModalOpen(false);
    } finally {
      setIsSubmittingDecline(false);
    }
  };

  // Reject applicant (E2E compatible)
  const handleRejectApplicant = async () => {
    if (!rejectingApplicant) return;
    const reason = rejectReason === 'other' ? rejectReasonOther.trim() : rejectReason;
    if (!reason) {
      setRejectError('กรุณาเลือกหรือระบุเหตุผลที่ไม่รับนักศึกษาเข้าปฏิบัติงาน');
      return;
    }

    setRejectError(null);
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

  if (loading) {
    return <PageSkeleton variant={skeletonFor('company', 'dashboard')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-12">
      {/* 1. Header Card: ทะเบียนสถานประกอบการของมหาวิทยาลัย */}
      {companyProfile && (
        <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-brand-blue dark:text-blue-400 tracking-wider uppercase">
              ทะเบียนสถานประกอบการของมหาวิทยาลัย
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
              {companyProfile.name_th}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              {companyProfile.name_en ? `${companyProfile.name_en} · ` : ''}
              {companyProfile.address} ต.{companyProfile.district} อ.{companyProfile.district} จ.{companyProfile.province} {companyProfile.postal_code}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0 ${
              companyProfile.is_verified
                ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
            }`}
          >
            {companyProfile.is_verified ? (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                เจ้าหน้าที่รับรองข้อมูลแล้ว
              </>
            ) : (
              'รอการตรวจสอบข้อมูล'
            )}
          </span>
        </div>
      )}

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. การ์ดฤดูกาลใบใหญ่ (D1 Hero Card) */}
      <div
        data-testid="company-home-season"
        data-season={currentSeason}
        className={`card rounded-2xl border overflow-hidden shadow-sm transition-all ${
          currentSeason === 'overdue'
            ? 'border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20'
            : currentSeason === 'survey'
            ? 'border-blue-200 dark:border-blue-900 bg-gradient-to-b from-blue-50/70 to-white dark:from-blue-950/20 dark:to-gray-900'
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
        }`}
      >
        <div className="p-6 sm:p-8 flex flex-col gap-5">
          {/* Season 1: Overdue */}
          {currentSeason === 'overdue' && (
            <>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <span className="text-xs font-bold tracking-wider text-red-600 dark:text-red-400 uppercase">
                    เอกสารเลยกำหนดส่ง
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
                    มีงานเอกสารที่เลยกำหนดส่งจากสถานประกอบการ
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
                    กรุณากรอกแบบแจ้งรายละเอียดงานและพนักงานที่ปรึกษา (สหกิจ 07) เพื่อให้นักศึกษาสามารถเริ่มปฏิบัติงานได้อย่างถูกต้อง
                  </p>
                </div>
                <Button
                  variant="danger"
                  data-testid="company-home-pending-form07"
                  onClick={() => onNavigate?.('form07')}
                >
                  กรอก สหกิจ 07 เดี๋ยวนี้
                </Button>
              </div>
            </>
          )}

          {/* Season 2: Survey */}
          {currentSeason === 'survey' && (
            <>
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="max-w-2xl">
                  <span className="text-xs font-bold tracking-wider text-brand-blue dark:text-blue-400 uppercase">
                    สิ่งที่มหาวิทยาลัยรอจากคุณ
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white mt-1.5 leading-snug">
                    {currentOfferData?.semester?.label || 'ภาคเรียนที่จะถึง'} สถานประกอบการของท่านรับนักศึกษาสหกิจศึกษาหรือไม่
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">
                    งานสหกิจศึกษาและการฝึกงานวิชาชีพ คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ ส่ง <strong>แบบเสนองานสหกิจศึกษา (สหกิจ 02)</strong> มาถามล่วงหน้าหนึ่งภาคการศึกษา เพื่อจัดนักศึกษาให้ตรงสาขาที่ท่านต้องการ
                  </p>
                </div>

                {offer?.due_date && (
                  <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
                    <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900 rounded-full text-xs font-bold">
                      ขอคำตอบกลับก่อน {offer.due_date}
                    </span>
                    {offer.days_left !== undefined && offer.days_left !== null && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        เหลืออีก {offer.days_left} วัน
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Previous answer preview */}
              {currentOfferData?.previous && (
                <div className="bg-white dark:bg-gray-800/80 border border-blue-100 dark:border-blue-900/50 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-xs">
                  <div className="flex items-center gap-2 text-brand-blue dark:text-blue-400">
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      ระบบกรอกคำตอบของ{currentOfferData.previous.semester_label} ไว้ให้แล้ว
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {currentOfferData.items && currentOfferData.items.length > 0 ? (
                      currentOfferData.items.map((it, idx) => (
                        <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-900/40">
                          <div className="text-xs font-bold text-gray-800 dark:text-gray-200">
                            {it.title} · {it.quota} อัตรา
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {it.major_names?.join(', ') || 'ทุกสาขา'} · {it.duration_term === 'full_year' ? 'ตลอดปีการศึกษา' : 'ภาคเรียนที่ 1'} · ค่าตอบแทน {it.pay_amount ? `${it.pay_amount} บาท/${it.pay_unit === 'month' ? 'เดือน' : 'วัน'}` : 'ไม่มี'} · {it.accommodation === 'free' ? 'มีที่พัก ฟรี' : 'ไม่มีที่พัก'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
                        มีข้อมูลตำแหน่งงานเดิม {currentOfferData.previous.item_count} รายการ รวม {currentOfferData.previous.quota_total} อัตรา
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    ภาคการศึกษาที่ผ่านมา สถานประกอบการของท่านรับนักศึกษาไป {currentOfferData.previous.accepted_count} คน
                  </div>
                </div>
              )}

              {/* 3 action buttons (Spec D 2.3) */}
              <div className="flex items-center gap-3 flex-wrap pt-2">
                <Button
                  data-testid="company-home-offer-same"
                  variant="primary"
                  loading={isSubmittingSame}
                  onClick={handleOfferSame}
                >
                  <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                  รับเหมือนเดิม ส่งคำตอบเลย
                </Button>

                <Button
                  data-testid="company-home-offer-edit"
                  variant="secondary"
                  onClick={() => onNavigate?.('jobs')}
                >
                  แก้รายละเอียดก่อนส่ง
                </Button>

                <Button
                  data-testid="company-home-offer-decline"
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                  onClick={() => setIsDeclineModalOpen(true)}
                >
                  ภาคเรียนนี้ยังไม่รับนักศึกษา
                </Button>

                <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                  ทุกปุ่มมีหน้าสรุปให้ตรวจก่อนส่งจริง
                </span>
              </div>
            </>
          )}

          {/* Season 3: Select (Pending Applicants) */}
          {currentSeason === 'select' && (
            <>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold tracking-wider text-amber-600 dark:text-amber-400 uppercase">
                      ช่วงคัดเลือกนักศึกษา
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      มี {pendingDecisions.length} คนรอการตัดสินใจ
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
                    นักศึกษา {pendingDecisions.length} คนที่คณะส่งมาให้ท่านพิจารณา
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
                    รายชื่อตาม <strong>สหกิจ 04</strong> — คณะออกหนังสือขอความอนุเคราะห์ให้แล้ว และแนบ <strong>ใบสมัคร สหกิจ 03</strong>
                  </p>
                </div>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
                {pendingDecisions.map((app) => (
                  <div key={app.form_id} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">
                        {applicantName(app)} · <span className="font-mono text-xs">{app.student_code}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {/* ⛔ ไม่มีตำแหน่ง = แสดง "–" · ค่าสำรองที่แต่งเอง ("ฝึกงานทั่วไป") ทำให้ใบที่นักศึกษา
                            หาที่ฝึกเองดูเหมือนมีตำแหน่งตกลงไว้แล้ว ทั้งที่ยังไม่มีใครกรอก สหกิจ 07 */}
                        {app.major_name_th} · สมัครตำแหน่ง <span className="font-semibold text-gray-700 dark:text-gray-300">{app.job_title || '–'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {app.resume_file && (
                        <a
                          href={`${API_BASE_URL}/files/${app.resume_file}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 transition"
                        >
                          เปิดใบสมัคร สหกิจ 03
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setAcceptingApplicant(app)}
                      >
                        ตอบรับเข้างาน
                      </Button>
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
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Season 4: During Internship */}
          {currentSeason === 'during' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold tracking-wider text-brand-blue dark:text-blue-400 uppercase">
                  ระหว่างนักศึกษาปฏิบัติงาน
                </span>
                <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
                  มีงานเอกสารที่รอท่านและพนักงานที่ปรึกษา
                </h2>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      สหกิจ 07 หน้า 1–2 · ตำแหน่งงานและพนักงานที่ปรึกษา
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      กำหนดส่งภายในสัปดาห์แรกของการปฏิบัติงาน
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="company-home-pending-form07"
                    onClick={() => onNavigate?.('form07')}
                  >
                    กรอกข้อมูล
                  </Button>
                </div>

                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      บันทึกการปฏิบัติงานและรายงาน
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      พนักงานที่ปรึกษา (พี่เลี้ยง) เป็นผู้รับรองบันทึกรายสัปดาห์และโครงร่างรายงาน
                    </div>
                  </div>
                  <span
                    data-testid="company-home-pending-logs"
                    className="text-xs text-gray-500 dark:text-gray-400"
                  >
                    รอพี่เลี้ยงรับรอง
                  </span>
                </div>

                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      แผนปฏิบัติงาน (สหกิจ 07 หน้า 3)
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      นักศึกษาลงชื่อแล้ว รอพนักงานที่ปรึกษาลงนามร่วมกัน
                    </div>
                  </div>
                  <span
                    data-testid="company-home-pending-workplan"
                    className="text-xs text-gray-500 dark:text-gray-400"
                  >
                    รอพี่เลี้ยงลงนาม
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Season 5 & 6: End / Idle */}
          {(currentSeason === 'end' || currentSeason === 'idle') && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">
                  ภาพรวมการดำเนินงาน
                </span>
                <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
                  ยังไม่มีงานเอกสารที่ต้องดำเนินการเร่งด่วนในขณะนี้
                </h2>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  ระบบจะแสดงการแจ้งเตือนเมื่อถึงช่วงเวลาสำรวจความต้องการ หรือเมื่อมีนักศึกษายื่นความจำนงเข้ามา
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer info strip of hero card */}
        <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/50 px-6 sm:px-8 py-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>ตอบจากลิงก์ในอีเมลได้โดยไม่ต้องเข้าระบบ — ลิงก์ใช้ได้ 24 ชั่วโมงและใช้ได้ครั้งเดียว</span>
          {companyProfile?.email && (
            <span className="text-brand-blue dark:text-blue-400 font-medium">
              ส่งลิงก์แบบสำรวจไปที่ {companyProfile.email}
            </span>
          )}
        </div>
      </div>

      {/* 3. สองคอลัมน์ล่าง: นักศึกษาในความดูแล + ประวัติความร่วมมือ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* คอลัมน์ซ้าย: นักศึกษาที่อยู่กับท่านตอนนี้ */}
        <div className="card bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 shadow-sm">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <span className="text-base font-bold text-gray-900 dark:text-white">
              นักศึกษาที่อยู่กับท่านตอนนี้
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {currentOfferData?.semester?.label || ''}
            </span>
          </div>

          {/* ⛔ เฉพาะใบที่ตอบรับแล้วเท่านั้น — ใบที่ยังรอท่านตัดสินใจอยู่ในกล่องด้านบน
              การเอามารวมที่นี่ทำให้หัวข้อ "อยู่กับท่านตอนนี้" พูดเกินกว่าที่ข้อมูลรับรอง */}
          {acceptedStudents.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
              {acceptedStudents.map((app) => (
                <div key={app.form_id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-gray-800 dark:text-gray-200">
                      {applicantName(app)}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 font-mono">
                      {app.student_code} · {app.major_name_th}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={app.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 flex flex-col items-center justify-center text-center gap-2">
              <svg className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              </svg>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                ยังไม่มีนักศึกษาในความดูแลของภาคนี้
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">
                ไม่มีคำขอสมัครงานเข้ามาในขณะนี้ — รายชื่อนักศึกษาที่คณะคัดเลือกแล้วจะแสดงที่นี่หลังท่านตอบแบบเสนองาน
              </p>
            </div>
          )}
        </div>

        {/* คอลัมน์ขวา: ประวัติความร่วมมือกับคณะ */}
        <div className="card bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 shadow-sm">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <span className="text-base font-bold text-gray-900 dark:text-white">
              ประวัติความร่วมมือกับคณะ
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {historyList.length} ภาคการศึกษา
            </span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {historyList.map((hist, idx) => (
              <div
                key={idx}
                data-testid="company-home-history-row"
                className="p-4 flex items-center justify-between gap-4 text-xs hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition"
              >
                <div>
                  <div className="font-bold text-gray-900 dark:text-white">
                    {hist.semester_label}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                    รับ {hist.accepted_count} คน {hist.details ? `· ${hist.details}` : ''}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  ประเมินครบ {hist.evaluated_count} คน
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. แถบอธิบายว่าทำไมไม่มีปุ่มลงประกาศ */}
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-900 flex gap-4 items-start shadow-xs">
        <svg className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <div className="space-y-1 text-xs">
          <div className="font-bold text-gray-900 dark:text-white">
            หน้านี้ไม่มีปุ่ม “ลงประกาศรับสมัครงาน” และจะไม่มี
          </div>
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed max-w-4xl">
            ตามคู่มือสหกิจศึกษา มหาวิทยาลัยเป็นฝ่ายส่งแบบเสนองาน (สหกิจ 02) ไปถามล่วงหน้าหนึ่งภาคการศึกษา สถานประกอบการไม่เคยเป็นฝ่ายเดินมาโพสต์ประกาศ — ตำแหน่งที่นักศึกษาเห็นในระบบ คือรายการที่ท่านตอบกลับมาในแบบสำรวจใบนี้ หลังเจ้าหน้าที่ตรวจแล้ว
          </p>
        </div>
      </div>

      {/* Onboarding Mentor Modal (E2E requirement) */}
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

      {/* Reject Applicant Modal (E2E requirement) */}
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
                onChange={(e) => setRejectReason(e.target.value)}
                size="sm"
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
                  placeholder="อธิบายเหตุผลที่ไม่รับนักศึกษาคนนี้เข้าปฏิบัติงาน..."
                  size="sm"
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

      {/* Decline Survey Offer Modal */}
      {isDeclineModalOpen && (
        <Modal
          onClose={() => setIsDeclineModalOpen(false)}
          size="md"
          title="ยืนยันการงดรับนักศึกษาในภาคเรียนนี้"
        >
          <ModalBody className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              สถานประกอบการของท่านจะแจ้งไปยังงานสหกิจศึกษาว่าไม่ประสงค์รับนักศึกษาใน{currentOfferData?.semester?.label || 'ภาคเรียนนี้'} (การไม่รับในภาคนี้ไม่ส่งผลต่อการส่งแบบสำรวจในภาคถัดไป)
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เหตุผล (ระบุหรือไม่ระบุก็ได้)
              </label>
              <Textarea
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="เช่น กำลังปรับโครงสร้างหน่วยงาน, ไม่มีพี่เลี้ยงพร้อมดูแลในภาคการศึกษานี้..."
                size="sm"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setIsDeclineModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isSubmittingDecline}
              onClick={handleConfirmDecline}
            >
              ยืนยันงดรับนักศึกษา
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default CompanyHome;
