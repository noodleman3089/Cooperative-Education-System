import React, { useState } from 'react';
import PageSkeleton from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile, IntentForm, OfficialDocument } from '../types/api';
import CoopStepperBar, { type PhaseGroup } from './CoopStepperBar';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import StatusBadge from './ui/StatusBadge';
import Button from './ui/Button';
import { Pin, UserPen } from 'lucide-react';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import { Input } from './ui/Input';

/** ประกาศจากงานสหกิจ — ที่ปักหมุดจะขึ้นเป็นแบนเนอร์บนสุดของแดชบอร์ด */
interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
}

const StudentDashboard: React.FC = () => {
  const [data, setData] = useState<{
    student: StudentProfile & { advisor?: { email: string; name?: string }; supervisor?: { email: string; name?: string } };
    activeIntent: IntentForm | null;
    documents: OfficialDocument[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingConsent, setUploadingConsent] = useState(false);

  // Manual Acceptance States
  const [mentorName, setMentorName] = useState('');
  const [mentorEmail, setMentorEmail] = useState('');
  const [mentorPhone, setMentorPhone] = useState('');
  const [mentorPosition, setMentorPosition] = useState('');
  const [mentorDept, setMentorDept] = useState('');
  const [startDate, setStartDate] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [reportingFail, setReportingFail] = useState(false);
  const [confirmingFailure, setConfirmingFailure] = useState(false);
  // 404 from /students/dashboard means "not onboarded yet", not "broken".
  const [needsProfile, setNeedsProfile] = useState(false);

  // PR Announcements states
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const loadDashboardData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);

      // The two calls are independent, so they are settled independently.
      // Previously Promise.all meant a failing /students/dashboard (a student who
      // has not completed onboarding gets a 404) threw before setAnnouncements
      // ever ran — announcements silently disappeared from the whole page.
      const [dashResult, annResult] = await Promise.allSettled([
        api.get('/students/dashboard'),
        api.get('/announcements')
      ]);

      if (annResult.status === 'fulfilled') {
        setAnnouncements(annResult.value?.data || []);
      } else {
        console.error('Failed to load announcements:', annResult.reason);
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

  const handleConsentUpload = async (e: React.ChangeEvent<HTMLInputElement>, formId: number) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    const formData = new FormData();
    formData.append('consent', file);

    setUploadingConsent(true);
    setError(null);

    try {
      await api.put(`/intents/${formId}/parental-consent`, formData);
      await loadDashboardData();
    } catch (err) {
      setError(getErrorMessage(err, 'การอัปโหลดใบยินยอมล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setUploadingConsent(false);
    }
  };

  const handleDownloadConsentTemplate = (intent: IntentForm) => {
    // Dynamically request pre-filled parental consent template from backend
    // Route: GET /api/files/download/parental-consent-template?intent_id=X
    const url = `${API_BASE_URL}/files/download/parental-consent-template?intent_id=${intent.form_id}`;
    window.open(url, '_blank');
  };

  const handleProofSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIntent || !evidenceFile) return;

    if (!mentorName || !mentorEmail || !mentorPhone || !startDate) {
      setError('กรุณากรอกข้อมูลพี่เลี้ยงและระบุวันเริ่มงานให้ครบถ้วน');
      return;
    }

    const formData = new FormData();
    formData.append('name', mentorName);
    formData.append('email', mentorEmail);
    formData.append('phone', mentorPhone);
    formData.append('position', mentorPosition);
    formData.append('department', mentorDept);
    formData.append('start_date', startDate);
    formData.append('evidence', evidenceFile);

    setSubmittingProof(true);
    setError(null);

    try {
      await api.post(`/acceptances/student/${activeIntent.form_id}/upload-proof`, formData);
      // Reset states
      setMentorName('');
      setMentorEmail('');
      setMentorPhone('');
      setMentorPosition('');
      setMentorDept('');
      setStartDate('');
      setEvidenceFile(null);
      await loadDashboardData();
    } catch (err) {
      setError(getErrorMessage(err, 'การอัปโหลดหลักฐานการตอบรับล้มเหลว กรุณาลองใหม่อีกครั้ง'));
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
        <AlertBanner variant="error" message={error} />

        {needsProfile && (
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
        )}

        {selectedAnnouncement && announcementModal}
      </div>
    );
  }

  const activeIntent = data.activeIntent;
  const student = data.student;
  const documents = data.documents || [];

  const step1_1Done = !!activeIntent;
  const step1_2Done = activeIntent?.status === 'approved_by_dept_head' || activeIntent?.status === 'accepted' || activeIntent?.status === 'pending_officer_approval';
  const step1_3Done = activeIntent?.status === 'accepted' || documents.some(d => d.type === 'cover_letter' || d.type === 'transfer_letter');

  const step2_1Done = step1_3Done && !!(student?.current_address || activeIntent?.status === 'accepted');
  const step2_2Done = step1_3Done && activeIntent?.status === 'accepted';

  const step3_1Done = step2_2Done && false;
  const step3_2Done = step3_1Done && false;
  const step3_3Done = step3_2Done && false;

  const step4_1Done = step3_3Done && false;
  const step4_2Done = step4_1Done && false;
  const step4_3Done = student?.is_eligible || false;

  let activePhaseId = 1;
  if (step1_3Done) activePhaseId = 2;
  if (step2_1Done && step2_2Done) activePhaseId = 3;
  if (step3_3Done) activePhaseId = 4;

  const phases: PhaseGroup[] = [
    {
      phaseId: 1,
      title: '1. ก่อนปฏิบัติงาน',
      subtitle: 'สมัครงาน & บริษัทตอบรับ',
      status: step1_3Done ? 'completed' : activePhaseId === 1 ? 'active' : 'pending',
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
          title: '1.2 อาจารย์ & หัวหน้าสาขาอนุมัติ',
          description: 'ผ่านการพิจารณาคุณสมบัติจากอาจารย์ที่ปรึกษาและหัวหน้าสาขา',
          status: step1_2Done ? 'completed' : step1_1Done ? 'active' : 'pending'
        },
        {
          id: '1.3',
          title: '1.3 สถานประกอบการตอบรับเข้าทำงาน',
          description: 'บริษัทตอบรับเข้าทำงาน หรือเจ้าหน้าที่ออกหนังสือส่งตัวเป็นทางการ',
          status: step1_3Done ? 'completed' : step1_2Done ? 'active' : 'pending'
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
          title: '3.3 การนิเทศงาน (สหกิจ 13)',
          description: 'อาจารย์นิเทศเข้าตรวจเยี่ยมพื้นที่/ออนไลน์ และบันทึกการประเมิน',
          status: step3_3Done ? 'completed' : step3_2Done ? 'active' : 'pending'
        }
      ]
    },
    {
      phaseId: 4,
      title: '4. สิ้นสุด & ประเมินผล',
      subtitle: 'ส่งรายงานเล่มสมบูรณ์ & ตัดเกรด',
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
          title: '4.3 ประเมินผลสำเร็จ & ยืนยันเกรด (S/U)',
          description: 'อาจารย์ตัดเกรดผ่านโครงการสหกิจศึกษาสำเร็จเรียบร้อย',
          status: step4_3Done ? 'completed' : step4_2Done ? 'active' : 'pending'
        }
      ]
    }
  ];

  return (
    <div className="space-y-6 page-enter">
      {/* PR Announcements Banner */}
      {announcementBanner}

      {/* Bento Grid Profile Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Profile Card (2/3 width on large screens) */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 p-6 rounded-3xl border border-gray-200/80 dark:border-gray-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-6 relative overflow-hidden">
          {/* Decorative background circle */}
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-50/50 dark:bg-blue-900/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-brand-blue to-blue-600 shadow-lg shadow-blue-500/30 flex items-center justify-center text-white text-3xl font-bold uppercase ring-4 ring-white dark:ring-gray-900 z-10 relative">
              {data.student.first_name ? data.student.first_name.charAt(0) : data.student.student_code.charAt(0)}
            </div>
          </div>
          
          <div className="flex-1 space-y-1.5 z-10">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/50 text-brand-blue dark:text-blue-400 text-xs font-bold tracking-wide uppercase">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              Student Profile
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-800 dark:text-white tracking-tight">
              {data.student.first_name && data.student.last_name 
                ? `${data.student.first_name} ${data.student.last_name}` 
                : 'ไม่ระบุชื่อ'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /></svg>
                {data.student.student_code}
              </div>
              <div className="hidden sm:block w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-700" />
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                {data.student.major_name_th || 'ไม่ระบุสาขาวิชา'}
              </div>
            </div>
          </div>
        </div>

        {/* Right Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-4">
          {/* Status Badge */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-sm flex items-center gap-4 hover:border-brand-blue/30 transition-colors group">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${data.student.is_eligible ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'}`}>
              {data.student.is_eligible ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">สิทธิ์สหกิจศึกษา</p>
              <p className={`text-sm font-bold ${data.student.is_eligible ? 'text-gray-800 dark:text-white' : 'text-rose-600 dark:text-rose-400'}`}>
                {data.student.is_eligible ? 'ผ่านเกณฑ์' : 'ยังไม่ผ่านเกณฑ์'}
              </p>
            </div>
          </div>

          {/* GPAX Badge */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-sm flex items-center gap-4 hover:border-brand-blue/30 transition-colors group">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">เกรดเฉลี่ยสะสม</p>
              <p className="text-sm font-bold text-gray-800 dark:text-white">
                {data.student.cumulative_gpa ? data.student.cumulative_gpa.toFixed(2) : 'N/A'}
              </p>
            </div>
          </div>

          {/* Advisor Badge */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-sm flex items-center gap-4 sm:col-span-3 lg:col-span-1 hover:border-brand-blue/30 transition-colors group">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${data.student.advisor ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">อาจารย์ที่ปรึกษาสหกิจ</p>
              <p className={`text-sm font-bold ${data.student.advisor ? 'text-gray-800 dark:text-white' : 'text-gray-600 dark:text-gray-400 italic'}`}>
                {data.student.advisor ? (data.student.advisor.name || 'จัดสรรแล้ว (ไม่ระบุชื่อ)') : 'รอการจัดสรร'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Milestone Progress Tracker */}
      <CoopStepperBar phases={phases} activePhaseId={activePhaseId} />

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
                  <StatusBadge status={activeIntent.status} />
                </div>
              </div>

              {/* Step 3 Action: Pre-filled PDF Consent download & Upload */}
              {activeIntent.status === 'pending_advisor' && (
                <div className="border-t border-gray-100 pt-4 mt-4 dark:border-gray-800 space-y-3">
                  <span className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    แบบฟอร์มหนังสือยินยอมผู้ปกครอง (Parental Consent)
                  </span>

                  {activeIntent.parental_consent_path ? (
                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 font-semibold">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      อัปโหลดใบยินยอมสำเร็จแล้ว (รออาจารย์ปลดล็อกปุ่มอนุมัติ)
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => handleDownloadConsentTemplate(activeIntent)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-brand-blue hover:bg-blue-50/10 text-brand-blue text-xs font-bold transition-all dark:text-blue-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        ดาวน์โหลดแบบฟอร์ม PDF ที่กรอกข้อมูลให้ล่วงหน้า
                      </button>

                      <label className="block">
                        <span className="sr-only">เลือกไฟล์สแกนคำยินยอม</span>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          disabled={uploadingConsent}
                          onChange={(e) => handleConsentUpload(e, activeIntent.form_id)}
                          className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-300 cursor-pointer"
                        />
                      </label>
                      {uploadingConsent && <span className="text-xs text-gray-600 dark:text-gray-400 block">กำลังดำเนินการอัปโหลดไฟล์...</span>}
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
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">หนังสือส่งตัว & เอกสารทางการ</h3>

          {data.documents && data.documents.length > 0 ? (
            <div className="space-y-3">
              {data.documents.map((doc) => (
                <div key={doc.doc_id} className="flex justify-between items-center p-3 rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-800 dark:border-gray-800 text-xs">
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
              ยังไม่มีการออกจดหมายส่งตัวอย่างเป็นทางการในระบบ (เมื่อสถานประกอบการตอบรับ เจ้าหน้าที่จะดำเนินการเปิดจดหมายเพื่อส่งต่อให้คณบดีลงนาม)
            </div>
          )}
        </div>

      </div>

      {/* Announcement Detail Modal */}
      {selectedAnnouncement && announcementModal}

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
