import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton from '../../components/ui/Skeleton';
import api, { API_BASE_URL } from '../../services/api';
import { FileText, CheckCircle, XCircle } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';

interface ReportConfirmation {
  confirmationId: number;
  status: 'pending' | 'certified' | string;
  requestedAt: string | null;
  certifiedAt: string | null;
}

interface StudentProgress {
  studentId: number;
  studentCode: string;
  studentName: string;
  majorName: string;
  companyName: string;
  advisorName: string;
  progressPercent: number;
  finalReportStatus: string;
  finalReportPath: string | null;
  finalReportId: number | null;
  sahatkit15Score: number | null;
  sahatkit16Score: number | null;
  lastNotifiedAt: string | null;
  reportConfirmation: ReportConfirmation | null;
}

interface FinalReportHistoryItem {
  report_id: number;
  file_path: string;
  status: string;
  rejection_comment: string | null;
  version: number;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_email?: string;
  reviewer_kind?: string;
}

const AdvisorEvaluation: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentProgress | null>(null);
  const [studentReports, setStudentReports] = useState<FinalReportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [rejectionComment, setRejectionComment] = useState<string>('');
  const [certifyDialogOpen, setCertifyDialogOpen] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/coop-progress/dashboard');
      const list: StudentProgress[] = res.data || [];
      setStudents(list);

      // Restore selected student from URL param if available
      const urlStudentId = searchParams.get('student');
      if (urlStudentId) {
        const found = list.find((s) => String(s.studentId) === urlStudentId);
        if (found) {
          setSelectedStudent(found);
        } else if (list.length > 0) {
          setSelectedStudent(list[0]);
        }
      } else if (list.length > 0) {
        setSelectedStudent(list[0]);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลความคืบหน้าได้'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Load student report history when selectedStudent changes
  useEffect(() => {
    if (!selectedStudent?.studentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStudentReports([]);
      return;
    }

    let isMounted = true;
    api
      .get(`/final-reports/student/${selectedStudent.studentId}`)
      .then((res) => {
        if (isMounted) {
          setStudentReports(res.data || []);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setStudentReports([]);
          setError(getErrorMessage(err, 'ไม่สามารถโหลดประวัติเล่มรายงานของนักศึกษาคนนี้ได้'));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedStudent?.studentId]);

  const handleSelectStudent = (student: StudentProgress) => {
    setSelectedStudent(student);
    setSuccess(null);
    setError(null);
    setRejectionComment('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('student', String(student.studentId));
      return next;
    });
  };

  // Step 1: Approve or Reject final report
  const handleReviewReport = async (status: 'approved' | 'rejected') => {
    if (!selectedStudent || !selectedStudent.finalReportId) return;
    if (status === 'rejected' && !rejectionComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะว่าต้องแก้ไขอะไร ก่อนส่งเล่มรายงานกลับ');
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      setSuccess(null);

      await api.patch(`/final-reports/${selectedStudent.finalReportId}/status`, {
        status,
        comment: status === 'rejected' ? rejectionComment.trim() : null,
      });

      setSuccess(
        status === 'approved'
          ? 'อนุมัติเล่มรายงานเรียบร้อยแล้ว'
          : 'ส่งรายงานกลับไปให้นักศึกษาแก้ไขแล้ว'
      );
      setRejectionComment('');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การเปลี่ยนสถานะเล่มรายงานล้มเหลว'));
    } finally {
      setActionLoading(false);
    }
  };

  // Step 2: Certify report confirmation (สหกิจ 14)
  const handleCertifyConfirmation = async () => {
    if (!selectedStudent?.reportConfirmation?.confirmationId) return;

    try {
      setActionLoading(true);
      setError(null);
      setSuccess(null);

      await api.patch(
        `/report-confirmations/${selectedStudent.reportConfirmation.confirmationId}/certify`
      );

      setSuccess('ลงนามรับรอง สหกิจ 14 เรียบร้อยแล้ว');
      setCertifyDialogOpen(false);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การลงนามรับรอง สหกิจ 14 ล้มเหลว'));
    } finally {
      setActionLoading(false);
    }
  };

  const formatDisplayDate = (isoStr?: string | null) => {
    if (!isoStr) return '';
    return formatThaiDate(String(isoStr).slice(0, 10));
  };

  // Find mentor review draft info for selected student
  const mentorDraft = studentReports.find(
    (r) => r.reviewer_kind === 'mentor' || r.reviewer_email
  );

  const advisorName = selectedStudent?.advisorName || 'อาจารย์ที่ปรึกษา';

  if (loading) {
    return <PageSkeleton variant="cards" />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 page-enter pb-12">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          สองขั้นของอาจารย์ที่ปรึกษา: <strong className="text-gray-900 dark:text-gray-200">① ตรวจรับเล่มฉบับสมบูรณ์</strong> → นักศึกษายื่นแบบแจ้งยืนยันการส่งรายงาน → <strong className="text-gray-900 dark:text-gray-200">② ลงนามรับรอง สหกิจ 14</strong> · คะแนน สหกิจ 15/16 เป็นของพนักงานที่ปรึกษา หน้านี้ดูได้อย่างเดียว
        </p>
      </div>

      {students.length === 0 ? (
        <div className="card p-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl text-center space-y-2">
          <span className="inline-block text-xs font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-lg px-2.5 py-1">
            ยังไม่มีนักศึกษาในที่ปรึกษา
          </span>
          <h3 className="font-bold text-base text-gray-900 dark:text-white">
            หัวหน้าสาขาวิชายังไม่ได้จัดสรรนักศึกษาให้คุณเป็นที่ปรึกษา
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            รายชื่อจะขึ้นเมื่อหัวหน้าสาขากำหนดอาจารย์ที่ปรึกษา
          </p>
        </div>
      ) : (
        <>
          {/* Table matching FinalReportCheck.dc.html lines 99-141 */}
          <div className="card overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
                    <th className="px-4 py-3 text-xs font-bold text-gray-600 dark:text-gray-400">นักศึกษาในที่ปรึกษา</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-600 dark:text-gray-400">① เล่มฉบับสมบูรณ์</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-600 dark:text-gray-400">② สหกิจ 14</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-600 dark:text-gray-400">สหกิจ 15 · พี่เลี้ยง</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-600 dark:text-gray-400">สหกิจ 16 · พี่เลี้ยง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {students.map((std) => {
                    const isSelected = selectedStudent?.studentId === std.studentId;
                    return (
                      <tr
                        key={std.studentId}
                        data-testid={`final-row-${std.studentId}`}
                        onClick={() => handleSelectStudent(std)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/90 dark:bg-blue-950/40 border-l-4 border-l-brand-blue'
                            : 'hover:bg-gray-50/70 dark:hover:bg-gray-800/40'
                        }`}
                      >
                        <td className="px-4 py-3.5 align-top">
                          <span className="font-bold text-gray-900 dark:text-white block text-[15px]">
                            {std.studentName}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">
                            {std.studentCode}
                          </span>
                          {std.companyName && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 block mt-0.5 truncate max-w-xs">
                              {std.companyName}
                            </span>
                          )}
                        </td>

                        {/* Column 2: ① เล่มฉบับสมบูรณ์ */}
                        <td className="px-4 py-3.5 align-top">
                          {std.finalReportStatus === 'submitted' ? (
                            <div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                ส่งแล้ว · รอคุณตรวจรับ
                              </span>
                              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                ฉบับล่าสุด
                              </span>
                            </div>
                          ) : std.finalReportStatus === 'approved' ? (
                            <div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                ตรวจรับแล้ว
                              </span>
                            </div>
                          ) : std.finalReportStatus === 'rejected' ? (
                            <div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                                ส่งกลับแก้ไข
                              </span>
                              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                รอนักศึกษาส่งฉบับใหม่
                              </span>
                            </div>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ยังไม่ส่ง
                            </span>
                          )}
                        </td>

                        {/* Column 3: ② สหกิจ 14 */}
                        <td className="px-4 py-3.5 align-top">
                          {std.reportConfirmation?.status === 'certified' ? (
                            <div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                ลงนามรับรองแล้ว
                              </span>
                              {std.reportConfirmation.certifiedAt && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  {formatDisplayDate(std.reportConfirmation.certifiedAt)}
                                </span>
                              )}
                            </div>
                          ) : std.reportConfirmation?.status === 'pending' ? (
                            <div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                นักศึกษายื่นขอ · รอคุณลงนาม
                              </span>
                              {std.reportConfirmation.requestedAt && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  ยื่น {formatDisplayDate(std.reportConfirmation.requestedAt)}
                                </span>
                              )}
                            </div>
                          ) : std.finalReportStatus === 'approved' ? (
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              รอนักศึกษายื่นขอ
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ยื่นได้หลังขั้น ①
                            </span>
                          )}
                        </td>

                        {/* Column 4: สหกิจ 15 · พี่เลี้ยง */}
                        <td className="px-4 py-3.5 align-top">
                          {std.sahatkit15Score !== null ? (
                            <span className="text-[13px] text-gray-800 dark:text-gray-200">
                              <strong>{std.sahatkit15Score}</strong> / 100
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ยังไม่ส่ง
                            </span>
                          )}
                        </td>

                        {/* Column 5: สหกิจ 16 · พี่เลี้ยง */}
                        <td className="px-4 py-3.5 align-top">
                          {std.sahatkit16Score !== null ? (
                            <span className="text-[13px] text-gray-800 dark:text-gray-200">
                              <strong>{std.sahatkit16Score}</strong> / 70
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ยังไม่ส่ง
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Side-by-side action cards for Step ① and Step ② */}
          {selectedStudent && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* ══ ขั้น ① ตรวจรับเล่มฉบับสมบูรณ์ (?student=...&step=report) ══ */}
              <div
                data-testid="final-report-panel"
                className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-3.5"
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <span className="text-xs font-bold text-blue-700 dark:text-blue-400 block">
                      ① ตรวจรับเล่มฉบับสมบูรณ์
                    </span>
                    <span className="text-lg font-bold text-gray-900 dark:text-white block mt-0.5">
                      {selectedStudent.studentName}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      รายละเอียดการส่งเล่มของนักศึกษา: รหัส {selectedStudent.studentCode} · {selectedStudent.companyName}
                    </p>
                  </div>

                  {selectedStudent.finalReportPath ? (
                    <a
                      href={`${API_BASE_URL}/files/${selectedStudent.finalReportPath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/60 shadow-sm transition-colors shrink-0"
                    >
                      <FileText className="w-4 h-4" />
                      เปิดเล่มรายงาน (PDF)
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      ยังไม่มีไฟล์รายงาน
                    </span>
                  )}
                </div>

                {/* Mentor review info box */}
                <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 text-xs leading-relaxed text-gray-700 dark:text-gray-300 space-y-1">
                  <div>
                    ร่างที่ส่งพนักงานที่ปรึกษา:{' '}
                    {mentorDraft ? (
                      mentorDraft.reviewed_at ? (
                        <strong>
                          พี่เลี้ยงตรวจแล้ว {formatDisplayDate(mentorDraft.reviewed_at)}
                          {mentorDraft.rejection_comment ? ` · “${mentorDraft.rejection_comment}”` : ''}
                        </strong>
                      ) : (
                        <strong>นักศึกษาส่งให้พี่เลี้ยงแล้ว (รอผลตรวจ)</strong>
                      )
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">ยังไม่มีข้อมูลร่างที่ส่งพี่เลี้ยง</span>
                    )}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">
                    ข้อมูลประกอบ ไม่ใช่เงื่อนไข — คู่มือให้ส่งพี่เลี้ยงตรวจอย่างน้อย 2 สัปดาห์ก่อนสิ้นสุด
                  </div>
                </div>

                {/* Rejection comment textarea */}
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    ข้อเสนอแนะ <span className="font-normal text-gray-500 dark:text-gray-400">(บังคับเมื่อส่งกลับแก้)</span>
                  </span>
                  <textarea
                    data-testid="final-report-comment"
                    rows={3}
                    value={rejectionComment}
                    onChange={(e) => setRejectionComment(e.target.value)}
                    disabled={selectedStudent.finalReportStatus !== 'submitted'}
                    placeholder="ระบุข้อเสนอแนะ หรือสิ่งที่นักศึกษาต้องนำกลับไปปรับปรุงแก้ไข..."
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:bg-gray-100 dark:disabled:bg-gray-800/40 disabled:text-gray-500"
                  />
                </label>

                {/* Action buttons or status indicator */}
                {selectedStudent.finalReportStatus === 'submitted' && (
                  <div className="flex justify-end gap-2.5 pt-1">
                    <button
                      data-testid="final-report-reject"
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleReviewReport('rejected')}
                      className="px-4 py-2 text-sm font-bold rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                    >
                      ส่งกลับให้แก้ไข
                    </button>
                    <button
                      data-testid="final-report-approve"
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleReviewReport('approved')}
                      className="px-4 py-2 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors cursor-pointer"
                    >
                      ตรวจรับเล่มรายงาน
                    </button>
                  </div>
                )}

                {selectedStudent.finalReportStatus === 'approved' && (
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    เล่มรายงานสหกิจศึกษานี้ได้รับการอนุมัติเรียบร้อยแล้ว
                  </div>
                )}

                {selectedStudent.finalReportStatus === 'rejected' && (
                  <div className="p-3.5 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 flex items-center gap-2 text-sm font-semibold">
                    <XCircle className="w-4 h-4 shrink-0" />
                    ส่งกลับให้นักศึกษาแก้ไขแล้ว (รอนักศึกษาส่งฉบับใหม่)
                  </div>
                )}

                {selectedStudent.finalReportStatus === 'not_submitted' && (
                  <div className="p-3.5 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 rounded-xl border border-gray-200 dark:border-gray-700 text-sm">
                    นักศึกษายังไม่ได้ส่งเล่มรายงานฉบับสมบูรณ์
                  </div>
                )}
              </div>

              {/* ══ ขั้น ② ลงนามรับรอง สหกิจ 14 ══ */}
              <div className="flex flex-col gap-4">
                <div className="card bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700/60 rounded-2xl p-5 md:p-6 shadow-sm space-y-3">
                  <div>
                    <span className="text-xs font-bold text-amber-800 dark:text-amber-400 block">
                      ② ลงนามรับรอง สหกิจ 14 — แบบแจ้งยืนยันการส่งรายงานการปฏิบัติงาน
                    </span>
                    <span className="block font-bold text-lg text-gray-900 dark:text-white mt-0.5">
                      {selectedStudent.studentName}
                    </span>
                  </div>

                  {selectedStudent.reportConfirmation?.status === 'pending' ? (
                    <>
                      <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 space-y-1">
                        <p>
                          นักศึกษายื่นขอเมื่อ {formatDisplayDate(selectedStudent.reportConfirmation.requestedAt)} · อ้างเล่มฉบับที่คุณตรวจรับแล้ว
                        </p>
                        <p>
                          การลงนามนี้ยืนยันว่า <strong className="text-gray-900 dark:text-white">นักศึกษาส่งเล่มรายงานครบแล้วจริง</strong> — ไม่ใช่การให้คะแนน
                        </p>
                      </div>
                      <div className="flex justify-end pt-2">
                        <button
                          data-testid={`confirmation-certify-${selectedStudent.reportConfirmation.confirmationId}`}
                          type="button"
                          disabled={actionLoading}
                          onClick={() => setCertifyDialogOpen(true)}
                          className="px-4 py-2 text-sm font-bold rounded-xl bg-brand-blue hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer"
                        >
                          ลงนามรับรอง สหกิจ 14
                        </button>
                      </div>
                    </>
                  ) : selectedStudent.reportConfirmation?.status === 'certified' ? (
                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      ลงนามรับรอง สหกิจ 14 เรียบร้อยแล้ว
                      {selectedStudent.reportConfirmation.certifiedAt
                        ? ` เมื่อ ${formatDisplayDate(selectedStudent.reportConfirmation.certifiedAt)}`
                        : ''}
                    </div>
                  ) : (
                    <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 space-y-1">
                      {selectedStudent.finalReportStatus === 'approved' ? (
                        <p>
                          คุณได้ตรวจรับเล่มรายงานแล้ว รอนักศึกษายื่นขอแบบแจ้งยืนยันการส่งรายงาน (สหกิจ 14) ในระบบ
                        </p>
                      ) : (
                        <p>
                          นักศึกษาจะสามารถยื่นขอลงนาม สหกิจ 14 ได้ หลังจากที่คุณตรวจรับเล่มรายงานฉบับสมบูรณ์ (ขั้น ①) เรียบร้อยแล้ว
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Mentor evaluation scores (read-only) */}
                <div className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm space-y-3">
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                    ผลประเมินจากพนักงานที่ปรึกษา (พี่เลี้ยง) · อ่านอย่างเดียว
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40">
                      <span className="text-xs text-gray-500 dark:text-gray-400 block font-medium">
                        สหกิจ 15 (ผลการปฏิบัติงาน)
                      </span>
                      {selectedStudent.sahatkit15Score !== null ? (
                        <span className="text-base font-bold text-gray-900 dark:text-white block mt-0.5">
                          สหกิจ 15: {selectedStudent.sahatkit15Score}/100
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400 block mt-1">
                          ยังไม่ส่งผลประเมิน
                        </span>
                      )}
                    </div>

                    <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40">
                      <span className="text-xs text-gray-500 dark:text-gray-400 block font-medium">
                        สหกิจ 16 (รายงาน)
                      </span>
                      {selectedStudent.sahatkit16Score !== null ? (
                        <span className="text-base font-bold text-gray-900 dark:text-white block mt-0.5">
                          สหกิจ 16: {selectedStudent.sahatkit16Score}/70
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400 block mt-1">
                          ยังไม่ส่งผลประเมิน
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Guidelines Cards matching FinalReportCheck.dc.html lines 177-188 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="card p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col gap-1.5 items-center text-center">
              <span className="self-start text-[11px] font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg px-2 py-0.5">
                กระบวนการ
              </span>
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                การตรวจเล่มและลงนาม สหกิจ 14
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                อาจารย์ที่ปรึกษาตรวจรับเล่มฉบับสมบูรณ์ก่อน เมื่อนักศึกษายื่นขอ สหกิจ 14 จึงลงนามรับรอง
              </p>
            </div>

            <div className="card p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col gap-1.5 items-center text-center">
              <span className="self-start text-[11px] font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg px-2 py-0.5">
                ระเบียบปฏิบัติ
              </span>
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                ไม่มีคำว่า “ผ่าน / ไม่ผ่าน” ในหน้านี้
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ระบบบันทึกเฉพาะการส่งเล่มและผลประเมินของสถานประกอบการ · อาจารย์เป็นผู้ตัดเกรดนอกระบบ
              </p>
            </div>
          </div>
        </>
      )}

      {/* ConfirmDialog for Step ② Certifying สหกิจ 14 */}
      <ConfirmDialog
        open={certifyDialogOpen}
        title="ยืนยันการลงนามรับรอง สหกิจ 14"
        message={
          <div className="text-sm space-y-2 text-gray-600 dark:text-gray-300">
            <p>
              ลงนามในนาม <strong className="text-gray-900 dark:text-white">{advisorName}</strong> ว่า{' '}
              <strong className="text-gray-900 dark:text-white">{selectedStudent?.studentName}</strong>{' '}
              ส่งรายงานการปฏิบัติงานฉบับสมบูรณ์แล้ว
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800">
              การลงนามนี้ยืนยันว่านักศึกษาส่งเล่มครบแล้วจริง ไม่ใช่การให้คะแนน · ชื่อของคุณจะถูกพิมพ์ลงแบบฟอร์มที่นักศึกษาพิมพ์ออก และไม่สามารถถอนการลงนามได้
            </p>
          </div>
        }
        confirmLabel="ลงนาม"
        cancelLabel="ยกเลิก"
        busy={actionLoading}
        onConfirm={handleCertifyConfirmation}
        onCancel={() => setCertifyDialogOpen(false)}
      />
    </div>
  );
};

export default AdvisorEvaluation;
