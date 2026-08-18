import React, { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';

/**
 * สหกิจ 01 — หน้าตรวจใบสมัครของอาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชา
 *
 * อาจารย์ประเมิน 3 ด้าน → หัวหน้าสาขาสรุปผล · การอนุมัติของหัวหน้าสาขาคือจุดที่
 * `students.is_eligible` ถูกตั้งเป็น TRUE และเกรดที่นักศึกษาแจ้งกลายเป็นเกรดทางการ
 * จึงเป็นการกระทำที่ย้อนกลับเองไม่ได้ และถูกบันทึกลง audit_log ทุกครั้ง
 */

type Aspect = 'academic' | 'behavior' | 'maturity';

interface Application {
  application_id: number;
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  cumulative_gpa: number | string | null;
  claimed_gpa: number | string | null;
  semester: number;
  academic_year: number;
  expected_region: string | null;
  special_skills: string | null;
  status: string;
  academic_evaluation: string | null;
  academic_remark: string | null;
  behavior_evaluation: string | null;
  behavior_remark: string | null;
  maturity_evaluation: string | null;
  maturity_remark: string | null;
  conclusion_remark: string | null;
  created_at: string;
}

const ASPECTS: { key: Aspect; label: string }[] = [
  { key: 'academic', label: 'ด้านการเรียน' },
  { key: 'behavior', label: 'ด้านความประพฤติ' },
  { key: 'maturity', label: 'ด้านวุฒิภาวะ' },
];

const emptyForm = {
  academic_evaluation: '',
  academic_remark: '',
  behavior_evaluation: '',
  behavior_remark: '',
  maturity_evaluation: '',
  maturity_remark: '',
  conclusion: '',
  conclusion_remark: '',
};

const gpaText = (value: number | string | null) =>
  value === null || value === undefined || value === '' ? '—' : Number(value).toFixed(2);

const ApplicationReview: React.FC = () => {
  const authContext = useContext(AuthContext);
  const user = authContext?.user;
  const isDeptHead = !!user?.roles?.includes('dept_head');
  const isAdvisor = !isDeptHead && !!user?.roles?.includes('advisor');

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fetchApplications = useCallback(async () => {
    try {
      const data = await api.get('/applications');
      setApplications((data.data as Application[]) || []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const openModal = (app: Application) => {
    setForm(emptyForm);
    setModalError('');
    setSelectedApp(app);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;
    setModalError('');

    // ฟอร์มประเมินห้ามมีค่าตั้งต้น — ไม่งั้นแยกไม่ออกว่าอาจารย์ตั้งใจให้ผ่าน
    // หรือแค่กดบันทึกโดยไม่ได้อ่าน · ตรวจครบทุกข้อก่อนส่งเสมอ
    if (isAdvisor) {
      const missing = ASPECTS.find(({ key }) => !form[`${key}_evaluation`]);
      if (missing) {
        setModalError(`กรุณาเลือกผลการประเมิน${missing.label}`);
        return;
      }
      const missingRemark = ASPECTS.find(
        ({ key }) => form[`${key}_evaluation`] === 'inappropriate' && !form[`${key}_remark`].trim()
      );
      if (missingRemark) {
        setModalError(`กรุณาระบุเหตุผลของการประเมิน "ไม่เหมาะสม" ใน${missingRemark.label}`);
        return;
      }
    } else {
      if (!form.conclusion) {
        setModalError('กรุณาเลือกผลการพิจารณา');
        return;
      }
      if (form.conclusion !== 'approved' && !form.conclusion_remark.trim()) {
        setModalError('กรุณาระบุเหตุผลของผลการพิจารณา เพื่อให้นักศึกษาทราบว่าต้องแก้ไขอะไร');
        return;
      }
    }

    setSaving(true);
    try {
      if (isDeptHead) {
        const res = await api.put(`/applications/${selectedApp.application_id}/approve`, {
          conclusion: form.conclusion,
          remark: form.conclusion_remark,
        });
        setSuccess(res.message || 'บันทึกผลการพิจารณาเรียบร้อยแล้ว');
      } else {
        const res = await api.put(`/applications/${selectedApp.application_id}/evaluate`, {
          academic_evaluation: form.academic_evaluation,
          academic_remark: form.academic_remark,
          behavior_evaluation: form.behavior_evaluation,
          behavior_remark: form.behavior_remark,
          maturity_evaluation: form.maturity_evaluation,
          maturity_remark: form.maturity_remark,
        });
        setSuccess(res.message || 'บันทึกผลการประเมินเรียบร้อยแล้ว');
      }

      setSelectedApp(null);
      await fetchApplications();
    } catch (err) {
      // แถบ error ของโมดัลต้องอยู่ในโมดัล ไม่ใช่ข้างหลังกล่อง
      setModalError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const canAct = (app: Application) =>
    (isAdvisor && app.status === 'pending_advisor') ||
    (isDeptHead && app.status === 'pending_dept_head');

  if (loading) return <PageSkeleton variant="table" />;

  const selectClass =
    'mt-1 block w-full rounded-xl border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600 sm:text-sm dark:bg-gray-800 dark:text-white dark:ring-gray-700';
  const textareaClass =
    'mt-1 block w-full rounded-xl border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 sm:text-sm dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:placeholder:text-gray-500';

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
          {isDeptHead ? 'อนุมัติใบสมัครเข้าโครงการ (สหกิจ 01)' : 'ตรวจใบสมัครเข้าโครงการ (สหกิจ 01)'}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {isDeptHead
            ? 'สรุปผลการพิจารณาคุณสมบัติ — การอนุมัติจะให้สิทธิ์นักศึกษายื่นแบบแจ้งความจำนงและบันทึกเกรดที่แจ้งเป็นเกรดทางการ'
            : 'ประเมินความพร้อมของนักศึกษาในสาขาวิชาของท่าน 3 ด้าน ก่อนส่งให้หัวหน้าสาขาวิชาพิจารณา'}
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800/50">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50">
              <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-medium text-gray-800 sm:pl-6 dark:text-gray-300">รหัสนักศึกษา</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-800 dark:text-gray-300">ชื่อ-สกุล</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-800 dark:text-gray-300">ภาคเรียน</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-800 dark:text-gray-300">เกรดที่แจ้ง</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-800 dark:text-gray-300">สถานะ</th>
              <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                <span className="sr-only">จัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800/50 dark:bg-gray-900">
            {applications.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-gray-600 dark:text-gray-400">
                  ยังไม่มีนักศึกษายื่นใบสมัครเข้าโครงการ
                </td>
              </tr>
            ) : (
              applications.map((app) => (
                <tr key={app.application_id} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/20">
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6 dark:text-gray-100">
                    {app.student_code}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {app.first_name || app.last_name
                      ? `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim()
                      : 'ยังไม่ได้กรอกชื่อในระบบ'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {app.semester}/{app.academic_year}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {gpaText(app.claimed_gpa)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                    {canAct(app) ? (
                      <Button size="sm" variant="secondary" onClick={() => openModal(app)}>
                        {isDeptHead ? 'พิจารณา' : 'ประเมิน'}
                        <span className="sr-only">, {app.student_code}</span>
                      </Button>
                    ) : (
                      <span className="text-gray-600 dark:text-gray-400">ดำเนินการแล้ว</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedApp && (
        <Modal
          onClose={() => setSelectedApp(null)}
          size="lg"
          closeOnBackdrop={false}
          title={isDeptHead ? 'สรุปผลการพิจารณา' : 'ประเมินความพร้อมของนักศึกษา'}
        >
          <form onSubmit={handleSubmit}>
            <ModalBody>
              <div className="mb-5 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800/50">
                <p className="font-medium text-gray-800 dark:text-gray-100">
                  {selectedApp.student_code} {selectedApp.first_name} {selectedApp.last_name}
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  เกรดที่นักศึกษาแจ้ง: {gpaText(selectedApp.claimed_gpa)}
                  {' · '}เกรดในทะเบียนปัจจุบัน: {gpaText(selectedApp.cumulative_gpa)}
                </p>
                {selectedApp.expected_region && (
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    ภูมิภาคที่ต้องการ: {selectedApp.expected_region}
                  </p>
                )}
                {selectedApp.special_skills && (
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    ความสามารถพิเศษ: {selectedApp.special_skills}
                  </p>
                )}
              </div>

              <AlertBanner variant="error" message={modalError} className="mb-4" />

              {isAdvisor ? (
                <div className="space-y-5">
                  {ASPECTS.map(({ key, label }) => (
                    <div key={key} className="border-b border-gray-100 pb-4 last:border-0 dark:border-gray-800">
                      <label
                        htmlFor={`${key}_evaluation`}
                        className="block text-sm font-medium text-gray-800 dark:text-gray-300"
                      >
                        {label}
                      </label>
                      <select
                        id={`${key}_evaluation`}
                        className={selectClass}
                        value={form[`${key}_evaluation`]}
                        onChange={(e) => setForm({ ...form, [`${key}_evaluation`]: e.target.value })}
                      >
                        <option value="">-- กรุณาเลือก --</option>
                        <option value="appropriate">เหมาะสม</option>
                        <option value="inappropriate">ไม่เหมาะสม</option>
                      </select>
                      <textarea
                        rows={2}
                        className={textareaClass}
                        placeholder={
                          form[`${key}_evaluation`] === 'inappropriate'
                            ? 'ระบุเหตุผล (จำเป็น)'
                            : 'ความเห็นเพิ่มเติม (ถ้ามี)'
                        }
                        value={form[`${key}_remark`]}
                        onChange={(e) => setForm({ ...form, [`${key}_remark`]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="conclusion" className="block text-sm font-medium text-gray-800 dark:text-gray-300">
                      ผลการพิจารณา
                    </label>
                    <select
                      id="conclusion"
                      className={selectClass}
                      value={form.conclusion}
                      onChange={(e) => setForm({ ...form, conclusion: e.target.value })}
                    >
                      <option value="">-- กรุณาเลือก --</option>
                      <option value="approved">อนุมัติ ให้สิทธิ์เข้าร่วมสหกิจศึกษา</option>
                      <option value="waitlisted">รอพิจารณาเพิ่มเติม</option>
                      <option value="other">ไม่อนุมัติ / อื่นๆ</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="conclusion_remark" className="block text-sm font-medium text-gray-800 dark:text-gray-300">
                      ความเห็น {form.conclusion && form.conclusion !== 'approved' && <span className="text-red-600 dark:text-red-400">*</span>}
                    </label>
                    <textarea
                      id="conclusion_remark"
                      rows={3}
                      className={textareaClass}
                      placeholder="นักศึกษาจะเห็นข้อความนี้ในหน้าใบสมัครของตนเอง"
                      value={form.conclusion_remark}
                      onChange={(e) => setForm({ ...form, conclusion_remark: e.target.value })}
                    />
                  </div>

                  {form.conclusion === 'approved' && (
                    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                      การอนุมัติจะให้สิทธิ์นักศึกษายื่นแบบแจ้งความจำนง และบันทึกเกรด{' '}
                      {gpaText(selectedApp.claimed_gpa)} ที่นักศึกษาแจ้งเป็นเกรดทางการในทะเบียน
                      การกระทำนี้ถูกบันทึกในระบบตรวจสอบย้อนหลัง
                    </p>
                  )}
                </div>
              )}
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setSelectedApp(null)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'กำลังบันทึก...' : 'บันทึกผล'}
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default ApplicationReview;
