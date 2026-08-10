import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { User, ClipboardList, CheckCircle, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';

interface Student {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  major_name_th: string;
  company_name: string;
  mentor_score: number | null;
  final_report_status: string | null;
  final_report_path: string | null;
}

const MentorEvaluation: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form scores state (10 questions, each 1-10 score)
  const [scores, setScores] = useState<Record<string, number>>({
    punctuality: 10,
    responsibility: 10,
    teamwork: 10,
    ethics: 10,
    learning: 10,
    technical: 10,
    quality: 10,
    reportContent: 10,
    reportFormat: 10,
    utility: 10
  });

  const [comments, setComments] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'behavior' | 'performance' | 'report'>('behavior');

  const rubrics = {
    behavior: [
      { id: 'punctuality', label: '1. ความตรงต่อเวลาและการปฏิบัติตามระเบียบวินัย', desc: 'การตรงต่อเวลา เข้าปฏิบัติงานตามเวลา และปฏิบัติตามระเบียบข้อบังคับขององค์กร' },
      { id: 'responsibility', label: '2. ความรับผิดชอบต่อหน้าที่และความกระตือรือร้น', desc: 'ความเอาใจใส่ในงานที่ได้รับมอบหมาย ทำงานเสร็จตรงเวลา และแสดงความขยันหมั่นเพียร' },
      { id: 'teamwork', label: '3. การมีมนุษยสัมพันธ์และการทำงานร่วมกับผู้อื่น', desc: 'การเข้ากับผู้อื่นได้ดี การสื่อสาร และการทำงานร่วมกันเป็นทีมในองค์กร' },
      { id: 'ethics', label: '4. ความซื่อสัตย์และจริยธรรมในการทำงาน', desc: 'ความซื่อสัตย์สุจริต การรักษาความลับของบริษัท และจริยธรรมในวิชาชีพ' }
    ],
    performance: [
      { id: 'learning', label: '5. ความสามารถในการเรียนรู้และการปรับตัว', desc: 'ทักษะการเรียนรู้งานใหม่ ความเข้าใจ และความพยายามเรียนรู้สิ่งใหม่ๆ' },
      { id: 'technical', label: '6. ความรู้และความเชี่ยวชาญทางเทคนิค/ปฏิบัติการ', desc: 'ทักษะทางเทคนิคและความสามารถในการประยุกต์ใช้ความรู้จากห้องเรียนสู่งานจริง' },
      { id: 'quality', label: '7. คุณภาพ ประสิทธิภาพ และความแม่นยำของผลงาน', desc: 'ความละเอียดรอบคอบในการทำงาน ความถูกต้อง และประสิทธิภาพโดยรวมของเนื้องาน' }
    ],
    report: [
      { id: 'reportContent', label: '8. ความถูกต้องและเนื้อหาที่ครอบคลุมในเล่มรายงาน', desc: 'เนื้อหาสาระของรายงานมีความสมบูรณ์เชิงวิชาการและการปฏิบัติงานจริง' },
      { id: 'reportFormat', label: '9. รูปเล่มและการจัดระเบียบรายงานที่เป็นระบบ', desc: 'ความเรียบร้อยของการจัดพิมพ์ รูปแบบหัวข้อ และการจัดโครงสร้างรายงาน' },
      { id: 'utility', label: '10. ประโยชน์และความคุ้มค่าของโครงงานต่อบริษัท', desc: 'ประโยชน์ที่องค์กรหรือสถานประกอบการจะได้รับจากตัวผลงานหรืองานวิจัยชิ้นนี้' }
    ]
  };

  const loadStudents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/final-evaluations/my-students');
      setStudents(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'ไม่สามารถโหลดรายชื่อนักศึกษาได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, []);

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSuccess(null);
    setError(null);
    setComments('');
    setScores({
      punctuality: 10,
      responsibility: 10,
      teamwork: 10,
      ethics: 10,
      learning: 10,
      technical: 10,
      quality: 10,
      reportContent: 10,
      reportFormat: 10,
      utility: 10
    });
    setActiveTab('behavior');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    try {
      setSubmitting(true);
      setError(null);
      
      const payload = {
        studentId: selectedStudent.student_id,
        scoresDetail: {
          ...scores,
          comments
        }
      };

      await api.post('/final-evaluations', payload);

      setSuccess('ส่งผลการประเมินนักศึกษาเรียบร้อยแล้ว');
      setSelectedStudent(null);
      await loadStudents();
    } catch (err: any) {
      setError(err.response?.data?.message || 'ล้มเหลวในการส่งแบบประเมิน');
    } finally {
      setSubmitting(false);
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
            รายชื่อประเมินผลนักศึกษาสหกิจศึกษา
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            เลือกนักศึกษาที่ปฏิบัติงานในความดูแลของท่านเพื่อบันทึกแบบประเมินผลออนไลน์ (คะแนนเต็ม 100 คะแนนดิบ)
          </p>

          {students.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {students.map((std) => (
                <div
                  key={std.student_id}
                  onClick={() => handleSelectStudent(std)}
                  className="p-5 border border-gray-200 dark:border-gray-700 hover:border-brand-blue rounded-xl flex items-center justify-between cursor-pointer hover:shadow-md transition-all duration-200 dark:bg-gray-800/40"
                >
                  <div className="space-y-1.5">
                    <h3 className="font-bold text-gray-900 dark:text-white">
                      {std.first_name} {std.last_name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">รหัสประจำตัว: {std.student_code}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">สาขาวิชา: {std.major_name_th}</p>
                    {std.final_report_status ? (
                      <span className="inline-flex items-center text-xs font-semibold text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400 px-2 py-0.5 rounded-full">
                        ส่งเล่มรายงานสมบูรณ์แล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs font-semibold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full dark:text-gray-400">
                        ยังไม่ส่งเล่มรายงาน
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {std.mentor_score !== null ? (
                      <span className="text-xs font-bold text-green-600 bg-green-50 dark:bg-green-950/30 px-3 py-1 rounded-lg">
                        ประเมินแล้ว ({std.mentor_score}/100)
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-brand-blue bg-blue-50 dark:bg-blue-950/30 px-3 py-1 rounded-lg flex items-center dark:text-blue-400">
                        รอการประเมิน <ChevronRight className="w-4 h-4 ml-1" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">ยังไม่มีนักศึกษาปฏิบัติงานในระบบ</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">จะเห็นนักศึกษาก็ต่อเมื่อมีการเพิ่มพี่เลี้ยงและตอบรับเข้างานสำเร็จในเฟสที่ 1</p>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="bg-brand-blue px-6 py-6 text-white flex justify-between items-center flex-wrap gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-2.5 py-1 rounded-full">
                แบบประเมินผลออนไลน์ (คะแนนดิบ)
              </span>
              <h2 className="text-xl font-bold mt-2">
                ผู้รับประเมิน: {selectedStudent.first_name} {selectedStudent.last_name}
              </h2>
              <p className="text-xs opacity-80 mt-1">รหัสนักศึกษา: {selectedStudent.student_code} | บริษัท: {selectedStudent.company_name}</p>
            </div>
            
            <div className="bg-white/10 px-4 py-2.5 rounded-xl border border-white/20 text-center">
              <span className="text-xs uppercase block opacity-80">คะแนนประเมินรวม</span>
              <span className="text-3xl font-extrabold">{calculateTotal()}</span>
              <span className="text-xs opacity-75"> / 100</span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
            {(['behavior', 'performance', 'report'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-4 text-sm font-semibold transition-all duration-200 border-b-2
                  ${activeTab === tab
                    ? 'border-brand-blue text-brand-blue dark:text-blue-400 bg-white dark:bg-gray-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:bg-gray-700/50'}`}
              >
                {tab === 'behavior' ? '1. ด้านพฤติกรรม' : tab === 'performance' ? '2. ด้านผลงาน' : '3. เล่มรายงาน'}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <div className="p-6 md:p-8 space-y-6">
            {selectedStudent.final_report_path && activeTab === 'report' && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <span>นักศึกษาอัปโหลดรายงานเล่มสมบูรณ์เข้าระบบแล้ว</span>
                </div>
                <a
                  href={`http://localhost:5000/uploads/${selectedStudent.final_report_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-brand-blue hover:underline dark:text-blue-400"
                >
                  เปิดอ่านเล่มรายงาน (PDF)
                </a>
              </div>
            )}

            <div className="space-y-8">
              {rubrics[activeTab].map((rub) => (
                <div key={rub.id} className="border-b border-gray-100 dark:border-gray-700/60 pb-6 last:border-0 last:pb-0">
                  <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-3">
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">{rub.label}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{rub.desc}</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">คะแนนที่ได้ (1-10):</label>
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

            {/* General Feedback Comments (Visible on all tabs or as a final step) */}
            <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
              <label className="block text-sm font-bold text-gray-900 dark:text-white mb-2">
                ความคิดเห็นและข้อเสนอแนะเพิ่มเติมเกี่ยวกับการฝึกสหกิจศึกษาของนักศึกษา
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="กรอกข้อแนะนำ จุดแข็ง หรือจุดที่ควรพัฒนาของนักศึกษาเพื่อแจ้งทางอาจารย์และเป็นประโยชน์แก่นักศึกษาในการปรับปรุงตัว..."
                rows={4}
                className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>
          </div>

          {/* Actions Footer */}
          <div className="bg-gray-50 dark:bg-gray-900/60 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-between gap-4">
            <button
              type="button"
              onClick={() => setSelectedStudent(null)}
              className="px-5 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-xl font-medium text-sm transition-all dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-700"
            >
              ย้อนกลับ
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-green-500/10 flex items-center gap-2"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <CheckCircle className="w-5 h-5" />
              )}
              ส่งผลประเมิน (คะแนน: {calculateTotal()})
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default MentorEvaluation;
