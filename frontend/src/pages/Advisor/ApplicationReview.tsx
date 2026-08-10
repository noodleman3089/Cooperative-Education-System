import React, { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal, { ModalBody } from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';

interface Application {
  application_id: number;
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  cumulative_gpa: number;
  expected_region: string;
  special_skills: string;
  status: string;
  created_at: string;
}

const ApplicationReview: React.FC = () => {
  const authContext = useContext(AuthContext);
  const user = authContext?.user;
  const isAdvisor = user?.roles?.includes('advisor');
  const isDeptHead = user?.roles?.includes('dept_head');
  
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Evaluation Modal State
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [evalForm, setEvalForm] = useState({
    academic_evaluation: 'appropriate',
    academic_remark: '',
    behavior_evaluation: 'appropriate',
    behavior_remark: '',
    maturity_evaluation: 'appropriate',
    maturity_remark: '',
    conclusion: 'approved', // For Dept Head
    conclusion_remark: '',
  });

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const data = await api.get('/applications');
      setApplications(data.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;

    try {
      const endpoint = isDeptHead
        ? `/applications/${selectedApp.application_id}/approve`
        : `/applications/${selectedApp.application_id}/evaluate`;

      const body = isDeptHead
        ? { conclusion: evalForm.conclusion, remark: evalForm.conclusion_remark }
        : {
            academic_evaluation: evalForm.academic_evaluation,
            academic_remark: evalForm.academic_remark,
            behavior_evaluation: evalForm.behavior_evaluation,
            behavior_remark: evalForm.behavior_remark,
            maturity_evaluation: evalForm.maturity_evaluation,
            maturity_remark: evalForm.maturity_remark,
          };

      await api.put(endpoint, body);

      setSelectedApp(null);
      fetchApplications();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10 dark:bg-gray-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tighter text-gray-900 dark:text-gray-50">
              ตรวจสอบใบสมัคร (Co-op 01)
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              พิจารณาคุณสมบัติและประเมินความพร้อมของนักศึกษา
            </p>
          </div>
        </div>

        <AlertBanner variant="error" message={error} className="mb-6" />

        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800/50">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-medium text-gray-900 sm:pl-6 dark:text-gray-300">รหัสนักศึกษา</th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-900 dark:text-gray-300">ชื่อ-สกุล</th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-900 dark:text-gray-300">GPAX</th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-medium text-gray-900 dark:text-gray-300">สถานะ</th>
                <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800/50 bg-white dark:bg-gray-900">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">กำลังโหลดข้อมูล...</td>
                </tr>
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">ไม่พบรายการใบสมัคร</td>
                </tr>
              ) : (
                applications.map((app) => (
                  <tr key={app.application_id} className="hover:bg-gray-50 transition-colors dark:hover:bg-gray-800/20">
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6 dark:text-gray-100">
                      {app.student_code}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {app.first_name} {app.last_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {app.cumulative_gpa}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                      {(isAdvisor && app.status === 'pending_advisor') || (isDeptHead && app.status === 'pending_dept_head') ? (
                        <button
                          onClick={() => setSelectedApp(app)}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          ประเมิน<span className="sr-only">, {app.student_code}</span>
                        </button>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">ตรวจสอบแล้ว</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal - Extremely simple bento overlay style */}
      {selectedApp && (
        <Modal
          onClose={() => setSelectedApp(null)}
          size="lg"
          closeOnBackdrop={false}
          title={isDeptHead ? 'การอนุมัติ (Dept Head)' : 'การประเมิน (Advisor)'}
        >
          <ModalBody>
            <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">
              นักศึกษา: {selectedApp.student_code} {selectedApp.first_name} {selectedApp.last_name}
            </p>

            <form onSubmit={handleAction} className="space-y-4">
              {isAdvisor ? (
                <>
                  {['academic', 'behavior', 'maturity'].map((type) => (
                    <div key={type} className="grid grid-cols-2 gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          {type === 'academic' ? 'ด้านวิชาการ' : type === 'behavior' ? 'ด้านความประพฤติ' : 'ด้านวุฒิภาวะ'}
                        </label>
                        <select
                          className="mt-1 block w-full rounded-xl border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600 sm:text-sm dark:bg-gray-800 dark:text-white dark:ring-gray-700"
                          value={(evalForm as any)[`${type}_evaluation`]}
                          onChange={(e) => setEvalForm({...evalForm, [`${type}_evaluation`]: e.target.value})}
                        >
                          <option value="appropriate">เหมาะสม</option>
                          <option value="inappropriate">ไม่เหมาะสม</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="col-span-2 pb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ผลการพิจารณา</label>
                  <select
                    className="mt-1 block w-full rounded-xl border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600 sm:text-sm dark:bg-gray-800 dark:text-white dark:ring-gray-700"
                    value={evalForm.conclusion}
                    onChange={(e) => setEvalForm({...evalForm, conclusion: e.target.value})}
                  >
                    <option value="approved">อนุมัติ</option>
                    <option value="waitlisted">รอดำเนินการ</option>
                    <option value="other">อื่นๆ</option>
                  </select>
                </div>
              )}

              <div className="pt-2 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelectedApp(null)}>
                  ยกเลิก
                </Button>
                <Button type="submit" size="sm">
                  บันทึกผล
                </Button>
              </div>
            </form>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
};

export default ApplicationReview;
