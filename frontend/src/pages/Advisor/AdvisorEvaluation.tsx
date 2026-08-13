import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api, { API_BASE_URL } from '../../services/api';
import { User, ClipboardList, CheckCircle, XCircle, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

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
  mentorScore: number | null;
  advisorScore: number | null;
  totalScore: number;
  lastNotifiedAt: string | null;
}

const AdvisorEvaluation: React.FC = () => {
  const [students, setStudents] = useState<StudentProgress[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /**
   * Rubric scores, 1–10 each. Every item starts unset on purpose: the form used
   * to open with all ten pre-filled at 10, so an advisor who opened it and
   * pressed save had just awarded 100/100 without making a single judgement,
   * and there was no way to tell a deliberate perfect score from an untouched
   * form. The system does not get to guess an academic verdict.
   */
  const [scores, setScores] = useState<Record<string, number | ''>>({
    structure: '',
    objectives: '',
    literature: '',
    methodology: '',
    results: '',
    discussion: '',
    references: '',
    formatting: '',
    innovation: '',
    understanding: ''
  });
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  const [comments, setComments] = useState<string>('');
  const [rejectionComment, setRejectionComment] = useState<string>('');

  const rubrics = [
    { id: 'structure', label: '1. ความถูกต้องและครบถ้วนของโครงสร้างรายงาน', desc: 'มีส่วนประกอบของรายงานครบถ้วนตามแบบแผน (บทคัดย่อ บทนำ ทฤษฎี วิธีการดำเนินงาน ผล สรุป อ้างอิง)' },
    { id: 'objectives', label: '2. ความชัดเจนของวัตถุประสงค์และขอบเขตโครงการ', desc: 'วัตถุประสงค์สอดคล้องกับงานที่ได้รับมอบหมาย ขอบเขตโครงการอธิบายได้ชัดเจน' },
    { id: 'literature', label: '3. การทบทวนวรรณกรรมและการนำทฤษฎีมาอ้างอิง', desc: 'การค้นคว้า รวบรวมหลักการเชิงวิชาการ และเอกสารอ้างอิงเชิงลึกที่สอดคล้องกับปัญหา' },
    { id: 'methodology', label: '4. ระเบียบวิธีดำเนินงานและขั้นตอนปฏิบัติการ', desc: 'ความชัดเจนและความถูกต้องของวิธีการพัฒนา ซอฟต์แวร์ การทดลอง หรือการลงมือปฏิบัติงาน' },
    { id: 'results', label: '5. ผลการดำเนินงานและการวิเคราะห์ข้อมูล', desc: 'การนำเสนอข้อมูลผลลัพธ์ ตาราง แผนภูมิประกอบ และความลึกซึ้งในการอภิปรายผล' },
    { id: 'discussion', label: '6. การวิเคราะห์อภิปรายสรุปผลและข้อเสนอแนะ', desc: 'การสรุปเนื้อหาตอบวัตถุประสงค์โครงการ และการระบุข้อจำกัดรวมถึงข้อเสนอแนะในการปรับปรุง' },
    { id: 'references', label: '7. ความถูกต้องของการอ้างอิงและบรรณานุกรม', desc: 'รูปแบบการเขียนรายการบรรณานุกรมถูกต้องและครบถ้วนตามหลักมาตรฐานวิชาการ' },
    { id: 'formatting', label: '8. ความเรียบร้อยและการใช้ภาษาวิชาการ', desc: 'การพิมพ์ จัดย่อหน้า สารบัญ การใช้ไวยากรณ์ คำศัพท์เฉพาะทางเทคนิคที่ถูกต้องเป็นสากล' },
    { id: 'innovation', label: '9. ความคิดสร้างสรรค์และการประยุกต์ใช้นวัตกรรม', desc: 'การใช้เครื่องมือใหม่ ๆ วิธีการเชิงนวัตกรรม หรือระบบออโตเมชันในการพัฒนาโครงงาน' },
    { id: 'understanding', label: '10. ความสมบูรณ์เชิงเทคนิคและความเข้าใจของนักศึกษา', desc: 'เนื้อหาในเล่มแสดงให้เห็นว่านักศึกษาเข้าใจรายละเอียดปัญหาและการแก้ปัญหาทางวิชาการอย่างลึกซึ้ง' }
  ];

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch progress from backend (filters for current advisor automatically)
      const res = await api.get('/coop-progress/dashboard');
      setStudents(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลความคืบหน้าได้');
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
    setComments('');
    setRejectionComment('');
    setScores({
      structure: '',
      objectives: '',
      literature: '',
      methodology: '',
      results: '',
      discussion: '',
      references: '',
      formatting: '',
      innovation: '',
      understanding: ''
    });
  };

  const handleScoreChange = (rubricId: string, val: number | '') => {
    setScores(prev => ({
      ...prev,
      [rubricId]: val
    }));
  };

  /** Sum of what has been scored so far — not a final grade until all ten are in. */
  const calculateTotal = () =>
    Object.values(scores).reduce((sum: number, v) => sum + (v === '' ? 0 : v), 0);

  const unscoredRubrics = rubrics.filter((r) => scores[r.id] === '');

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
    } catch (err: any) {
      setError(err.response?.data?.message || 'การเปลี่ยนสถานะเล่มรายงานล้มเหลว');
    } finally {
      setActionLoading(false);
    }
  };

  // Score evaluation submission
  const handleSubmitEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    // The API totals whatever rubric keys arrive, so a partly filled form would
    // be stored as a real, quietly wrong score.
    if (unscoredRubrics.length > 0) {
      setError(
        `ยังให้คะแนนไม่ครบ เหลืออีก ${unscoredRubrics.length} ข้อ: ${unscoredRubrics
          .map((r) => r.label.split('.')[0])
          .join(', ')}`
      );
      setSuccess(null);
      return;
    }

    setError(null);
    setConfirmingSubmit(true);
  };

  const submitEvaluation = async () => {
    if (!selectedStudent) return;

    try {
      setActionLoading(true);
      setError(null);
      setSuccess(null);

      const payload = {
        studentId: selectedStudent.studentId,
        scoresDetail: {
          ...scores,
          comments
        }
      };

      await api.post('/final-evaluations', payload);

      setSuccess('บันทึกคะแนนรายงานวิชาการของอาจารย์นิเทศสำเร็จเรียบร้อย');
      setConfirmingSubmit(false);
      setSelectedStudent(null);
      await loadData();
    } catch (err: any) {
      setConfirmingSubmit(false);
      setError(err.response?.data?.message || 'ส่งคะแนนประเมินล้มเหลว');
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
            การประเมินเล่มรายงานสหกิจศึกษา (อาจารย์นิเทศ)
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            ตรวจเล่มรายงานวิชาการสะสมและสรุปคะแนนประเมินดิบของนักศึกษาในความดูแลของท่าน
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
                        <span className="text-xs font-semibold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full dark:text-gray-400">
                          ยังไม่ส่งเล่มรายงาน
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    {std.advisorScore !== null ? (
                      <span className="text-xs font-bold text-green-600 bg-green-50 dark:bg-green-950/30 px-3 py-1 rounded-lg">
                        อาจารย์ประเมินแล้ว ({std.advisorScore}/100)
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-brand-blue bg-blue-50 dark:bg-blue-950/30 px-3 py-1 rounded-lg flex items-center dark:text-blue-400">
                        รอกรอกคะแนน <ChevronRight className="w-4 h-4 ml-1" />
                      </span>
                    )}

                    {std.mentorScore !== null ? (
                      <span className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">
                        คะแนนพี่เลี้ยง: {std.mentorScore}/100
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">พี่เลี้ยงยังไม่ประเมิน</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
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
                  <p className="text-xs text-red-500 font-semibold">นักศึกษายังไม่ทำการอัปโหลดไฟล์เล่มรายงานเข้ามาในเฟสนี้</p>
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

          {/* Section 2: Advisor Evaluation Form */}
          <form onSubmit={handleSubmitEvaluation} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="bg-brand-blue px-6 py-6 text-white flex justify-between items-center flex-wrap gap-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-2.5 py-1 rounded-full">
                  แบบประเมินรูปเล่มรายงานวิชาการ (สหกิจ 16)
                </span>
                <h3 className="text-lg font-bold mt-2">ประเมินและให้คะแนนตามเกณฑ์วิชาการ</h3>
              </div>

              <div className="bg-white/10 px-4 py-2.5 rounded-xl border border-white/20 text-center">
                <span className="text-xs uppercase block opacity-80">คะแนนประเมินรายงาน</span>
                <span className="text-3xl font-extrabold">{calculateTotal()}</span>
                <span className="text-xs opacity-75"> / 100</span>
                <span className="mt-0.5 block text-xs opacity-90">
                  {unscoredRubrics.length > 0
                    ? `ยังเหลืออีก ${unscoredRubrics.length} ข้อ`
                    : 'ให้คะแนนครบทุกข้อแล้ว'}
                </span>
              </div>
            </div>

            <div className="p-6 md:p-8 space-y-6">
              <div className="space-y-8">
                {rubrics.map((rub) => (
                  <div key={rub.id} className="border-b border-gray-100 dark:border-gray-700/60 pb-6 last:border-0 last:pb-0">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-3">
                      <div>
                        <h4 className="font-bold text-gray-900 dark:text-white text-sm">{rub.label}</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{rub.desc}</p>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">คะแนน (1-10):</label>
                        <select
                          value={scores[rub.id]}
                          onChange={(e) =>
                            handleScoreChange(rub.id, e.target.value === '' ? '' : Number(e.target.value))
                          }
                          aria-invalid={scores[rub.id] === ''}
                          className={`w-28 px-3 py-1.5 rounded-lg border bg-white text-sm font-semibold focus:outline-none dark:bg-gray-800 dark:text-white ${
                            scores[rub.id] === ''
                              ? 'border-amber-400 dark:border-amber-500/70'
                              : 'border-gray-200 focus:border-brand-blue dark:border-gray-700'
                          }`}
                        >
                          <option value="">ยังไม่ให้</option>
                          {[...Array(10)].map((_, i) => (
                            <option key={i + 1} value={i + 1}>{i + 1}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-bold text-gray-900 dark:text-white mb-2">
                  ข้อคิดเห็นทางวิชาการและข้อเสนอแนะสำหรับการปรับปรุงรายงานในอนาคต
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="กรอกข้อเสนอแนะเชิงวิชาการ จุดดี หรือแนวทางที่อาจารย์อยากแนะนำเพิ่มเติม..."
                  rows={4}
                  className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/60 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
              {unscoredRubrics.length > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  ยังให้คะแนนไม่ครบ {unscoredRubrics.length} ข้อ
                </span>
              )}
              <Button
                type="submit"
                variant="success"
                loading={actionLoading}
                loadingLabel="กำลังบันทึก..."
                icon={<CheckCircle className="w-5 h-5" />}
              >
                บันทึกคะแนนรายงาน (คะแนน: {calculateTotal()})
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* The score lands in the sealed evaluation and the audit log; it is not
          something to hand over on a single stray click. */}
      <ConfirmDialog
        open={confirmingSubmit}
        title="ยืนยันการบันทึกคะแนนรายงาน"
        message={`บันทึกคะแนน ${calculateTotal()}/100 ให้ ${selectedStudent?.studentName ?? ''} ใช่หรือไม่? คะแนนจะถูกส่งเข้าระบบประเมินผลและแก้ไขเองภายหลังไม่ได้`}
        confirmLabel="ยืนยัน บันทึกคะแนน"
        busy={actionLoading}
        onConfirm={submitEvaluation}
        onCancel={() => setConfirmingSubmit(false)}
      />
    </div>
  );
};

export default AdvisorEvaluation;
