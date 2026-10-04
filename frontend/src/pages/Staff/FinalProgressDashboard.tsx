import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { Search, Check, AlertTriangle, RefreshCw, Download, Mail, Lock } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
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
    workPlanCertified: boolean;
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
}

export const FinalProgressDashboard: React.FC = () => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [selectedMajor, setSelectedMajor] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notifyingMap, setNotifyingMap] = useState<Record<number, boolean>>({});
  const [notifyTarget, setNotifyTarget] = useState<StudentProgress | null>(null);
  const [batchNotifyOpen, setBatchNotifyOpen] = useState(false);
  const [batchNotifying, setBatchNotifying] = useState(false);

  // Store mount timestamp to avoid impure Date.now() during render
  const [now] = useState(() => Date.now());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/coop-progress/dashboard');
      setStudents(res.data || []);
    } catch (err) {
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
      let sentCount = 0;
      for (const s of pendingStudents) {
        if (!isCooldownActive(s.lastNotifiedAt)) {
          try {
            await api.post(`/final-reports/notify-mentor/${s.studentId}`);
            sentCount++;
          } catch {
            // Ignore single failures in batch
          }
        }
      }
      setBatchNotifyOpen(false);
      setSuccess(`ส่งอีเมลเตือนไปยังผู้มีเอกสารค้างสำเร็จ ${sentCount} ราย`);
      await loadData();
    } catch (err) {
      setBatchNotifyOpen(false);
      setError(getErrorMessage(err, 'ส่งอีเมลเตือนเป็นกลุ่มไม่สำเร็จ'));
    } finally {
      setBatchNotifying(false);
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
      p.workPlanCertified &&
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
      'สหกิจ 07 (แผนงาน)',
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
        p.workPlanCertified ? 'พี่เลี้ยงรับรองแล้ว' : '-',
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
        <div className="flex items-center gap-2.5">
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
          มีของค้าง ({pendingCount})
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
          ครบทุกอย่าง ({completeCount})
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
                    แผนงาน
                    <br />
                    <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">สหกิจ 07</span>
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
                  <th className="p-3 font-bold text-right w-[110px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-700 dark:text-gray-300">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-gray-500 dark:text-gray-400">
                      ไม่พบข้อมูลนักศึกษาตรงตามเงื่อนไขที่เลือก
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

                    const needsMentorReminder =
                      std.finalReportStatus !== 'not_submitted' &&
                      (!p.evaluation15Submitted || !p.evaluation16Submitted);

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

                        {/* 4. สหกิจ 07 แผนงาน — ติ๊กเมื่อพี่เลี้ยงรับรองหน้า 3 แล้ว (เดิมผูกผิดกับ intentApproved) */}
                        <td className="p-3 text-center">
                          {p.workPlanCertified ? (
                            <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 inline-flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-md bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700 inline-flex items-center justify-center text-[11px] font-extrabold">
                              !
                            </span>
                          )}
                        </td>

                        {/* 5. สหกิจ 09 รายสัปดาห์ */}
                        <td className="p-3 text-center font-bold">
                          <span className={complete ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                            {complete ? '16 / 16' : '6 / 6'}
                          </span>
                        </td>

                        {/* 6. สหกิจ 10 รายเดือน */}
                        <td className="p-3 text-center font-bold">
                          <span className={complete ? 'text-emerald-700 dark:text-emerald-400' : 'text-emerald-700 dark:text-emerald-400'}>
                            {complete ? '4 / 4' : '1 / 1'}
                          </span>
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
                          {needsMentorReminder ? (
                            <button
                              type="button"
                              onClick={() => setNotifyTarget(std)}
                              disabled={isCooldownActive(std.lastNotifiedAt) || notifyingMap[std.studentId]}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                            >
                              เตือนพี่เลี้ยง
                            </button>
                          ) : !complete ? (
                            <button
                              type="button"
                              onClick={() => setNotifyTarget(std)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                            >
                              ส่งอีเมลเตือน
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => alert(`ข้อมูลนักศึกษา: ${std.studentName}\nรหัส: ${std.studentCode}\nอาจารย์: ${std.advisorName}\nความคืบหน้า: 100% ครบสมบูรณ์`)}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50"
                            >
                              ดูรายคน
                            </button>
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
            ระบบรู้แค่ว่า <strong>มีใบประเมินเข้ามาแล้วหรือยัง</strong> · การตัดเกรดเป็นของอาจารย์ ป้ายที่เขียนว่า “ผ่าน” จึงเป็นคำที่สัญญาเกินกว่าข้อมูลที่มี — เคยพลาดมาแล้ว
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
            ⛔ ไม่มีปุ่มให้ใครกดลบ และไม่มีปุ่ม “ปิดสหกิจ” — นโยบายลบข้อมูลที่ต้องรอคนกดคือนโยบายที่ไม่มีใครกด
          </p>
        </div>
      </div>

      {/* Confirmation for Single Notify */}
      <ConfirmDialog
        open={notifyTarget !== null}
        title="ยืนยันการส่งอีเมลแจ้งเตือน"
        message={`ส่งอีเมลแจ้งเตือนไปยังพี่เลี้ยงของ ${notifyTarget?.studentName ?? ''} ใช่หรือไม่? ระบบจะส่งอีเมลออกทันที และจะส่งซ้ำให้นักศึกษาคนนี้ไม่ได้อีกภายใน 24 ชั่วโมง`}
        confirmLabel="ยืนยัน ส่งอีเมล"
        busy={!!(notifyTarget && notifyingMap[notifyTarget.studentId])}
        onConfirm={handleNotifyMentor}
        onCancel={() => setNotifyTarget(null)}
      />

      {/* Confirmation for Batch Notify */}
      <ConfirmDialog
        open={batchNotifyOpen}
        title="ยืนยันการส่งอีเมลเตือนผู้มีเอกสารค้าง"
        message={`ต้องการส่งอีเมลแจ้งเตือนไปยังพี่เลี้ยงและนักศึกษาที่มีเอกสารค้างทั้งหมด ${pendingCount} รายการ ใช่หรือไม่? ระบบจะข้ามรายการที่เพิ่งส่งไปภายใน 24 ชั่วโมง`}
        confirmLabel="ส่งอีเมลเตือนทั้งหมด"
        busy={batchNotifying}
        onConfirm={handleBatchNotify}
        onCancel={() => setBatchNotifyOpen(false)}
      />
    </div>
  );
};

export default FinalProgressDashboard;
