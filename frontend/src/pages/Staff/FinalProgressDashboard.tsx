import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { ClipboardList, Users, Search, Mail, Download, RefreshCw, CheckCircle, Clock } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';

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
  // สองใบคนละมาตร (100 กับ 70) จงใจไม่มีช่องรวม — เกรดมาจาก สหกิจ 15 อย่างเดียว
  sahatkit15Score: number | null;
  sahatkit16Score: number | null;
  lastNotifiedAt: string | null;
}

const FinalProgressDashboard: React.FC = () => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notifyingMap, setNotifyingMap] = useState<Record<number, boolean>>({});
  /** Which student the "email their mentor" confirmation is about. */
  const [notifyTarget, setNotifyTarget] = useState<StudentProgress | null>(null);

  const loadData = async () => {
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
  };

  useEffect(() => {
    loadData();
  }, []);

  /**
   * Sends a real email to an outside party, and the server then refuses another
   * for 24 hours — so a mis-click costs a day of waiting. It asks first.
   */
  const handleNotifyMentor = async () => {
    const student = notifyTarget;
    if (!student) return;
    try {
      setNotifyingMap(prev => ({ ...prev, [student.studentId]: true }));
      setError(null);
      setSuccess(null);

      await api.post(`/final-reports/notify-mentor/${student.studentId}`);

      setNotifyTarget(null);
      setSuccess(`ส่งอีเมลแจ้งเตือนหาพี่เลี้ยงของ ${student.studentName} สำเร็จ`);
      
      // Reload page data
      const res = await api.get('/coop-progress/dashboard');
      setStudents(res.data || []);
    } catch (err) {
      setNotifyTarget(null);
      setError(getErrorMessage(err, 'ล้มเหลวในการส่งแจ้งเตือนเนื่องจากเงื่อนไข Cooldown'));
    } finally {
      setNotifyingMap(prev => ({ ...prev, [student.studentId]: false }));
    }
  };

  const isCooldownActive = (lastNotifiedAt: string | null) => {
    if (!lastNotifiedAt) return false;
    const last = new Date(lastNotifiedAt).getTime();
    const now = Date.now();
    return (now - last) < 24 * 60 * 60 * 1000;
  };

  const formatRemainingCooldown = (lastNotifiedAt: string | null) => {
    if (!lastNotifiedAt) return '';
    const last = new Date(lastNotifiedAt).getTime();
    const now = Date.now();
    const remainMs = (24 * 60 * 60 * 1000) - (now - last);
    if (remainMs <= 0) return '';
    
    const hours = Math.floor(remainMs / (60 * 60 * 1000));
    const mins = Math.floor((remainMs % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours} ชม. ${mins} นาที`;
  };

  // Export data client-side to CSV format
  const handleExportCSV = () => {
    if (filteredStudents.length === 0) return;

    // Header definition
    const headers = [
      'รหัสนักศึกษา',
      'ชื่อ-นามสกุล',
      'สาขาวิชา',
      'อาจารย์ที่ปรึกษา',
      'สถานประกอบการ',
      'เปอร์เซ็นต์งาน (%)',
      'ผลประเมิน สหกิจ 15 (เต็ม 100)',
      'ประเมินรายงาน สหกิจ 16 (เต็ม 70)'
    ];

    // Data rows mapping
    const rows = filteredStudents.map(std => [
      std.studentCode,
      std.studentName,
      std.majorName,
      std.advisorName,
      std.companyName,
      `${std.progressPercent}%`,
      std.sahatkit15Score !== null ? std.sahatkit15Score : '-',
      std.sahatkit16Score !== null ? std.sahatkit16Score : '-'
    ]);

    // A value containing a double quote used to break the row it sat in \u2014
    // RFC 4180 escapes one by doubling it. Company names are free text typed by
    // whoever registered the placement. The BOM is what lets Excel read the
    // Thai, and was already right.
    const csvCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csvContent = '\uFEFF' + [
      headers.map(csvCell).join(','),
      ...rows.map(e => e.map(csvCell).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Coop_Progress_Scores_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredStudents = students.filter(
    std =>
      std.studentName.toLowerCase().includes(search.toLowerCase()) ||
      std.studentCode.includes(search) ||
      std.companyName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 page-enter">
      {/* Overview Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-brand-blue rounded-xl dark:text-blue-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400">นักศึกษาในสาขาทั้งหมด</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">{students.length} คน</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400">เสร็จสิ้นกระบวนการ 100%</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">
              {students.filter(s => s.progressPercent === 100).length} คน
            </h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-orange-50 dark:bg-orange-900/20 text-orange-500 rounded-xl">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400">กำลังอยู่ในกระบวนการ</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">
              {students.filter(s => s.progressPercent < 100).length} คน
            </h3>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-brand-blue dark:text-blue-400" />
              กระดานติดตามสถานะและผลการประเมิน (Final Progress Dashboard)
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
              ติดตามภาพรวมความก้าวหน้า รายเล่มรายงาน และคะแนนประเมินดิบสะสมของนักศึกษา
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadData}
              title="ดึงข้อมูลใหม่"
              aria-label="ดึงข้อมูลใหม่"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              onClick={handleExportCSV}
              disabled={filteredStudents.length === 0}
              icon={<Download className="w-4 h-4" />}
            >
              Export คะแนน (CSV)
            </Button>
          </div>
        </div>

        {/* Filter / Search */}
        <div className="relative mb-6">
          <Search className="w-4 h-4 absolute left-4 top-3 text-gray-600 dark:text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาด้วยรหัส รหัสประจำตัว ชื่อนักศึกษา หรือสถานประกอบการ..."
            className="w-full pl-11 pr-4 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          />
        </div>

        <AlertBanner variant="error" message={error} className="mb-6" />

        <AlertBanner variant="success" message={success} className="mb-6" />

        {loading ? (
          <PageSkeleton variant="table" />
        ) : filteredStudents.length === 0 ? (
          <div className="py-16 text-center text-gray-600 dark:text-gray-400 text-sm">
            ไม่พบข้อมูลนักศึกษาสหกิจศึกษาตรงตามเกณฑ์
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-700 rounded-xl">
            <table className="w-full border-collapse text-left text-xs min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="p-4 font-bold">ข้อมูลนักศึกษา</th>
                  <th className="p-4 font-bold">สถานประกอบการ</th>
                  <th className="p-4 font-bold">ความคืบหน้า (%)</th>
                  <th className="p-4 font-bold text-center">ผลประเมิน สหกิจ 15 (100)</th>
                  <th className="p-4 font-bold text-center">ประเมินรายงาน สหกิจ 16 (70)</th>
                  <th className="p-4 font-bold text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredStudents.map((std) => (
                  <tr key={std.studentId} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/20">
                    <td className="p-4">
                      <div className="font-bold text-gray-900 dark:text-white text-sm">{std.studentName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">รหัส: {std.studentCode} | อ.ที่ปรึกษา: {std.advisorName}</div>
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-300">
                      <div>{std.companyName}</div>
                    </td>
                    <td className="p-4 w-48">
                      <div className="flex items-center gap-3">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 h-2.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              std.progressPercent === 100 ? 'bg-green-500' :
                              std.progressPercent >= 60 ? 'bg-brand-blue' :
                              std.progressPercent >= 20 ? 'bg-orange-400' : 'bg-red-400'
                            }`}
                            style={{ width: `${std.progressPercent}%` }}
                          />
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">{std.progressPercent}%</span>
                      </div>
                    </td>
                    <td className="p-4 text-center text-sm font-bold text-gray-800 dark:text-gray-200">
                      {std.sahatkit15Score !== null ? (
                        <span>{std.sahatkit15Score}</span>
                      ) : (
                        <span className="font-medium text-gray-600 dark:text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-center text-sm font-bold text-gray-800 dark:text-gray-200">
                      {std.sahatkit16Score !== null ? (
                        <span>
                          {std.sahatkit16Score}
                          <span className="text-xs font-normal text-gray-600 dark:text-gray-400">/70</span>
                        </span>
                      ) : (
                        <span className="font-medium text-gray-600 dark:text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {/* Notify button active only if report is uploaded but mentor score is missing */}
                      {std.finalReportStatus !== 'not_submitted' &&
                        (std.sahatkit15Score === null || std.sahatkit16Score === null) && (
                        <div className="flex items-center justify-end gap-2">
                          {isCooldownActive(std.lastNotifiedAt) ? (
                            <span className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-950/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Cooldown ({formatRemainingCooldown(std.lastNotifiedAt)})
                            </span>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!!notifyingMap[std.studentId]}
                              icon={<Mail className="w-3.5 h-3.5" />}
                              onClick={() => setNotifyTarget(std)}
                            >
                              แจ้งเตือนพี่เลี้ยง
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={notifyTarget !== null}
        title="ยืนยันการส่งอีเมลแจ้งเตือนพี่เลี้ยง"
        message={`ส่งอีเมลแจ้งเตือนไปยังพี่เลี้ยงของ ${notifyTarget?.studentName ?? ''} ใช่หรือไม่? ระบบจะส่งอีเมลออกทันที และจะส่งซ้ำให้นักศึกษาคนนี้ไม่ได้อีกภายใน 24 ชั่วโมง`}
        confirmLabel="ยืนยัน ส่งอีเมล"
        busy={!!(notifyTarget && notifyingMap[notifyTarget.studentId])}
        onConfirm={handleNotifyMentor}
        onCancel={() => setNotifyTarget(null)}
      />
    </div>
  );
};

export default FinalProgressDashboard;
