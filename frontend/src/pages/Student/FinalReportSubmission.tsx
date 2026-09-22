import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Printer,
  ChevronRight,
  Send,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { CalendarGate, useCalendarGate } from '../../components/ui/CalendarGate';
import { getErrorMessage } from '../../utils/errors';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';

interface ReportItem {
  report_id: number;
  file_path: string;
  status: 'submitted' | 'approved' | 'rejected';
  rejection_comment: string | null;
  reviewer_comment: string | null;
  version: number;
  reviewer_kind: 'mentor' | 'advisor';
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_email: string | null;
  advisor_first_name?: string | null;
  advisor_last_name?: string | null;
  mentor_reviewer_name?: string | null;
}

interface IntentMeta {
  start_date: string | null;
  end_date: string | null;
  company_name: string | null;
  mentor_name: string | null;
}

interface ConfirmationData {
  confirmation_id: number;
  report_id: number;
  status: 'pending' | 'certified';
  requested_at: string | null;
  certified_at: string | null;
  certified_by_first_name?: string | null;
  certified_by_last_name?: string | null;
}

interface FinalReportData {
  intent: IntentMeta | null;
  outline_approved: boolean;
  deadline_mentor_draft: string | null;
  mentor_drafts: ReportItem[];
  advisor_reports: ReportItem[];
  confirmation: ConfirmationData | null;
}

const formatThaiDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const FinalReportSubmission: React.FC = () => {
  const auth = useContext(AuthContext);

  const [data, setData] = useState<FinalReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploadingStep1, setUploadingStep1] = useState<boolean>(false);
  const [uploadingStep2, setUploadingStep2] = useState<boolean>(false);
  const [requestingConfirm, setRequestingConfirm] = useState<boolean>(false);
  // ⛔ เลือกไฟล์แล้วยังไม่ส่ง — ต้องผ่านกล่องยืนยันก่อน (เดิมเลือกไฟล์ = ส่งทันที · ส่งแล้วถอนไม่ได้
  //    ทุกครั้งนับเป็นฉบับใหม่ที่ผู้ตรวจเห็นในประวัติ) · เจ้าของตัดสิน 2026-09-21
  const [pendingUpload, setPendingUpload] = useState<{ kind: 'mentor' | 'advisor'; file: File } | null>(null);
  const [confirmingRequest, setConfirmingRequest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [examDate, setExamDate] = useState<string | null>(null);

  const step1InputRef = useRef<HTMLInputElement>(null);
  const step2InputRef = useRef<HTMLInputElement>(null);

  const { status: calendarStatus } = useCalendarGate('final_report');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      if (!auth?.user) return;
      try {
        setLoading(true);
        setError(null);

        const [reportRes, calRes] = await Promise.allSettled([
          api.get('/final-reports/my-report'),
          api.get('/calendar'),
        ]);

        if (!active) return;

        if (reportRes.status === 'fulfilled') {
          const resData = (reportRes.value as { data?: FinalReportData })?.data || null;
          setData(resData);
        } else {
          setError(getErrorMessage(reportRes.reason, 'ไม่สามารถโหลดข้อมูลรายงานได้'));
        }

        if (calRes.status === 'fulfilled') {
          const calData = calRes.value as { activities?: { activity_key: string; start_date?: string; end_date?: string }[] };
          const examAct = calData?.activities?.find((a) => a.activity_key === 'coop_exam');
          if (examAct?.end_date || examAct?.start_date) {
            setExamDate(examAct.end_date || examAct.start_date || null);
          }
        }
      } catch (err) {
        if (!active) return;
        setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดข้อมูล'));
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [auth?.user, refreshTrigger]);

  /** ตรวจไฟล์แบบเดียวกันทั้งสองขั้น — ผ่านแล้วเปิดกล่องยืนยัน ยังไม่ส่ง */
  const checkPdf = (file: File): boolean => {
    if (file.type !== 'application/pdf') {
      setError('กรุณาอัปโหลดไฟล์ PDF เท่านั้น');
      return false;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('ขนาดไฟล์ต้องไม่เกิน 20MB');
      return false;
    }
    return true;
  };

  // Handle Step 1 (draft to mentor) — เลือกไฟล์แล้วเปิดกล่องยืนยัน
  const handleUploadStep1 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!checkPdf(file)) return;
    setError(null);
    setPendingUpload({ kind: 'mentor', file });
  };

  // Handle Step 2 (final report to advisor) — เลือกไฟล์แล้วเปิดกล่องยืนยัน
  const handleUploadStep2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (calendarStatus === 'upcoming' || calendarStatus === 'closed') {
      setError('ไม่อยู่ในช่วงเวลาที่เปิดให้ส่งรายงานฉบับสมบูรณ์ตามปฏิทินสหกิจศึกษา');
      return;
    }

    if (!data?.outline_approved) {
      setError('โครงร่างรายงาน (สหกิจ 11) ต้องได้รับการอนุมัติจากอาจารย์ที่ปรึกษาก่อน');
      return;
    }

    if (!checkPdf(file)) return;
    setError(null);
    setPendingUpload({ kind: 'advisor', file });
  };

  /** ยกเลิกในกล่องยืนยัน — ล้างไฟล์ที่เลือกไว้ ให้เลือกไฟล์เดิมซ้ำได้ */
  const cancelUpload = () => {
    setPendingUpload(null);
    if (step1InputRef.current) step1InputRef.current.value = '';
    if (step2InputRef.current) step2InputRef.current.value = '';
  };

  const submitUpload = async () => {
    if (!pendingUpload) return;
    const { kind, file } = pendingUpload;
    const setBusy = kind === 'mentor' ? setUploadingStep1 : setUploadingStep2;
    try {
      setBusy(true);
      setError(null);
      setSuccess(null);

      const formData = new FormData();
      formData.append('report', file);
      formData.append('reviewer_kind', kind);

      const res = await api.post('/final-reports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const fallback = kind === 'mentor' ? 'ส่งร่างรายงานให้พี่เลี้ยงตรวจเรียบร้อยแล้ว' : 'ส่งเล่มรายงานฉบับสมบูรณ์เรียบร้อยแล้ว';
      setSuccess((res as { message?: string })?.message || fallback);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(
        getErrorMessage(err, kind === 'mentor' ? 'เกิดข้อผิดพลาดในการส่งร่างรายงาน' : 'เกิดข้อผิดพลาดในการส่งรายงานฉบับสมบูรณ์')
      );
    } finally {
      setBusy(false);
      cancelUpload();
    }
  };

  // Handle Step 3 request confirmation (สหกิจ 14)
  const handleRequestConfirmation = async () => {
    setConfirmingRequest(false);
    try {
      setRequestingConfirm(true);
      setError(null);
      setSuccess(null);

      const res = await api.post('/report-confirmations');
      const msg = (res as { message?: string })?.message || 'ยื่นคำขอให้อาจารย์ที่ปรึกษารับรองเรียบร้อยแล้ว';
      setSuccess(msg);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถยื่นขอการรับรองได้'));
    } finally {
      setRequestingConfirm(false);
    }
  };

  // State derivation
  const latestMentorDraft = data?.mentor_drafts?.[0] || null;
  const isMentorApproved = latestMentorDraft?.status === 'approved';
  const isMentorPending = latestMentorDraft?.status === 'submitted';
  const isMentorRejected = latestMentorDraft?.status === 'rejected';

  const latestAdvisorReport = data?.advisor_reports?.[0] || null;
  const isAdvisorApproved = latestAdvisorReport?.status === 'approved';
  const isAdvisorPending = latestAdvisorReport?.status === 'submitted';
  const isAdvisorRejected = latestAdvisorReport?.status === 'rejected';

  const confirmation = data?.confirmation || null;
  const isConfirmed = confirmation?.status === 'certified';
  const isConfirmPending = confirmation?.status === 'pending';

  // Deadline calculation for step 1
  const step1Deadline = data?.deadline_mentor_draft || null;
  const isStep1Late = (() => {
    if (!step1Deadline) return false;
    const dl = new Date(step1Deadline);
    const now = new Date();
    return now.getTime() > dl.getTime();
  })();

  const daysLateStep1 = (() => {
    if (!step1Deadline || !isStep1Late) return 0;
    const dl = new Date(step1Deadline);
    const now = new Date();
    return Math.floor((now.getTime() - dl.getTime()) / (1000 * 60 * 60 * 24));
  })();

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-10 space-y-6">
        <div className="animate-pulse bg-white dark:bg-gray-800 rounded-2xl p-6 h-28" />
        <div className="animate-pulse bg-white dark:bg-gray-800 rounded-2xl p-6 h-48" />
        <div className="animate-pulse bg-white dark:bg-gray-800 rounded-2xl p-6 h-64" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* 1. Header Card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          รายงานฉบับสมบูรณ์
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          การส่งรายงานมี 3 ขั้นตามคู่มือ และต้องทำตามลำดับ — ขั้นสุดท้ายคือใบแจ้งยืนยันการส่งรายงาน (สหกิจ 14) ที่อาจารย์ที่ปรึกษาต้องลงนาม
        </p>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {success && <AlertBanner variant="success" message={success} />}

      {/* 2. Step 1: Draft to Mentor */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-5">
        <div className="flex items-start gap-4">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              isMentorApproved
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border border-green-300 dark:border-green-700'
                : latestMentorDraft
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {isMentorApproved ? <CheckCircle2 className="w-5 h-5" /> : '1'}
          </div>

          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                ขั้นที่ 1 · ส่งร่างรายงานให้พี่เลี้ยงตรวจ
              </h2>
              <span
                data-testid="finalreport-step1-status"
                className={`px-3 py-1 rounded-full text-xs font-bold border ${
                  isMentorApproved
                    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800'
                    : isMentorPending
                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                    : isMentorRejected
                    ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
                    : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:border-gray-700'
                }`}
              >
                {isMentorApproved
                  ? `พี่เลี้ยงตรวจแล้ว · ${formatThaiDate(latestMentorDraft?.reviewed_at)}`
                  : isMentorPending
                  ? 'รอพี่เลี้ยงตรวจ'
                  : isMentorRejected
                  ? 'ส่งกลับมาแก้'
                  : 'ยังไม่ได้ส่งร่าง'}
              </span>
            </div>

            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              คู่มือกำหนดว่าต้องส่งให้พี่เลี้ยงตรวจ{' '}
              <strong className="text-gray-900 dark:text-white">
                อย่างน้อย 2 สัปดาห์ก่อนวันสุดท้ายของการปฏิบัติงาน
              </strong>{' '}
              เพื่อให้มีเวลาแก้ — สำหรับคุณคือภายใน{' '}
              <span className="font-semibold text-gray-900 dark:text-gray-200">
                {step1Deadline ? formatThaiDate(step1Deadline) : 'สัปดาห์ที่ 14'}
              </span>
              {isStep1Late && !isMentorApproved && (
                <span className="ml-2 text-red-600 dark:text-red-400 font-semibold">
                  (เลยกำหนดมาแล้ว {daysLateStep1} วัน)
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Step 1 content & actions */}
        <div className="ml-12 space-y-4">
          {latestMentorDraft && (
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-gray-500 shrink-0" />
                <div>
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {latestMentorDraft.file_path.split('/').pop()} (เวอร์ชัน {latestMentorDraft.version})
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    ส่งเมื่อ {formatThaiDate(latestMentorDraft.submitted_at)}
                  </p>
                </div>
              </div>

              {latestMentorDraft.reviewer_comment && (
                <div
                  data-testid="finalreport-mentor-comment"
                  className="text-xs md:text-sm text-gray-700 dark:text-gray-300 italic bg-white dark:bg-gray-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  พี่เลี้ยงบันทึกไว้ว่า: &ldquo;{latestMentorDraft.reviewer_comment}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* Upload Button */}
          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={step1InputRef}
              data-testid="finalreport-step1-upload"
              accept=".pdf"
              className="hidden"
              onChange={handleUploadStep1}
              disabled={uploadingStep1}
            />
            <button
              type="button"
              onClick={() => step1InputRef.current?.click()}
              disabled={uploadingStep1}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 transition shadow-sm disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploadingStep1
                ? 'กำลังอัปโหลด...'
                : latestMentorDraft
                ? 'ส่งร่างฉบับแก้ไขให้พี่เลี้ยงใหม่'
                : 'ส่งร่างรายงานให้พี่เลี้ยงตรวจ'}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              PDF เท่านั้น ไม่เกิน 20 MB
            </span>
          </div>
        </div>
      </div>

      {/* 3. Step 2: Final Report to Advisor */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-5">
        <div className="flex items-start gap-4">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              isAdvisorApproved
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border border-green-300 dark:border-green-700'
                : isMentorApproved
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {isAdvisorApproved ? <CheckCircle2 className="w-5 h-5" /> : '2'}
          </div>

          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                ขั้นที่ 2 · ส่งรายงานฉบับสมบูรณ์เข้าระบบ
              </h2>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border ${
                  isAdvisorApproved
                    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800'
                    : isAdvisorPending
                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                    : isAdvisorRejected
                    ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
                    : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:border-gray-700'
                }`}
              >
                {isAdvisorApproved
                  ? `อาจารย์ที่ปรึกษาอนุมัติแล้ว · ${formatThaiDate(latestAdvisorReport?.reviewed_at)}`
                  : isAdvisorPending
                  ? 'รออาจารย์ที่ปรึกษาตรวจ'
                  : isAdvisorRejected
                  ? 'ส่งกลับมาแก้'
                  : 'ยังไม่ได้ส่งรายงาน'}
              </span>
            </div>

            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              ไฟล์ PDF ไม่เกิน 20 MB · ส่งใหม่ได้เรื่อยๆ ระบบเก็บเป็นเวอร์ชัน ไม่ทับของเดิม
            </p>
          </div>
        </div>

        <div className="ml-12 space-y-5">
          {/* Calendar Gate */}
          <CalendarGate activityKey="final_report" actionLabel="ส่งรายงานฉบับสมบูรณ์" />

          {/* Condition: Report outline must be approved */}
          {!data?.outline_approved ? (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-semibold">
                  โครงร่างรายงาน (สหกิจ 11) ต้องได้รับการอนุมัติจากอาจารย์ที่ปรึกษาก่อน
                </p>
                <p>
                  โปรดตรวจสอบความคืบหน้าของโครงร่างรายงาน หรือปรับปรุงเนื้อหาให้เรียบร้อย
                </p>
                <a
                  href="/dashboard?menu=report_outline"
                  className="inline-flex items-center gap-1 font-bold text-blue-600 dark:text-blue-400 hover:underline pt-1"
                >
                  ไปที่หน้าโครงร่างรายงาน
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          ) : (
            <>
              {/* Upload Dropzone */}
              <div
                onClick={() => step2InputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl p-8 bg-gray-50/60 dark:bg-gray-800/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition text-center"
              >
                <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {uploadingStep2
                    ? 'กำลังอัปโหลดรายงาน...'
                    : 'ลากไฟล์รายงานมาวาง หรือคลิกเพื่อเลือกไฟล์จากเครื่อง'}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  PDF เท่านั้น ไม่เกิน 20 MB
                </span>
                <input
                  type="file"
                  ref={step2InputRef}
                  data-testid="finalreport-upload"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleUploadStep2}
                  disabled={uploadingStep2}
                />
              </div>

              {/* Version history */}
              {data?.advisor_reports && data.advisor_reports.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    ประวัติการส่งรายงานฉบับสมบูรณ์
                  </h3>

                  <div className="space-y-2.5">
                    {data.advisor_reports.map((ver) => (
                      <div
                        key={ver.report_id}
                        data-testid={`finalreport-version-${ver.version}`}
                        className={`p-4 rounded-xl border ${
                          ver.status === 'rejected'
                            ? 'border-red-200 dark:border-red-800/70 bg-red-50/50 dark:bg-red-950/20'
                            : ver.status === 'approved'
                            ? 'border-green-200 dark:border-green-800/70 bg-green-50/40 dark:bg-green-950/20'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                        } space-y-2`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold shrink-0">
                              {ver.version}
                            </span>
                            <div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {ver.file_path.split('/').pop()}
                              </span>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                ส่งเมื่อ {formatThaiDate(ver.submitted_at)}
                              </p>
                            </div>
                          </div>

                          <span
                            className={`px-3 py-0.5 rounded-full text-xs font-bold border ${
                              ver.status === 'approved'
                                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300'
                                : ver.status === 'rejected'
                                ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300'
                                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}
                          >
                            {ver.status === 'approved'
                              ? 'อนุมัติ'
                              : ver.status === 'rejected'
                              ? 'ส่งกลับมาแก้'
                              : 'รอตรวจ'}
                          </span>
                        </div>

                        {/* Rejection comment */}
                        {ver.status === 'rejected' && ver.rejection_comment && (
                          <div
                            data-testid="finalreport-rejection-comment"
                            className="ml-10 p-3 rounded-lg bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/50 text-xs md:text-sm text-red-800 dark:text-red-300 leading-relaxed"
                          >
                            <span className="font-semibold">
                              {ver.advisor_first_name
                                ? `อาจารย์${ver.advisor_first_name} ${ver.advisor_last_name || ''}: `
                                : 'อาจารย์ที่ปรึกษา: '}
                            </span>
                            {ver.rejection_comment}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 4. Step 3: Report Confirmation (สหกิจ 14) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-5">
        <div className="flex items-start gap-4">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              isConfirmed
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border border-green-300 dark:border-green-700'
                : isAdvisorApproved
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {isConfirmed ? <CheckCircle2 className="w-5 h-5" /> : '3'}
          </div>

          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                ขั้นที่ 3 · ใบแจ้งยืนยันการส่งรายงาน (สหกิจ 14)
              </h2>
              <span
                data-testid="finalreport-confirm-status"
                className={`px-3 py-1 rounded-full text-xs font-bold border ${
                  isConfirmed
                    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800'
                    : isConfirmPending
                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                    : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:border-gray-700'
                }`}
              >
                {isConfirmed
                  ? `ได้รับการรับรองแล้ว · ${formatThaiDate(confirmation?.certified_at)}`
                  : isConfirmPending
                  ? 'รออาจารย์ที่ปรึกษารับรอง'
                  : 'ยังทำไม่ได้'}
              </span>
            </div>

            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              เปิดให้ทำเมื่ออาจารย์ที่ปรึกษาอนุมัติรายงานในขั้นที่ 2 แล้ว · ต้องทำ
              <strong className="text-gray-900 dark:text-white">
                ก่อนวันนำเสนอผลงาน
              </strong>
              {examDate && (
                <span className="ml-1 text-gray-800 dark:text-gray-200">
                  (วันสอบสหกิจศึกษา {formatThaiDate(examDate)})
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="ml-12 space-y-4">
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 text-xs md:text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            ใบนี้เป็นหลักฐานว่าส่งรายงานครบแล้ว ระบบเติมข้อมูลให้เองทั้งใบ (ชื่อ · รหัส · สถานประกอบการ · ชื่อรายงาน · วันที่ส่ง) นักศึกษาไม่ต้องกรอกอะไร — กดขอให้อาจารย์รับรอง แล้วพิมพ์ไปส่งงานสหกิจศึกษาประจำคณะ
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="finalreport-confirm-request"
              onClick={() => setConfirmingRequest(true)}
              disabled={!isAdvisorApproved || isConfirmed || isConfirmPending || requestingConfirm}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition ${
                !isAdvisorApproved || isConfirmed || isConfirmPending
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
              }`}
            >
              <Send className="w-4 h-4" />
              {requestingConfirm
                ? 'กำลังยื่นคำขอ...'
                : isConfirmed
                ? 'อาจารย์รับรองแล้ว'
                : isConfirmPending
                ? 'ยื่นคำขอแล้ว (รออาจารย์รับรอง)'
                : 'ขอให้อาจารย์ที่ปรึกษารับรอง'}
            </button>

            {confirmation && (
              <a
                data-testid="finalreport-confirm-print"
                href="/api/report-confirmations/print"
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold flex items-center gap-2 transition shadow-sm"
              >
                <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                พิมพ์ใบยืนยัน (สหกิจ 14)
              </a>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingUpload}
        title={pendingUpload?.kind === 'mentor' ? 'ส่งร่างรายงานให้พี่เลี้ยง' : 'ส่งเล่มรายงานให้อาจารย์ที่ปรึกษา'}
        confirmLabel={pendingUpload?.kind === 'mentor' ? 'ส่งร่างให้พี่เลี้ยง' : 'ส่งเล่มให้อาจารย์'}
        cancelLabel="กลับไปเลือกไฟล์"
        confirmTestId="finalreport-upload-confirm"
        cancelTestId="finalreport-upload-cancel"
        busy={uploadingStep1 || uploadingStep2}
        onCancel={cancelUpload}
        onConfirm={submitUpload}
        message={
          pendingUpload && (
            <ConfirmSummary
              lead={
                pendingUpload.kind === 'mentor'
                  ? `ส่งถึง ${data?.intent?.mentor_name ? `คุณ${data.intent.mentor_name}` : 'พี่เลี้ยง'} เพื่อตรวจร่าง`
                  : 'ส่งถึงอาจารย์ที่ปรึกษาเพื่อตรวจเล่มสมบูรณ์'
              }
              rows={[
                { label: 'ไฟล์', value: pendingUpload.file.name },
                { label: 'ขนาด', value: `${(pendingUpload.file.size / (1024 * 1024)).toFixed(1)} MB` },
                {
                  label: 'ส่งเป็นฉบับที่',
                  value: String(
                    ((pendingUpload.kind === 'mentor' ? data?.mentor_drafts : data?.advisor_reports)?.length ?? 0) + 1
                  ),
                },
              ]}
              lockNote="ส่งแล้วถอนไม่ได้ — ถ้าไฟล์ผิดต้องส่งฉบับใหม่ และฉบับนี้ยังอยู่ในประวัติที่ผู้ตรวจเห็น"
            />
          )
        }
      />

      <ConfirmDialog
        open={confirmingRequest}
        title="ขอใบรับรองการส่งรายงาน (สหกิจ 14)"
        confirmLabel="ยื่นขอรับรอง"
        cancelLabel="ยกเลิก"
        confirmTestId="finalreport-request-confirm"
        cancelTestId="finalreport-request-cancel"
        busy={requestingConfirm}
        onCancel={() => setConfirmingRequest(false)}
        onConfirm={handleRequestConfirmation}
        message={
          <ConfirmSummary
            lead="อาจารย์ที่ปรึกษาจะรับรองว่าเล่มฉบับนี้คือฉบับที่ส่งจริง"
            rows={[
              { label: 'เล่มฉบับที่', value: latestAdvisorReport ? String(latestAdvisorReport.version) : '—' },
              { label: 'ไฟล์', value: latestAdvisorReport?.file_path?.split('/').pop() ?? '—' },
            ]}
            lockNote="ยื่นได้ครั้งเดียว — ตรวจว่าเป็นเล่มฉบับสุดท้ายที่อาจารย์อนุมัติแล้ว"
          />
        }
      />
    </div>
  );
};

export default FinalReportSubmission;
