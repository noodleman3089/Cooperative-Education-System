import React, { useState } from 'react';
import StudentWelcomeGuide from './StudentWelcomeGuide';
import PageSkeleton from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile, IntentForm, OfficialDocument } from '../types/api';
import { type PhaseGroup } from './CoopStepperBar';
import CoopNowCard from './CoopNowCard';
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
import { formatThaiDate } from '../utils/thaiDate';
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

const StudentDashboard: React.FC = () => {
  const [data, setData] = useState<{
    student: StudentProfile & { advisor?: { email: string; name?: string }; supervisor?: { email: string; name?: string } };
    activeIntent: IntentForm | null;
    documents: OfficialDocument[];
    /** ความคืบหน้าเฟส 2–4 นับจากแถวจริง — `GET /students/dashboard` */
    progress?: {
      accommodation_submitted: boolean;
      work_plan_certified: boolean;
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
  const [uploadingRequestForm, setUploadingRequestForm] = useState(false);
  const [signerAdvisor, setSignerAdvisor] = useState('');
  const [signerDeptHead, setSignerDeptHead] = useState('');
  const [requestFormError, setRequestFormError] = useState<string | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [reportingFail, setReportingFail] = useState(false);
  const [confirmingFailure, setConfirmingFailure] = useState(false);
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
      // ให้เลือกไฟล์เดิมซ้ำได้ ถ้ารอบแรกพลาด
      e.target.value = '';
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

  // ⛔ เฟส 2–4 อ่านจาก `progress` ที่ backend นับจากแถวจริงของแต่ละขั้น — ห้ามเดาจากสถานะใบความจำนง
  //    เดิม 2.x ติ๊กเสร็จทันทีที่บริษัทตอบรับ (ยังไม่ได้กรอกอะไรเลย) และ 3.x/4.x เป็น `&& false` ตลอดกาล
  //    · แต่ละขั้นเสร็จตามข้อมูลของตัวเอง ไม่ต่อโซ่กัน — ของจริงไม่เรียงเสมอ (นิเทศได้ก่อนโครงร่างผ่าน)
  const progress = data.progress;
  const SUPERVISION_VISITS = 2; // คู่มือกำหนดนิเทศ 2 ครั้ง (`supervision_records.visit_number` 1 | 2)
  const supervisionVisits = progress?.supervision_visits ?? 0;

  const step2_1Done = step1_5Done && !!progress?.accommodation_submitted;
  const step2_2Done = step1_5Done && !!progress?.work_plan_certified;

  const step3_1Done = step1_5Done && !!progress?.outline_submitted;
  const step3_2Done = step1_5Done && !!progress?.outline_approved;
  const step3_3Done = step1_5Done && supervisionVisits >= SUPERVISION_VISITS;

  const step4_1Done = step1_5Done && !!progress?.final_report_approved;
  const step4_2Done = step1_5Done && (progress?.mentor_evaluations ?? 0) >= 2;
  // ระบบไม่เก็บเกรด (เจ้าของตัดสิน 2026-09-21) — ขั้นสุดท้ายบอกแค่ว่าผลประเมินครบแล้ว
  const step4_3Done = step4_2Done;

  let activePhaseId = 1;
  // เฟส 2 คือ "สัปดาห์แรกของการทำงาน" — เข้าได้ต่อเมื่อ **สถานประกอบการตอบรับแล้ว**
  // ไม่ใช่แค่ออกหนังสือเสร็จ (ของเดิมใช้ step1_3Done ที่ติ๊กตั้งแต่มีแถวหนังสือ)
  if (step1_5Done) activePhaseId = 2;
  if (step2_1Done && step2_2Done) activePhaseId = 3;
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
          title: '1.1 ยื่นแบบแจ้งความจำนง (Intent Form)',
          description: 'เลือกบริษัทและตำแหน่งงานเพื่อเสนอขอออกสหกิจศึกษา',
          status: step1_1Done ? 'completed' : 'active',
          actionLabel: !step1_1Done ? 'เลือกตำแหน่งงาน (Smart Job)' : undefined,
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
          description: 'พิมพ์แบบคำร้อง (เอกสารหมายเลข 1) ไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนามด้วยปากกา แล้วสแกนอัปโหลดกลับเข้าระบบ',
          status: step1_2Done ? 'completed' : step1_1Done ? 'active' : 'pending'
        },
        {
          id: '1.3',
          title: '1.3 เจ้าหน้าที่รับคำร้อง & ออกเลขที่หนังสือ',
          description: 'เจ้าหน้าที่ตรวจลายเซ็นบนกระดาษ กรอกชื่อผู้ลงนาม แล้วออกเลขที่หนังสือราชการ',
          status: step1_3Done ? 'completed' : step1_2Done ? 'active' : 'pending'
        },
        {
          id: '1.4',
          title: '1.4 คณบดีลงนามหนังสือขอความอนุเคราะห์',
          description: 'ลงนามแล้วดาวน์โหลดหนังสือไปยื่นสถานประกอบการด้วยตนเอง',
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
      title: '2. สัปดาห์แรกของการทำงาน',
      subtitle: 'แจ้งที่พัก & แผนงาน 4 เดือน',
      status: (step2_1Done && step2_2Done) ? 'completed' : activePhaseId === 2 ? 'active' : 'pending',
      subSteps: [
        {
          id: '2.1',
          title: '2.1 แบบแจ้งรายละเอียดที่พัก (สหกิจ 06)',
          description: 'กรอกข้อมูลที่พัก แผนที่ และบุคคลติดต่อฉุกเฉินสัปดาห์แรก',
          status: step2_1Done ? 'completed' : activePhaseId === 2 ? 'active' : 'pending',
          actionLabel: activePhaseId === 2 && !step2_1Done ? 'กรอกรายละเอียดที่พัก' : undefined,
          onAction: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'accommodation_plan' }))
        },
        {
          id: '2.2',
          title: '2.2 แผนปฏิบัติงาน 4 เดือน (สหกิจ 07)',
          description: 'ระบุชื่อพี่เลี้ยงดูแลและจัดทำกรอบงานร่วมกับพี่เลี้ยงสัปดาห์ที่ 2',
          status: step2_2Done ? 'completed' : activePhaseId === 2 ? 'active' : 'pending',
          actionLabel: activePhaseId === 2 && !step2_2Done ? 'ส่งแผนงานร่วมกับพี่เลี้ยง' : undefined,
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
      <CoopNowCard
        phases={phases}
        deadline={
          acceptanceDue
            ? {
                label: 'กำหนดส่งหลักฐานตอบรับ',
                date: formatThaiDate(acceptanceDue.due),
                daysLeft: acceptanceDue.daysLeft,
                overdue: acceptanceDue.overdue,
              }
            : null
        }
      />

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
                {activeIntent.job_title && (
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    ตำแหน่ง {activeIntent.job_title}
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
              ยังไม่ได้เลือกสถานประกอบการ — เลือกได้จากเมนู “หาที่ฝึกงาน”
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
          { label: 'แจ้งที่พักและแผนงาน', subStepIds: ['2.1', '2.2'] },
          { label: 'ปฏิบัติงานและส่งบันทึก', subStepIds: ['3.1', '3.2', '3.3'] },
          { label: 'ส่งรายงานและรับผลประเมิน', subStepIds: ['4.1', '4.2', '4.3'] },
        ]}
      />

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Placement / Application status block */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">สถานะคำขอสมัครงานปัจจุบัน</h3>

          {activeIntent ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 dark:bg-gray-800 dark:border-gray-800">
                <span className="block text-xs text-gray-600 dark:text-gray-400">สถานประกอบการ</span>
                <span className="block text-sm font-bold text-gray-800 dark:text-white mt-0.5">
                  {activeIntent.company_name_th}
                </span>
                <span className="block text-xs text-gray-500 mt-1 dark:text-gray-400">
                  ตำแหน่ง: {activeIntent.job_title || 'ระบุทั่วไป / ไม่ผ่านโควตาสาขา'}
                </span>
              </div>

              {/* Status Display and Conditional Operations */}
              <div>
                <span className="text-xs text-gray-500 block mb-2 dark:text-gray-400">สถานะการพิจารณา:</span>
                <div className="flex items-center gap-2">
                  {/* domain="intent": `pending_advisor` ของใบความจำนงแปลว่า
                      "เอาแบบคำร้องไปให้ลงนาม" ไม่ใช่ "รออาจารย์กดปุ่ม" เหมือน
                      โครงร่างรายงานที่ใช้ key เดียวกัน */}
                  <StatusBadge status={intentDisplayStatus(activeIntent.status, coverLetter?.status)} domain="intent" />
                </div>
              </div>

              {/* เอกสารหมายเลข 1 — พิมพ์ได้ทันทีที่ยื่นคำร้อง และอัปโหลดไฟล์ที่ลงนามแล้ว
                  แสดงเฉพาะระหว่างรอลงนาม (pending_advisor) หรือรอเจ้าหน้าที่ตรวจสอบ (pending_officer_request) */}
              {(activeIntent.status === 'pending_advisor' ||
                activeIntent.status === 'pending_officer_request') && (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  <span className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1)
                  </span>

                  {/* ponytail: ซ่อนปุ่มสั่งพิมพ์และคำแนะนำเมื่อส่งแบบคำร้องแล้ว */}
                  {!activeIntent.request_form_path && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-600 mb-2 leading-relaxed dark:text-gray-400">
                        พิมพ์ออกมากรอกช่องที่เว้นไว้ด้วยปากกา แล้วนำไปให้อาจารย์ที่ปรึกษาและ
                        หัวหน้าสาขาวิชาลงนาม
                      </p>
                      <a
                        href={`${API_BASE_URL}/intents/${activeIntent.form_id}/request-form`}
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
                    {activeIntent.request_form_path ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span data-testid="request-form-uploaded">
                          ส่งแบบคำร้องที่ลงนามแล้ว · รอเจ้าหน้าที่ตรวจสอบ
                        </span>
                        <a
                          href={`${API_BASE_URL}/files/${activeIntent.request_form_path}`}
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
                        {(!activeIntent.request_signers?.advisor_name || !activeIntent.request_signers?.dept_head_name) && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            ระบบยังไม่มีชื่อผู้ลงนามบางคน — พิมพ์ชื่อตามที่ลงนามบนกระดาษ
                          </p>
                        )}
                        {activeIntent.request_signers?.advisor_name ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            อาจารย์ที่ปรึกษา: <span className="font-bold text-gray-800 dark:text-gray-200">{activeIntent.request_signers.advisor_name}</span>
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
                        {activeIntent.request_signers?.dept_head_name ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            หัวหน้าสาขาวิชา: <span className="font-bold text-gray-800 dark:text-gray-200">{activeIntent.request_signers.dept_head_name}</span>
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
                          onChange={(e) => handleRequestFormUpload(e, activeIntent.form_id)}
                          className="sr-only"
                        />
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                            uploadingRequestForm
                              ? 'border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-600'
                              : 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
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
                  {activeIntent.status === 'pending_advisor' && activeIntent.reject_reason && (
                    <div className="mt-3">
                      <AlertBanner
                        variant="warning"
                        message={
                          <>
                            <strong>เจ้าหน้าที่ตีกลับแบบคำร้อง</strong> — {activeIntent.reject_reason}
                            <br />
                            แก้ไขตามที่แจ้งแล้วอัปโหลดใหม่ได้เลย
                          </>
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {activeIntent.status === 'approved_by_dept_head' && (
                <div className="border-t border-gray-100 pt-4 mt-4 dark:border-gray-800 space-y-4">
                  <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 dark:bg-blue-950/10 dark:border-blue-900/50">
                    <span className="block text-xs font-bold text-brand-blue mb-1 dark:text-blue-400">
                      การรายงานผลการสมัครและตอบรับเข้าปฏิบัติสหกิจศึกษา (Placement Reporting)
                    </span>
                    <p className="text-xs text-gray-500 leading-relaxed dark:text-gray-400">
                      หากสถานประกอบการตอบรับคุณเข้าปฏิบัติงานแล้ว (กรณีบริษัทให้เอกสารตอบรับกระดาษ / นอกระบบ) กรุณากรอกรายละเอียดพี่เลี้ยง (Mentor) กำหนดวันเริ่มงาน และอัปโหลดไฟล์หลักฐานเพื่อขึ้นทะเบียน หรือหากสัมภาษณ์ไม่ผ่าน สามารถกดปุ่มรายงานสัมภาษณ์ล้มเหลวด้านล่างเพื่อปลดล็อกสิทธิ์
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
                    <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <button
                        type="submit"
                        disabled={submittingProof || reportingFail}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-brand-blue hover:bg-blue-600 text-white text-xs font-bold transition-all disabled:opacity-50"
                      >
                        {submittingProof ? 'กำลังส่งข้อมูล...' : 'ส่งรายงานตัวเข้าปฏิบัติงาน'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmingFailure(true)}
                        disabled={submittingProof || reportingFail}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-950/20 text-xs font-bold transition-all disabled:opacity-50"
                      >
                        {reportingFail ? 'กำลังดำเนินการ...' : 'แจ้งสัมภาษณ์ไม่ผ่าน'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400 text-xs">
              ยังไม่มีคำขอยื่นความจำนง กรุณาไปที่เมนู "ตำแหน่งงาน / สมัครงาน" เพื่อกดยื่นคำขอสมัครสหกิจศึกษา
            </div>
          )}
        </div>

        {/* Official Letter Status */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">หนังสือขอความอนุเคราะห์ & เอกสารทางการ</h3>

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
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs dark:border-blue-900/40 dark:bg-blue-950/20">
              <span className="block font-bold text-gray-700 dark:text-gray-300">
                แบบยืนยันแบบตอบรับ (เอกสารหมายเลข 2)
              </span>
              <p className="mt-0.5 text-gray-600 dark:text-gray-400">
                พิมพ์ไปพร้อมหนังสือขอความอนุเคราะห์ ให้สถานประกอบการกรอก ลงนามและประทับตรา
                <span className="font-semibold"> ภายใน 15 วันทำการ</span> แล้วนำกลับมาอัปโหลดที่นี่
              </p>

              {/* นับถอยหลังกำหนดตอบกลับ
                  ⚠️ วันครบกำหนดคำนวณโดยข้ามเฉพาะเสาร์-อาทิตย์ ระบบไม่มีตารางวันหยุด
                  นักขัตฤกษ์ จึงเรียกว่า "โดยประมาณ" ไม่ใช่เส้นตาย — และเลยกำหนดแล้ว
                  ก็ยังอัปโหลดได้ เซิร์ฟเวอร์แค่ติดธงว่าส่งช้า ไม่ได้ปิดประตู */}
              {acceptanceDue && (
                <p
                  data-testid="acceptance-due"
                  className={`mt-2 font-semibold ${
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
              )}
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
        </div>

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
      {selectedAnnouncement && announcementModal}

      {/* Co-op Calendar Modal */}
      {calendarModal}

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
