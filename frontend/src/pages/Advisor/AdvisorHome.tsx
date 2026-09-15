import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { IntentForm, StudentRow } from '../../types/api';
import { Users, FileText, CheckCircle } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import StatusBadge from '../../components/ui/StatusBadge';
import { intentDisplayStatus } from '../../utils/intentStatus';

const intentStudentName = (intent?: IntentForm | null): string =>
  [intent?.first_name, intent?.last_name].filter(Boolean).join(' ').trim()
  || intent?.student_name
  || intent?.student_code
  || 'ไม่ระบุชื่อ';

const AdvisorHome: React.FC = () => {
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success] = useState<string | null>(null);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [intentsRes, studentsRes] = await Promise.all([
        api.get('/intents'),
        api.get('/students'),
      ]);
      setIntents(intentsRes || []);
      setStudents(studentsRes || []);
    } catch (err) {
      console.error('Failed to load advisor dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลใบความจำนงหรือรายชื่อนักศึกษาได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'dashboard')} />;
  }

  const pendingIntents = intents.filter(i => i.status === 'pending_advisor');
  const DEAD_INTENT_STATUSES = ['rejected', 'company_rejected'];
  const approvedIntents = intents.filter(
    i => i.status !== 'pending_advisor' && !DEAD_INTENT_STATUSES.includes(i.status)
  );
  const trackedIntents = intents.filter(i => !DEAD_INTENT_STATUSES.includes(i.status));

  return (
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">ระบบตรวจสอบใบความจำนง (อาจารย์ที่ปรึกษา)</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          ติดตามว่านักศึกษาในความดูแลยื่นคำร้องที่ไหนและไปถึงขั้นไหนแล้ว — การลงนามอนุมัติ
          อยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น ไม่ใช่ในระบบ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Total Students */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-brand-blue dark:text-blue-400 rounded-2xl">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">นักศึกษาในสาขาทั้งหมด</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {students.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>

        {/* Card 2: Pending Intents */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400 rounded-2xl">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">รอนำแบบคำร้องไปลงนาม</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {pendingIntents.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>

        {/* Card 3: Approved Placements */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 rounded-2xl">
            <CheckCircle className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">อนุมัติแล้ว/กำลังดำเนินการ</span>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
              {approvedIntents.length} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">คน</span>
            </h3>
          </div>
        </div>
      </div>

      {/* Pending list table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            ใบความจำนงของนักศึกษาในความดูแล ({trackedIntents.length} รายการ)
          </span>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            การลงนามอนุมัติอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — หน้านี้ไว้ติดตามว่า
            นักศึกษาในความดูแลยื่นที่ไหนและไปถึงขั้นไหนแล้ว
          </p>
        </div>

        {trackedIntents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">สถานประกอบการ</th>
                  <th className="p-4 font-semibold">ตำแหน่งงาน</th>
                  <th className="p-4 font-semibold">สถานะ</th>
                  <th className="p-4 font-semibold text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {trackedIntents.map((intent) => {
                  return (
                    <tr key={intent.form_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">{intentStudentName(intent)}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">รหัส: {intent.student_code}</span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {intent.company_name_th}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {intent.job_title || '–'}
                      </td>
                      <td className="p-4">
                        <StatusBadge status={intentDisplayStatus(intent.status, intent.cover_letter_status)} domain="intent" />
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: intent.form_id }))}
                            className="py-1.5 px-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold transition-all text-gray-700 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800 text-xs"
                          >
                            ตรวจทาน
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400 text-sm">
            ยังไม่มีนักศึกษาในความดูแลยื่นใบความจำนง
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvisorHome;
