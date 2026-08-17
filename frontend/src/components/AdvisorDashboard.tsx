import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api, { API_BASE_URL } from '../services/api';
import type { IntentForm } from '../types/api';
import { Users, FileText, CheckCircle, Search, Filter, ExternalLink, Calendar } from 'lucide-react';
import WeeklyLogViewModal from './WeeklyLogViewModal';
import AlertBanner from './ui/AlertBanner';
import StatusBadge from './ui/StatusBadge';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import type { ReportOutlineRow, StudentRow } from '../types/api';

interface AdvisorDashboardProps {
  activeMenu: string;
}

/**
 * Report-outline statuses only. Deliberately not folded into ui/StatusBadge:
 * `report_outlines.status` shares key names with `intent_forms.status` while
 * meaning something else, so the shared table would translate them wrongly.
 */
const OUTLINE_STATUS: Record<string, { text: string; tone: string }> = {
  pending_mentor: {
    text: 'รอพี่เลี้ยงตรวจ',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
  },
  pending_advisor: {
    text: 'รอที่ปรึกษาอนุมัติ',
    tone: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50',
  },
  approved: {
    text: 'อนุมัติเรียบร้อย',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50',
  },
  rejected: {
    text: 'ตีกลับแก้ไข',
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50',
  },
};

/**
 * `student_name` is declared optional on IntentForm but `/api/intents` never
 * sends it — the query returns `first_name` and `last_name`. The approval queue
 * read `intent.student_name || 'ไม่ระบุชื่อ'`, so it has always shown "ไม่ระบุ
 * ชื่อ" for every student, and the advisor approved by student code alone.
 * (StaffDashboard reads the same missing field in two places — not touched here.)
 */
const intentStudentName = (intent?: IntentForm | null): string =>
  [intent?.first_name, intent?.last_name].filter(Boolean).join(' ').trim()
  || intent?.student_name
  || intent?.student_code
  || 'ไม่ระบุชื่อ';

