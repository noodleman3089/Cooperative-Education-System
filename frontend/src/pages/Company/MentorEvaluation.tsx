import React, { useState } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import { User, ClipboardList, CheckCircle, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';

interface Student {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  major_name_th: string;
  company_name: string;
  mentor_name: string | null;
  mentor_score: number | null;
  final_report_status: string | null;
  final_report_path: string | null;
}

type RubricGroup = 'behavior' | 'performance' | 'report';

/** Every rubric item starts unset — see the note on `scores` below. */
const BLANK_SCORES: Record<string, number | ''> = {
  punctuality: '',
  responsibility: '',
  teamwork: '',
  ethics: '',
  learning: '',
  technical: '',
  quality: '',
  reportContent: '',
  reportFormat: '',
  utility: ''
};

const MentorEvaluation: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  /**
   * Whether this account may score, or is only watching.
   *
   * A company representative and a mentor are two different accounts — SEC-03
   * refuses to attach the `mentor` role to an existing user — but the company
   * has its own "ประเมินผลนักศึกษา" menu, which used to answer 403 and show a
   * red banner forever. A representative now sees every placement at their
   * company and whether it has been scored; the score itself is the mentor's to
   * give, which is also who signs สก 13 on paper.
   */
  const [canEvaluate, setCanEvaluate] = useState(true);

  /**
   * Rubric scores, 1–10 each, all unset to begin with.
   *
   * The form used to open with all ten pre-filled at 10 and a submit button
   * reading "ส่งผลประเมิน (คะแนน: 100)" — so opening it and pressing save
   * awarded a perfect score without a single judgement being made, and nothing
   * distinguished a deliberate 100 from an untouched form. The same bug was
   * fixed on the advisor's form in round 12; this one was never touched.
   */
  const [scores, setScores] = useState<Record<string, number | ''>>({ ...BLANK_SCORES });

  const [comments, setComments] = useState<string>('');
  const [activeTab, setActiveTab] = useState<RubricGroup>('behavior');

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

  const allRubrics = [...rubrics.behavior, ...rubrics.performance, ...rubrics.report];
  const unscoredRubrics = allRubrics.filter((r) => scores[r.id] === '');
  const tabOf = (rubricId: string): RubricGroup =>
    rubrics.behavior.some((r) => r.id === rubricId) ? 'behavior'
      : rubrics.performance.some((r) => r.id === rubricId) ? 'performance'
      : 'report';

  // `isBackground`: a poll must not wipe the "ยังให้คะแนนไม่ครบ" banner the
  // mentor is currently reading, nor throw the form back to a skeleton.
  const loadStudents = async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }
      const res = await api.get('/final-evaluations/my-students');
      setStudents(res.data || []);
      setCanEvaluate(res.canEvaluate !== false);
    } catch (err) {
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อนักศึกษาได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // A report arriving is the student's action, not this screen's, so it has to
  // look again rather than wait for a manual reload.
  useDashboardData(loadStudents, []);

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSuccess(null);
    setError(null);
    setComments('');
    setScores({ ...BLANK_SCORES });
    setActiveTab('behavior');
  };

  const handleScoreChange = (rubricId: string, val: number | '') => {
    setScores(prev => ({
      ...prev,
      [rubricId]: val
    }));
  };

  /** Sum of what has been scored so far — not a final score until all ten are in. */
  const calculateTotal = () =>
    Object.values(scores).reduce((sum: number, v) => sum + (v === '' ? 0 : v), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    // The API totals whatever rubric keys arrive, so a partly filled form would
    // be stored as a real — and quietly wrong — score out of 100.
    if (unscoredRubrics.length > 0) {
      setError(
        `ยังให้คะแนนไม่ครบ เหลืออีก ${unscoredRubrics.length} ข้อ: ${unscoredRubrics
          .map((r) => r.label.split('.')[0])
          .join(', ')}`
      );
      setSuccess(null);
      setActiveTab(tabOf(unscoredRubrics[0].id));
      return;
    }

    setError(null);
    setConfirmingSubmit(true);
  };

  const submitEvaluation = async () => {
    if (!selectedStudent) return;

    try {
      setSubmitting(true);
      setError(null);

      await api.post('/final-evaluations', {
        studentId: selectedStudent.student_id,
        scoresDetail: {
          ...scores,
          comments
        }
      });

      setSuccess('ส่งผลการประเมินนักศึกษาเรียบร้อยแล้ว');
      setConfirmingSubmit(false);
      setSelectedStudent(null);
      await loadStudents();
    } catch (err) {
      setConfirmingSubmit(false);
      setError(getErrorMessage(err, 'ล้มเหลวในการส่งแบบประเมิน'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    // The screen is a grid of student cards, not a table. Drawing a table meant
    // the layout changed shape the moment the data arrived — the one thing a
    // skeleton exists to prevent.
    return (
      <PageSkeleton variant='cards' />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {!selectedStudent ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8">
          {/* h2 like every other screen — this was the only h1 in the app. */}
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-blue dark:text-blue-400" />
            {canEvaluate ? 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา' : 'สถานะการประเมินนักศึกษาของสถานประกอบการ'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            {canEvaluate
              ? 'เลือกนักศึกษาที่ปฏิบัติงานในความดูแลของท่านเพื่อบันทึกแบบประเมินผลออนไลน์ (คะแนนเต็ม 100 คะแนนดิบ)'
              : 'ติดตามว่านักศึกษาแต่ละคนได้รับการประเมินจากพนักงานที่ปรึกษาแล้วหรือยัง — การให้คะแนนเป็นหน้าที่ของพนักงานที่ปรึกษาที่ดูแลนักศึกษาโดยตรง'}
          </p>

          {students.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {students.map((std) => {
                const body = (
                  <>
                    <div className="space-y-1.5 text-left">
                      <h3 className="font-bold text-gray-900 dark:text-white">
                        {std.first_name} {std.last_name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">รหัสประจำตัว: {std.student_code}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">สาขาวิชา: {std.major_name_th}</p>
                      {!canEvaluate && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          พนักงานที่ปรึกษา: {std.mentor_name || 'ยังไม่ระบุ'}
                        </p>
                      )}
                      {std.final_report_status ? (
                        <span className="inline-flex items-center text-xs font-semibold text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400 px-2 py-0.5 rounded-full">
                          ส่งเล่มรายงานสมบูรณ์แล้ว
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold text-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full dark:text-gray-400">
                          ยังไม่ส่งเล่มรายงาน
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {std.mentor_score !== null ? (
                        <span className="text-xs font-bold text-green-700 bg-green-50 dark:bg-green-950/30 dark:text-green-400 px-3 py-1 rounded-lg">
                          ประเมินแล้ว ({std.mentor_score}/100)
                        </span>
                      ) : canEvaluate ? (
                        <span className="text-xs font-medium text-brand-blue bg-blue-50 dark:bg-blue-950/30 px-3 py-1 rounded-lg flex items-center dark:text-blue-400">
                          รอการประเมิน <ChevronRight className="w-4 h-4 ml-1" />
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-3 py-1 rounded-lg">
                          รอพนักงานที่ปรึกษาประเมิน
                        </span>
                      )}
                    </div>
                  </>
                );

                const cardClass =
                  'p-5 border border-gray-200 dark:border-gray-700 rounded-xl w-full flex items-center justify-between transition-all duration-200 dark:bg-gray-800/40';

                return canEvaluate ? (
                  <button
                    type="button"
                    key={std.student_id}
                    onClick={() => handleSelectStudent(std)}
                    className={`${cardClass} hover:border-brand-blue cursor-pointer hover:shadow-md text-left`}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={std.student_id} className={cardClass}>
                    {body}
                  </div>
                );
              })}
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
              <span className="text-xs uppercase block opacity-80">คะแนนที่ให้แล้ว</span>
              <span className="text-3xl font-extrabold">{calculateTotal()}</span>
              <span className="text-xs opacity-75"> / 100</span>
              <span className="block text-xs opacity-90 mt-0.5">
                {unscoredRubrics.length > 0 ? `ยังเหลืออีก ${unscoredRubrics.length} ข้อ` : 'ให้คะแนนครบทุกข้อแล้ว'}
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
            {(['behavior', 'performance', 'report'] as const).map((tab) => {
              const remaining = rubrics[tab].filter((r) => scores[r.id] === '').length;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-semibold transition-all duration-200 border-b-2
                    ${activeTab === tab
                      ? 'border-brand-blue text-brand-blue dark:text-blue-400 bg-white dark:bg-gray-800'
                      : 'border-transparent text-gray-600 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:bg-gray-700/50'}`}
                >
                  {tab === 'behavior' ? '1. ด้านพฤติกรรม' : tab === 'performance' ? '2. ด้านผลงาน' : '3. เล่มรายงาน'}
                  {remaining > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold dark:bg-amber-950/40 dark:text-amber-300">
                      {remaining}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Form Content */}
          <div className="p-6 md:p-8 space-y-6">
            {selectedStudent.final_report_path && activeTab === 'report' && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <span>นักศึกษาอัปโหลดรายงานเล่มสมบูรณ์เข้าระบบแล้ว</span>
                </div>
                {/* Was http://localhost:5000/uploads/… — a hardcoded host with no
                    express.static behind it, so this link has never opened a
                    file. Round 11 repointed the advisor's and student's copies
                    of the same link; this third one was missed. */}
                <a
                  href={`${API_BASE_URL}/files/${selectedStudent.final_report_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-brand-blue hover:underline dark:text-blue-400 whitespace-nowrap"
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
                        aria-label={rub.label}
                        aria-invalid={scores[rub.id] === ''}
                        onChange={(e) => handleScoreChange(rub.id, e.target.value === '' ? '' : Number(e.target.value))}
                        className={`w-28 px-3 py-1.5 rounded-lg border bg-white text-sm font-semibold focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:text-white ${
                          scores[rub.id] === ''
                            ? 'border-amber-300 dark:border-amber-700'
                            : 'border-gray-200 dark:border-gray-700'
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
            <Button variant="secondary" onClick={() => setSelectedStudent(null)}>
              ย้อนกลับ
            </Button>

            <Button
              type="submit"
              variant="success"
              icon={<CheckCircle className="w-5 h-5" />}
              loading={submitting}
              loadingLabel="กำลังส่ง..."
            >
              ส่งผลประเมิน
            </Button>
          </div>
        </form>
      )}

      {/* The score lands in audit_log and the mentor cannot revise it afterwards. */}
      <ConfirmDialog
        open={confirmingSubmit}
        title="ยืนยันส่งผลการประเมิน"
        message={
          selectedStudent
            ? `ส่งคะแนนประเมิน ${calculateTotal()}/100 ของ ${selectedStudent.first_name} ${selectedStudent.last_name} (${selectedStudent.student_code}) ใช่หรือไม่? เมื่อส่งแล้วจะไม่สามารถแก้ไขคะแนนเองได้`
            : ''
        }
        confirmLabel="ยืนยันส่งคะแนน"
        busy={submitting}
        onConfirm={submitEvaluation}
        onCancel={() => setConfirmingSubmit(false)}
      />
    </div>
  );
};

export default MentorEvaluation;
