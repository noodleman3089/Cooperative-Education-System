import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { StudentProfile } from '../../types/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
  first_name?: string | null;
  last_name?: string | null;
}

const studentDisplayName = (s: { first_name?: string | null; last_name?: string | null; student_code?: string }): string =>
  [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.student_code || 'ไม่ระบุชื่อ';

const personnelDisplayName = (p?: Personnel): string =>
  p ? ([p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email) : '';

const DeptHeadHome: React.FC = () => {
  const [, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [advisors, setAdvisors] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [studentsRes, personnelRes] = await Promise.all([
        api.get('/students'),
        api.get('/personnel?role=advisor'),
      ]);
      setStudents(studentsRes || []);
      setAdvisors(personnelRes || []);
    } catch (err) {
      console.error('Failed to load department head dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลนักศึกษาและรายชื่ออาจารย์ในสาขาวิชาได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dept_head', 'dashboard')} />;
  }

  const totalStudents = students.length;
  const assignedAdvisorCount = students.filter(s => s.advisor_id).length;
  const unassignedAdvisorCount = totalStudents - assignedAdvisorCount;
  const assignedSupervisorCount = students.filter(s => s.supervisor_id).length;

  return (
    <div className="space-y-6 page-enter">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            ภาพรวมนักศึกษาสหกิจสาขาวิชา
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            สถิติการดำเนินการสหกิจศึกษาและข่าวสารภาพรวมภายในภาควิชา
          </p>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />

      <div className="space-y-6">
        {/* Bento Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">นักศึกษาในภาควิชาทั้งหมด</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-gray-800 dark:text-white">{totalStudents}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">คน</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">จัดสรรอาจารย์ที่ปรึกษาแล้ว</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-green-700 dark:text-green-400">{assignedAdvisorCount}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((assignedAdvisorCount / totalStudents) * 100) : 0}%)</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">ยังไม่ได้รับการจัดสรร</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-yellow-600 dark:text-yellow-400">{unassignedAdvisorCount}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((unassignedAdvisorCount / totalStudents) * 100) : 0}%)</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">จัดสรรอาจารย์นิเทศแล้ว</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-brand-blue dark:text-blue-400">{assignedSupervisorCount}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((assignedSupervisorCount / totalStudents) * 100) : 0}%)</span>
            </div>
          </div>
        </div>

        {/* Activity/Status Summary Table (Preview) */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">
              รายชื่อนักศึกษาในสาขาวิชา
              {totalStudents > 5 && (
                <span className="ml-2 font-normal text-xs text-gray-600 dark:text-gray-400">
                  แสดง 5 จาก {totalStudents} คน
                </span>
              )}
            </h3>
            {totalStudents > 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  next.set('menu', 'assignment');
                  return next;
                })}
              >
                ดูทั้งหมด →
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-400">
                  <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                  <th className="p-4 font-semibold">อาจารย์ที่ปรึกษา</th>
                  <th className="p-4 font-semibold">อาจารย์นิเทศ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {students.slice(0, 5).map((student) => {
                  const advisor = advisors.find(a => a.personnel_id === student.advisor_id);
                  const supervisor = advisors.find(a => a.personnel_id === student.supervisor_id);
                  return (
                    <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/10">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">{studentDisplayName(student)}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">รหัส: {student.student_code}</span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">
                        {advisor ? personnelDisplayName(advisor) : <span className="text-gray-600 dark:text-gray-400">ยังไม่ระบุ</span>}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">
                        {supervisor ? personnelDisplayName(supervisor) : <span className="text-gray-600 dark:text-gray-400">ยังไม่ระบุ</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeptHeadHome;
