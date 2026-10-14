import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { Search, Check, AlertTriangle, RefreshCw, Download, Mail, Lock } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';

/**
 * E8 · ติดตามเอกสารนักศึกษา (StudentDocProgress.dc.html)
 *
 * กฎเหล็กของหน้านี้:
 * - คอลัมน์ประเมินท้ายตารางต้องเขียนว่า "ครบทั้ง 2 ใบ" หรือ "มีแค่ 15" หรือ "–"
 *   **ห้ามเขียนว่า "ผ่าน" เด็ดขาด** เพราะอาจารย์เป็นผู้ตัดเกรด ระบบรู้แค่ว่ามีใบประเมินส่งเข้ามาแล้วหรือยัง
 * - การ์ดอธิบายสองใบด้านล่าง: ทำไมไม่เขียนว่าผ่าน + นาฬิกา 90 วันลบข้อมูลอ่อนไหวอัตโนมัติ
 */

interface StudentProgress {
  studentId: number;
  studentCode: string;
  studentName: string;
  majorName: string;
  majorCode: string;
  advisorName: string;
  companyName: string;
  progressPercent: number;
  progressDetails: {
    intentApproved: boolean;
    accommodationSubmitted: boolean;
    outlineApproved: boolean;
    supervisionCompleted: boolean;
    finalReportSubmitted: boolean;
    evaluation15Submitted: boolean;
    evaluation16Submitted: boolean;
  };
  finalReportStatus: string;
  finalReportPath: string | null;
  sahatkit15Score: number | null;
  sahatkit16Score: number | null;
  lastNotifiedAt: string | null;
  /** มีพี่เลี้ยงที่อาจารย์นิเทศยืนยันแล้ว — ไม่มี = เซิร์ฟเวอร์ไม่ส่งอีเมลเตือนให้ */
  mentorReady: boolean;
  weeklyLogsSent: number;
  monthlyLogsSent: number;
  placement?: {
    form_id: number;
    status: 'accepted' | 'superseded';
    closed_kind: 'sent_back' | 'change_company' | null;
    can_reopen: boolean;
  } | null;
}

