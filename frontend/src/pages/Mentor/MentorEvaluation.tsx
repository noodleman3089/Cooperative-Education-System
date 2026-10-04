import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageSkeleton from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import { User, ClipboardList, FileText, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import type { RubricItem } from '../../config/evaluationRubric';
import {
  SAHATKIT_15_ITEMS,
  SAHATKIT_15_SECTIONS,
  SAHATKIT_16_ITEMS,
  SAHATKIT_16_SCALE,
  WOULD_HIRE_CHOICES,
} from '../../config/evaluationRubric';

/**
 * แบบประเมินของพนักงานที่ปรึกษา (พี่เลี้ยง) — สองใบ
 *
 *   สหกิจ 15 — แบบประเมินผลนักศึกษา 18 ข้อ เต็ม 100 → ใช้ตัดเกรด
 *   สหกิจ 16 — แบบประเมินรายงาน 14 ข้อ ระดับ 1-5 เต็ม 70 → เรตติ้ง ไม่รวมเกรด
 *
 * ทั้งสองใบเป็นของพี่เลี้ยงตามที่แบบฟอร์มจริงระบุ — เดิมระบบมี rubric 10 ข้อที่คิด
 * ขึ้นเองใบเดียว (ปนเรื่องคนกับเรื่องรายงาน) และเอาการประเมินรายงานไปให้อาจารย์ทำ
 * ทั้งที่ไม่มีแบบฟอร์มไหนในชุด 01-16 ที่อาจารย์เป็นผู้ประเมิน
 *
 * เมนูเดียวสองแท็บ ไม่แยกเป็นสองเมนู เพราะรายชื่อนักศึกษามาจาก query เดียว
 * การแยกเมนูแปลว่าต้องเรนเดอร์รายชื่อ + skeleton + polling ซ้ำสองที่
 */

type FormCode = 'sahatkit_15' | 'sahatkit_16';

interface Student {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  major_name_th: string;
  company_name: string;
  mentor_name: string | null;
  sahatkit15_score: number | null;
  sahatkit16_score: number | null;
  final_report_status: string | null;
  final_report_path: string | null;
}

/** ทุกข้อเริ่มที่ "ยังไม่ให้" เสมอ — ฟอร์มให้คะแนนห้าม default เป็นคะแนนเต็ม
 *  เพราะแยกไม่ออกว่าตั้งใจให้เต็มหรือแค่ยังไม่ได้แตะ */
const blankScores = (items: RubricItem[]): Record<string, number | ''> =>
  Object.fromEntries(items.map((i) => [i.key, '' as number | '']));

const FORM_META: Record<FormCode, { tab: string; title: string; maxTotal: number; items: RubricItem[] }> = {
  sahatkit_15: {
    tab: 'สหกิจ 15 — แบบประเมินผลนักศึกษา',
    title: 'แบบประเมินผลนักศึกษาสหกิจศึกษา (สหกิจ 15)',
    maxTotal: 100,
    items: SAHATKIT_15_ITEMS,
  },
  sahatkit_16: {
    tab: 'สหกิจ 16 — แบบประเมินรายงาน',
    title: 'แบบประเมินรายงานนักศึกษาสหกิจศึกษา (สหกิจ 16)',
    maxTotal: 70,
    items: SAHATKIT_16_ITEMS,
  },
};

const MentorEvaluation: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const studentParam = searchParams.get('student');
  const formParam = searchParams.get('form');

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [activeForm, setActiveForm] = useState<FormCode>('sahatkit_15');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [canEvaluate, setCanEvaluate] = useState(true);

  const [scores, setScores] = useState<Record<string, number | ''>>(blankScores(SAHATKIT_15_ITEMS));
  const [strength, setStrength] = useState('');
  const [improvement, setImprovement] = useState('');
  const [comments, setComments] = useState('');
  const [wouldHire, setWouldHire] = useState('');
  const [reportTitleTh, setReportTitleTh] = useState('');
  const [reportTitleEn, setReportTitleEn] = useState('');

  const meta = FORM_META[activeForm];
  const unscored = meta.items.filter((item) => scores[item.key] === '' || scores[item.key] === undefined);
  const total = meta.items.reduce((sum, item) => {
    const v = scores[item.key];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);

  /** ยอดย่อยรายหมวดของ สหกิจ 15 ให้ตรงกับกล่องสรุปบนกระดาษ */
  const sectionTotal = (keys: string[]) =>
    keys.reduce((sum, key) => {
      const v = scores[key];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);

  // `isBackground`: การ poll ต้องไม่ล้างแถบ "ยังให้คะแนนไม่ครบ" ที่พี่เลี้ยงกำลังอ่าน
  // และต้องไม่โยนฟอร์มกลับไปเป็น skeleton
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

  useDashboardData(loadStudents, []);

  const resetForm = (form: FormCode) => {
    setScores(blankScores(FORM_META[form].items));
    setStrength('');
    setImprovement('');
    setComments('');
    setWouldHire('');
    setReportTitleTh('');
    setReportTitleEn('');
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSuccess(null);
    setError(null);
    setActiveForm('sahatkit_15');
    resetForm('sahatkit_15');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('student', String(student.student_id));
        next.set('form', '15');
        return next;
      },
      { replace: true }
    );
  };

  const handleSwitchForm = (form: FormCode) => {
    setActiveForm(form);
    setError(null);
    setSuccess(null);
    resetForm(form);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('form', form === 'sahatkit_16' ? '16' : '15');
        return next;
      },
      { replace: true }
    );
  };

  const handleBackToList = () => {
    setSelectedStudent(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('student');
        next.delete('form');
        return next;
      },
      { replace: true }
    );
  };

  // ponytail: auto-select student and form from deep-link query params (?student=<id>&form=15|16)
  useEffect(() => {
    if (!studentParam) {
      if (selectedStudent) {
        setSelectedStudent(null);
      }
      return;
    }
    if (students.length === 0) return;

    const targetForm: FormCode =
      formParam === '16' || formParam === 'sahatkit_16' ? 'sahatkit_16' : 'sahatkit_15';

    const matched = students.find(
      (s) => String(s.student_id) === studentParam || s.student_code === studentParam
    );
    if (!matched) return;

    if (!selectedStudent || selectedStudent.student_id !== matched.student_id) {
      setSelectedStudent(matched);
      setActiveForm(targetForm);
      resetForm(targetForm);
    } else {
      if (
        selectedStudent.final_report_status !== matched.final_report_status ||
        selectedStudent.sahatkit15_score !== matched.sahatkit15_score ||
        selectedStudent.sahatkit16_score !== matched.sahatkit16_score
      ) {
        setSelectedStudent(matched);
      }
      if (activeForm !== targetForm) {
        setActiveForm(targetForm);
        resetForm(targetForm);
      }
    }
  }, [studentParam, formParam, students, selectedStudent, activeForm]);

  const handleScoreChange = (key: string, val: number | '') =>
    setScores((prev) => ({ ...prev, [key]: val }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    if (unscored.length > 0) {
      setError(
        `ยังให้คะแนนไม่ครบ เหลืออีก ${unscored.length} ข้อ: ${unscored.map((i) => i.no).join(', ')}`
      );
      setSuccess(null);
      // เดิมใช้การกระโดดแท็บ ตอนนี้ฟอร์มเป็นหน้าเลื่อนเดียว จึงเลื่อนไปข้อแรกที่ขาดแทน
      document
        .getElementById(`score-${unscored[0].key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (activeForm === 'sahatkit_15' && !wouldHire) {
      setError('กรุณาตอบคำถามว่าจะรับนักศึกษาเข้าทำงานหรือไม่');
      setSuccess(null);
      return;
    }

    if (activeForm === 'sahatkit_16' && (!reportTitleTh.trim() || !reportTitleEn.trim())) {
      setError('กรุณากรอกหัวข้อรายงานทั้งภาษาไทยและภาษาอังกฤษ');
      setSuccess(null);
      return;
    }

    setError(null);
    setConfirmingSubmit(true);
  };

  const submitEvaluation = async () => {
    if (!selectedStudent) return;

    const scoresDetail: Record<string, unknown> = { ...scores, other_comments: comments };
    if (activeForm === 'sahatkit_15') {
      scoresDetail.strength = strength;
      scoresDetail.improvement = improvement;
      scoresDetail.would_hire = wouldHire;
    } else {
      scoresDetail.report_title_th = reportTitleTh;
      scoresDetail.report_title_en = reportTitleEn;
    }

    try {
      setSubmitting(true);
      setError(null);

      await api.post('/final-evaluations', {
        studentId: selectedStudent.student_id,
        formCode: activeForm,
        scoresDetail,
      });

      setSuccess(
        activeForm === 'sahatkit_15'
          ? 'บันทึกแบบประเมิน สหกิจ 15 เรียบร้อยแล้ว'
          : 'บันทึกแบบประเมิน สหกิจ 16 เรียบร้อยแล้ว'
      );
      setConfirmingSubmit(false);
      handleBackToList();
      await loadStudents();
    } catch (err) {
      setConfirmingSubmit(false);
      setError(getErrorMessage(err, 'ล้มเหลวในการส่งแบบประเมิน'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    // หน้านี้เป็นกริดการ์ดนักศึกษา ไม่ใช่ตาราง — วาดตารางแล้วเลย์เอาต์จะเปลี่ยนรูป
    // ตอนข้อมูลมา ซึ่งเป็นสิ่งเดียวที่ skeleton มีไว้ป้องกัน
    return <PageSkeleton variant="cards" />;
  }

  const scoreOptions = (max: number) =>
    Array.from({ length: max }, (_, i) => i + 1).map((n) => (
      <option key={n} value={n}>
        {n}
      </option>
    ));

  /** แถวให้คะแนนหนึ่งข้อ — ใช้ร่วมกันทั้งสองฟอร์ม */
  const scoreRow = (item: RubricItem) => (
    <div
      key={item.key}
      id={`score-${item.key}`}
      className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-700"
    >
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-gray-900 dark:text-white">
          {item.no}. {item.label}
        </h4>
        {item.desc && (
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{item.desc}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label
          htmlFor={`select-${item.key}`}
          className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400"
        >
          คะแนน (1-{item.max}):
        </label>
        <Select
          id={`select-${item.key}`}
          size="sm"
          className="w-24"
          aria-label={`${item.no}. ${item.label}`}
          aria-invalid={scores[item.key] === ''}
          error={scores[item.key] === ''}
          value={scores[item.key]}
          onChange={(e) =>
            handleScoreChange(item.key, e.target.value === '' ? '' : Number(e.target.value))
          }
        >
          <option value="">ยังไม่ให้</option>
          {scoreOptions(item.max)}
        </Select>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {!selectedStudent ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-2 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <ClipboardList className="h-6 w-6 text-brand-blue dark:text-blue-400" />
            {canEvaluate
              ? 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา'
              : 'สถานะการประเมินนักศึกษาของสถานประกอบการ'}
          </h2>
          <p className="mb-8 text-gray-600 dark:text-gray-400">
            {canEvaluate
              ? 'เลือกนักศึกษาเพื่อกรอกแบบประเมิน 2 ใบ — สหกิจ 15 (ประเมินผลนักศึกษา เต็ม 100) และ สหกิจ 16 (ประเมินรายงาน เต็ม 70)'
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
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        รหัสประจำตัว: {std.student_code}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        สาขาวิชา: {std.major_name_th}
                      </p>
                      {!canEvaluate && (
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          พนักงานที่ปรึกษา: {std.mentor_name || 'ยังไม่ระบุ'}
                        </p>
                      )}
                      {std.final_report_status ? (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-950/20 dark:text-green-400">
                          ส่งร่างรายงานให้ตรวจแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          ยังไม่ส่งร่างรายงาน
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      {std.sahatkit15_score !== null ? (
                        <span className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 dark:bg-green-950/30 dark:text-green-400">
                          สหกิจ 15: {std.sahatkit15_score}/100
                        </span>
                      ) : (
                        <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                          สหกิจ 15: รอประเมิน
                        </span>
                      )}
                      {std.sahatkit16_score !== null ? (
                        <span className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 dark:bg-green-950/30 dark:text-green-400">
                          สหกิจ 16: {std.sahatkit16_score}/70
                        </span>
                      ) : (
                        <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                          สหกิจ 16: รอประเมิน
                        </span>
                      )}
                      {canEvaluate && (
                        <span className="flex items-center text-xs font-medium text-brand-blue dark:text-blue-400">
                          กรอกแบบประเมิน <ChevronRight className="ml-1 h-4 w-4" />
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
                    className={`${cardClass} cursor-pointer text-left hover:border-brand-blue hover:shadow-md`}
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
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center dark:border-gray-700">
              <User className="mx-auto mb-4 h-12 w-12 text-gray-600 dark:text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                ยังไม่มีนักศึกษาปฏิบัติงานในระบบ
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                จะเห็นนักศึกษาก็ต่อเมื่อมีการเพิ่มพี่เลี้ยงและตอบรับเข้างานสำเร็จในเฟสที่ 1
              </p>
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 bg-brand-blue px-6 py-6 text-white">
            <div>
              {/* ป้ายเป็นพื้นขาวทึบ ไม่ใช่ bg-white/20 — ขาว 20% ทับ brand-blue ทำให้พื้น
                  *สว่างขึ้น* ตัวอักษรขาวจึงเหลือ 3.62 ตกเกณฑ์ 4.5 (วัดจริงแล้ว) */}
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold tracking-wider text-brand-blue uppercase">
                {meta.title}
              </span>
              <h2 className="mt-2 text-xl font-bold">
                ผู้รับประเมิน: {selectedStudent.first_name} {selectedStudent.last_name}
              </h2>
              {/* text-blue-100 บน brand-blue ได้ 4.24 ตกเกณฑ์ — ใช้ขาวเต็ม */}
              <p className="text-sm text-white">
                รหัสประจำตัว: {selectedStudent.student_code} · {selectedStudent.major_name_th}
              </p>
            </div>
            <div className="text-right">
              <span className="block text-xs uppercase text-white">คะแนนที่ให้แล้ว</span>
              <span className="text-3xl font-bold">
                {total} / {meta.maxTotal}
              </span>
              <span className="block text-xs text-white">
                {unscored.length > 0 ? `ยังเหลืออีก ${unscored.length} ข้อ` : 'ให้คะแนนครบทุกข้อแล้ว'}
              </span>
            </div>
          </div>

          {/* แถบเลือกฟอร์ม — สองใบเป็นของพี่เลี้ยงคนเดียวกัน จึงอยู่ในหน้าเดียว */}
          <div className="flex flex-wrap border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
            {(Object.keys(FORM_META) as FormCode[]).map((code) => {
              const submitted =
                code === 'sahatkit_15'
                  ? selectedStudent.sahatkit15_score
                  : selectedStudent.sahatkit16_score;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleSwitchForm(code)}
                  className={`flex-1 px-4 py-3 text-sm font-bold transition-colors ${
                    activeForm === code
                      ? 'border-b-2 border-brand-blue bg-white text-brand-blue dark:bg-gray-800 dark:text-blue-400'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  {FORM_META[code].tab}
                  <span className="mt-0.5 block text-xs font-normal">
                    {submitted !== null
                      ? `ส่งแล้ว (${submitted}/${FORM_META[code].maxTotal})`
                      : 'ยังไม่ได้ส่ง'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-5 p-6 md:p-8">
            {(activeForm === 'sahatkit_15'
              ? selectedStudent.sahatkit15_score
              : selectedStudent.sahatkit16_score) !== null && (
              <AlertBanner
                variant="warning"
                message={
                  <>
                    แบบประเมินใบนี้ถูกส่งไปแล้ว — การกรอกและกดส่งอีกครั้งจะ
                    <strong>ทับของเดิมทั้งใบ</strong> ไม่ใช่การแก้เฉพาะข้อที่เปลี่ยน
                  </>
                }
              />
            )}

            {activeForm === 'sahatkit_15' ? (
              <>
                {SAHATKIT_15_SECTIONS.map((section) => (
                  <section key={section.no}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-bold text-gray-900 dark:text-white">
                        หมวดที่ {section.no} {section.title}
                      </h3>
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-brand-blue dark:bg-blue-950/40 dark:text-blue-300">
                        {sectionTotal(section.items.map((i) => i.key))} / {section.max}
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-4 dark:border-gray-700">
                      {section.items.map(scoreRow)}
                    </div>
                  </section>
                ))}

                <div>
                  <label
                    htmlFor="strength"
                    className="mb-1 block text-sm font-bold text-gray-900 dark:text-white"
                  >
                    จุดเด่นของนักศึกษา / Strength
                  </label>
                  <Textarea
                    id="strength"
                    rows={3}
                    value={strength}
                    onChange={(e) => setStrength(e.target.value)}
                  />
                </div>

                <div>
                  <label
                    htmlFor="improvement"
                    className="mb-1 block text-sm font-bold text-gray-900 dark:text-white"
                  >
                    ข้อควรปรับปรุงของนักศึกษา / Improvement
                  </label>
                  <Textarea
                    id="improvement"
                    rows={3}
                    value={improvement}
                    onChange={(e) => setImprovement(e.target.value)}
                  />
                </div>

                <fieldset className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <legend className="px-2 text-sm font-bold text-gray-900 dark:text-white">
                    หากนักศึกษาผู้นี้สำเร็จการศึกษาแล้ว ท่านจะรับเข้าทำงานหรือไม่
                  </legend>
                  <div className="flex flex-wrap gap-5">
                    {WOULD_HIRE_CHOICES.map((choice) => (
                      <label
                        key={choice.value}
                        className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200"
                      >
                        <input
                          type="radio"
                          name="would_hire"
                          value={choice.value}
                          checked={wouldHire === choice.value}
                          onChange={(e) => setWouldHire(e.target.value)}
                          className="h-4 w-4 accent-brand-blue"
                        />
                        {choice.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : (
              <>
                {/* ponytail: advisory draft report review banner on Form 16 — non-blocking */}
                {selectedStudent.final_report_status === 'approved' ? (
                  <AlertBanner
                    variant="info"
                    message="ท่านได้ตรวจรับรองร่างรายงานของนักศึกษาแล้ว"
                  />
                ) : (
                  <AlertBanner
                    variant="warning"
                    message={
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          คำแนะนำ: ท่านยังไม่ได้ตรวจรับรองร่างรายงานของนักศึกษา (แนะนำให้ตรวจร่างรายงานในเมนู 'รับรองงานนักศึกษา' ก่อนประเมินเล่มรายงาน)
                        </span>
                        <Link
                          to={`/dashboard?role=mentor&menu=certify&tab=draft&student=${selectedStudent.student_id}`}
                          className="font-medium underline hover:text-amber-950 dark:hover:text-amber-200"
                        >
                          ไปที่ตรวจรับรองร่างรายงาน &rarr;
                        </Link>
                      </div>
                    }
                  />
                )}

                {selectedStudent.final_report_path && (
                  <a
                    href={`${API_BASE_URL}/files/${selectedStudent.final_report_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-brand-blue hover:bg-blue-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-700"
                  >
                    <FileText className="h-4 w-4" />
                    เปิดอ่านร่างรายงานที่ส่งให้ท่านตรวจ
                  </a>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="report_title_th"
                      className="mb-1 block text-sm font-bold text-gray-900 dark:text-white"
                    >
                      หัวข้อรายงาน (ภาษาไทย)
                    </label>
                    <Input
                      id="report_title_th"
                      type="text"
                      value={reportTitleTh}
                      onChange={(e) => setReportTitleTh(e.target.value)}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="report_title_en"
                      className="mb-1 block text-sm font-bold text-gray-900 dark:text-white"
                    >
                      Report title (English)
                    </label>
                    <Input
                      id="report_title_en"
                      type="text"
                      value={reportTitleEn}
                      onChange={(e) => setReportTitleEn(e.target.value)}
                    />
                  </div>
                </div>

                <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                  <strong>เกณฑ์การประเมิน</strong> {SAHATKIT_16_SCALE}
                  <br />
                  คะแนนของแบบประเมินนี้เป็นเรตติ้งคุณภาพรายงาน{' '}
                  <strong>ไม่นำไปรวมกับคะแนนประเมินผล (สหกิจ 15)</strong>
                </p>

                <div className="rounded-xl border border-gray-200 px-4 dark:border-gray-700">
                  {SAHATKIT_16_ITEMS.map(scoreRow)}
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="other_comments"
                className="mb-1 block text-sm font-bold text-gray-900 dark:text-white"
              >
                ข้อคิดเห็นเพิ่มเติม / Other comments
              </label>
              <Textarea
                id="other_comments"
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>

            {unscored.length > 0 && (
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                ยังให้คะแนนไม่ครบ {unscored.length} ข้อ: {unscored.map((i) => i.no).join(', ')}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <Button type="button" variant="secondary" onClick={handleBackToList}>
                ย้อนกลับ
              </Button>
              <Button type="submit" disabled={submitting}>
                ส่งผลประเมิน
              </Button>
            </div>
          </div>
        </form>
      )}

      {selectedStudent && (
        <ConfirmDialog
          open={confirmingSubmit}
          title="ยืนยันส่งผลการประเมิน"
          message={`ส่ง${meta.title} ของ ${selectedStudent.first_name} ${selectedStudent.last_name} (${selectedStudent.student_code}) คะแนน ${total}/${meta.maxTotal} ใช่หรือไม่? เมื่อส่งแล้วจะไม่สามารถแก้ไขคะแนนเองได้`}
          confirmLabel="ยืนยันส่งคะแนน"
          busy={submitting}
          onConfirm={submitEvaluation}
          onCancel={() => setConfirmingSubmit(false)}
        />
      )}
    </div>
  );
};

export default MentorEvaluation;
