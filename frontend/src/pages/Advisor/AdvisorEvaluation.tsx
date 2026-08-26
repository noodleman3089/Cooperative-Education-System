import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api, { API_BASE_URL } from '../../services/api';
import { User, ClipboardList, CheckCircle, XCircle, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { getErrorMessage } from '../../utils/errors';

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
}

const AdvisorEvaluation: React.FC = () => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [rejectionComment, setRejectionComment] = useState<string>('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch progress from backend (filters for current advisor automatically)
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

  const handleSelectStudent = (student: StudentProgress) => {
    setSelectedStudent(student);
    setSuccess(null);
    setError(null);
    setRejectionComment('');
  };

  // Review status submission: Approve or Reject
  const handleReviewReport = async (status: 'approved' | 'rejected') => {
    if (!selectedStudent || !selectedStudent.finalReportId) return;
    if (status === 'rejected' && !rejectionComment) {
      setError('กรุณาระบุความคิดเห็นและข้อเสนอแนะในการแก้ไขรายงาน เพื่อส่งกลับให้นักศึกษา');
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      setSuccess(null);

      await api.patch(`/final-reports/${selectedStudent.finalReportId}/status`, {
        status,
        comment: status === 'rejected' ? rejectionComment : null
      });

      setSuccess(status === 'approved' ? 'อนุมัติเล่มรายงานเรียบร้อยแล้ว' : 'ส่งรายงานกลับไปให้นักศึกษาแก้ไขแล้ว');
      setSelectedStudent(null);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การเปลี่ยนสถานะเล่มรายงานล้มเหลว'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='cards' />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 page-enter">
      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {!selectedStudent ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 md:p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-blue dark:text-blue-400" />
            ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)
          </h1>
          <p className="mb-8 text-gray-600 dark:text-gray-400">
            ตรวจอนุมัติเล่มรายงานของนักศึกษาในความดูแล และดูผลประเมินจากพนักงานที่ปรึกษา
          </p>

          {students.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {students.map((std) => (
                // Was a <div onClick>, which no keyboard could reach — this is
                // the only way into the grading form.
                <button
                  type="button"
                  key={std.studentId}
                  onClick={() => handleSelectStudent(std)}
                  className="w-full p-5 text-left border border-gray-200 dark:border-gray-700 hover:border-brand-blue rounded-xl flex items-center justify-between cursor-pointer hover:shadow-md transition-all duration-200 dark:bg-gray-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                >
                  <div className="space-y-1.5">
                    <h3 className="font-bold text-gray-900 dark:text-white">
                      {std.studentName}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">รหัส: {std.studentCode}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">บริษัท: {std.companyName}</p>
                    
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {std.finalReportStatus === 'approved' ? (
                        <span className="text-xs font-semibold text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400 px-2 py-0.5 rounded-full">
                          เล่มรายงานอนุมัติแล้ว
                        </span>
                      ) : std.finalReportStatus === 'submitted' ? (
                        <span className="text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          รออนุมัติเล่มรายงาน
                        </span>
                      ) : std.finalReportStatus === 'rejected' ? (
                        <span className="text-xs font-semibold text-red-700 bg-red-50 dark:bg-red-950/20 dark:text-red-400 px-2 py-0.5 rounded-full">
                          ส่งกลับแก้ไข
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full dark:text-gray-400">
                          ยังไม่ส่งเล่มรายงาน
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    {std.sahatkit15Score !== null ? (
                      <span className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 dark:bg-green-950/30 dark:text-green-400">
                        สหกิจ 15: {std.sahatkit15Score}/100
                      </span>
                    ) : (
                      <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        สหกิจ 15: รอพี่เลี้ยงประเมิน
                      </span>
                    )}

                    {std.sahatkit16Score !== null ? (
                      <span className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 dark:bg-green-950/30 dark:text-green-400">
                        สหกิจ 16: {std.sahatkit16Score}/70
                      </span>
                    ) : (
                      <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        สหกิจ 16: รอพี่เลี้ยงประเมิน
                      </span>
                    )}

                    <span className="flex items-center text-xs font-medium text-brand-blue dark:text-blue-400">
                      ตรวจเล่มรายงาน <ChevronRight className="ml-1 h-4 w-4" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
              <User className="w-12 h-12 text-gray-600 dark:text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">ไม่มีนักศึกษาในที่ปรึกษาสหกิจของคุณ</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">รายชื่อจะปรากฏก็ต่อเมื่อคุณได้รับการมอบหมายบทบาทและจัดสรรนักศึกษาในเฟสที่ 1</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Back button */}
          <Button variant="ghost" size="sm" onClick={() => setSelectedStudent(null)}>
            &larr; ย้อนกลับไปรายชื่อนักศึกษา
          </Button>

          {/* Section 1: Final Report Approval */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 md:p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand-blue dark:text-blue-400" />
              การพิจารณาตรวจสอบเล่มรายงาน (สหกิจ 14)
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              ตรวจสอบไฟล์เอกสารที่นักศึกษาส่งเข้ามา หากถูกต้องเหมาะสมสามารถกดอนุมัติ หรือแจ้งตีกลับหากต้องการให้แก้ไขเพิ่มเติม
            </p>

            <div className="grid md:grid-cols-2 gap-6 items-start">
              <div className="p-5 bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
                <h3 className="font-bold text-gray-900 dark:text-white">รายละเอียดการส่งเล่มของนักศึกษา</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300"><b>ชื่อนักศึกษา:</b> {selectedStudent.studentName}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300"><b>รหัสนักศึกษา:</b> {selectedStudent.studentCode}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300"><b>บริษัท:</b> {selectedStudent.companyName}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                  <b>สถานะไฟล์ปัจจุบัน:</b> 
                  {/* `dark:text-gray-400` used to sit outside this ternary, so in
                      dark mode every state rendered the same grey text — approved
                      and rejected became indistinguishable apart from a faint
                      background. Each branch carries its own dark pair now. */}
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                    selectedStudent.finalReportStatus === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    selectedStudent.finalReportStatus === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    selectedStudent.finalReportStatus === 'submitted' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}>
                    {selectedStudent.finalReportStatus === 'approved' ? 'อนุมัติแล้ว' :
                     selectedStudent.finalReportStatus === 'rejected' ? 'ส่งตีกลับแก้ไข' :
                     selectedStudent.finalReportStatus === 'submitted' ? 'ส่งเล่มรออนุมัติ' :
                     'ยังไม่มีการส่งเล่ม'}
                  </span>
                </p>

                {/* finalReportPath is already "final_reports/<file>", which is
                    the category/filename shape /api/files expects. The old
                    hardcoded http://localhost:5000/uploads/ URL was served by
                    nothing at all — there is no express.static for /uploads. */}
                {selectedStudent.finalReportPath ? (
                  <div className="pt-2">
                    <a
                      href={`${API_BASE_URL}/files/${selectedStudent.finalReportPath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-brand-blue hover:bg-blue-600 text-white rounded-xl text-sm font-semibold transition shadow-sm"
                    >
                      <FileText className="w-4 h-4" />
                      เปิดอ่านเล่มรายงาน PDF
                    </a>
                  </div>
                ) : (
                  // red-500 เดิมได้ 3.66 (สว่าง) / 3.85 (มืด) ตกเกณฑ์ 4.5 ทั้งคู่ — วัดจริงแล้ว
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">นักศึกษายังไม่ทำการอัปโหลดไฟล์เล่มรายงานเข้ามาในเฟสนี้</p>
                )}
              </div>

              {selectedStudent.finalReportPath && selectedStudent.finalReportStatus !== 'approved' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900 dark:text-white">ดำเนินการตรวจสอบสถานะเล่มรายงาน</h3>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                      ระบุความคิดเห็น/ข้อเสนอแนะในการตีกลับเพื่อแก้ไข (จำเป็นกรณีตีกลับ)
                    </label>
                    <textarea
                      value={rejectionComment}
                      onChange={(e) => setRejectionComment(e.target.value)}
                      placeholder="อธิบายสิ่งสำคัญที่นักศึกษาต้องนำกลับไปปรับปรุงแก้ไข..."
                      rows={3}
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="danger"
                      loading={actionLoading}
                      loadingLabel="กำลังส่ง..."
                      icon={<XCircle className="w-4 h-4" />}
                      onClick={() => handleReviewReport('rejected')}
                      className="flex-1"
                    >
                      ตีกลับไปแก้ไข
                    </Button>
                    <Button
                      variant="success"
                      loading={actionLoading}
                      loadingLabel="กำลังส่ง..."
                      icon={<CheckCircle className="w-4 h-4" />}
                      onClick={() => handleReviewReport('approved')}
                      className="flex-1"
                    >
                      อนุมัติรายงาน
                    </Button>
                  </div>
                </div>
              )}

              {selectedStudent.finalReportStatus === 'approved' && (
                <div className="p-4 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-400 rounded-xl border border-green-100 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-semibold">เล่มรายงานสหกิจศึกษานี้ได้รับการอนุมัติเรียบร้อยแล้ว</span>
                </div>
              )}
            </div>
          </div>

          {/* ผลประเมินจากพี่เลี้ยง — อ่านอย่างเดียว
              อาจารย์ไม่ใช่ผู้ประเมิน: ทั้ง สหกิจ 15 และ 16 เป็นของพนักงานที่ปรึกษาตามแบบฟอร์มจริง
              เดิมหน้านี้มีฟอร์ม 10 ข้อที่ระบบคิดขึ้นเองซึ่งไม่ตรงกับแบบฟอร์มไหนในชุด 01-16
              อาจารย์ยังต้องเห็นคะแนนเพราะกล่องสรุปท้าย สหกิจ 15 เขียนว่า "สำหรับอาจารย์นิเทศงานสหกิจศึกษา" */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">
              ผลประเมินจากพนักงานที่ปรึกษา (พี่เลี้ยง)
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              การให้คะแนนเป็นหน้าที่ของพนักงานที่ปรึกษาในสถานประกอบการ อาจารย์นิเทศใช้ผลนี้ประกอบการสรุปเกรด
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <span className="block text-xs font-bold text-gray-600 dark:text-gray-400">
                  สหกิจ 15 — แบบประเมินผลนักศึกษา
                </span>
                {selectedStudent.sahatkit15Score !== null ? (
                  <>
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      สหกิจ 15: {selectedStudent.sahatkit15Score}/100
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-amber-800 dark:text-amber-400">
                    รอพนักงานที่ปรึกษาประเมิน
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <span className="block text-xs font-bold text-gray-600 dark:text-gray-400">
                  สหกิจ 16 — แบบประเมินรายงาน
                </span>
                {selectedStudent.sahatkit16Score !== null ? (
                  <>
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      สหกิจ 16: {selectedStudent.sahatkit16Score}/70
                    </span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400">
                      เรตติ้งคุณภาพรายงาน ไม่รวมกับคะแนนประเมินผล
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-amber-800 dark:text-amber-400">
                    รอพนักงานที่ปรึกษาประเมิน
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdvisorEvaluation;
