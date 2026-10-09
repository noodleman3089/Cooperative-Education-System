import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  UploadCloud,
  Send,
  Save,
  Loader2,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import CalendarGate, { useCalendarGate } from '../../components/ui/CalendarGate';
import { getErrorMessage } from '../../utils/errors';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';

interface OutlineVersion {
  version_id: number;
  file_path: string | null;
  report_title: string | null;
  outline_text: string | null;
  submitted_at: string;
  rejection_comment: string | null;
  status: string;
  reviewer_email: string | null;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
  reviewer_mentor_name?: string | null;
}

interface OutlineMeta {
  start_date: string | null;
  end_date: string | null;
  mentor_name: string | null;
  advisor_first_name: string | null;
  advisor_last_name: string | null;
}

interface OutlineResponse {
  outline_id: number | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  meta: OutlineMeta | null;
  versions: OutlineVersion[];
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const formatThaiDate = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = THAI_MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${day} ${month} ${year}`;
};

const ReportOutline: React.FC = () => {
  const auth = useContext(AuthContext);
  const [data, setData] = useState<OutlineResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields
  const [reportTitle, setReportTitle] = useState<string>('');
  const [outlineText, setOutlineText] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [existingFilePath, setExistingFilePath] = useState<string | null>(null);

  // Calendar Gate
  const { status: calendarStatus } = useCalendarGate('report_outline');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ⛔ backend ไม่มีสถานะ "ร่าง" — ทุก POST /outlines คือส่งถึงพี่เลี้ยงทันที (เดิมปุ่มบันทึกร่างส่งจริง พบ 2026-09-22)
  //    ร่างจึงเก็บในเครื่องนี้ (แบบเดียวกับแผนปฏิบัติงาน) · ไฟล์แนบเก็บไม่ได้ ต้องแนบใหม่ตอนส่ง
  const DRAFT_KEY = `outline_draft_${auth?.user?.userId ?? 'anon'}`;

  useEffect(() => {
    let active = true;
    const loadOutline = async () => {
      if (!auth?.user) return;
      try {
        setLoading(true);
        setError(null);
        const res = await api.get(`/outlines/student/${auth.user.userId}`);
        if (!active) return;
        const outlineData: OutlineResponse | null = (res as { data?: OutlineResponse })?.data || null;
        setData(outlineData);

        if (outlineData?.versions && outlineData.versions.length > 0) {
          const latest = outlineData.versions[0];
          setReportTitle(latest.report_title || '');
          setOutlineText(latest.outline_text || '');
          setExistingFilePath(latest.file_path || null);
        }
        // ร่างในเครื่องใหม่กว่าฉบับที่ส่งไปเสมอ (ถูกลบทิ้งตอนส่งจริง)
        try {
          const raw = localStorage.getItem(`outline_draft_${auth.user.userId}`);
          if (raw) {
            const draft = JSON.parse(raw) as { title?: string; text?: string };
            if (draft.title !== undefined) setReportTitle(draft.title);
            if (draft.text !== undefined) setOutlineText(draft.text);
          }
        } catch {
          /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว) — ไม่มีร่างก็แสดงฉบับจากเซิร์ฟเวอร์ */
        }
      } catch (err) {
        if (!active) return;
        setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดโครงร่างรายงาน'));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOutline();
    return () => {
      active = false;
    };
  }, [auth?.user, refreshTrigger]);

  // Calculate deadline from start_date (within week 3 = start_date + 21 days)
  const deadlineInfo = (() => {
    if (!data?.meta?.start_date) {
      return { text: 'กำหนดส่งภายในสัปดาห์ที่ 3', isLate: false };
    }
    const start = new Date(data.meta.start_date);
    const deadline = new Date(start);
    deadline.setDate(start.getDate() + 21);

    const now = new Date();
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: `กำหนดส่งภายในสัปดาห์ที่ 3 (${formatThaiDate(deadline.toISOString())}) · เลยกำหนดมาแล้ว ${Math.abs(diffDays)} วัน`,
        isLate: true,
      };
    }
    return {
      text: `กำหนดส่งภายในสัปดาห์ที่ 3 (${formatThaiDate(deadline.toISOString())}) · เหลืออีก ${diffDays} วัน`,
      isLate: false,
    };
  })();

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: reportTitle, text: outlineText }));
      setError(null);
      setSuccess('บันทึกร่างไว้ในเครื่องนี้แล้ว — พี่เลี้ยงยังไม่เห็นจนกว่าจะกดส่ง (ไฟล์แนบต้องแนบใหม่ตอนส่ง)');
    } catch {
      setError('บันทึกร่างในเครื่องนี้ไม่ได้ (เบราว์เซอร์ปิดการเก็บข้อมูล)');
    }
  };

  /** ตรวจแล้วเปิดกล่องยืนยัน — การส่งจริงอยู่ที่ submitOutline */
  const handleSubmit = async (isDraft: boolean) => {
    if (isDraft) {
      saveDraft();
      return;
    }
    setError(null);
    setSuccess(null);

    if (!isDraft && (calendarStatus === 'upcoming' || calendarStatus === 'closed')) {
      setError('ไม่อยู่ในช่วงเวลาที่เปิดให้ส่งตามปฏิทินสหกิจศึกษา (สามารถบันทึกร่างไว้ก่อนได้)');
      return;
    }

    if (!reportTitle.trim()) {
      setError('กรุณากรอกหัวข้อรายงาน');
      return;
    }

    if (!isDraft && !outlineText.trim() && !file && !existingFilePath) {
      setError('กรุณากรอกโครงร่างเนื้อหาพอสังเขป หรือแนบไฟล์โครงร่างรายงาน');
      return;
    }

    setError(null);
    setConfirmOpen(true);
  };

  const submitOutline = async () => {
    try {
      setSubmitting(true);
      const formData = new FormData();
      formData.append('report_title', reportTitle.trim());
      formData.append('outline_text', outlineText.trim());
      if (existingFilePath) {
        formData.append('file_path', existingFilePath);
      }
      if (file) {
        formData.append('outline', file);
      }

      await api.post('/outlines', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setSuccess('ส่งโครงร่างรายงานให้พี่เลี้ยงตรวจสอบเรียบร้อยแล้ว');
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ไม่มีร่างให้ลบ */
      }
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  // Step calculations
  // Steps:
  // 1: pending_mentor (Step 1 active) -> if passed (pending_advisor or approved): step 1 done
  // 2: pending_advisor (Step 2 active) -> if passed (approved): step 2 done
  // 3: approved (Step 3 done)
  const currentStatus = data?.status || 'draft';
  const isMentorApproved = currentStatus === 'pending_advisor' || currentStatus === 'approved';
  const isAdvisorApproved = currentStatus === 'approved';
  const isRejected = currentStatus === 'rejected';

  const advisorFullName = data?.meta?.advisor_first_name
    ? `อาจารย์ ${data.meta.advisor_first_name} ${data.meta.advisor_last_name || ''}`
    : 'อาจารย์นิเทศ';
  const mentorFullName = data?.meta?.mentor_name ? `คุณ${data.meta.mentor_name}` : 'พี่เลี้ยง';

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-16 flex justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* 1. Header Card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            โครงร่างรายงาน (สหกิจ 11)
          </h1>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            เลือกหัวข้อรายงานร่วมกับพี่เลี้ยงก่อน แล้วให้อาจารย์นิเทศเห็นชอบ จึงเริ่มเขียนรายงานฉบับจริงได้
          </p>
        </div>
        <div className="shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border ${
              deadlineInfo.isLate
                ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            {deadlineInfo.text}
          </span>
        </div>
      </div>

      {/* 2. Three Steps Indicator */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm space-y-4">
        <span className="text-base font-bold text-gray-900 dark:text-white block">
          โครงร่างต้องผ่าน 2 คน
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Step 1: Mentor */}
          <div
            data-testid="outline-step-mentor"
            className={`p-4 rounded-xl border flex items-start gap-3 transition ${
              isMentorApproved
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30'
                : currentStatus === 'pending_mentor'
                ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/30'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                isMentorApproved
                  ? 'bg-emerald-500 text-white'
                  : currentStatus === 'pending_mentor'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {isMentorApproved ? <CheckCircle2 className="w-4 h-4" /> : '1'}
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-bold text-gray-900 dark:text-white block text-sm">
                พี่เลี้ยงเห็นชอบหัวข้อ
              </span>
              <span className="text-gray-600 dark:text-gray-400 block font-medium">
                {mentorFullName}
              </span>
              <span className="text-gray-600 dark:text-gray-400 block">
                {isMentorApproved
                  ? 'เห็นชอบแล้ว'
                  : currentStatus === 'pending_mentor'
                  ? 'รอพี่เลี้ยงตรวจสอบ'
                  : 'ยังไม่ได้ส่ง'}
              </span>
            </div>
          </div>

          {/* Step 2: Advisor */}
          <div
            data-testid="outline-step-advisor"
            className={`p-4 rounded-xl border flex items-start gap-3 transition ${
              isAdvisorApproved
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30'
                : currentStatus === 'pending_advisor'
                ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/30'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                isAdvisorApproved
                  ? 'bg-emerald-500 text-white'
                  : currentStatus === 'pending_advisor'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {isAdvisorApproved ? <CheckCircle2 className="w-4 h-4" /> : '2'}
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-bold text-gray-900 dark:text-white block text-sm">
                อาจารย์นิเทศลงนามเห็นชอบ
              </span>
              <span className="text-gray-600 dark:text-gray-400 block font-medium">
                {advisorFullName}
              </span>
              <span className="text-gray-600 dark:text-gray-400 block">
                {isAdvisorApproved
                  ? 'ลงนามเห็นชอบแล้ว'
                  : currentStatus === 'pending_advisor'
                  ? 'รออาจารย์นิเทศลงนาม'
                  : 'รอพี่เลี้ยงเห็นชอบก่อน'}
              </span>
            </div>
          </div>

          {/* Step 3: Final Stage */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 transition ${
              isAdvisorApproved
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                isAdvisorApproved
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {isAdvisorApproved ? <CheckCircle2 className="w-4 h-4" /> : '3'}
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-bold text-gray-900 dark:text-white block text-sm">
                เริ่มเขียนรายงานฉบับจริง
              </span>
              <span className="text-gray-500 dark:text-gray-400 block">
                {isAdvisorApproved ? 'อนุมัติเรียบร้อย เริ่มเขียนรายงานได้' : 'รอการเห็นชอบครบทั้ง 2 ท่าน'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Main Form Card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
        <AlertBanner variant="error" message={error} scrollOnShow />
        <AlertBanner variant="success" message={success} scrollOnShow />

        {/* Calendar Gate */}
        <CalendarGate activityKey="report_outline" actionLabel="ส่งโครงร่างรายงาน" className="mb-2" />

        {/* Rejection Banner if rejected */}
        {isRejected && (
          <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 text-sm space-y-1">
            <span className="font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              โครงร่างรายงานถูกส่งกลับมาแก้ไข:
            </span>
            <p className="leading-relaxed pl-5.5 text-rose-800 dark:text-rose-200">
              {data?.versions?.[0]?.rejection_comment || 'กรุณาแก้ไขเนื้อหาและส่งเวอร์ชันใหม่เพื่อรับการพิจารณาอีกครั้ง'}
            </p>
          </div>
        )}

        {/* Fields */}
        <div className="space-y-5">
          {/* Report Title */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-900 dark:text-white">
              หัวข้อรายงาน <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400 block">
              ต้องหารือกับพี่เลี้ยงก่อนว่าหัวข้อนี้ทำได้จริงและไม่ติดข้อมูลลับของสถานประกอบการ
            </span>
            <input
              type="text"
              data-testid="outline-title"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="เช่น การพัฒนาระบบรายงานยอดผลิตรายวันเพื่อลดเวลาการสรุปข้อมูลของฝ่ายวางแผน"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-blue-500 transition"
            />
          </div>

          {/* Outline Text */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-900 dark:text-white">
              โครงร่างเนื้อหาพอสังเขป <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400 block">
              เขียนเป็นหัวข้อย่อยว่ารายงานจะมีบทอะไรบ้าง แต่ละบทเล่าเรื่องอะไร — ไม่ต้องยาว อาจารย์ดูว่าขอบเขตพอเหมาะไหม
            </span>
            <textarea
              data-testid="outline-text"
              rows={7}
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              placeholder={`บทที่ 1 บทนำ — ที่มาของปัญหา และวัตถุประสงค์
บทที่ 2 ข้อมูลสถานประกอบการและงานที่ได้รับมอบหมาย
บทที่ 3 เครื่องมือและวิธีดำเนินงาน — การออกแบบระบบและการพัฒนา
บทที่ 4 ผลการดำเนินงานและการทดสอบระบบ
บทที่ 5 สรุปผล ปัญหา อุปสรรค และข้อเสนอแนะ`}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-blue-500 transition font-mono leading-relaxed"
            />
          </div>

          {/* File Attachment (Optional) */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900 dark:text-white">
              ไฟล์แนบ (ถ้ามี)
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400 block">
              ถ้าสาขาหรือสถานประกอบการให้ใช้แบบฟอร์มโครงร่างของเขาเอง แนบไฟล์นั้นมาได้ — สองช่องข้างบนยังต้องกรอกเพราะอาจารย์ใช้ค้นและอ้างอิงในระบบ
            </span>

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-5 bg-gray-50/50 dark:bg-gray-900/20 text-center space-y-1.5 relative">
              <input
                type="file"
                data-testid="outline-file-input"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <UploadCloud className="w-7 h-7 text-gray-400 mx-auto" />
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
                ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์ (PDF หรือ Word ไม่เกิน 10 MB)
              </span>
            </div>

            {(file || existingFilePath) && (
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                  <span className="truncate font-medium text-gray-800 dark:text-gray-200">
                    {file ? file.name : existingFilePath?.split('/').pop()}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {existingFilePath && (
                    <a
                      href={`/api/files/${existingFilePath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> เปิดดู
                    </a>
                  )}
                  {file && (
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-300 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> ลบ
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data?.versions && data.versions.length > 0
              ? 'การกดส่งใหม่จะนับเป็นเวอร์ชันถัดไป และเริ่มรอบการตรวจใหม่จากพี่เลี้ยง'
              : 'บันทึกร่างเก็บไว้ในเครื่องนี้ พี่เลี้ยงยังไม่เห็นจนกว่าจะกดส่งตรวจ'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              data-testid="outline-save-draft"
              disabled={submitting}
              onClick={() => handleSubmit(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 transition"
            >
              <Save className="w-4 h-4" />
              บันทึกร่าง
            </button>
            <button
              type="button"
              data-testid="outline-submit"
              disabled={submitting || isMentorApproved || calendarStatus === 'upcoming' || calendarStatus === 'closed'}
              title={isMentorApproved ? 'พี่เลี้ยงเห็นชอบแล้ว ส่งทับไม่ได้จนกว่าอาจารย์จะส่งกลับให้แก้' : undefined}
              onClick={() => handleSubmit(false)}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition shadow-sm ${
                submitting || isMentorApproved || calendarStatus === 'upcoming' || calendarStatus === 'closed'
                  ? 'bg-blue-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
              }`}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {data?.versions && data.versions.length > 0 ? 'ส่งเวอร์ชันใหม่ให้ตรวจ' : 'ส่งให้พี่เลี้ยงตรวจสอบ'}
            </button>
          </div>
        </div>
      </div>

      {/* 4. Versions History Card */}
      {data?.versions && data.versions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">
            ประวัติการส่งและผลตรวจ ({data.versions.length} เวอร์ชัน)
          </h2>

          <div className="space-y-6">
            {data.versions.map((ver, idx) => {
              const vNum = data.versions.length - idx;
              const isVerApproved = ver.status === 'approved';
              const isVerRejected = ver.status === 'rejected';

              let dotColor = 'bg-blue-600';
              if (isVerApproved) dotColor = 'bg-emerald-500';
              if (isVerRejected) dotColor = 'bg-rose-600';

              return (
                <div
                  key={ver.version_id}
                  data-testid={`outline-version-${vNum}`}
                  className="flex gap-4 items-start"
                >
                  <div className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        เวอร์ชันที่ {vNum} · ส่งเมื่อ {formatThaiDate(ver.submitted_at)}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                          isVerApproved
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : isVerRejected
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                        }`}
                      >
                        {isVerApproved
                          ? 'อนุมัติแล้ว'
                          : isVerRejected
                          ? 'ถูกส่งกลับมาแก้'
                          : 'รอตรวจ'}
                      </span>
                    </div>

                    {ver.report_title && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                        หัวข้อ: {ver.report_title}
                      </p>
                    )}

                    {ver.rejection_comment && (
                      <div
                        data-testid="outline-rejection-comment"
                        className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 text-xs leading-relaxed"
                      >
                        <span className="font-bold block mb-1">
                          {ver.reviewer_first_name
                            ? `อาจารย์ ${ver.reviewer_first_name} ${ver.reviewer_last_name || ''}:`
                            : ver.reviewer_mentor_name
                            ? `คุณ${ver.reviewer_mentor_name}:`
                            : 'ผู้ตรวจ:'}
                        </span>
                        <p className="whitespace-pre-wrap">{ver.rejection_comment}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="ส่งโครงร่างให้พี่เลี้ยงตรวจ"
        confirmLabel="ส่งให้พี่เลี้ยงตรวจ"
        cancelLabel="กลับไปแก้"
        confirmTestId="outline-confirm"
        cancelTestId="outline-confirm-cancel"
        busy={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submitOutline}
        message={
          <ConfirmSummary
            lead={`ส่งถึง ${mentorFullName} · เป็นเวอร์ชันที่ ${(data?.versions?.length ?? 0) + 1}`}
            rows={[
              { label: 'หัวข้อรายงาน', value: reportTitle.trim() },
              {
                label: 'โครงร่าง',
                value: outlineText.trim()
                  ? outlineText.trim().split('\n').slice(0, 2).join(' / ') + (outlineText.trim().split('\n').length > 2 ? ' …' : '')
                  : '',
              },
              { label: 'ไฟล์แนบ', value: file ? file.name : existingFilePath ? existingFilePath.split('/').pop() : 'ไม่มี' },
            ]}
            lockNote="ส่งฉบับใหม่ทับได้จนกว่าพี่เลี้ยงจะเห็นชอบ · เห็นชอบแล้วแก้ไม่ได้ จนกว่าอาจารย์จะส่งกลับให้แก้"
          />
        }
      />
    </div>
  );
};

export default ReportOutline;
