import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { User, ClipboardList, CheckCircle, XCircle, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';

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

  // Rubrics state (10 items, 1-10 points each)
  const [scores, setScores] = useState<Record<string, number>>({
    structure: 10,
    objectives: 10,
    literature: 10,
    methodology: 10,
    results: 10,
    discussion: 10,
    references: 10,
    formatting: 10,
    innovation: 10,
    understanding: 10
  });

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
      structure: 10,
      objectives: 10,
      literature: 10,
      methodology: 10,
      results: 10,
      discussion: 10,
      references: 10,
      formatting: 10,
      innovation: 10,
      understanding: 10
    });
  };

  const handleScoreChange = (rubricId: string, val: number) => {
    setScores(prev => ({
      ...prev,
      [rubricId]: val
    }));
  };

  const calculateTotal = () => {
    return Object.values(scores).reduce((a, b) => a + b, 0);
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
      setSelectedStudent(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'ส่งคะแนนประเมินล้มเหลว');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='table' />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {!selectedStudent ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8">
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
                <div
                  key={std.studentId}
                  onClick={() => handleSelectStudent(std)}
                  className="p-5 border border-gray-200 dark:border-gray-700 hover:border-brand-blue rounded-xl flex items-center justify-between cursor-pointer hover:shadow-md transition-all duration-200 dark:bg-gray-800/40"
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
                </div>
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
          <button
            onClick={() => setSelectedStudent(null)}
            className="flex items-center text-sm font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            &larr; ย้อนกลับไปรายชื่อนักศึกษา
          </button>

          {/* Section 1: Final Report Approval */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8">
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
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                    selectedStudent.finalReportStatus === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' :
                    selectedStudent.finalReportStatus === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                    selectedStudent.finalReportStatus === 'submitted' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' :
                    'bg-gray-100 text-gray-500'
                  } dark:text-gray-400`}>
                    {selectedStudent.finalReportStatus === 'approved' ? 'อนุมัติแล้ว' :
                     selectedStudent.finalReportStatus === 'rejected' ? 'ส่งตีกลับแก้ไข' :
                     selectedStudent.finalReportStatus === 'submitted' ? 'ส่งเล่มรออนุมัติ' :
                     'ยังไม่มีการส่งเล่ม'}
                  </span>
                </p>

                {selectedStudent.finalReportPath ? (
                  <div className="pt-2">
                    <a
                      href={`http://localhost:5000/uploads/${selectedStudent.finalReportPath}`}
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
                    <button
                      type="button"
                      onClick={() => handleReviewReport('rejected')}
                      disabled={actionLoading}
                      className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold text-sm transition shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      ตีกลับไปแก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewReport('approved')}
                      disabled={actionLoading}
                      className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-sm transition shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle className="w-4 h-4" />
                      อนุมัติรายงาน
                    </button>
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
          <form onSubmit={handleSubmitEvaluation} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
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
                          onChange={(e) => handleScoreChange(rub.id, Number(e.target.value))}
                          className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                        >
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

            <div className="bg-gray-50 dark:bg-gray-900/60 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-4">
              <button
                type="submit"
                disabled={actionLoading}
                className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-green-500/10 flex items-center gap-2"
              >
                {actionLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <CheckCircle className="w-5 h-5" />
                )}
                บันทึกคะแนนรายงาน (คะแนน: {calculateTotal()})
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AdvisorEvaluation;
