import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';

/**
 * สหกิจ 01 — แบบสมัครเข้าร่วมโครงการสหกิจศึกษา
 *
 * ยื่นที่นี่ → อาจารย์ที่ปรึกษาประเมิน 3 ด้าน → หัวหน้าสาขาอนุมัติ
 * · ⛔ ไม่ใช่ประตูสู่การยื่นใบความจำนงอีกแล้ว — ระบบไม่มีการตรวจสิทธิ์ (ตัดออก 2026-09-14 · SEC-02)
 *
 * เกรดที่กรอกตรงนี้เป็น "เกรดที่แจ้ง" เท่านั้น ยังไม่ใช่เกรดทางการ จะถูกคัดลอกเข้า
 * ทะเบียนก็ต่อเมื่อหัวหน้าสาขาอนุมัติ (SEC-05 — นักศึกษาไม่เคยเขียน students โดยตรง)
 */

interface ActiveSemester {
  semester_id: number;
  academic_year: number;
  semester: number;
}

interface MyApplication {
  application_id: number;
  semester: number;
  academic_year: number;
  status: string;
  claimed_gpa: string | number | null;
  expected_region: string | null;
  special_skills: string | null;
  academic_evaluation: string | null;
  academic_remark: string | null;
  behavior_evaluation: string | null;
  behavior_remark: string | null;
  maturity_evaluation: string | null;
  maturity_remark: string | null;
  conclusion_remark: string | null;
  created_at: string;
}

const aspectLabel: Record<string, string> = {
  academic: 'ด้านการเรียน',
  behavior: 'ด้านความประพฤติ',
  maturity: 'ด้านวุฒิภาวะ',
};

