import React, { useState } from 'react';
import StudentWelcomeGuide from './StudentWelcomeGuide';
import PageSkeleton from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile, IntentForm, OfficialDocument } from '../types/api';
import { type PhaseGroup } from './CoopStepperBar';
import CoopNowCard from './CoopNowCard';
import StudentStatusCard, { RequestProgress, type StatusCardState, type StatusIntent } from './StudentStatusCard';
import CoopJourneyBar from './CoopJourneyBar';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import ConfirmSummary from './ui/ConfirmSummary';
import StatusBadge from './ui/StatusBadge';
import { intentDisplayStatus } from '../utils/intentStatus';
import Button from './ui/Button';
import { Building2, CalendarDays, Pin, Upload, UserPen } from 'lucide-react';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import { Input } from './ui/Input';
import CoopCalendarModal from './CoopCalendarModal';
import { formatThaiDate, formatThaiDateTime } from '../utils/thaiDate';
import type { CoopCalendarResponse } from '../types/api';

/** ประกาศจากงานสหกิจ — ที่ปักหมุดจะขึ้นเป็นแบนเนอร์บนสุดของแดชบอร์ด */
interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
  image_url?: string | null;
}

/**
 * ใบความจำนงอยู่สถานะไหนของการ์ด "สิ่งที่ต้องทำตอนนี้" — ตัดสินจากฟิลด์เดียวกับที่เซิร์ฟเวอร์ใช้
 * (`status` · `acceptance_due_date` · `reject_reason` · `company_mail_sent_at`) ไม่คำนวณวันทำการซ้ำ
 * (อยู่ในไฟล์นี้ ไม่ใช่ `StudentStatusCard.tsx` เพราะไฟล์ที่ export คอมโพเนนต์ export ฟังก์ชันปนไม่ได้ — fast refresh)
 */
function deriveStatusState(intent: StatusIntent): StatusCardState | null {
  switch (intent.status) {
    case 'pending_advisor':
      return 'submit-paper';
    case 'pending_officer_request':
      return 'wait-staff';
    case 'approved_by_dept_head':
      // คณบดียังไม่ลงนาม = ยังไม่มีกำหนดตอบกลับ = ส่งอะไรให้บริษัทไม่ได้ (เซิร์ฟเวอร์ 409)
      if (!intent.acceptance_due_date) return 'wait-dean';
      if (intent.reject_reason) return 'returned';
      return intent.company_mail_sent_at ? 'wait-company' : 'send';
    case 'pending_officer_approval':
      // บริษัทตอบทางลิงก์ไม่ได้ระบุพี่เลี้ยง — เจ้าหน้าที่กดรับไม่ได้จนกว่านักศึกษาจะระบุ
      return intent.mentor?.name ? 'wait-confirm' : 'add-mentor';
    case 'company_rejected':
      return 'company-rejected';
    case 'rejected':
      return 'rejected';
    case 'accepted':
      // ได้ที่ฝึกงานแล้ว = จบช่วงขอที่ฝึกงาน · การ์ด "สิ่งที่ต้องทำตอนนี้" ช่วงนี้หายไป
      // เหลือ `CoopNowCard` ใบเดียวที่พาเดินต่อ (เจ้าของตัดสิน 2026-09-30: มีการ์ด "ทำอะไรตอนนี้" ได้ใบเดียวเสมอ)
      return null;
    default:
      // สถานะที่ไม่รู้จัก = ไม่แต่งเรื่องให้ · ป้ายสถานะอื่นในหน้ายังโชว์ค่าดิบอยู่
      return null;
  }
}