export const FinalProgressDashboard: React.FC = () => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [selectedMajor, setSelectedMajor] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  // โหลดรายชื่อไม่สำเร็จ — ต้องไม่แสดง "(0)" หรือ "ไม่พบข้อมูล" คู่กับแถบ error เพราะไม่ได้แปลว่าไม่มีนักศึกษา
  const [loadFailed, setLoadFailed] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [notifyingMap, setNotifyingMap] = useState<Record<number, boolean>>({});
  const [notifyTarget, setNotifyTarget] = useState<StudentProgress | null>(null);
  const [batchNotifyOpen, setBatchNotifyOpen] = useState(false);
  const [batchNotifying, setBatchNotifying] = useState(false);

  // ปิดใบที่ฝึกงาน (accepted → superseded)
  const [closeTarget, setCloseTarget] = useState<StudentProgress | null>(null);
  const [closeKind, setCloseKind] = useState<'sent_back' | 'change_company' | ''>('');
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // ยกเลิกการปิดใบ (superseded → accepted)
  const [reopenTarget, setReopenTarget] = useState<StudentProgress | null>(null);
  const [reopening, setReopening] = useState(false);

  // Store mount timestamp to avoid impure Date.now() during render
  const [now] = useState(() => Date.now());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/coop-progress/dashboard');
      setStudents(res.data || []);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลความคืบหน้าได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleNotifyMentor = async () => {
    const student = notifyTarget;
    if (!student) return;
    try {
      setNotifyingMap((prev) => ({ ...prev, [student.studentId]: true }));
      setError(null);
      setSuccess(null);

      await api.post(`/final-reports/notify-mentor/${student.studentId}`);

      setNotifyTarget(null);
      setSuccess(`ส่งอีเมลแจ้งเตือนหาพี่เลี้ยงของ ${student.studentName} สำเร็จ`);
      await loadData();
    } catch (err) {
      setNotifyTarget(null);
      setError(getErrorMessage(err, 'ล้มเหลวในการส่งแจ้งเตือนเนื่องจากเงื่อนไข Cooldown'));
    } finally {
      setNotifyingMap((prev) => ({ ...prev, [student.studentId]: false }));
    }
  };

  const handleBatchNotify = async () => {
    try {
      setBatchNotifying(true);
      setError(null);
      setSuccess(null);
      // Notify students/mentors who have pending evaluations or reports
      const pendingStudents = students.filter(
        (s) => !s.progressDetails.evaluation15Submitted || !s.progressDetails.evaluation16Submitted
      );
      // ข้ามคนที่ยังไม่มีพี่เลี้ยงที่ยืนยันแล้วและคนที่เพิ่งเตือน — ตรงกับที่กล่องยืนยันบอกไว้ และเซิร์ฟเวอร์ปฏิเสธสองกลุ่มนี้อยู่แล้ว
      const targets = pendingStudents.filter((s) => s.mentorReady && !isCooldownActive(s.lastNotifiedAt));
      let sentCount = 0;
      let failedCount = 0;
      for (const s of targets) {
        try {
          await api.post(`/final-reports/notify-mentor/${s.studentId}`);
          sentCount++;
        } catch {
          // รายเดียวล้มไม่หยุดทั้งชุด แต่ต้องนับไว้บอกผู้ใช้ — เดิมกลืนเงียบแล้วขึ้นว่าสำเร็จ
          failedCount++;
        }
      }
      setBatchNotifyOpen(false);
      await loadData();
      if (failedCount > 0) {
        setError(`ส่งอีเมลเตือนสำเร็จ ${sentCount} ราย · ส่งไม่สำเร็จ ${failedCount} ราย กรุณาลองใหม่อีกครั้ง`);
      } else if (targets.length === 0) {
        setSuccess('ไม่มีอีเมลที่ต้องส่ง — ทุกคนเพิ่งถูกเตือนใน 24 ชั่วโมง หรือยังไม่มีพี่เลี้ยงที่ยืนยันแล้ว');
      } else {
        setSuccess(`ส่งอีเมลเตือนไปยังผู้มีเอกสารค้างสำเร็จ ${sentCount} ราย`);
      }
    } catch (err) {
      setBatchNotifyOpen(false);
      setError(getErrorMessage(err, 'ส่งอีเมลเตือนเป็นกลุ่มไม่สำเร็จ'));
    } finally {
      setBatchNotifying(false);
    }
  };

  const handleCloseSubmit = async () => {
    if (!closeTarget?.placement || !closeKind || !closeReason.trim()) return;
    try {
      setClosing(true);
      setCloseError(null);
      const res = await api.post(`/intents/${closeTarget.placement.form_id}/close-accepted`, {
        kind: closeKind,
        reason: closeReason.trim(),
      });
      setCloseTarget(null);
      // `api` คืน body ของคำตอบตรง ๆ (ไม่ใช่ axios) — ข้อความอยู่ที่ res.message
      setSuccess(res?.message || 'ปิดใบที่ฝึกงานแล้ว');
      await loadData();
    } catch (err) {
      setCloseError(getErrorMessage(err, 'ไม่สามารถปิดใบที่ฝึกงานได้'));
    } finally {
      setClosing(false);
    }
  };

  const handleReopenConfirm = async () => {
    if (!reopenTarget?.placement) return;
    try {
      setReopening(true);
      setError(null);
      const res = await api.post(`/intents/${reopenTarget.placement.form_id}/reopen-accepted`);
      setReopenTarget(null);
      setSuccess(res?.message || 'ยกเลิกการปิดใบสำเร็จ');
      await loadData();
    } catch (err) {
      setReopenTarget(null);
      setError(getErrorMessage(err, 'ไม่สามารถยกเลิกการปิดใบได้'));
    } finally {
      setReopening(false);
    }
  };

  const isCooldownActive = (lastNotifiedAt: string | null) => {
    if (!lastNotifiedAt) return false;
    const last = new Date(lastNotifiedAt).getTime();
    return now - last < 24 * 60 * 60 * 1000;
  };

  const isStudentComplete = (s: StudentProgress) => {
    const p = s.progressDetails;
    return (
      p.accommodationSubmitted &&
      p.intentApproved &&
      p.outlineApproved &&
      p.supervisionCompleted &&
      p.finalReportSubmitted &&
      p.evaluation15Submitted &&
      p.evaluation16Submitted
    );
  };

  const pendingCount = useMemo(
    () => students.filter((s) => !isStudentComplete(s)).length,
    [students]
  );
  // ชุดเดียวกับที่ handleBatchNotify วนส่ง — อีเมลออกถึงพี่เลี้ยงเท่านั้น
  const evalPendingStudents = useMemo(
    () => students.filter((s) => !s.progressDetails.evaluation15Submitted || !s.progressDetails.evaluation16Submitted),
    [students]
  );
  const completeCount = useMemo(
    () => students.filter((s) => isStudentComplete(s)).length,
    [students]
  );

  const majorOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.majorName) set.add(s.majorName);
    });
    return Array.from(set);
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter((std) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        std.studentName.toLowerCase().includes(q) ||
        std.studentCode.toLowerCase().includes(q) ||
        (std.companyName && std.companyName.toLowerCase().includes(q)) ||
        (std.majorName && std.majorName.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (statusFilter === 'pending' && isStudentComplete(std)) return false;
      if (statusFilter === 'completed' && !isStudentComplete(std)) return false;

      if (selectedMajor !== 'all' && std.majorName !== selectedMajor) return false;

      return true;
    });
  }, [students, search, statusFilter, selectedMajor]);

  const handleExportCSV = () => {
    if (filteredStudents.length === 0) return;

    const headers = [
      'รหัสนักศึกษา',
      'ชื่อ-นามสกุล',
      'สาขาวิชา',
      'สถานประกอบการ',
      'สหกิจ 06 (ที่พัก)',
      'สหกิจ 11 (โครงร่าง)',
      'สหกิจ 13 (นิเทศ)',
      'สหกิจ 14 (เล่มรายงาน)',
      'ใบประเมิน 15/16 (พี่เลี้ยง)',
      'ความคืบหน้า (%)',
    ];

    const rows = filteredStudents.map((std) => {
      const p = std.progressDetails;
      const evalText =
        p.evaluation15Submitted && p.evaluation16Submitted
          ? 'ครบทั้ง 2 ใบ'
          : p.evaluation15Submitted
          ? 'มีแค่ 15'
          : '-';

      return [
        std.studentCode,
        std.studentName,
        std.majorName,
        std.companyName || '-',
        p.accommodationSubmitted ? 'ส่งแล้ว' : '-',
        p.outlineApproved ? 'อนุมัติแล้ว' : '-',
        p.supervisionCompleted ? 'นิเทศแล้ว' : '-',
        p.finalReportSubmitted ? 'ส่งแล้ว' : '-',
        evalText,
        `${std.progressPercent}%`,
      ];
    });

    const csvCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csvContent =
      '\uFEFF' +
      [headers.map(csvCell).join(','), ...rows.map((e) => e.map(csvCell).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `student_doc_progress_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching StudentDocProgress.dc.html */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            กระดานติดตามสถานะและผลการประเมิน
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            ตอบคำถามเดียว: <strong className="font-bold text-gray-800 dark:text-gray-200">ใครยังไม่ส่งอะไร</strong> · ช่องประเมินท้ายตารางบอกว่า “มีใบประเมินแล้วหรือยัง” เท่านั้น —{' '}
            <strong className="font-bold text-gray-800 dark:text-gray-200">ไม่ใช่ผ่าน/ไม่ผ่าน</strong> เพราะอาจารย์เป็นผู้ตัดเกรด
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="btn-batch-notify"
            onClick={() => setBatchNotifyOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Mail className="w-4 h-4 text-gray-500" />
            ส่งอีเมลเตือนที่ค้าง
          </button>
          <button
            type="button"
            data-testid="btn-export-table"
            onClick={handleExportCSV}
            disabled={filteredStudents.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            ส่งออกเป็นตาราง
          </button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. Filter Bar matching StudentDocProgress.dc.html */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex-grow min-w-[260px] relative flex items-center">
          <Search className="w-4 h-4 absolute left-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ รหัสนักศึกษา หรือสถานประกอบการ"
            className="w-full pl-10 pr-4 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            statusFilter === 'pending'
              ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-500'
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          มีของค้าง ({loadFailed ? '–' : pendingCount})
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            statusFilter === 'completed'
              ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-500'
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          ครบทุกอย่าง ({loadFailed ? '–' : completeCount})
        </button>

        {majorOptions.length === 1 ? (
          <div
            data-testid="major-locked-badge"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <Lock className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
            <span>สาขาวิชา: {majorOptions[0]}</span>
          </div>
        ) : majorOptions.length > 1 ? (
          <select
            value={selectedMajor}
            onChange={(e) => setSelectedMajor(e.target.value)}
            aria-label="กรองตามสาขาวิชา"
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
          >
            <option value="all">ทุกสาขาวิชา</option>
            {majorOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          onClick={loadData}
          title="ดึงข้อมูลใหม่"
          aria-label="ดึงข้อมูลใหม่"
          className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3. Main Horizontal Matrix Table */}
      {loading ? (
        <PageSkeleton variant="table" />
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  <th className="p-3 font-bold w-[250px]">นักศึกษา</th>
                  <th className="p-3 font-bold w-[200px]">สถานประกอบการ</th>
                  <th className="p-3 font-bold text-center">
                    ที่พัก
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 06</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    รายสัปดาห์
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 09</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    รายเดือน
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 10</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    โครงร่าง
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 11</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    นิเทศ
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 13</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    เล่มรายงาน
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 14</span>
                  </th>
                  <th className="p-3 font-bold text-center">
                    ใบประเมิน
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">15 / 16</span>
                  </th>
                  <th className="p-3 font-bold text-right min-w-[140px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-700 dark:text-gray-300">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-gray-500 dark:text-gray-400">
                      {loadFailed
                        ? 'โหลดรายชื่อไม่สำเร็จ กดปุ่มดึงข้อมูลใหม่เพื่อลองอีกครั้ง'
                        : 'ไม่พบข้อมูลนักศึกษาตรงตามเงื่อนไขที่เลือก'}
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((std) => {
                    const p = std.progressDetails;
                    const complete = isStudentComplete(std);
                    const evalText =
                      p.evaluation15Submitted && p.evaluation16Submitted
                        ? 'ครบทั้ง 2 ใบ'
                        : p.evaluation15Submitted
                        ? 'มีแค่ 15'
                        : '–';

                    return (
                      <tr
                        key={std.studentId}
                        data-testid={`student-row-${std.studentId}`}
                        className={`hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors ${
                          !complete ? 'bg-[#FFFBEB]/40 dark:bg-amber-950/10' : ''
                        }`}
                      >
                        {/* 1. นักศึกษา */}
                        <td className="p-3">
                          <div className="font-bold text-gray-900 dark:text-white">
                            {std.studentName}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-normal">
                            {std.studentCode} · {std.majorName}
                          </div>
                        </td>

                        {/* 2. สถานประกอบการ */}
                        <td className="p-3">
                          <div className="font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">
                            {std.companyName || '—'}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-normal">
                            {complete ? 'จบการปฏิบัติงานแล้ว' : `ความคืบหน้า ${std.progressPercent}%`}
                          </div>
                        </td>

                        {/* 3. สหกิจ 06 ที่พัก */}
                        <td className="p-3 text-center">
                          {p.accommodationSubmitted ? (
                            <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 inline-flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-md bg-gray-50 dark:bg-gray-700/50 border border-dashed border-gray-300 dark:border-gray-600 inline-flex items-center justify-center text-[11px] text-gray-600 dark:text-gray-400">
                              –
                            </span>
                          )}
                        </td>

                        {/* 5. สหกิจ 09 รายสัปดาห์ */}
                        {/* นับจากฉบับที่ส่งแล้วจริง (ไม่นับร่าง) — เดิมเป็นเลขตายตัว 6 / 6 ทุกแถว · ไม่ใส่ตัวหารเพราะระบบไม่รู้ว่าแต่ละคนต้องส่งกี่ฉบับ */}
                        <td className="p-3 text-center font-bold" title="จำนวนฉบับที่นักศึกษาส่งแล้ว ไม่นับฉบับร่าง">
                          {std.weeklyLogsSent > 0 ? (
                            <span className="text-gray-900 dark:text-white">{std.weeklyLogsSent} ฉบับ</span>
                          ) : (
                            <span className="font-normal text-gray-600 dark:text-gray-400">–</span>
                          )}
                        </td>

                        {/* 6. สหกิจ 10 รายเดือน */}
                        <td className="p-3 text-center font-bold" title="จำนวนฉบับที่นักศึกษาส่งแล้ว ไม่นับฉบับร่าง">
                          {std.monthlyLogsSent > 0 ? (
                            <span className="text-gray-900 dark:text-white">{std.monthlyLogsSent} ฉบับ</span>
                          ) : (
                            <span className="font-normal text-gray-600 dark:text-gray-400">–</span>
                          )}
                        </td>

                        {/* 7. สหกิจ 11 โครงร่าง */}
                        <td className="p-3 text-center">
                          {p.outlineApproved ? (
                            <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 inline-flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-md bg-gray-50 dark:bg-gray-700/50 border border-dashed border-gray-300 dark:border-gray-600 inline-flex items-center justify-center text-[11px] text-gray-600 dark:text-gray-400">
                              –
                            </span>
                          )}
                        </td>

                        {/* 8. สหกิจ 13 นิเทศ */}
                        <td className="p-3 text-center">
                          {p.supervisionCompleted ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                              2 ครั้ง
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-md bg-gray-50 dark:bg-gray-700/50 border border-dashed border-gray-300 dark:border-gray-600 inline-flex items-center justify-center text-[11px] text-gray-600 dark:text-gray-400">
                              –
                            </span>
                          )}
                        </td>

                        {/* 9. สหกิจ 14 เล่มรายงาน */}
                        <td className="p-3 text-center">
                          {p.finalReportSubmitted ? (
                            <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 inline-flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-md bg-gray-50 dark:bg-gray-700/50 border border-dashed border-gray-300 dark:border-gray-600 inline-flex items-center justify-center text-[11px] text-gray-600 dark:text-gray-400">
                              –
                            </span>
                          )}
                        </td>

                        {/* 10. ใบประเมิน 15 / 16 (กฎ: ห้ามเขียนว่าผ่าน — คะแนนดิบสองใบแยกกัน ไม่รวม) */}
                        <td className="p-3 text-center font-bold">
                          {evalText === 'ครบทั้ง 2 ใบ' ? (
                            <div>
                              <span className="text-emerald-700 dark:text-emerald-400 block">
                                ครบทั้ง 2 ใบ
                              </span>
                              <span className="font-normal text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                                สหกิจ 15: {std.sahatkit15Score}/100 · สหกิจ 16: {std.sahatkit16Score}/70
                              </span>
                            </div>
                          ) : evalText === 'มีแค่ 15' ? (
                            <div>
                              <span className="text-amber-700 dark:text-amber-400 block">
                                มีแค่ 15
                              </span>
                              <span className="font-normal text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                                สหกิจ 15: {std.sahatkit15Score}/100
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                          )}
                        </td>

                        {/* 11. Actions */}
                        <td className="p-3 text-right">
                          {std.placement?.status === 'superseded' ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                เจ้าหน้าที่ปิดใบแล้ว
                                {std.placement.closed_kind === 'sent_back'
                                  ? ' (สถานประกอบการส่งตัวกลับ)'
                                  : std.placement.closed_kind === 'change_company'
                                  ? ' (เปลี่ยนสถานประกอบการ)'
                                  : ''}
                              </span>
                              {std.placement.can_reopen && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  data-testid={`reopen-accepted-${std.studentCode}`}
                                  onClick={() => setReopenTarget(std)}
                                >
                                  ยกเลิกการปิด
                                </Button>
                              )}
                            </div>
                          ) : (
                            // ปุ่มในแถวใช้ ui/Button size sm — บนจอสัมผัสสูง 44px (เดิมเขียนคลาสเอง สูง 17–26px ชิดกัน 6px กดผิดปุ่มง่าย)
                            <div className="flex flex-col items-end gap-2">
                              {!complete ? (
                                // ปุ่มนี้ส่งอีเมลถึงพี่เลี้ยงเสมอ จึงใช้ชื่อเดียว · ปิดเมื่อเซิร์ฟเวอร์จะปฏิเสธ (409 ไม่มีพี่เลี้ยง · 429 เพิ่งเตือน) พร้อมบอกเหตุผล
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => setNotifyTarget(std)}
                                    disabled={
                                      !std.mentorReady ||
                                      isCooldownActive(std.lastNotifiedAt) ||
                                      notifyingMap[std.studentId]
                                    }
                                  >
                                    เตือนพี่เลี้ยง
                                  </Button>
                                  {!std.mentorReady ? (
                                    <span className="text-[11px] text-gray-600 dark:text-gray-400">
                                      ยังไม่มีพี่เลี้ยงที่ยืนยันแล้ว
                                    </span>
                                  ) : isCooldownActive(std.lastNotifiedAt) ? (
                                    <span className="text-[11px] text-gray-600 dark:text-gray-400">
                                      เตือนแล้วใน 24 ชั่วโมง
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => alert(`ข้อมูลนักศึกษา: ${std.studentName}\nรหัส: ${std.studentCode}\nอาจารย์: ${std.advisorName}\nความคืบหน้า: 100% ครบสมบูรณ์`)}
                                >
                                  ดูรายคน
                                </Button>
                              )}
                              {std.placement?.status === 'accepted' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`close-accepted-${std.studentCode}`}
                                  onClick={() => {
                                    setCloseTarget(std);
                                    setCloseKind('');
                                    setCloseReason('');
                                    setCloseError(null);
                                  }}
                                >
                                  ปิดใบที่ฝึก
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Bottom Clarification Cards matching StudentDocProgress.dc.html */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-2">
        <div className="p-5 rounded-2xl border border-amber-200 bg-[#FFFBEB] dark:bg-amber-950/20 dark:border-amber-800/60 space-y-2.5">
          <div className="flex items-center gap-2 font-bold text-sm text-[#92400E] dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#92400E] dark:text-amber-400" />
            <span>ทำไมคอลัมน์ประเมินเขียนว่า “ครบทั้ง 2 ใบ” ไม่ใช่ “ผ่าน”</span>
          </div>
          <p className="text-xs leading-relaxed text-[#92400E] dark:text-amber-200/90">
            ระบบรู้แค่ว่า <strong>มีใบประเมินเข้ามาแล้วหรือยัง</strong> · การตัดเกรดเป็นของอาจารย์ ป้ายที่เขียนว่า “ผ่าน” จึงเป็นคำที่สัญญาเกินกว่าข้อมูลที่มี
            <br />
            ทั้งสองใบเป็นของ <strong>พี่เลี้ยง</strong> ทั้งคู่ (สหกิจ 15 เต็ม 100 ใช้ตัดเกรด · สหกิจ 16 เต็ม 70 ประเมินตัวเล่ม) — ไม่ใช่ใบของอาจารย์
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2.5">
          <div className="font-bold text-sm text-gray-900 dark:text-white">
            ครบทั้งสองใบเมื่อไร นาฬิกาลบข้อมูลอ่อนไหวเริ่มเดิน
          </div>
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            เลขบัตรประชาชน เชื้อชาติ และศาสนา ที่ใช้พิมพ์ใบสมัคร สหกิจ 03 จะถูกลบอัตโนมัติ <strong>90 วันหลังพี่เลี้ยงส่งครบทั้ง สหกิจ 15 และ 16</strong>
            <br />
            ระบบลบให้เองตามกำหนด ไม่ต้องกดปุ่มใด
          </p>
        </div>
      </div>

      {/* Confirmation for Single Notify */}
      <ConfirmDialog
        open={notifyTarget !== null}
        title="ยืนยันการส่งอีเมลแจ้งเตือน"
        message={
          notifyTarget ? (
            <ConfirmSummary
              lead="ส่งอีเมลเตือนถึงพี่เลี้ยงของนักศึกษาคนนี้"
              rows={[
                {
                  label: 'นักศึกษา',
                  value: `${notifyTarget.studentName} (${notifyTarget.studentCode})`,
                },
                ...(notifyTarget.companyName
                  ? [{ label: 'สถานประกอบการ', value: notifyTarget.companyName }]
                  : []),
              ]}
              lockNote="ระบบจะส่งอีเมลทันที และจะไม่สามารถส่งเตือนซ้ำให้นักศึกษาคนนี้ได้อีกภายใน 24 ชั่วโมง"
            />
          ) : (
            ''
          )
        }
        confirmLabel="ยืนยัน ส่งอีเมล"
        busy={!!(notifyTarget && notifyingMap[notifyTarget.studentId])}
        onConfirm={handleNotifyMentor}
        onCancel={() => setNotifyTarget(null)}
      />

      {/* Confirmation for Batch Notify */}
      <ConfirmDialog
        open={batchNotifyOpen}
        title="ยืนยันการส่งอีเมลเตือนผู้มีเอกสารค้าง"
        message={
          <ConfirmSummary
            lead="ส่งอีเมลเตือนถึงพี่เลี้ยงของนักศึกษาที่ผลประเมินยังไม่ครบ 2 ใบ"
            rows={[
              { label: 'นักศึกษาที่ผลประเมินยังไม่ครบ', value: `${evalPendingStudents.length} คน` },
              {
                label: 'เพิ่งเตือนไปใน 24 ชั่วโมง (ข้าม)',
                value: `${evalPendingStudents.filter((s) => isCooldownActive(s.lastNotifiedAt)).length} คน`,
              },
            ]}
            lockNote="อีเมลออกทันที เรียกคืนไม่ได้ · นักศึกษาไม่ได้รับอีเมลจากปุ่มนี้ · คนที่ยังไม่มีพี่เลี้ยงที่ยืนยันแล้วถูกข้าม"
          />
        }
        confirmLabel="ส่งอีเมลเตือนทั้งหมด"
        busy={batchNotifying}
        onConfirm={handleBatchNotify}
        onCancel={() => setBatchNotifyOpen(false)}
      />

      {/* Dialog สำหรับปิดใบที่ฝึกงาน */}
      {closeTarget && (
        <Modal
          onClose={() => !closing && setCloseTarget(null)}
          size="lg"
          closeOnBackdrop={!closing}
          data-testid="close-accepted-dialog"
          title={
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">
                ปิดใบที่ฝึกงาน
              </div>
              <div className="text-xs font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                {closeTarget.studentName} ({closeTarget.studentCode}) · {closeTarget.companyName || '—'}
              </div>
            </div>
          }
        >
          {/* ⛔ ห้ามห่อ ModalBody/ModalFooter ด้วย div — แผง Modal เป็น flex column ตัวห่อทำให้เนื้อหาเลื่อนไม่ได้และปุ่มถูกตัดบนจอเตี้ย */}
          <>
            <ModalBody className="space-y-4">
              <AlertBanner variant="error" message={closeError} />

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  เหตุที่ปิดใบ <span className="text-red-500">*</span>
                </label>
                <select
                  data-testid="close-accepted-kind"
                  value={closeKind}
                  disabled={closing}
                  onChange={(e) => setCloseKind(e.target.value as 'sent_back' | 'change_company' | '')}
                  className="w-full text-xs p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- เลือกเหตุที่ปิดใบ --</option>
                  <option value="sent_back">สถานประกอบการส่งตัวกลับ</option>
                  <option value="change_company">เปลี่ยนสถานประกอบการ</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  เหตุผล <span className="text-red-500">*</span>
                </label>
                <textarea
                  data-testid="close-accepted-reason"
                  rows={3}
                  value={closeReason}
                  disabled={closing}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="ระบุเหตุผล..."
                  className="w-full text-xs p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  พิมพ์ตามบันทึกข้อความที่สาขาส่งมา นักศึกษาจะเห็นข้อความนี้
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 dark:border-gray-700 dark:bg-gray-800/60 space-y-1.5">
                <p className="text-xs font-bold text-gray-700 dark:text-gray-300">สิ่งที่จะเกิดขึ้น:</p>
                <ul className="list-disc list-inside text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <li>นักศึกษายื่นคำร้องขอหนังสือสำหรับที่ใหม่ได้ทันที แม้พ้นช่วงยื่นตามปฏิทิน</li>
                  <li>พี่เลี้ยงของที่เดิมจะไม่เห็นนักศึกษาคนนี้อีก</li>
                  <li>นักศึกษาต้องส่งแบบแจ้งที่พัก (สหกิจ 06) ใหม่</li>
                  <li>บันทึกการปฏิบัติงาน โครงร่าง และผลประเมินที่มีอยู่ยังอยู่ครบ</li>
                </ul>
              </div>
            </ModalBody>

            <ModalFooter className="flex justify-end gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={closing}
                onClick={() => setCloseTarget(null)}
              >
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="close-accepted-submit"
                loading={closing}
                disabled={!closeKind || !closeReason.trim() || closing}
                onClick={handleCloseSubmit}
              >
                ปิดใบที่ฝึก
              </Button>
            </ModalFooter>
          </>
        </Modal>
      )}

      {/* Confirmation for Reopen */}
      <ConfirmDialog
        open={reopenTarget !== null}
        level={1}
        title="ยกเลิกการปิดใบที่ฝึกงาน"
        message={
          reopenTarget
            ? `คืนใบที่ฝึกงานของ ${reopenTarget.studentName} (${reopenTarget.studentCode}) เป็น ได้ที่ฝึกแล้ว`
            : ''
        }
        confirmLabel="คืนใบนี้เป็น ได้ที่ฝึกแล้ว"
        cancelLabel="ยกเลิก"
        confirmTestId="reopen-accepted-confirm"
        busy={reopening}
        onConfirm={handleReopenConfirm}
        onCancel={() => setReopenTarget(null)}
      />
    </div>
  );
};

export default FinalProgressDashboard;