const CoopApplicationForm: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState<ActiveSemester | null>(null);
  const [myApplications, setMyApplications] = useState<MyApplication[]>([]);

  const [formData, setFormData] = useState({
    claimed_gpa: '',
    expected_region: '',
    special_skills: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    // ภาคเรียนที่เปิดรับกับใบที่เคยยื่นเป็นคนละเรื่อง ล้มอันหนึ่งไม่ควรกลืนอีกอัน
    const [semesterRes, appsRes] = await Promise.allSettled([
      api.get('/semesters/active'),
      api.get('/applications/me'),
    ]);

    if (semesterRes.status === 'fulfilled') {
      setSemester(semesterRes.value as ActiveSemester);
    }
    if (appsRes.status === 'fulfilled') {
      setMyApplications((appsRes.value?.data as MyApplication[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!semester) {
      setErrorMsg('ขณะนี้ยังไม่มีภาคการศึกษาที่เปิดรับสมัคร กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา');
      return;
    }

    const gpa = parseFloat(formData.claimed_gpa);
    if (isNaN(gpa) || gpa < 0 || gpa > 4) {
      setErrorMsg('กรุณากรอกเกรดเฉลี่ยสะสมให้ถูกต้อง (0.00 – 4.00)');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/applications', {
        semester_id: semester.semester_id,
        claimed_gpa: gpa,
        expected_region: formData.expected_region,
        special_skills: formData.special_skills,
      });

      setSuccessMsg('ยื่นใบสมัครเรียบร้อยแล้ว รออาจารย์ที่ปรึกษาพิจารณา');
      setFormData({ claimed_gpa: '', expected_region: '', special_skills: '' });
      await load();
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton variant="form" />;

  // ใบที่ยังไม่ถูกปฏิเสธของภาคเรียนที่เปิดอยู่ = ยื่นซ้ำไม่ได้ (เซิร์ฟเวอร์บังคับด้วย UNIQUE อยู่แล้ว)
  const pendingForActiveSemester = semester
    ? myApplications.find(
        (app) =>
          app.semester === semester.semester &&
          app.academic_year === semester.academic_year
      )
    : undefined;

  const inputClass =
    'block w-full rounded-xl border-0 py-2.5 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 sm:text-sm dark:bg-gray-900 dark:text-white dark:ring-gray-700 dark:placeholder:text-gray-500';

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
          สมัครเข้าร่วมโครงการสหกิจศึกษา (สหกิจ 01)
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          ยื่นความจำนงเข้าร่วมโครงการเพื่อให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาพิจารณาคุณสมบัติ
          เมื่อได้รับอนุมัติแล้วจึงจะยื่นแบบแจ้งความจำนงไปสถานประกอบการได้
        </p>
      </div>

      <AlertBanner variant="error" message={errorMsg} />
      <AlertBanner variant="success" message={successMsg} />

      {/* ใบที่เคยยื่น — ผลการพิจารณาและเหตุผลต้องอ่านได้จากที่นี่ ไม่ใช่ต้องไปถามอาจารย์ */}
      {myApplications.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-base font-bold text-gray-800 dark:text-white">ใบสมัครของฉัน</h2>
          <div className="mt-4 space-y-4">
            {myApplications.map((app) => (
              <div
                key={app.application_id}
                className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    ภาคเรียนที่ {app.semester}/{app.academic_year}
                  </span>
                  <StatusBadge status={app.status} />
                </div>

                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  เกรดเฉลี่ยที่แจ้ง: {app.claimed_gpa !== null ? Number(app.claimed_gpa).toFixed(2) : '—'}
                  {app.expected_region ? ` · ภูมิภาคที่ต้องการ: ${app.expected_region}` : ''}
                </p>

                {/* ความเห็นของอาจารย์ที่ปรึกษา — โดยเฉพาะข้อที่ประเมินว่าไม่เหมาะสม */}
                {(['academic', 'behavior', 'maturity'] as const).some(
                  (aspect) => app[`${aspect}_evaluation`]
                ) && (
                  <ul className="mt-3 space-y-1 text-xs">
                    {(['academic', 'behavior', 'maturity'] as const).map((aspect) => {
                      const value = app[`${aspect}_evaluation`];
                      if (!value) return null;
                      const remark = app[`${aspect}_remark`];
                      const isOk = value === 'appropriate';
                      return (
                        <li
                          key={aspect}
                          className={
                            isOk
                              ? 'text-gray-600 dark:text-gray-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {aspectLabel[aspect]}: {isOk ? 'เหมาะสม' : 'ไม่เหมาะสม'}
                          {remark ? ` — ${remark}` : ''}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {app.conclusion_remark && (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    ความเห็นของหัวหน้าสาขาวิชา: {app.conclusion_remark}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ฟอร์มยื่น */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        {!semester ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            ขณะนี้ยังไม่มีภาคการศึกษาที่เปิดรับสมัครสหกิจศึกษา กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษาของคณะ
          </p>
        ) : pendingForActiveSemester ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            คุณยื่นใบสมัครของภาคเรียนที่ {semester.semester}/{semester.academic_year} ไปแล้ว
            สามารถติดตามผลการพิจารณาได้จากรายการด้านบน
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
              ภาคการศึกษาที่เปิดรับสมัคร:{' '}
              <span className="font-bold">
                ภาคเรียนที่ {semester.semester}/{semester.academic_year}
              </span>
            </div>

            <div>
              <label
                htmlFor="claimed_gpa"
                className="block text-sm font-medium text-gray-800 dark:text-gray-300"
              >
                เกรดเฉลี่ยสะสม (GPAX) <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="4"
                id="claimed_gpa"
                name="claimed_gpa"
                value={formData.claimed_gpa}
                onChange={handleChange}
                placeholder="เช่น 3.25"
                required
                className={`mt-2 ${inputClass}`}
              />
              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                กรอกตามใบแสดงผลการเรียนล่าสุด อาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาจะตรวจสอบก่อนอนุมัติ
              </p>
            </div>

            <div>
              <label
                htmlFor="expected_region"
                className="block text-sm font-medium text-gray-800 dark:text-gray-300"
              >
                ภูมิภาค/จังหวัด ที่ต้องการไปปฏิบัติงาน (ถ้ามี)
              </label>
              <input
                type="text"
                name="expected_region"
                id="expected_region"
                value={formData.expected_region}
                onChange={handleChange}
                placeholder="เช่น กรุงเทพมหานคร, ชลบุรี, ระยอง"
                className={`mt-2 ${inputClass}`}
              />
            </div>

            <div>
              <label
                htmlFor="special_skills"
                className="block text-sm font-medium text-gray-800 dark:text-gray-300"
              >
                ความสามารถพิเศษ
              </label>
              <textarea
                id="special_skills"
                name="special_skills"
                rows={3}
                value={formData.special_skills}
                onChange={handleChange}
                placeholder="เช่น การเขียนโปรแกรม, ภาษาอังกฤษ, กราฟิกดีไซน์"
                className={`mt-2 ${inputClass}`}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'กำลังบันทึก...' : 'ยื่นใบสมัคร'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default CoopApplicationForm;