const StudentDashboard: React.FC = () => {
  const [data, setData] = useState<{
    student: StudentProfile & { advisor?: { email: string; name?: string }; supervisor?: { email: string; name?: string } };
    activeIntent: IntentForm | null;
    /** ใบที่ถูกปิดล่าสุดของภาคนี้ — มีเฉพาะตอน activeIntent เป็น null */
    closedIntent?: { form_id: number; status: string; company_name_th: string; reject_reason: string | null } | null;
    documents: OfficialDocument[];
    /** คณะเตือนพี่เลี้ยงของนักศึกษาคนนี้ไปกี่ครั้ง — แสดงให้รู้ว่าไม่ต้องตามเอง (ไม่มี = ไม่แสดงอะไร) */
    mentor_reminders?: { count: number; last_at: string | null };
    /** ความคืบหน้าเฟส 2–4 นับจากแถวจริง — `GET /students/dashboard` */
    progress?: {
      accommodation_submitted: boolean;
      outline_submitted: boolean;
      outline_approved: boolean;
      supervision_visits: number;
      final_report_approved: boolean;
      mentor_evaluations: number;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual Acceptance States
  const [mentorName, setMentorName] = useState('');
  const [mentorEmail, setMentorEmail] = useState('');
  const [mentorPhone, setMentorPhone] = useState('');
  const [mentorPosition, setMentorPosition] = useState('');
  const [mentorDept, setMentorDept] = useState('');
  const [startDate, setStartDate] = useState('');
  // ผู้ลงนามบนแบบตอบรับ — นักศึกษากรอกตามกระดาษ (ถูกพิมพ์ลงหนังสือส่งตัว · เจ้าหน้าที่ไม่ต้องคีย์ซ้ำ)
  const [signerName, setSignerName] = useState('');
  const [signerPosition, setSignerPosition] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [proofError, setProofError] = useState<string | null>(null);
  // ส่งแล้วแก้เองไม่ได้จนกว่าเจ้าหน้าที่ตีกลับ + ระบบส่งลิงก์เชิญถึงอีเมลพี่เลี้ยง — ตรวจก่อนส่ง
  const [confirmingProof, setConfirmingProof] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  // ระบุพี่เลี้ยงหลังบริษัทตอบรับทางลิงก์ (`POST /intents/:id/mentor`)
  const [mentorSet, setMentorSet] = useState({ name: '', email: '', phone: '', position: '', department: '' });
  const [mentorSetOpen, setMentorSetOpen] = useState(false);
  const [mentorSetBusy, setMentorSetBusy] = useState(false);
  const [mentorSetError, setMentorSetError] = useState<string | null>(null);
  const [uploadingRequestForm, setUploadingRequestForm] = useState(false);
  // ไฟล์แบบคำร้องที่เลือกแล้วแต่ยังไม่ส่ง — มีค่า = กล่องยืนยันเปิดอยู่
  const [pendingRequestForm, setPendingRequestForm] = useState<{ file: File; formId: number } | null>(null);
  const [signerAdvisor, setSignerAdvisor] = useState('');
  const [signerDeptHead, setSignerDeptHead] = useState('');
  const [requestFormError, setRequestFormError] = useState<string | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [reportingFail, setReportingFail] = useState(false);
  const [confirmingFailure, setConfirmingFailure] = useState(false);
  // ยกเลิกคำร้องเองก่อนเจ้าหน้าที่รับ (`POST /intents/:id/withdraw`) — คนละเส้นกับ "สัมภาษณ์ไม่ผ่าน" ข้างบน
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // ใบถูกลบทั้งใบ การ์ดสถานะจึงหายไป — ต้องมีข้อความบอกว่ายกเลิกสำเร็จ ไม่งั้นดูเหมือนหน้าจอรีเซ็ตเฉยๆ
  const [withdrawNotice, setWithdrawNotice] = useState<string | null>(null);
  // ส่งหนังสือให้สถานประกอบการทางอีเมล — null = ยังไม่พิมพ์เอง ใช้ค่าเริ่มต้นจากที่ระบบรู้
  const [companyMailInput, setCompanyMailInput] = useState<string | null>(null);
  const [confirmingCompanyMail, setConfirmingCompanyMail] = useState(false);
  const [sendingCompanyMail, setSendingCompanyMail] = useState(false);
  const [companyMailError, setCompanyMailError] = useState<string | null>(null);
  // ฟอร์มรายงานผลของนักศึกษา (ทางสำรอง) พับไว้หลังปุ่ม · กล่องส่งซ้ำพับไว้หลังปุ่มตอนรอบริษัทตอบ
  const [proofOpen, setProofOpen] = useState(false);
  const [mailResendOpen, setMailResendOpen] = useState(false);
  // 404 from /students/dashboard means "not onboarded yet", not "broken".
  const [needsProfile, setNeedsProfile] = useState(false);

  // guide มีไว้ให้ "ผู้ใช้ครั้งแรก" เท่านั้น ซึ่งระบบรู้เองอยู่แล้วว่าคือใคร — คนที่ยังไม่มี
  // ประวัติในฐาน (needsProfile) · กรอกประวัติเสร็จเมื่อไหร่ guide หายเอง จึงไม่ต้องจำอะไรทั้งสิ้น
  // เดิมใช้ localStorage ซึ่งผิดสองทาง: key ไม่ผูก user (เครื่องแชร์ในแล็บ คนที่สองไม่เห็นเลย)
  // และมันไปโผล่ในหน้าหลักของคนที่กรอกประวัติแล้วแต่ยังไม่ยื่นใบความจำนง ซึ่งไม่ใช่ผู้ใช้ครั้งแรก
  const [showGuide, setShowGuide] = useState(true);
  const dismissGuide = () => setShowGuide(false);

  // PR Announcements states
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  // ปฏิทินสหกิจ — คนละระบบกับประกาศประชาสัมพันธ์ด้านบน อยู่คู่กันบนหน้าเดียว
  const [calendar, setCalendar] = useState<CoopCalendarResponse | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const loadDashboardData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);

      // The two calls are independent, so they are settled independently.
      // Previously Promise.all meant a failing /students/dashboard (a student who
      // has not completed onboarding gets a 404) threw before setAnnouncements
      // ever ran — announcements silently disappeared from the whole page.
      const [dashResult, annResult, calResult] = await Promise.allSettled([
        api.get('/students/dashboard'),
        api.get('/announcements'),
        api.get('/calendar')
      ]);

      if (annResult.status === 'fulfilled') {
        setAnnouncements(annResult.value?.data || []);
      } else {
        console.error('Failed to load announcements:', annResult.reason);
      }

      if (calResult.status === 'fulfilled') {
        setCalendar(calResult.value as CoopCalendarResponse);
      } else {
        console.error('Failed to load co-op calendar:', calResult.reason);
      }

      if (dashResult.status === 'fulfilled') {
        setData(dashResult.value);
        if (!isBackground) {
          setError(null);
          setNeedsProfile(false);
        }
      } else {
        console.error('Failed to load student dashboard:', dashResult.reason);
        if (!isBackground) {
          // A 404 here is not a failure — it is every new student, on their
          // first visit, before they have filled the profile in. The server
          // says so ("Student profile not found. Please setup profile first.")
          // and this used to throw that away and tell them to try again, which
          // could never work however many times they did it.
          const notOnboarded = getErrorStatus(dashResult.reason) === 404;
          setNeedsProfile(notOnboarded);
          setError(notOnboarded ? null : 'ไม่สามารถเรียกข้อมูลแดชบอร์ดได้ กรุณาลองใหม่อีกครั้ง');
        }
      }
    } catch (err) {
      console.error('Failed to load student dashboard:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลแดชบอร์ดได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadDashboardData);

  /** อัปโหลดแบบคำร้อง (เอกสารหมายเลข 1) ที่อาจารย์ลงนามบนกระดาษแล้ว */
  const handleRequestFormUpload = async (e: React.ChangeEvent<HTMLInputElement>, formId: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ชื่อผู้ลงนาม — ระบบรู้แล้วไม่ต้องส่ง · ระบบไม่รู้ = นักศึกษาต้องกรอกก่อน (เจ้าหน้าที่ไม่ต้องคีย์อีก)
    const known = data?.activeIntent?.request_signers;
    const missing = [
      !known?.advisor_name && !signerAdvisor.trim() && 'ชื่ออาจารย์ที่ปรึกษาที่ลงนาม',
      !known?.dept_head_name && !signerDeptHead.trim() && 'ชื่อหัวหน้าสาขาวิชาที่ลงนาม',
    ].filter(Boolean);
    if (missing.length > 0) {
      setRequestFormError(`กรุณากรอก ${missing.join(' และ ')} ก่อนเลือกไฟล์`);
      e.target.value = '';
      return;
    }

    // ยังไม่ส่ง — เปิดกล่องยืนยันให้ตรวจไฟล์กับชื่อผู้ลงนามก่อน (ส่งแล้วแก้เองไม่ได้จนกว่าเจ้าหน้าที่ตีกลับ)
    setRequestFormError(null);
    setPendingRequestForm({ file, formId });
    // ให้เลือกไฟล์เดิมซ้ำได้ ถ้ายกเลิกแล้วอยากเลือกใหม่
    e.target.value = '';
  };

  const submitRequestForm = async () => {
    if (!pendingRequestForm) return;
    const { file, formId } = pendingRequestForm;
    const known = data?.activeIntent?.request_signers;

    const formData = new FormData();
    formData.append('request_form', file);
    if (!known?.advisor_name) formData.append('advisor_signer_name', signerAdvisor.trim());
    if (!known?.dept_head_name) formData.append('dept_head_signer_name', signerDeptHead.trim());

    setUploadingRequestForm(true);
    setRequestFormError(null);
    try {
      await api.post(`/intents/${formId}/request-form`, formData);
      await loadDashboardData();
    } catch (err) {
      // ⛔ ไม่ใช้ setError — `error` ของหน้านี้แทนที่ทั้งหน้า ช่องที่กรอกไว้จะหายไปกับมัน
      setRequestFormError(getErrorMessage(err, 'อัปโหลดแบบคำร้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setUploadingRequestForm(false);
      setPendingRequestForm(null);
    }
  };

  const handleProofSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIntent || !evidenceFile) return;

    if (!mentorName || !mentorEmail || !mentorPhone || !startDate) {
      setProofError('กรุณากรอกข้อมูลพี่เลี้ยงและระบุวันเริ่มงานให้ครบถ้วน');
      return;
    }
    if (!signerName.trim() || !signerPosition.trim() || !signedDate) {
      setProofError('กรุณากรอกชื่อ ตำแหน่ง และวันที่ของผู้ลงนาม ตามที่ปรากฏบนแบบตอบรับ');
      return;
    }
    setProofError(null);
    setConfirmingProof(true);
  };

  const submitProof = async () => {
    if (!activeIntent || !evidenceFile) return;

    const formData = new FormData();
    formData.append('name', mentorName);
    formData.append('email', mentorEmail);
    formData.append('phone', mentorPhone);
    formData.append('position', mentorPosition);
    formData.append('department', mentorDept);
    formData.append('start_date', startDate);
    formData.append('signer_name', signerName.trim());
    formData.append('signer_position', signerPosition.trim());
    formData.append('signed_date', signedDate);
    formData.append('evidence', evidenceFile);

    setSubmittingProof(true);
    setProofError(null);

    try {
      await api.post(`/acceptances/student/${activeIntent.form_id}/upload-proof`, formData);
      setConfirmingProof(false);
      setProofOpen(false);
      // Reset states
      setMentorName('');
      setMentorEmail('');
      setMentorPhone('');
      setMentorPosition('');
      setMentorDept('');
      setStartDate('');
      setSignerName('');
      setSignerPosition('');
      setSignedDate('');
      setEvidenceFile(null);
      await loadDashboardData();
    } catch (err) {
      // ⛔ ไม่ใช้ setError — `error` ของหน้านี้แทนที่ทั้งหน้า ข้อมูลที่กรอกไว้จะหายไปกับมัน
      setConfirmingProof(false);
      setProofError(getErrorMessage(err, 'การอัปโหลดหลักฐานการตอบรับล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSubmittingProof(false);
    }
  };

  const submitCompanyMail = async (formId: number, companyEmail: string) => {
    setSendingCompanyMail(true);
    setCompanyMailError(null);
    try {
      const res = await api.post(`/intents/${formId}/send-to-company`, { company_email: companyEmail });
      setConfirmingCompanyMail(false);
      setMailResendOpen(false);
      // ใช้ค่าจาก 200 ที่ตอบกลับโดยตรง — ไม่พึ่ง poll รอบถัดไปเพื่อให้ "ส่งถึง …" ขึ้นทันที
      setData((prev) =>
        prev && prev.activeIntent
          ? {
              ...prev,
              activeIntent: {
                ...prev.activeIntent,
                company_mail_to: res.company_mail_to,
                company_mail_sent_at: res.company_mail_sent_at,
                company_mail_count: res.company_mail_count,
                company_mail_limit: res.company_mail_limit,
                // backend ล้าง reject_reason เมื่อส่งสำเร็จ — ล้างตามให้การ์ดออกจาก "ตีกลับ" ทันที ไม่ต้องรอ poll
                reject_reason: null,
              },
            }
          : prev,
      );
      setCompanyMailInput(null);
    } catch (err) {
      // ⛔ ไม่ใช้ setError — แทนที่ทั้งหน้า · error อยู่ในกล่องส่งเอง (400/409/429/502 เซิร์ฟเวอร์ให้ข้อความไทย)
      setConfirmingCompanyMail(false);
      setCompanyMailError(getErrorMessage(err, 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      setTimeout(() => {
        document.querySelector('[data-testid="company-mail-error"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    } finally {
      setSendingCompanyMail(false);
    }
  };

  const handleReportFailure = async () => {
    if (!activeIntent) return;
    setReportingFail(true);
    setError(null);

    try {
      await api.post(`/acceptances/student/${activeIntent.form_id}/fail`);
      setConfirmingFailure(false);
      await loadDashboardData();
    } catch (err) {
      setError(getErrorMessage(err, 'การรายงานผลสัมภาษณ์ล้มเหลวล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setReportingFail(false);
    }
  };

  const handleWithdraw = async () => {
    if (!activeIntent) return;
    setWithdrawing(true);
    setWithdrawError(null);

    try {
      const company = activeIntent.company_name_th;
      await api.post(`/intents/${activeIntent.form_id}/withdraw`);
      setConfirmingWithdraw(false);
      await loadDashboardData();
      setWithdrawNotice(
        `ยกเลิกคำร้องถึง ${company} แล้ว — ยื่นคำร้องใหม่ได้ที่เมนู "ยื่นคำร้องขอหนังสือ"`
      );
    } catch (err) {
      // error อยู่ในกล่องยืนยัน ไม่ใช่แถบหลังกล่อง
      setWithdrawError(getErrorMessage(err, 'ยกเลิกคำร้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='cards' />
    );
  }

  // Announcements are independent of the student's own dashboard data, so they
  // stay visible even when that request failed — a student who has not finished
  // onboarding still needs to read the co-op office's notices.
  const announcementBanner = announcements.length > 0 && (
    <div className="space-y-3">
      {announcements.filter((a) => a.is_pinned).map((pinned) => (
        <div key={pinned.announcement_id} className="p-5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 text-white shadow-md flex justify-between items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 text-xs font-bold bg-white/20 rounded-full inline-flex items-center gap-1"><Pin className="h-3 w-3" /> ประกาศด่วนปักหมุด</span>
              <span className="text-xs text-blue-100">{new Date(pinned.created_at).toLocaleDateString('th-TH')}</span>
            </div>
            <h3 className="font-bold text-base line-clamp-1">{pinned.title}</h3>
            <p className="text-xs text-blue-100 line-clamp-2">{pinned.content}</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedAnnouncement(pinned)}
            className="px-4 py-2 bg-white text-blue-700 hover:bg-blue-50 font-bold text-xs rounded-xl shadow-sm transition-all shrink-0"
          >
            อ่านรายละเอียด
          </button>
        </div>
      ))}
    </div>
  );

  /**
   * แถบปฏิทิน — บอกว่า "ตอนนี้อยู่ช่วงอะไร" หรือ "ช่วงถัดไปคือเมื่อไหร่"
   *
   * จงใจ **ไม่ใช้ gradient** เหมือนแถบประกาศด้านบน สองแถบไล่สีเต็มความกว้าง
   * ซ้อนกันจะแย่งสายตากันเอง และประกาศด่วนของเจ้าหน้าที่ต้องเด่นกว่าเสมอ
   *
   * ยังไม่มีอะไรถูกตั้งเลย = คืน null ไม่ขึ้นแถบ — fail-open ต้องเงียบ
   * ไม่ใช่ขึ้นแถบบอกว่า "ไม่มีข้อมูล" ซึ่งเป็นเสียงรบกวนล้วนๆ
   */
  const calendarBanner = (() => {
    if (!calendar) return null;

    // ยุบสองแหล่ง (กิจกรรมตายตัว + รายการอิสระ) ให้เป็นรูปเดียวก่อน
    // แถบนี้ไม่สนว่าอันไหนล็อกอะไร สนแค่ชื่อกับวัน
    // แถบนี้พูดถึงแค่ของที่มีวันจริง — แถวชนิดข้อความ ("ภายใน 3 วันทำการ" ·
    // "ให้เป็นไปตามสาขาวิชากำหนด") ไม่มีวันให้บอกว่ากำลังอยู่ในช่วงหรือยัง
    // จึงถูกกรองออกด้วย end_date และไปโผล่ในกล่องปฏิทินเต็มแทน
    const items: { name: string; start_date: string | null; end_date: string; status: string }[] = [
      ...calendar.activities
        .filter((a) => a.end_date)
        .map((a) => ({
          name: a.label,
          start_date: a.start_date,
          end_date: a.end_date as string,
          status: a.status as string,
        })),
      ...calendar.custom_events
        .filter((c) => c.end_date)
        .map((c) => ({
          name: c.title,
          start_date: c.start_date,
          end_date: c.end_date as string,
          status: c.status as string,
        })),
    ];

    if (items.length === 0) return null;

    const openNow = items.filter((i) => i.status === 'open');
    // upcoming เกิดได้เฉพาะเมื่อมีวันเริ่ม (ดู calendarStatus) — กรองซ้ำเพื่อให้ TS แคบชนิดให้
    const upcoming = items
      .filter((i): i is (typeof items)[number] & { start_date: string } =>
        Boolean(i.status === 'upcoming' && i.start_date)
      )
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-950/30">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
            ปฏิทินสหกิจศึกษา
          </p>
          {openNow.length > 0 ? (
            openNow.map((item) => (
              <p key={item.name} className="text-sm text-emerald-800 dark:text-emerald-300">
                ตอนนี้อยู่ในช่วง: <span className="font-semibold">{item.name}</span> (ถึง{' '}
                {formatThaiDate(item.end_date)})
              </p>
            ))
          ) : upcoming.length > 0 ? (
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              ช่วงถัดไป: <span className="font-semibold">{upcoming[0].name}</span> เริ่ม{' '}
              {formatThaiDate(upcoming[0].start_date)}
            </p>
          ) : (
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              กำหนดการของภาคการศึกษานี้ผ่านไปหมดแล้ว
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          aria-label="ดูปฏิทินสหกิจศึกษาทั้งหมด"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-gray-800"
        >
          <CalendarDays className="h-4 w-4" />
          ดูปฏิทินทั้งหมด
        </button>
      </div>
    );
  })();

  const calendarModal = calendarOpen && calendar && (
    <CoopCalendarModal data={calendar} onClose={() => setCalendarOpen(false)} />
  );

  const announcementModal = selectedAnnouncement && (
    <Modal
      onClose={() => setSelectedAnnouncement(null)}
      size="lg"
      title={selectedAnnouncement.title}
    >
      <ModalBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {selectedAnnouncement.is_pinned && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded-full">
              <Pin className="h-3 w-3" />
              ประกาศด่วน
            </span>
          )}
          <span className="text-xs text-gray-600 dark:text-gray-400">
            ประกาศเมื่อ: {new Date(selectedAnnouncement.created_at).toLocaleString('th-TH')}
          </span>
        </div>

        {selectedAnnouncement.image_url && (
          <img
            src={selectedAnnouncement.image_url}
            alt={selectedAnnouncement.title}
            className="w-full h-48 object-cover rounded-xl border border-gray-100 dark:border-gray-800"
          />
        )}

        <div className="text-sm text-gray-700 dark:text-gray-300 max-h-60 overflow-y-auto whitespace-pre-line leading-relaxed p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
          {selectedAnnouncement.content}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button size="sm" onClick={() => setSelectedAnnouncement(null)}>
          ปิดหน้าต่าง
        </Button>
      </ModalFooter>
    </Modal>
  );

  if (error || !data) {
    return (
      <div className="space-y-6">
        {announcementBanner}
        {calendarBanner}
        <AlertBanner variant="error" message={error} />

        {/* guide ครอบคลุมกว่าการ์ดนี้ (บอกครบ 3 ขั้น + มีปุ่มไปหน้าประวัติอยู่แล้ว) จึงแสดง
            อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่ — เดิมขึ้น "ยินดีต้อนรับสู่ระบบสหกิจศึกษา" ซ้อนกันสองบล็อก
            พร้อมปุ่มไปหน้าเดียวกันสองปุ่ม · ternary ไม่ใช่ && เพราะกด "ซ่อนคำแนะนำนี้" แล้ว
            ต้องยังเหลืออะไรบอกว่าให้ไปกรอกประวัติ */}
        {needsProfile && (
          showGuide ? (
            <StudentWelcomeGuide onDismiss={dismissGuide} />
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400">
                <UserPen className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                ยินดีต้อนรับสู่ระบบสหกิจศึกษา
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
                ยังไม่มีข้อมูลประวัติของคุณในระบบ กรุณากรอกประวัตินักศึกษาให้ครบถ้วนก่อน
                จึงจะเริ่มยื่นใบความจำนงและติดตามสถานะสหกิจศึกษาได้
              </p>
              <Button
                className="mt-6"
                onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'profile' }))}
              >
                กรอกประวัตินักศึกษา
              </Button>
            </div>
          )
        )}

        {selectedAnnouncement && announcementModal}
        {calendarModal}
      </div>
    );
  }

  const activeIntent = data.activeIntent;
  const documents = data.documents || [];

  // ป้าย "สถานะการพิจารณา" ต้องอ่านจากหนังสือเมื่อออกหนังสือแล้ว — ตรรกะอยู่ที่
  // `utils/intentStatus.ts` ที่เดียว เพราะหน้าที่ปรึกษาและหัวหน้าสาขาก็ใช้ตัวเดียวกัน
  const coverLetter = documents.find(d => d.type === 'cover_letter');

  /**
   * ขั้นของเฟส 1 — **ต้องตรงกับเส้นทางเอกสารหมายเลข 1 ทีละขั้นจริงๆ**
   *
   * ⛔ ของเดิมยุบทุกอย่างเหลือสามขั้นแล้วผิดสองทาง:
   *   1. **ไม่มีขั้นคณบดีลงนามเลย** ทั้งที่เป็นขั้นสุดท้ายของการออกหนังสือ
   *   2. `step1_3Done` (= สถานประกอบการตอบรับ) ติ๊กเสร็จทันทีที่ **มีแถวหนังสือ**
   *      → นักศึกษาที่เจ้าหน้าที่เพิ่งกดรับคำร้อง เห็นว่า "บริษัทตอบรับแล้ว ✓" และ
   *      ไทม์ไลน์กระโดดไปเฟส 2 ทั้งที่ยังไม่มีบริษัทไหนตอบอะไร (เจอตอนเดินจริง 2026-08-27)
   *
   * `officer-reject` ล้าง `request_form_path` แล้วดันสถานะกลับ `pending_advisor`
   * ขั้น 1.2 จึงย้อนกลับมาเป็น active เองอย่างถูกต้อง
   */
  const OFFICER_RECEIVED = ['approved_by_dept_head', 'pending_officer_approval', 'accepted'];
  const intentStatus = activeIntent?.status ?? '';

  const step1_1Done = !!activeIntent;
  const step1_2Done = !!activeIntent?.request_form_path || OFFICER_RECEIVED.includes(intentStatus);
  const step1_3Done = OFFICER_RECEIVED.includes(intentStatus);
  const step1_4Done = coverLetter?.status === 'signed';

  /**
   * กำหนดตอบกลับของแบบตอบรับ (เอกสารหมายเลข 2)
   *
   * วันครบกำหนดคิดที่เซิร์ฟเวอร์ตอนคณบดีลงนาม (๑๕ วันทำการ) ฝั่งนี้แค่เอามาแสดงและ
   * นับถอยหลังเป็นวันปฏิทิน — **ไม่คำนวณวันทำการซ้ำ** เพราะจะกลายเป็นแหล่งความจริงที่สอง
   * ที่วันหนึ่งจะไม่ตรงกับเซิร์ฟเวอร์ · ตัวตัดสินว่า "ส่งช้าไหม" อยู่ที่เซิร์ฟเวอร์เสมอ
   */
  const acceptanceDue = (() => {
    // ⛔ ห้ามทำเป็น hook — โค้ดตรงนี้อยู่ **หลัง** early return (`if (loading)` และ
    //    `if (error || !data)`) การใส่ useMemo จะทำให้จำนวน hook ต่างกันระหว่าง render
    //    แล้ว React พังด้วย "Rendered more hooks than during the previous render"
    const due = activeIntent?.acceptance_due_date;
    if (!due) return null;
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const [y, m, d] = due.slice(0, 10).split('-').map(Number);
    const daysLeft = Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86400000);
    return { due: due.slice(0, 10), daysLeft, overdue: daysLeft < 0 };
  })();
  const step1_5Done = intentStatus === 'accepted';

  // ส่งหนังสือให้สถานประกอบการทางอีเมล — ค่าทั้งหมดมาจาก `GET /students/dashboard` และ 200 ของ send-to-company
  const companyMailCount = activeIntent?.company_mail_count ?? 0;
  const companyMailLimit = activeIntent?.company_mail_limit ?? 3;
  const companyMailLeft = Math.max(0, companyMailLimit - companyMailCount);
  const companyMailAddress = (companyMailInput ?? activeIntent?.company_mail_to ?? activeIntent?.company_email ?? '').trim();

  // ⛔ เฟส 2–4 อ่านจาก `progress` ที่ backend นับจากแถวจริงของแต่ละขั้น — ห้ามเดาจากสถานะใบความจำนง
  //    เดิม 2.x ติ๊กเสร็จทันทีที่บริษัทตอบรับ (ยังไม่ได้กรอกอะไรเลย) และ 3.x/4.x เป็น `&& false` ตลอดกาล
  //    · แต่ละขั้นเสร็จตามข้อมูลของตัวเอง ไม่ต่อโซ่กัน — ของจริงไม่เรียงเสมอ (นิเทศได้ก่อนโครงร่างผ่าน)
  const progress = data.progress;
  const SUPERVISION_VISITS = 2; // คู่มือกำหนดนิเทศ 2 ครั้ง (`supervision_records.visit_number` 1 | 2)
  const supervisionVisits = progress?.supervision_visits ?? 0;

  const step2_1Done = step1_5Done && !!progress?.accommodation_submitted;

  const step3_1Done = step1_5Done && !!progress?.outline_submitted;
  const step3_2Done = step1_5Done && !!progress?.outline_approved;
  const step3_3Done = step1_5Done && supervisionVisits >= SUPERVISION_VISITS;

  const step4_1Done = step1_5Done && !!progress?.final_report_approved;
  const step4_2Done = step1_5Done && (progress?.mentor_evaluations ?? 0) >= 2;
  // ระบบไม่เก็บเกรด (เจ้าของตัดสิน 2026-09-21) — ขั้นสุดท้ายบอกแค่ว่าผลประเมินครบแล้ว
  const step4_3Done = step4_2Done;

  let activePhaseId = 1;
  // เฟส 2 คือ "เตรียมเอกสารก่อนเริ่มฝึก" — เข้าได้ต่อเมื่อ **สถานประกอบการตอบรับแล้ว**
  // ไม่ใช่แค่ออกหนังสือเสร็จ (ของเดิมใช้ step1_3Done ที่ติ๊กตั้งแต่มีแถวหนังสือ)
  // ⛔ นักศึกษากรอกจริงแค่ สหกิจ 06 (สหกิจ 03 พิมพ์จากเมนูใบสมัครงานสหกิจ) — แผนปฏิบัติงาน สหกิจ 07 หน้า 3
  //    ไม่ใช่ภาระนักศึกษาและห้ามเป็นเงื่อนไขบล็อกความคืบหน้า (เจ้าของสั่ง 2026-10-05)
  if (step1_5Done) activePhaseId = 2;
  if (step2_1Done) activePhaseId = 3;
  if (step3_3Done || step4_1Done) activePhaseId = 4;

  const phases: PhaseGroup[] = [
    {
      phaseId: 1,
      title: '1. ก่อนปฏิบัติงาน',
      subtitle: 'ยื่นคำร้อง → ออกหนังสือ → บริษัทตอบรับ',
      status: step1_5Done ? 'completed' : activePhaseId === 1 ? 'active' : 'pending',
      subSteps: [
        {
          id: '1.1',
          title: '1.1 ยื่นคำร้องขอหนังสือ (เอกสารหมายเลข 1)',
          description: 'กรอกสถานประกอบการที่จะขอหนังสือขอความอนุเคราะห์ถึง',
          status: step1_1Done ? 'completed' : 'active',
          actionLabel: !step1_1Done ? 'ไปยื่นคำร้อง' : undefined,
          onAction: () => {
            window.dispatchEvent(new CustomEvent('navigate', { detail: 'jobs' }));
          }
        },
        {
          id: '1.2',
          // ⛔ ขั้นนี้เกิดบน **กระดาษ** ไม่ใช่ในระบบ — ที่ปรึกษาและหัวหน้าสาขาลงนาม
          //    บนแบบคำร้อง (เอกสารหมายเลข 1) แล้วนักศึกษาอัปโหลดกลับให้เจ้าหน้าที่
          //    ข้อความเดิมทำให้นักศึกษานั่งรอให้อาจารย์กดปุ่มที่ไม่มีอยู่จริง
          title: '1.2 ลงนามบนแบบคำร้อง & อัปโหลดกลับ',
          description: 'พิมพ์แบบคำร้อง (เอกสารหมายเลข 1) ที่ระบบกรอกให้แล้ว ไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนาม แล้วสแกนอัปโหลดกลับเข้าระบบ',
          status: step1_2Done ? 'completed' : step1_1Done ? 'active' : 'pending'
        },
        {
          id: '1.3',
          title: '1.3 เจ้าหน้าที่รับคำร้อง & ออกเลขที่หนังสือ',
          description: 'เจ้าหน้าที่ตรวจลายเซ็นบนกระดาษ แล้วออกเลขที่หนังสือออก',
          status: step1_3Done ? 'completed' : step1_2Done ? 'active' : 'pending'
        },
        {
          id: '1.4',
          title: '1.4 คณบดีลงนามหนังสือขอความอนุเคราะห์',
          description: 'ลงนามแล้วส่งหนังสือให้สถานประกอบการทางอีเมลจากระบบ หรือดาวน์โหลดไปยื่นด้วยตนเอง',
          status: step1_4Done ? 'completed' : step1_3Done ? 'active' : 'pending'
        },
        {
          id: '1.5',
          title: '1.5 สถานประกอบการตอบรับเข้าทำงาน',
          description: 'เมื่อบริษัทตอบรับ ให้กรอกข้อมูลพี่เลี้ยงและอัปโหลดหลักฐานการตอบรับ',
          status: step1_5Done ? 'completed' : step1_4Done ? 'active' : 'pending'
        }
      ]
    },
    {
      phaseId: 2,
      title: '2. เตรียมเอกสารก่อนเริ่มฝึก',
      subtitle: 'ใบสมัครงานสหกิจ (สหกิจ 03) & แจ้งที่พัก (สหกิจ 06)',
      status: step2_1Done ? 'completed' : activePhaseId === 2 ? 'active' : 'pending',
      subSteps: [
        {
          id: '2.1',
          title: '2.1 แบบแจ้งรายละเอียดที่พัก (สหกิจ 06)',
          description:
            'กรอกที่พักระหว่างฝึก ปักหมุดแผนที่ และตรวจผู้ติดต่อฉุกเฉิน · คณะใช้ข้อมูลนี้ออกหนังสือส่งตัวและจัดอาจารย์นิเทศ · ใบสมัครงานสหกิจ (สหกิจ 03) ตรวจทานและพิมพ์ได้จากเมนู "ใบสมัครงานสหกิจ"',
          status: step2_1Done ? 'completed' : activePhaseId === 2 ? 'active' : 'pending',
          actionLabel: activePhaseId === 2 && !step2_1Done ? 'กรอกรายละเอียดที่พัก' : undefined,
          onAction: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'accommodation_plan' }))
        }
      ]
    },
    {
      phaseId: 3,
      title: '3. ระหว่างทำงาน & นิเทศ',
      subtitle: 'โครงร่างรายงาน & นิเทศงาน',
      status: (step3_1Done && step3_2Done && step3_3Done) ? 'completed' : activePhaseId === 3 ? 'active' : 'pending',
      subSteps: [
        {
          id: '3.1',
          title: '3.1 ส่งโครงร่างรายงาน (สหกิจ 11)',
          description: 'เสนอหัวข้อรายงานการปฏิบัติงานภายใน 3 สัปดาห์แรก',
          status: step3_1Done ? 'completed' : activePhaseId === 3 ? 'active' : 'pending'
        },
        {
          id: '3.2',
          title: '3.2 อาจารย์อนุมัติโครงร่างรายงาน',
          description: 'อาจารย์ที่ปรึกษาพิจารณาและกดอนุมัติหัวข้อรายงาน',
          status: step3_2Done ? 'completed' : step3_1Done ? 'active' : 'pending'
        },
        {
          id: '3.3',
          // ⛔ ไม่ใช่ "สหกิจ 13" — ใบนั้นอาจารย์นิเทศประเมิน *สถานประกอบการ* ไม่ใช่ใบของนักศึกษา
          title: '3.3 การนิเทศงาน (ครั้งที่ 1 และ 2)',
          description: `อาจารย์นิเทศเข้าตรวจเยี่ยมพื้นที่/ออนไลน์ · นิเทศแล้ว ${supervisionVisits} จาก ${SUPERVISION_VISITS} ครั้ง`,
          status: step3_3Done ? 'completed' : step3_2Done ? 'active' : 'pending'
        }
      ]
    },
    {
      phaseId: 4,
      title: '4. สิ้นสุด & ประเมินผล',
      subtitle: 'ส่งรายงานเล่มสมบูรณ์ & ผลประเมิน',
      status: step4_3Done ? 'completed' : activePhaseId === 4 ? 'active' : 'pending',
      subSteps: [
        {
          id: '4.1',
          title: '4.1 รายงานฉบับสมบูรณ์ (สหกิจ 14)',
          description: 'อัปโหลดรูปเล่มรายงานปฏิบัติงานสมบูรณ์ก่อนจบ 2 สัปดาห์',
          status: step4_1Done ? 'completed' : activePhaseId === 4 ? 'active' : 'pending'
        },
        {
          id: '4.2',
          title: '4.2 พี่เลี้ยงประเมินผล (สหกิจ 15/16)',
          description: 'พี่เลี้ยงสถานประกอบการทำแบบประเมินผลการทำงานและรูปเล่ม',
          status: step4_2Done ? 'completed' : step4_1Done ? 'active' : 'pending'
        },
        {
          id: '4.3',
          title: '4.3 ผลประเมินครบแล้ว',
          description: 'ได้รับผลประเมินจากพนักงานที่ปรึกษาครบทั้งสหกิจ 15 และ 16',
          status: step4_3Done ? 'completed' : step4_2Done ? 'active' : 'pending'
        }
      ]
    }
  ];

  // ===== การ์ด "สิ่งที่ต้องทำตอนนี้" (แบบ A) =====
  // ตัวเลือกสถานะอยู่ที่ `deriveStatusState` ที่เดียว · ก้อนฟอร์ม/กล่องส่งอีเมลข้างล่างยังเป็นของหน้านี้
  // (state กับ handler อยู่ที่นี่) แล้วส่งเข้าการ์ดเป็น slot — ย้ายที่แสดง ไม่ได้เปลี่ยนพฤติกรรม
  // ไม่มี activeIntent แต่มีใบที่ถูกปิดในภาคนี้ (ตีกลับ / บริษัทไม่รับ) = การ์ดบอกเหตุผลแล้วชวนหาที่ใหม่
  // (`closedIntent` มาจาก backend แยกจาก activeIntent — โค้ดอื่นยังอ่าน activeIntent === null ว่ายื่นใหม่ได้)
  const statusIntent = (activeIntent ?? data.closedIntent ?? null) as StatusIntent | null;
  const statusState = statusIntent ? deriveStatusState(statusIntent) : null;
  // พี่เลี้ยงที่ `GET /students/dashboard` แนบมากับใบ (IntentForm ยังไม่ได้ประกาศฟิลด์นี้)
  const intentMentor = (activeIntent as StatusIntent | null)?.mentor;

  // นับถอยหลังกำหนดตอบกลับ
  // ⚠️ วันครบกำหนดคำนวณโดยข้ามเฉพาะเสาร์-อาทิตย์ ระบบไม่มีตารางวันหยุด
  // นักขัตฤกษ์ จึงเรียกว่า "โดยประมาณ" ไม่ใช่เส้นตาย — และเลยกำหนดแล้ว
  // ก็ยังอัปโหลดได้ เซิร์ฟเวอร์แค่ติดธงว่าส่งช้า ไม่ได้ปิดประตู
  const dueNote = acceptanceDue ? (
    <p
      data-testid="acceptance-due"
      className={`text-sm font-semibold ${
        acceptanceDue.overdue
          ? 'text-red-700 dark:text-red-400'
          : acceptanceDue.daysLeft <= 3
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      {acceptanceDue.overdue
        ? `เลยกำหนดตอบกลับมาแล้ว ${-acceptanceDue.daysLeft} วัน (ครบกำหนด ${formatThaiDate(acceptanceDue.due)}) — ยังส่งได้ แต่ระบบจะบันทึกว่าส่งช้า และควรยื่นบันทึกข้อความชี้แจง`
        : `ครบกำหนดตอบกลับโดยประมาณวันที่ ${formatThaiDate(acceptanceDue.due)} — เหลืออีก ${acceptanceDue.daysLeft} วัน`}
    </p>
  ) : null;

  // เอกสารหมายเลข 1 — พิมพ์ได้ทันทีที่ยื่นคำร้อง และอัปโหลดไฟล์ที่ลงนามแล้ว
  // การ์ดเรียกเฉพาะสถานะรอลงนาม (pending_advisor) และรอเจ้าหน้าที่ตรวจ (pending_officer_request)
  const renderRequestForm = (intent: IntentForm) => (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  <span className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1)
                  </span>

                  {/* ponytail: ซ่อนปุ่มสั่งพิมพ์และคำแนะนำเมื่อส่งแบบคำร้องแล้ว */}
                  {!intent.request_form_path && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-600 mb-2 leading-relaxed dark:text-gray-400">
                        ระบบกรอกข้อมูลให้ครบแล้ว — ตรวจให้ถูกต้อง พิมพ์ออกมาลงชื่อ
                        แล้วนำไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาลงนาม
                      </p>
                      <a
                        href={`${API_BASE_URL}/intents/${intent.form_id}/request-form`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="print-request-form"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-blue px-3 py-2 text-xs font-bold text-brand-blue transition-all hover:bg-blue-50/10 dark:border-blue-800 dark:text-blue-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        เปิดแบบคำร้องเพื่อสั่งพิมพ์
                      </a>
                    </div>
                  )}

                  {/* ขั้นถัดไป: อัปโหลดกระดาษที่ลงนามแล้ว */}
                  <div>
                    {intent.request_form_path ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span data-testid="request-form-uploaded">
                          ส่งแบบคำร้องที่ลงนามแล้ว · รอเจ้าหน้าที่ตรวจสอบ
                        </span>
                        <a
                          href={`${API_BASE_URL}/files/${intent.request_form_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-brand-blue underline dark:text-blue-400"
                        >
                          เปิดไฟล์ที่ส่งไป
                        </a>
                      </div>
                    ) : (
                      <>
                      {/* ผู้ลงนามสองช่องบนกระดาษ — ระบบดึงชื่อที่รู้ให้ ที่ยังไม่รู้ให้นักศึกษากรอก */}
                      <AlertBanner variant="error" message={requestFormError} />
                      <div className="mb-3 space-y-2" data-testid="request-signers">
                        {(!intent.request_signers?.advisor_name || !intent.request_signers?.dept_head_name) && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            ระบบยังไม่มีชื่อผู้ลงนามบางคน — พิมพ์ชื่อตามที่ลงนามบนกระดาษ
                          </p>
                        )}
                        {intent.request_signers?.advisor_name ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            อาจารย์ที่ปรึกษา: <span className="font-bold text-gray-800 dark:text-gray-200">{intent.request_signers.advisor_name}</span>
                          </p>
                        ) : (
                          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                            ชื่ออาจารย์ที่ปรึกษาที่ลงนาม
                            <Input
                              data-testid="signer-advisor"
                              value={signerAdvisor}
                              onChange={(e) => setSignerAdvisor(e.target.value)}
                              placeholder="เช่น ผศ.ดร.สมชาย ใจดี"
                              className="mt-1 font-normal"
                            />
                          </label>
                        )}
                        {intent.request_signers?.dept_head_name ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            หัวหน้าสาขาวิชา: <span className="font-bold text-gray-800 dark:text-gray-200">{intent.request_signers.dept_head_name}</span>
                          </p>
                        ) : (
                          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                            ชื่อหัวหน้าสาขาวิชาที่ลงนาม
                            <Input
                              data-testid="signer-dept-head"
                              value={signerDeptHead}
                              onChange={(e) => setSignerDeptHead(e.target.value)}
                              placeholder="เช่น ดร.สมหญิง รักเรียน"
                              className="mt-1 font-normal"
                            />
                          </label>
                        )}
                      </div>
                      <label className={`block ${uploadingRequestForm ? '' : 'cursor-pointer'}`}>
                        {/* ⛔ ปุ่มของ input type=file เป็นข้อความของเบราว์เซอร์
                            ("Choose File / No file chosen") จัดธีมได้แต่ **แปลไม่ได้** —
                            บนหน้าจอที่เป็นภาษาไทยทั้งหน้ามันโดดออกมาชัดมาก
                            จึงซ่อน input ไว้แล้วให้ label เป็นปุ่มจริงแทน
                            · ยังเป็น input ตัวเดิมที่มี data-testid เดิม — setInputFiles
                            ของ Playwright ทำงานกับ input ที่ซ่อนอยู่ได้ตามปกติ */}
                        <span className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                          ลงนามครบทั้งสองช่องแล้ว อัปโหลดไฟล์ที่สแกนหรือถ่ายรูปกลับเข้าระบบ
                          (PDF หรือรูปภาพ ไม่เกิน 10 MB)
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          disabled={uploadingRequestForm}
                          data-testid="upload-request-form"
                          onChange={(e) => handleRequestFormUpload(e, intent.form_id)}
                          className="sr-only"
                        />
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                            uploadingRequestForm
                              ? 'border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
                              : 'border-brand-blue bg-brand-blue text-white hover:bg-brand-navy'
                          }`}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          เลือกไฟล์แบบคำร้องที่ลงนามแล้ว
                        </span>
                      </label>
                      </>
                    )}
                    {uploadingRequestForm && (
                      <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
                        กำลังอัปโหลด...
                      </span>
                    )}
                  </div>

                  {/* เจ้าหน้าที่ตีกลับ — เหตุผลอยู่บนแถว ไม่ใช่แค่ audit_log (SEC-07)
                      เพราะคนที่ต้องอ่านคือนักศึกษา */}
                  {intent.status === 'pending_advisor' && intent.reject_reason && (
                    <div className="mt-3">
                      <AlertBanner
                        variant="warning"
                        message={
                          <>
                            <strong>เจ้าหน้าที่ตีกลับแบบคำร้อง</strong> — {intent.reject_reason}
                            <br />
                            แก้ไขตามที่แจ้งแล้วอัปโหลดใหม่ได้เลย · ถ้าข้อมูลสถานประกอบการผิด ให้ยกเลิกคำร้องนี้แล้วยื่นใหม่
                          </>
                        }
                      />
                    </div>
                  )}

                  {/* ยกเลิกได้จนกว่าเจ้าหน้าที่จะรับ — ทางเดียวที่เปลี่ยนสถานประกอบการ/แก้ข้อมูลบริษัทของใบที่ยื่นไปแล้ว */}
                  <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                    เลือกสถานประกอบการผิด หรืออาจารย์ไม่อนุญาต?{' '}
                    <button
                      type="button"
                      data-testid="withdraw-open"
                      onClick={() => {
                        setWithdrawError(null);
                        setConfirmingWithdraw(true);
                      }}
                      className="font-bold text-red-700 underline dark:text-red-400"
                    >
                      ยกเลิกคำร้องนี้
                    </button>
                  </p>
                </div>
  );

  // ส่งหนังสือให้สถานประกอบการทางอีเมล — การ์ดเรียกเฉพาะเมื่อคณบดีลงนามแล้ว (`acceptance_due_date` ไม่ว่าง)
  // สถานะอื่นเซิร์ฟเวอร์ตอบ 409 อยู่แล้ว จึงไม่แสดงกล่องให้กดแล้วเจอ error
  // · send/returned = เปิดกล่องเต็ม · wait = พับ เหลือแค่สถานะ "ส่งถึง …" กับปุ่มส่งซ้ำ
  const renderMailBox = (intent: IntentForm, mode: 'send' | 'returned' | 'wait') => {
    const collapsed = mode === 'wait' && !mailResendOpen;
    const sendLabel = mode === 'returned' ? 'ส่งลิงก์ให้บริษัทอีกครั้ง' : mode === 'wait' ? 'ส่งอีเมลอีกครั้ง' : 'ส่งหนังสือทางอีเมล';
    return (
      <div
        data-testid="company-mail-box"
        className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <span className="block font-bold text-gray-800 dark:text-gray-200">ส่งหนังสือให้สถานประกอบการ</span>
        {!collapsed && (
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            ระบบจะส่งอีเมลถึงสถานประกอบการพร้อมแนบ 2 ไฟล์ คือ หนังสือขอความอนุเคราะห์ที่คณบดีลงนามแล้ว
            และแบบตอบรับ (เอกสารหมายเลข 2) พร้อมลิงก์ให้บริษัทตอบรับออนไลน์ ·
            สถานประกอบการตอบกลับมาที่อีเมลมหาวิทยาลัยของท่านโดยตรง
          </p>
        )}

        {!collapsed && (
          <>
            <label htmlFor="company-mail-input" className="mt-3 block text-xs font-semibold text-gray-700 dark:text-gray-300">
              อีเมลฝ่ายบุคคลของบริษัท
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                id="company-mail-input"
                type="email"
                size="sm"
                data-testid="company-mail-input"
                value={companyMailInput ?? intent.company_mail_to ?? intent.company_email ?? ''}
                onChange={(e) => setCompanyMailInput(e.target.value)}
                placeholder="hr@company.com"
                disabled={companyMailLeft === 0 || sendingCompanyMail}
              />
              <Button
                size="sm"
                data-testid="company-mail-send"
                disabled={companyMailLeft === 0 || !companyMailAddress}
                onClick={() => {
                  setCompanyMailError(null);
                  setConfirmingCompanyMail(true);
                }}
                className="shrink-0"
              >
                {sendLabel}
              </Button>
            </div>
          </>
        )}

        {companyMailLeft === 0 && (
          <p data-testid="company-mail-limit" className="mt-2 text-amber-700 dark:text-amber-400">
            ส่งครบ {companyMailLimit} ครั้งแล้ว ไม่สามารถส่งเพิ่มได้ — หากต้องส่งอีกครั้ง โปรดติดต่อเจ้าหน้าที่ หรือเปิด PDF ไปยื่นด้วยตนเอง
          </p>
        )}

        {intent.company_mail_sent_at && intent.company_mail_to && (
          <p data-testid="company-mail-status" className="mt-2 font-semibold text-emerald-700 dark:text-emerald-400">
            ส่งถึง {intent.company_mail_to} เมื่อ {formatThaiDateTime(intent.company_mail_sent_at)}
            {companyMailLeft > 0 && ` · ส่งได้อีก ${companyMailLeft} ครั้ง`}
          </p>
        )}
        {!intent.company_mail_sent_at && companyMailLeft > 0 && (
          <p className="mt-2 text-gray-600 dark:text-gray-400">ส่งได้ {companyMailLeft} ครั้ง</p>
        )}

        {collapsed && companyMailLeft > 0 && (
          <Button
            variant="secondary"
            size="sm"
            data-testid="company-mail-resend-open"
            className="mt-3"
            onClick={() => setMailResendOpen(true)}
          >
            ส่งซ้ำ / เปลี่ยนอีเมล (เหลือ {companyMailLeft} ครั้ง)
          </Button>
        )}

        {companyMailError && (
          <div data-testid="company-mail-error" className="mt-2">
            <AlertBanner variant="error" message={companyMailError} />
          </div>
        )}
      </div>
    );
  };

  // ฟอร์มรายงานผลของนักศึกษา (D7) — ทางสำรองเมื่อบริษัทคืนเอกสารตอบรับมาที่นักศึกษาเอง
  // การ์ดเรียกเฉพาะสถานะที่คณบดีลงนามแล้ว และพับไว้หลังปุ่ม `proof-open` · ช่องกรอกอยู่ใน state ของหน้านี้
  // ปิดฟอร์มแล้วค่าที่กรอกไว้ไม่หาย
  const proofFormEl = (
    <div data-testid="proof-form" className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/10">
        <span className="mb-1 block text-xs font-bold text-brand-blue dark:text-blue-400">
          การรายงานผลการตอบรับเข้าปฏิบัติสหกิจศึกษา (Placement Reporting)
        </span>
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          หากสถานประกอบการคืนเอกสารตอบรับกระดาษมาให้คุณ (นอกระบบ) กรุณากรอกรายละเอียดพี่เลี้ยง (Mentor)
          กำหนดวันเริ่มงาน และอัปโหลดไฟล์หลักฐานเพื่อขึ้นทะเบียนแทนบริษัท
        </p>
      </div>

                  <form onSubmit={handleProofSubmit} className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">รายละเอียดพี่เลี้ยงผู้ดูแลสหกิจศึกษา</h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ชื่อ-นามสกุล พี่เลี้ยง *</label>
                        <Input
                          type="text"
                          required
                          disabled={submittingProof || reportingFail}
                          value={mentorName}
                          onChange={(e) => setMentorName(e.target.value)}
                          placeholder="เช่น นายสมชาย ดีใจ" size="sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">อีเมล พี่เลี้ยง *</label>
                        <Input
                          type="email"
                          required
                          disabled={submittingProof || reportingFail}
                          value={mentorEmail}
                          onChange={(e) => setMentorEmail(e.target.value)}
                          placeholder="mentor@company.com" size="sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">เบอร์โทรศัพท์ พี่เลี้ยง *</label>
                        <Input
                          type="tel"
                          required
                          disabled={submittingProof || reportingFail}
                          value={mentorPhone}
                          onChange={(e) => setMentorPhone(e.target.value)}
                          placeholder="เช่น 0812345678" size="sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">วันเริ่มปฏิบัติงานสหกิจ *</label>
                        <Input
                          type="date"
                          required
                          data-testid="proof-start-date"
                          disabled={submittingProof || reportingFail}
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)} size="sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ตำแหน่งงาน พี่เลี้ยง (ไม่บังคับ)</label>
                        <Input
                          type="text"
                          disabled={submittingProof || reportingFail}
                          value={mentorPosition}
                          onChange={(e) => setMentorPosition(e.target.value)}
                          placeholder="เช่น Supervisor / HR Specialist" size="sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ฝ่าย / แผนก (ไม่บังคับ)</label>
                        <Input
                          type="text"
                          disabled={submittingProof || reportingFail}
                          value={mentorDept}
                          onChange={(e) => setMentorDept(e.target.value)}
                          placeholder="เช่น Engineering / Human Resources" size="sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        ผู้ลงนามบนแบบตอบรับ (กรอกตามที่ปรากฏบนกระดาษ) — ชื่อนี้จะถูกพิมพ์ลงหนังสือส่งตัว
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ชื่อผู้อนุมัติ *</label>
                          <Input
                            data-testid="proof-signer-name"
                            disabled={submittingProof || reportingFail}
                            value={signerName}
                            onChange={(e) => setSignerName(e.target.value)}
                            placeholder="เช่น นางสาวสมหญิง ใจดี" size="sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ตำแหน่ง *</label>
                          <Input
                            data-testid="proof-signer-position"
                            disabled={submittingProof || reportingFail}
                            value={signerPosition}
                            onChange={(e) => setSignerPosition(e.target.value)}
                            placeholder="เช่น ผู้จัดการฝ่ายบุคคล" size="sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">วันที่บนแบบตอบรับ *</label>
                          <Input
                            type="date"
                            data-testid="proof-signed-date"
                            disabled={submittingProof || reportingFail}
                            value={signedDate}
                            onChange={(e) => setSignedDate(e.target.value)}
                            size="sm"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1 font-bold">ไฟล์หลักฐานใบตอบรับจากบริษัท (PDF/PNG/JPG) *</label>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        required
                        disabled={submittingProof || reportingFail}
                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                        className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-300 cursor-pointer"
                      />
                    </div>

                    <AlertBanner variant="error" message={proofError} />
      <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-gray-800 sm:flex-row">
        <Button
          type="submit"
          size="sm"
          disabled={submittingProof || reportingFail}
          className="flex-1"
        >
          {submittingProof ? 'กำลังส่งข้อมูล...' : 'ส่งรายงานตัวเข้าปฏิบัติงาน'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="proof-close"
          disabled={submittingProof}
          onClick={() => setProofOpen(false)}
        >
          ปิดฟอร์ม
        </Button>
      </div>
    </form>
    </div>
  );

  // ฟอร์มระบุพี่เลี้ยง — บริษัทตอบรับทางลิงก์ไม่ได้ระบุพี่เลี้ยงมา (ตัดสหกิจ 07 ฝั่งบริษัท 2026-10-05)
  // ส่งได้จนกว่าเจ้าหน้าที่จะกดรับ · บัญชีพี่เลี้ยงเปิดตอนเจ้าหน้าที่กดรับเท่านั้น จึงไม่มีอีเมลออกจากการกดตรงนี้
  const mentorFieldKeys = ['name', 'email', 'phone', 'position', 'department'] as const;
  const submitMentorSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIntent) return;
    setMentorSetBusy(true);
    setMentorSetError(null);
    try {
      await api.post(`/intents/${activeIntent.form_id}/mentor`, {
        name: mentorSet.name.trim(),
        email: mentorSet.email.trim(),
        phone: mentorSet.phone.trim(),
        position: mentorSet.position.trim(),
        department: mentorSet.department.trim(),
      });
      setMentorSetOpen(false);
      await loadDashboardData(true);
    } catch (err) {
      setMentorSetError(getErrorMessage(err, 'บันทึกข้อมูลพี่เลี้ยงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setMentorSetBusy(false);
    }
  };
  const mentorFieldLabels: Record<(typeof mentorFieldKeys)[number], string> = {
    name: 'ชื่อ-นามสกุล พี่เลี้ยง *',
    email: 'อีเมล พี่เลี้ยง *',
    phone: 'เบอร์โทรศัพท์ พี่เลี้ยง *',
    position: 'ตำแหน่ง (ไม่บังคับ)',
    department: 'ฝ่าย / แผนก (ไม่บังคับ)',
  };
  const mentorFormEl =
    statusState === 'add-mentor' || (statusState === 'wait-confirm' && mentorSetOpen) ? (
      <form
        data-testid="mentor-form"
        onSubmit={submitMentorSet}
        className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mentorFieldKeys.map((key) => (
            <div key={key}>
              <label htmlFor={`mentor-set-${key}`} className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                {mentorFieldLabels[key]}
              </label>
              <Input
                id={`mentor-set-${key}`}
                data-testid={`mentor-${key}`}
                type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                required={key === 'name' || key === 'email' || key === 'phone'}
                disabled={mentorSetBusy}
                value={mentorSet[key]}
                onChange={(e) => setMentorSet((prev) => ({ ...prev, [key]: e.target.value }))}
                size="sm"
              />
            </div>
          ))}
        </div>
        <AlertBanner variant="error" message={mentorSetError} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="mentor-submit" disabled={mentorSetBusy}>
            {mentorSetBusy ? 'กำลังบันทึก...' : 'บันทึกข้อมูลพี่เลี้ยง'}
          </Button>
          {statusState === 'wait-confirm' && (
            <Button variant="secondary" size="sm" disabled={mentorSetBusy} onClick={() => setMentorSetOpen(false)}>
              ยกเลิก
            </Button>
          )}
        </div>
      </form>
    ) : null;
  // wait-confirm: แก้พี่เลี้ยงได้จนกว่าเจ้าหน้าที่จะกดรับ — เฉพาะใบที่บริษัทตอบทางลิงก์ (ทางนักศึกษาอัปโหลดเอง พี่เลี้ยงมากับแบบตอบรับแล้ว)
  const mentorEditToggleEl =
    statusState === 'wait-confirm' && statusIntent?.acceptance_source === 'link' && !mentorSetOpen ? (
      <div>
        <Button
          variant="secondary"
          size="sm"
          data-testid="mentor-edit"
          onClick={() => {
            setMentorSet({
              name: intentMentor?.name ?? '',
              email: intentMentor?.email ?? '',
              phone: intentMentor?.phone ?? '',
              position: intentMentor?.position ?? '',
              department: intentMentor?.department ?? '',
            });
            setMentorSetError(null);
            setMentorSetOpen(true);
          }}
        >
          แก้ข้อมูลพี่เลี้ยง
        </Button>
      </div>
    ) : null;

  return (
    <div className="space-y-6 page-enter">
      {/* PR Announcements Banner */}
      {announcementBanner}

      {/* Co-op Calendar Banner — separate system, sits under the PR notice */}
      {calendarBanner}

      {/*
        "ตอนนี้ต้องทำอะไร" มาก่อนทุกอย่าง (2026-09-07)

        หน้านี้เคยเปิดด้วยแบนเนอร์โปรไฟล์ — รูป ชื่อ เกรด อาจารย์ที่ปรึกษา ซึ่งตอบว่า
        *คุณคือใคร* ทั้งที่คำถามที่นักศึกษาเปิดหน้านี้มาถามคือ *ตอนนี้ต้องทำอะไร*
        คำตอบนั้นเดิมอยู่ในแถบความคืบหน้าที่ต้องเลื่อนลงไปอีกจอหนึ่งถึงจะเห็น

        การ์ดอ่าน `phases` ชุดเดียวกับแถบเส้นทางด้านล่าง จึงไม่มีทางบอกคนละเรื่องกัน
      */}
      {/* การ์ด "สิ่งที่ต้องทำตอนนี้" ของช่วงขอที่ฝึกงาน (แบบ A) — ขอบฟ้า = ต้องทำ · เทา = รอ · เขียว = ได้แล้ว */}
      {withdrawNotice && (
        <div data-testid="withdraw-notice">
          <AlertBanner variant="success" message={withdrawNotice} />
        </div>
      )}
      {statusIntent && statusState && (
        <StudentStatusCard
          state={statusState}
          intent={statusIntent}
          dueNote={dueNote}
          evidenceHref={
            activeIntent?.acceptance_evidence_path
              ? `${API_BASE_URL}/files/${activeIntent.acceptance_evidence_path}`
              : null
          }
          requestForm={activeIntent ? renderRequestForm(activeIntent) : null}
          mailBox={
            !activeIntent
              ? null
              : statusState === 'send'
                ? renderMailBox(activeIntent, 'send')
                : statusState === 'returned'
                  ? renderMailBox(activeIntent, 'returned')
                  : statusState === 'wait-company'
                    ? renderMailBox(activeIntent, 'wait')
                    : null
          }
          mentorForm={mentorFormEl}
          mentorEditToggle={mentorEditToggleEl}
          proofForm={proofFormEl}
          proofOpen={proofOpen}
          onOpenProof={() => setProofOpen((open) => !open)}
          onFail={() => setConfirmingFailure(true)}
          failBusy={reportingFail}
          onFindPlacement={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'jobs' }))}
        />
      )}

      {/* ⛔ การ์ด "ทำอะไรตอนนี้" มีได้ใบเดียวเสมอ — ช่วงขอที่ฝึกงานเป็นของ StudentStatusCard · ตั้งแต่ได้ที่ฝึกงานแล้ว
          (หรือสถานะที่การ์ดนั้นไม่รู้จัก / ยังไม่มีคำร้อง) เป็นของ CoopNowCard */}
      {!(statusIntent && statusState) && (
        <CoopNowCard
          phases={phases}
          deadline={
            // ได้ที่ฝึกงานแล้ว = จบช่วงขอที่ฝึกงาน — กำหนดส่งหลักฐานตอบรับไม่เกี่ยวแล้ว ห้ามค้างอยู่ข้างขั้นที่พัก
            acceptanceDue && !step1_5Done
              ? {
                  label: 'กำหนดส่งหลักฐานตอบรับ',
                  date: formatThaiDate(acceptanceDue.due),
                  daysLeft: acceptanceDue.daysLeft,
                  overdue: acceptanceDue.overdue,
                }
              : null
          }
        />
      )}

      {/* สองใบนี้คือสิ่งที่นักศึกษาถามบ่อยที่สุดหลังจาก "ตอนนี้ต้องทำอะไร" */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3.5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">ที่ฝึกงานของคุณ</h3>
          {activeIntent?.company_name_th ? (
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {activeIntent.company_name_th}
                </span>
                {/* ข้อมูลที่เดิมอยู่บนการ์ดสถานะตอน "ได้ที่ฝึกงานแล้ว" — ขึ้นเมื่อมีเท่านั้น */}
                {intentMentor?.name && (
                  <span data-testid="intent-mentor" className="text-xs text-gray-600 dark:text-gray-400">
                    พี่เลี้ยง {intentMentor.name}
                    {intentMentor.email ? ` · ${intentMentor.email}` : ''}
                  </span>
                )}
                {data.mentor_reminders && data.mentor_reminders.count > 0 && (
                  <span data-testid="student-mentor-reminders" className="text-xs text-gray-600 dark:text-gray-400">
                    คณะแจ้งเตือนพี่เลี้ยงแล้ว {data.mentor_reminders.count} ครั้ง
                    {data.mentor_reminders.last_at
                      ? ` (ล่าสุด ${formatThaiDateTime(data.mentor_reminders.last_at)})`
                      : ''}{' '}
                    — ไม่ต้องตามเอง
                  </span>
                )}
                {activeIntent.start_date && (
                  <span data-testid="intent-start-date" className="text-xs text-gray-600 dark:text-gray-400">
                    เริ่มงาน {formatThaiDate(activeIntent.start_date.slice(0, 10))}
                  </span>
                )}
                <StatusBadge
                  domain="intent"
                  status={intentDisplayStatus(activeIntent.status, coverLetter?.status)}
                  className="mt-1 self-start"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              ยังไม่ได้เลือกสถานประกอบการ — ยื่นได้จากเมนู “ยื่นคำร้องขอหนังสือ”
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3.5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">อาจารย์ที่ปรึกษาของคุณ</h3>
          {data.student.advisor ? (
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-brand-navy dark:bg-blue-950/40 dark:text-blue-400">
                {(data.student.advisor.name || 'อ').charAt(0)}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {data.student.advisor.name || 'จัดสรรแล้ว (ไม่ระบุชื่อ)'}
                </span>
                <span className="truncate text-xs text-gray-600 dark:text-gray-400">
                  {data.student.advisor.email}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              รอหัวหน้าสาขาวิชาจัดสรร — ยังไม่ต้องทำอะไร ระบบจะแจ้งเมื่อมีชื่อแล้ว
            </p>
          )}
        </section>
      </div>

      {/*
        เส้นทางสหกิจแบบย่อ — 7 ขั้นที่นักศึกษาพูดถึงจริง ไม่ใช่ 13 ขั้นย่อยตามเอกสาร
        การจับคู่อยู่ตรงนี้ ติดกับ `phases` ที่เป็นแหล่งความจริง ไม่ได้แยกไปไฟล์อื่น
        เพิ่ม/ลดขั้นในเฟสเมื่อไหร่ จะเห็นทันทีว่าต้องมาแก้การจับคู่ตรงนี้ด้วย
      */}
      <CoopJourneyBar
        phases={phases}
        steps={[
          // มาถึงหน้านี้ได้แปลว่ามีแถวใน students แล้วเสมอ — ไม่มีแถว แดชบอร์ดตอบ 404
          { label: 'กรอกประวัติ', subStepIds: [], state: 'completed' as const },
          { label: 'เลือกสถานประกอบการ', subStepIds: ['1.1'] },
          { label: 'ขอหนังสือขอความอนุเคราะห์', subStepIds: ['1.2', '1.3'], pendingLabel: 'รอเจ้าหน้าที่' },
          { label: 'รอหนังสือตอบรับ', subStepIds: ['1.4', '1.5'], pendingLabel: 'รอสถานประกอบการ' },
          { label: 'แจ้งที่พัก', subStepIds: ['2.1'] },
          { label: 'ปฏิบัติงานและส่งบันทึก', subStepIds: ['3.1', '3.2', '3.3'] },
          { label: 'ส่งรายงานและรับผลประเมิน', subStepIds: ['4.1', '4.2', '4.3'] },
        ]}
      />

      {/* ความคืบหน้าการขอที่ฝึกงาน (6 ขั้น) + เอกสารของฉัน — ใต้การ์ดสถานะ
          ⛔ สถานะที่ไม่รู้จัก (statusState = null) ไม่แต่งความคืบหน้าให้ · ป้ายสถานะในการ์ด "ที่ฝึกงานของคุณ" โชว์ค่าดิบอยู่แล้ว */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {statusState ? (
          <RequestProgress state={statusState} />
        ) : (
          !statusIntent && (
            <div
              data-testid="no-intent-card"
              className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
            >
              ยังไม่มีคำร้อง กรุณาไปที่เมนู "ยื่นคำร้องขอหนังสือ" เพื่อยื่นคำร้องขอหนังสือขอความอนุเคราะห์
            </div>
          )
        )}

        {/* เอกสารของฉัน — PDF ทุกใบที่มีอยู่แล้วมารวมที่นี่ (ย้ายมา ไม่ได้เพิ่มใบใหม่) */}
        <section
          id="my-documents"
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">เอกสารของฉัน</h3>

          {data.documents && data.documents.length > 0 ? (
            <div className="space-y-3">
              {data.documents.map((doc) => (
                <div key={doc.doc_id} data-testid={`student-doc-${doc.type}`} className="flex justify-between items-center p-3 rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-800 dark:border-gray-800 text-xs">
                  <div>
                    <span className="block font-bold text-gray-700 dark:text-gray-300">
                      {doc.type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์' : 'หนังสือส่งตัวนักศึกษา'}
                    </span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      สถานะ: {doc.status === 'signed' ? 'คณบดีเซ็นอนุมัติแล้ว' : 'รอการลงนาม'}
                    </span>
                  </div>
                  {doc.generated_file_path && (
                    <a
                      href={`${API_BASE_URL}/files/documents/${doc.doc_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 rounded border border-gray-300 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-700 dark:hover:text-blue-400"
                    >
                      เปิดอ่าน PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-xs">
              {/* ⛔ ข้อความเดิมบอกว่าหนังสือจะออก "เมื่อสถานประกอบการตอบรับ" ซึ่งเป็น
                  ลำดับของหนังสือส่งตัวที่ถูกถอดออกไปแล้ว · หนังสือขอความอนุเคราะห์ออก
                  **ตอนเจ้าหน้าที่รับคำร้อง** ซึ่งเกิดก่อนบริษัทตอบรับ */}
              ยังไม่มีหนังสือในระบบ — หนังสือขอความอนุเคราะห์จะออกให้เมื่อเจ้าหน้าที่รับแบบคำร้องที่ท่านอัปโหลดกลับ แล้วส่งเข้าคิวให้คณบดีลงนาม
            </div>
          )}

          {/* เอกสารหมายเลข 2 ออกคู่กับหนังสือขอความอนุเคราะห์ตามคู่มือข้อ 3 —
              คณะส่งคืนนักศึกษาทั้งสองใบ นักศึกษาถือไปยื่นสถานประกอบการเอง
              ⛔ ขึ้นหลังคณบดีลงนามเท่านั้น เซิร์ฟเวอร์ก็ปฏิเสธ 409 ก่อนหน้านั้น
              · เงื่อนไขอ่านจาก `acceptance_due_date` ซึ่งถูกปั๊มตอนคณบดีลงนาม —
                แหล่งเดียวกับที่เซิร์ฟเวอร์ใช้ตัดสิน จึงไม่มีทางที่หน้าจอกับ API
                จะไม่ตรงกัน (ถ้าอ่านจาก `documents` จะเป็นแหล่งความจริงที่สอง) */}
          {activeIntent?.acceptance_due_date && (
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs dark:border-blue-900/40 dark:bg-blue-950/20">
              <span className="block font-bold text-gray-700 dark:text-gray-300">
                แบบยืนยันแบบตอบรับ (เอกสารหมายเลข 2)
              </span>
              <p className="mt-0.5 text-gray-600 dark:text-gray-400">
                พิมพ์ไปพร้อมหนังสือขอความอนุเคราะห์ ให้สถานประกอบการกรอก ลงนามและประทับตรา
                <span className="font-semibold"> ภายใน 15 วันทำการ</span> — ทางสำรองกรณีบริษัทรับกระดาษ
              </p>
              <a
                href={`${API_BASE_URL}/intents/${activeIntent.form_id}/acceptance-form`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-acceptance-form"
                className="mt-2 inline-block rounded border border-gray-300 px-2 py-1 font-bold transition-all hover:border-brand-blue hover:text-brand-blue dark:border-gray-700 dark:hover:text-blue-400"
              >
                เปิดแบบตอบรับเพื่อสั่งพิมพ์
              </a>
            </div>
          )}
        </section>
      </div>

      {/* Announcement Detail Modal */}
        <ConfirmDialog
          open={confirmingProof && !!activeIntent}
          title="ส่งแบบตอบรับให้เจ้าหน้าที่"
          confirmLabel="ยืนยันส่ง"
          cancelLabel="กลับไปแก้"
          confirmTestId="proof-confirm"
          cancelTestId="proof-confirm-cancel"
          busy={submittingProof}
          onCancel={() => setConfirmingProof(false)}
          onConfirm={submitProof}
          message={
            <ConfirmSummary
              lead={`${activeIntent?.company_name_th ?? ''} · เริ่มงาน ${startDate ? formatThaiDate(startDate) : '—'}`}
              groups={[
                {
                  title: 'พนักงานที่ปรึกษา (พี่เลี้ยง) · ระบบจะส่งลิงก์เชิญไปที่อีเมลนี้',
                  rows: [
                    { label: 'ชื่อ', value: mentorName.trim() },
                    { label: 'อีเมล', value: mentorEmail.trim() },
                    { label: 'โทรศัพท์', value: mentorPhone.trim() },
                  ],
                },
                {
                  title: 'ผู้ลงนามบนแบบตอบรับ · พิมพ์ลงหนังสือส่งตัว',
                  rows: [
                    { label: 'ชื่อ', value: signerName.trim() },
                    { label: 'ตำแหน่ง', value: signerPosition.trim() },
                    { label: 'วันที่', value: signedDate ? formatThaiDate(signedDate) : '' },
                    { label: 'ไฟล์', value: evidenceFile?.name ?? '' },
                  ],
                },
              ]}
              lockNote="ส่งแล้วแก้เองไม่ได้ จนกว่าเจ้าหน้าที่จะตีกลับ"
            />
          }
        />
      <ConfirmDialog
        open={!!pendingRequestForm}
        title="ส่งแบบคำร้องที่ลงนามแล้ว"
        confirmLabel="ยืนยันส่ง"
        cancelLabel="กลับไปเลือกไฟล์ใหม่"
        confirmTestId="request-form-confirm"
        cancelTestId="request-form-confirm-cancel"
        busy={uploadingRequestForm}
        onCancel={() => setPendingRequestForm(null)}
        onConfirm={submitRequestForm}
        message={
          <ConfirmSummary
            lead="เจ้าหน้าที่จะตรวจไฟล์นี้และออกเลขหนังสือ — เปิดไฟล์ดูให้แน่ใจว่าเป็นฉบับที่ลงนามครบทั้งสองช่อง"
            groups={[
              {
                rows: [
                  { label: 'ไฟล์', value: pendingRequestForm?.file.name ?? '' },
                  {
                    label: 'ขนาด',
                    value: pendingRequestForm ? `${(pendingRequestForm.file.size / 1024 / 1024).toFixed(2)} MB` : '',
                  },
                  {
                    label: 'อาจารย์ที่ปรึกษาที่ลงนาม',
                    value: activeIntent?.request_signers?.advisor_name || signerAdvisor.trim(),
                  },
                  {
                    label: 'หัวหน้าสาขาวิชาที่ลงนาม',
                    value: activeIntent?.request_signers?.dept_head_name || signerDeptHead.trim(),
                  },
                ],
              },
            ]}
            lockNote="ส่งแล้วแก้เองไม่ได้ จนกว่าเจ้าหน้าที่จะตีกลับ"
          />
        }
      />
      <ConfirmDialog
        open={confirmingCompanyMail && !!activeIntent}
        title="ส่งหนังสือให้สถานประกอบการ"
        confirmLabel="ยืนยันส่ง"
        cancelLabel="กลับไปแก้"
        confirmTestId="company-mail-confirm"
        cancelTestId="company-mail-confirm-cancel"
        busy={sendingCompanyMail}
        onCancel={() => setConfirmingCompanyMail(false)}
        onConfirm={() => activeIntent && submitCompanyMail(activeIntent.form_id, companyMailAddress)}
        message={
          <ConfirmSummary
            lead="ระบบจะส่งอีเมลถึงที่อยู่นี้ทันที"
            groups={[
              {
                rows: [
                  { label: 'ส่งถึง', value: companyMailAddress },
                  { label: 'สถานประกอบการ', value: activeIntent?.company_name_th ?? '' },
                  { label: 'ไฟล์แนบ 1', value: 'หนังสือขอความอนุเคราะห์ (คณบดีลงนามแล้ว)' },
                  { label: 'ไฟล์แนบ 2', value: 'แบบตอบรับ (เอกสารหมายเลข 2)' },
                  { label: 'ลิงก์ตอบรับ', value: 'ลิงก์ให้บริษัทตอบรับออนไลน์ (ใช้ได้ครั้งเดียว · ส่งใหม่แล้วลิงก์เก่าใช้ไม่ได้)' },
                  { label: 'ตอบกลับไปที่', value: 'อีเมลมหาวิทยาลัยของท่าน' },
                ],
              },
            ]}
            lockNote={`ส่งแล้วยกเลิกไม่ได้ และนับเป็น 1 ใน ${companyMailLimit} ครั้ง (เหลือ ${companyMailLeft} ครั้ง)`}
          />
        }
      />
      {selectedAnnouncement && announcementModal}

      {/* Co-op Calendar Modal */}
      {calendarModal}

      <ConfirmDialog
        open={confirmingWithdraw && !!activeIntent}
        title="ยกเลิกคำร้องนี้"
        confirmLabel="ยืนยันยกเลิกคำร้อง"
        cancelLabel="ไม่ยกเลิก"
        confirmTestId="withdraw-confirm"
        cancelTestId="withdraw-confirm-cancel"
        destructive
        busy={withdrawing}
        onConfirm={handleWithdraw}
        onCancel={() => setConfirmingWithdraw(false)}
        message={
          <>
            <AlertBanner variant="error" message={withdrawError} className="mb-3" />
            <ConfirmSummary
              lead="ยกเลิกแล้วยื่นคำร้องถึงสถานประกอบการอื่น (หรือที่เดิมด้วยข้อมูลที่แก้แล้ว) ได้ทันที"
              rows={[
                { label: 'สถานประกอบการ', value: activeIntent?.company_name_th ?? '' },
                {
                  label: 'ไฟล์ที่ส่งไปแล้ว',
                  value: activeIntent?.request_form_path ? 'ถูกลบออกจากระบบ' : 'ยังไม่ได้ส่ง',
                },
              ]}
              lockNote="ยกเลิกแล้วคำร้องนี้ถูกลบออกจากระบบ เรียกคืนไม่ได้ · กระดาษที่ลงนามไว้ของใบนี้ใช้ต่อไม่ได้ ต้องพิมพ์และลงนามใบใหม่"
            />
          </>
        }
      />
      <ConfirmDialog
        open={confirmingFailure}
        title="รายงานผลการสัมภาษณ์ไม่ผ่าน"
        message="ยืนยันที่จะรายงานว่าถูกปฏิเสธหรือสัมภาษณ์ไม่ผ่าน? ระบบจะปลดล็อกให้กลับไปยื่นความจำนงที่สถานประกอบการอื่นใหม่ได้ และใบความจำนงฉบับนี้จะถูกปิด"
        confirmLabel="ยืนยัน รายงานผล"
        destructive
        busy={reportingFail}
        onConfirm={handleReportFailure}
        onCancel={() => setConfirmingFailure(false)}
      />
    </div>
  );
};

export default StudentDashboard;