const AdvisorDashboard: React.FC<AdvisorDashboardProps> = ({ activeMenu }) => {
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [reportOutlines, setReportOutlines] = useState<ReportOutlineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Weekly Log viewer modal state
  const [selectedStudentForWeeklyLog, setSelectedStudentForWeeklyLog] = useState<{
    student_id: number;
    first_name?: string;
    last_name?: string;
    student_code?: string;
  } | null>(null);

  // Report Outline review modal state for Advisor
  const [reviewingOutline, setReviewingOutline] = useState<ReportOutlineRow | null>(null);
  const [outlineComment, setOutlineComment] = useState('');
  const [isSubmittingOutlineReview, setIsSubmittingOutlineReview] = useState(false);
  
  // Search & Filter State for Student List
  const [searchText, setSearchText] = useState('');
  const [eligibilityFilter, setEligibilityFilter] = useState('all');
  const [orientationFilter, setOrientationFilter] = useState('all');

  // Rejection modal state for inline reject button
  const [rejectingIntentId, setRejectingIntentId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState<number | null>(null);
  /** Shown inside the rejection dialog — see handleRejectSubmit. */
  const [rejectError, setRejectError] = useState<string | null>(null);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);

      // Fetch what this menu actually draws. All three used to be requested on
      // every menu, and `useDashboardData` repeats that every ten seconds — so
      // reading the outline queue re-fetched every intent and every student in
      // the department, six times a minute, to render nothing.
      if (activeMenu === 'report_outlines') {
        const outlinesRes = await api.get('/outlines/advisor').catch(() => ({ data: [] }));
        setReportOutlines(Array.isArray(outlinesRes) ? outlinesRes : (outlinesRes?.data || []));
      } else {
        const [intentsRes, studentsRes] = await Promise.all([
          api.get('/intents'),
          api.get('/students'),
        ]);
        setIntents(intentsRes || []);
        setStudents(studentsRes || []);
      }
    } catch (err) {
      console.error('Failed to load advisor dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลใบความจำนงหรือรายชื่อนักศึกษาได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleReviewAdvisorOutline = async (status: 'approved' | 'rejected') => {
    if (!reviewingOutline) return;
    if (status === 'rejected' && !outlineComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะในการตีกลับแก้ไขโครงร่างรายงาน');
      return;
    }

    try {
      setIsSubmittingOutlineReview(true);
      setError(null);
      await api.put(`/outlines/${reviewingOutline.outline_id}/status`, {
        status,
        comment: outlineComment
      });

      setSuccess(
        status === 'approved'
          ? 'อนุมัติโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11) สมบูรณ์เรียบร้อยแล้ว'
          : 'ตีกลับโครงร่างรายงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
      );
      setReviewingOutline(null);
      setOutlineComment('');
      await loadData();
    } catch (err) {
      console.error('Advisor review outline error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการอนุมัติโครงร่างรายงาน'));
    } finally {
      setIsSubmittingOutlineReview(false);
    }
  };

  useDashboardData(loadData, [activeMenu]);

  // Inline Approve handler (required for E2E tests and quick actions)
  const handleApprove = async (id: number) => {
    const intent = intents.find((i) => i.form_id === id);
    setSubmittingAction(id);
    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/intents/${id}/status`, { status: 'approved_by_advisor' });
      // Approving moves the form on to the department head and cannot be undone
      // from here, and the only visible effect used to be the row disappearing.
      setSuccess(
        `อนุมัติใบความจำนงของ ${intentStudentName(intent)} แล้ว ส่งต่อให้หัวหน้าสาขาวิชาพิจารณาเป็นลำดับถัดไป`
      );
      // Dispatch update event to sync bell notification and reload list
      window.dispatchEvent(new CustomEvent('intent-updated'));
    } catch (err) {
      setError(getErrorMessage(err, 'การอนุมัติใบความจำนงล้มเหลว'));
    } finally {
      setSubmittingAction(null);
    }
  };

  // Inline Reject submit handler
  const handleRejectSubmit = async () => {
    if (rejectingIntentId === null) return;
    const intent = intents.find((i) => i.form_id === rejectingIntentId);
    const finalReason = rejectReason === 'other' ? customReason.trim() : rejectReason;
    if (!finalReason) {
      // Inside the dialog, not on the page behind it: the page banner is
      // covered by the backdrop, so choosing nothing looked like a dead button.
      setRejectError('กรุณาเลือกสาเหตุการตีกลับ หรือกรอกเหตุผลของท่านเอง');
      return;
    }

    setSubmittingAction(rejectingIntentId);
    setError(null);
    setSuccess(null);
    setRejectError(null);
    try {
      await api.patch(`/intents/${rejectingIntentId}/status`, { status: 'rejected', reason: finalReason });
      setRejectingIntentId(null);
      setRejectReason('');
      setCustomReason('');
      setSuccess(
        `ตีกลับใบความจำนงของ ${intentStudentName(intent)} แล้ว นักศึกษาจะเห็นเหตุผลและยื่นใหม่ได้`
      );
      // Dispatch update event to sync bell notification and reload list
      window.dispatchEvent(new CustomEvent('intent-updated'));
    } catch (err) {
      setRejectError(getErrorMessage(err, 'การปฏิเสธใบความจำนงล้มเหลว'));
    } finally {
      setSubmittingAction(null);
    }
  };

  const advisorModals = (
    <>
      {/* Report Outline Review Modal for Advisor */}
      {reviewingOutline && (
        <Modal
          onClose={() => setReviewingOutline(null)}
          size="lg"
          closeOnBackdrop={false}
          title="พิจารณาอนุมัติโครงร่างรายงาน (สหกิจ 11)"
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
              <p>
                <span className="font-semibold text-gray-500 dark:text-gray-400">สถานประกอบการ:</span> {reviewingOutline.company_name_th}
              </p>
              {reviewingOutline.latest_file_path && (
                <div className="pt-2">
                  <a
                    href={`${API_BASE_URL}/files/${reviewingOutline.latest_file_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-blue text-brand-blue hover:bg-blue-50 dark:hover:bg-blue-950/30 font-bold transition-all"
                  >
                    <ExternalLink className="h-4 w-4" />
                    คลิกเพื่อเปิดอ่านไฟล์ PDF โครงร่างรายงาน
                  </a>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ความคิดเห็น / ข้อแนะนำ (จำเป็นกรณีตีกลับแก้ไข)
              </label>
              <textarea
                rows={4}
                value={outlineComment}
                onChange={(e) => setOutlineComment(e.target.value)}
                placeholder="กรอกคำแนะนำของอาจารย์ที่ปรึกษาเพิ่มเติม..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:border-brand-blue"
              />
            </div>

          </ModalBody>

          <ModalFooter>
            <Button
              variant="danger"
              size="sm"
              loading={isSubmittingOutlineReview}
              loadingLabel="กำลังส่งข้อมูล..."
              onClick={() => handleReviewAdvisorOutline('rejected')}
            >
              ตีกลับให้นักศึกษาแก้ไข
            </Button>
            <Button
              variant="success"
              size="sm"
              loading={isSubmittingOutlineReview}
              loadingLabel="กำลังส่งข้อมูล..."
              onClick={() => handleReviewAdvisorOutline('approved')}
            >
              อนุมัติโครงร่างรายงาน
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Weekly Log Viewer Modal */}
      <WeeklyLogViewModal
        isOpen={selectedStudentForWeeklyLog !== null}
        studentId={selectedStudentForWeeklyLog?.student_id || null}
        studentName={selectedStudentForWeeklyLog ? `${selectedStudentForWeeklyLog.first_name || ''} ${selectedStudentForWeeklyLog.last_name || ''}`.trim() : ''}
        studentCode={selectedStudentForWeeklyLog?.student_code}
        onClose={() => setSelectedStudentForWeeklyLog(null)}
      />
    </>
  );

  if (loading) {
    return (
      <PageSkeleton variant={skeletonFor('advisor', activeMenu)} />
    );
  }

  // Filter computations
  const pendingIntents = intents.filter(i => i.status === 'pending_advisor');
  // The three statuses that mean "this form is dead" are the same three
  // `models/intent.ts` uses. `rejected_by_dept_head` was missing here, so a form
  // the department head had sent back was counted under "อนุมัติแล้ว" — the same
  // slip found on the student job board in round 8. Keep this list in step with
  // the server's.
  const DEAD_INTENT_STATUSES = ['rejected', 'company_rejected', 'rejected_by_dept_head'];
  const approvedIntents = intents.filter(
    i => i.status !== 'pending_advisor' && !DEAD_INTENT_STATUSES.includes(i.status)
  );

  // Filter students based on search and selected options
  const filteredStudents = students.filter(student => {
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
    const studentCode = (student.student_code || '').toLowerCase();
    const nickname = (student.nickname || '').toLowerCase();
    const searchMatch = searchText === '' || 
      fullName.includes(searchText.toLowerCase()) || 
      studentCode.includes(searchText.toLowerCase()) ||
      nickname.includes(searchText.toLowerCase());

    const eligibleMatch = eligibilityFilter === 'all' || 
      (eligibilityFilter === 'eligible' && student.is_eligible === true) || 
      (eligibilityFilter === 'ineligible' && student.is_eligible === false);

    const orientationMatch = orientationFilter === 'all' || 
      (orientationFilter === 'passed' && student.is_orientation_passed === true) || 
      (orientationFilter === 'failed' && student.is_orientation_passed === false);

    return searchMatch && eligibleMatch && orientationMatch;
  });

  // Render Student List View
  if (activeMenu === 'students') {
    return (
      <div className="space-y-6 page-enter">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">รายชื่อนักศึกษาในสาขาวิชา</h2>
          <p className="text-xs text-gray-400 mt-1">
            ตรวจสอบรายชื่อ ประวัติการสหกิจศึกษา และคุณสมบัติพื้นฐานของนักศึกษาในสาขาที่ท่านดูแล
          </p>
        </div>

        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />

        {/* Filter Bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center">
          {/* Search box */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาด้วยรหัสนักศึกษา หรือ ชื่อ-นามสกุล..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>

          <div className="flex gap-3 w-full md:w-auto shrink-0">
            {/* Eligibility filter */}
            <div className="flex items-center gap-1.5 flex-1 md:flex-initial">
              <Filter className="h-3.5 w-3.5 text-gray-400" />
              <select
                value={eligibilityFilter}
                onChange={(e) => setEligibilityFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              >
                <option value="all">เกณฑ์สมัคร: ทั้งหมด</option>
                <option value="eligible">ผ่านเกณฑ์สะสม</option>
                <option value="ineligible">ไม่ผ่านเกณฑ์</option>
              </select>
            </div>

            {/* Orientation Filter */}
            <select
              value={orientationFilter}
              onChange={(e) => setOrientationFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-white flex-1 md:flex-initial"
            >
              <option value="all">ปฐมนิเทศ: ทั้งหมด</option>
              <option value="passed">ผ่านปฐมนิเทศ</option>
              <option value="failed">ยังไม่ผ่าน</option>
            </select>
          </div>
        </div>

        {/* Student Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          {filteredStudents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สาขาวิชา / เกรดเฉลี่ย</th>
                    <th className="p-4 font-semibold text-center">สิทธิ์สมัคร</th>
                    <th className="p-4 font-semibold text-center">ผ่านปฐมนิเทศ</th>
                    <th className="p-4 font-semibold">สถานะคำขอปัจจุบัน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredStudents.map((student) => {
                    const studentIntent = intents.find(i => i.student_id === student.student_id);

                    return (
                      <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                          <span className="block font-bold">
                            {student.first_name ? `${student.first_name} ${student.last_name}` : 'ไม่ระบุชื่อ'}
                          </span>
                          <span className="block text-xs text-gray-400 mt-0.5">
                            รหัส: {student.student_code}
                          </span>
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          <span className="block font-medium">{student.major_name_th}</span>
                          <span className="block text-xs text-gray-400 mt-0.5">GPA: {student.cumulative_gpa ? Number(student.cumulative_gpa).toFixed(2) : 'N/A'}</span>
                        </td>
                        <td className="p-4 text-center">
                          {student.is_eligible ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-900/50">
                              ผ่านเกณฑ์
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-900/50">
                              ไม่ผ่าน
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {student.is_orientation_passed ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-900/50">
                              ผ่านแล้ว
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-800">
                              ยังไม่ผ่าน
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          {studentIntent ? (
                            <div className="flex flex-col gap-1 items-start">
                              <StatusBadge status={studentIntent.status} />
                              <span className="text-xs text-gray-400 font-medium truncate max-w-[150px]">
                                {studentIntent.company_name_th}
                              </span>
                              <button
                                type="button"
                                onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: studentIntent.form_id }))}
                                className="text-xs text-brand-blue dark:text-blue-400 font-bold hover:underline flex items-center gap-0.5 mt-0.5"
                              >
                                ดูใบสมัครแบบละเอียด <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedStudentForWeeklyLog(student)}
                                className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-0.5 mt-0.5"
                              >
                                ดูบันทึกรายสัปดาห์ (Weekly Log) <Calendar className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-gray-400 text-xs">ยังไม่ส่งคำร้องขอสหกิจ</span>
                              <button
                                type="button"
                                onClick={() => setSelectedStudentForWeeklyLog(student)}
                                className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-0.5"
                              >
                                ดูบันทึกรายสัปดาห์ (Weekly Log) <Calendar className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              ไม่พบข้อมูลนักศึกษาที่ตรงตามเงื่อนไขค้นหา
            </div>
          )}
        </div>
        {advisorModals}
      </div>
    );
  }

  // Render Report Outlines (Co-op 11) View for Advisor
  if (activeMenu === 'report_outlines') {
    const pendingAdvisorCount = reportOutlines.filter(o => o.status === 'pending_advisor').length;

    return (
      <div className="space-y-6 page-enter">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
              อนุมัติโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11)
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              พิจารณาอนุมัติขั้นสุดท้ายสำหรับโครงร่างรายงานที่ผ่านการคัดกรองจากพี่เลี้ยงสถานประกอบการแล้ว
            </p>
          </div>
          <span className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-brand-blue/10 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800 self-start sm:self-auto">
            {pendingAdvisorCount} รายการรอที่ปรึกษาอนุมัติ
          </span>
        </div>

        <AlertBanner variant="error" message={error} />

        <AlertBanner variant="success" message={success} />

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          {reportOutlines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                    <th className="p-4 font-semibold">นักศึกษาในที่ปรึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">อัปโหลดล่าสุด</th>
                    <th className="p-4 font-semibold text-center">สถานะการอนุมัติ</th>
                    <th className="p-4 font-semibold text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {reportOutlines.map((item) => (
                    <tr key={item.outline_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4">
                        <div className="font-bold text-gray-800 dark:text-gray-200">
                          {item.first_name ? `${item.first_name} ${item.last_name}` : `รหัส: ${item.student_code}`}
                        </div>
                        <div className="text-xs text-gray-400">
                          รหัส: <span className="font-mono">{item.student_code}</span> ({item.major_name_th})
                        </div>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {item.company_name_th}
                      </td>
                      <td className="p-4 text-gray-500 font-mono text-xs dark:text-gray-400">
                        {item.latest_submitted_at
                          ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.latest_submitted_at))
                          : '-'}
                      </td>
                      <td className="p-4 text-center">
                        {/* Kept local rather than moved into ui/StatusBadge: the
                            keys collide across domains — an appointment's
                            `accepted` is not an intent's, and an outline's
                            `rejected` may come from the mentor, not the advisor.
                            A shared table keyed on the bare status would hand
                            back confidently wrong Thai. What is fixed here is
                            the fallback, which used to call *any* unrecognised
                            status "ตีกลับแก้ไข" — inventing a rejection. */}
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${
                          OUTLINE_STATUS[item.status]?.tone
                            ?? 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                        }`}
                        title={OUTLINE_STATUS[item.status] ? undefined : `สถานะที่ยังไม่ได้กำหนดคำอธิบาย: ${item.status}`}>
                          {OUTLINE_STATUS[item.status]?.text ?? item.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {/* The flex lived on the <td> itself, which drops the
                            cell out of the table's column sizing. Wrap instead. */}
                        <div className="flex items-center justify-end gap-2">
                        {item.latest_file_path && (
                          <a
                            href={`${API_BASE_URL}/files/${item.latest_file_path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all active:scale-[0.97] dark:border-gray-800 dark:hover:text-blue-400"
                            title="เปิดอ่านไฟล์ PDF โครงร่าง"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReviewingOutline(item);
                            setOutlineComment(item.latest_rejection_comment || '');
                          }}
                          className="py-1.5 px-3 rounded-lg bg-brand-blue text-white hover:bg-blue-600 font-bold text-xs transition-all active:scale-[0.97] shadow-sm shadow-blue-500/10"
                        >
                          {item.status === 'pending_advisor' ? 'เปิดตรวจอนุมัติ' : 'ดูประวัติ/ผลตรวจ'}
                        </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              ไม่พบข้อมูลโครงร่างรายงาน (สหกิจ 11) ของนักศึกษาในที่ปรึกษา
            </div>
          )}
        </div>
        {advisorModals}
      </div>
    );
  }

  // The supervision view that used to live here was unreachable: Dashboard.tsx
  // routes advisor "supervision" to pages/Advisor/SupervisionTracking, so this
  // branch never rendered. Everything it showed that the live screen lacked —
  // the travel-request button, the mentor and company contact block, the
  // accommodation phone, the advisor/supervisor role tag — has been moved
  // there. The one thing deliberately left behind is the "รูปแบบการนิเทศ"
  // panel, which hardcoded "On-site" for every student next to a note saying
  // the real calculation was coming later.


  // Render Dashboard View (Default)
  return (
    <div className="space-y-6 page-enter">
      <div>
        {/* heading kept exactly as expected by E2E tests: ระบบตรวจสอบใบความจำนง (อาจารย์ที่ปรึกษา) */}
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">ระบบตรวจสอบใบความจำนง (อาจารย์ที่ปรึกษา)</h2>
        <p className="text-xs text-gray-400 mt-1">
          พิจารณาอนุมัติคำขอฝึกงานของนักศึกษาในสาขาวิชาที่ดูแล พร้อมสถิติสรุปภาพรวมข้อมูล
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Total Students */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-brand-blue dark:text-blue-400 rounded-2xl">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-medium">นักศึกษาในสาขาทั้งหมด</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {students.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>

        {/* Card 2: Pending Intents */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400 rounded-2xl">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-medium">คำร้องที่รอพิจารณาอนุมัติ</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {pendingIntents.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>

        {/* Card 3: Approved Placements */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 rounded-2xl">
            <CheckCircle className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-medium">อนุมัติแล้ว/กำลังดำเนินการ</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {approvedIntents.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>
      </div>

      {/* Pending list table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            คำขอที่รอพิจารณาอนุมัติ ({pendingIntents.length} รายการ)
          </span>
        </div>

        {pendingIntents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">สถานประกอบการ</th>
                  <th className="p-4 font-semibold">ตำแหน่งงาน</th>
                  <th className="p-4 font-semibold text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pendingIntents.map((intent) => {
                  const isPendingAction = submittingAction === intent.form_id;

                  return (
                    <tr key={intent.form_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">{intentStudentName(intent)}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">รหัส: {intent.student_code}</span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {intent.company_name_th}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {intent.job_title || 'ฝึกงานทั่วไป'}
                      </td>
                      <td className="p-4 text-right">
                        {/* The flex lived on the <td> itself, which drops the
                            cell out of the table's column sizing. Wrap instead. */}
                        <div className="flex items-center justify-end gap-2">
                        {/* 1. Review button for detailed popup modal */}
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: intent.form_id }))}
                          className="py-1.5 px-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold transition-all text-gray-700 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800 text-xs"
                        >
                          ตรวจทาน
                        </button>

                        {/* 2. Reject button (Direct inline/dialog required by E2E tests) */}
                        <button
                          type="button"
                          onClick={() => setRejectingIntentId(intent.form_id)}
                          disabled={isPendingAction}
                          className="py-1.5 px-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-bold transition-all disabled:opacity-50 text-xs"
                        >
                          ตีกลับ
                        </button>

                        {/* 3. Approve button (Direct quick action required by E2E tests) */}
                        <button
                          type="button"
                          onClick={() => handleApprove(intent.form_id)}
                          disabled={isPendingAction}
                          className={`py-1.5 px-2.5 rounded-lg text-white font-bold transition-all text-xs ${
                            !isPendingAction
                              ? 'bg-brand-blue hover:bg-blue-600 shadow-sm'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800'
                          }`}
                        >
                          {isPendingAction ? 'รอ...' : 'อนุมัติ'}
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400 text-sm">
            ไม่มีรายการใบความจำนงคำขอรอตรวจสอบในขณะนี้
          </div>
        )}
      </div>

      {/* Rejection Modal Dialog (Required for inline Reject action) */}
      {rejectingIntentId !== null && (
        <Modal
          onClose={() => {
            setRejectingIntentId(null);
            setRejectReason('');
            setCustomReason('');
            setRejectError(null);
          }}
          size="md"
          closeOnBackdrop={false}
          title="ปฏิเสธและตีกลับใบความจำนง"
        >
          <ModalBody>
            <div className="space-y-4">
              <AlertBanner variant="error" message={rejectError} />
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  สาเหตุการตีกลับหลัก
                </label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="">-- กรุณาเลือกสาเหตุการปฏิเสธ --</option>
                  <option value="ตำแหน่งงานไม่ตรงกับสาขาวิชาที่เรียน">ตำแหน่งงานไม่ตรงกับสาขาวิชาที่เรียน</option>
                  <option value="สถานประกอบการไม่ผ่านเกณฑ์มาตรฐานของหลักสูตร">สถานประกอบการไม่ผ่านเกณฑ์มาตรฐานของหลักสูตร</option>
                  <option value="ข้อมูลประวัตินักศึกษาหรือเกรดไม่ถูกต้อง">ข้อมูลประวัตินักศึกษาหรือเกรดไม่ถูกต้อง</option>
                  <option value="other">ระบุเหตุผลอื่นๆ ด้วยตนเอง</option>
                </select>
              </div>

              {rejectReason === 'other' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    ระบุเหตุผลเพิ่มเติม (ภาษาไทย)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="กรอกเหตุผลรายละเอียดที่จะตีกลับแจ้งไปยังนักศึกษา"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant="secondary"
              size="sm"
              disabled={submittingAction !== null}
              onClick={() => {
                setRejectingIntentId(null);
                setRejectReason('');
                setCustomReason('');
                setRejectError(null);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={submittingAction === rejectingIntentId}
              loadingLabel="กำลังส่งข้อมูล..."
              onClick={handleRejectSubmit}
            >
              ยืนยันการปฏิเสธ
            </Button>
          </ModalFooter>
        </Modal>
      )}

    </div>
  );
};

export default AdvisorDashboard;

