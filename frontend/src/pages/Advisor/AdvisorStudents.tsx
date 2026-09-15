import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { IntentForm, StudentRow } from '../../types/api';
import { Search, ExternalLink, Calendar } from 'lucide-react';
import WeeklyLogViewModal from '../../components/WeeklyLogViewModal';
import AlertBanner from '../../components/ui/AlertBanner';
import StatusBadge from '../../components/ui/StatusBadge';
import { intentDisplayStatus } from '../../utils/intentStatus';

const AdvisorStudents: React.FC = () => {
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success] = useState<string | null>(null);

  // Weekly Log viewer modal state
  const [selectedStudentForWeeklyLog, setSelectedStudentForWeeklyLog] = useState<StudentRow | null>(null);

  // Search & Filter State for Student List
  const [searchText, setSearchText] = useState('');

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
      console.error('Failed to load students data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลใบความจำนงหรือรายชื่อนักศึกษาได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'students')} />;
  }

  // Filter students based on search
  const filteredStudents = students.filter(student => {
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
    const studentCode = (student.student_code || '').toLowerCase();
    const nickname = (student.nickname || '').toLowerCase();
    return searchText === '' ||
      fullName.includes(searchText.toLowerCase()) ||
      studentCode.includes(searchText.toLowerCase()) ||
      nickname.includes(searchText.toLowerCase());
  });

  return (
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">รายชื่อนักศึกษาในสาขาวิชา</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          ตรวจสอบรายชื่อ เกรดเฉลี่ย และสถานะคำขอสหกิจศึกษาของนักศึกษาในสาขาที่ท่านดูแล
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center">
        {/* Search box */}
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัสนักศึกษา หรือ ชื่อ-นามสกุล..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          />
        </div>
      </div>

      {/* Student Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        {filteredStudents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">สาขาวิชา / เกรดเฉลี่ย</th>
                  <th className="p-4 font-semibold">สถานะคำขอปัจจุบัน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredStudents.map((student) => {
                  const studentIntent = intents.find(i => i.student_id === student.student_id);

                  return (
                    <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">
                          {student.first_name ? `${student.first_name} ${student.last_name}` : 'ไม่ระบุชื่อ'}
                        </span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          รหัส: {student.student_code}
                        </span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">
                        <span className="block font-medium">{student.major_name_th}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">GPA: {student.cumulative_gpa ? Number(student.cumulative_gpa).toFixed(2) : 'N/A'}</span>
                      </td>
                      <td className="p-4">
                        {studentIntent ? (
                          <div className="flex flex-col gap-1 items-start">
                            <StatusBadge status={intentDisplayStatus(studentIntent.status, studentIntent.cover_letter_status)} domain="intent" />
                            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium truncate max-w-[150px]">
                              {studentIntent.company_name_th}
                            </span>
                            <button
                              type="button"
                              onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: studentIntent.form_id }))}
                              className="text-xs text-brand-blue dark:text-blue-400 font-bold hover:underline flex items-center gap-0.5 mt-0.5"
                            >
                              ดูใบสมัครแบบละเอียด <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedStudentForWeeklyLog(student)}
                              className="text-xs text-emerald-700 dark:text-emerald-400 font-bold hover:underline flex items-center gap-0.5 mt-0.5"
                            >
                              ดูบันทึกรายสัปดาห์ (Weekly Log) <Calendar className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="text-gray-600 dark:text-gray-400 text-xs">ยังไม่ส่งคำร้องขอสหกิจ</span>
                            <button
                              type="button"
                              onClick={() => setSelectedStudentForWeeklyLog(student)}
                              className="text-xs text-emerald-700 dark:text-emerald-400 font-bold hover:underline flex items-center gap-0.5"
                            >
                              ดูบันทึกรายสัปดาห์ (Weekly Log) <Calendar className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400 text-sm">
            ไม่พบข้อมูลนักศึกษาที่ตรงตามเงื่อนไขค้นหา
          </div>
        )}
      </div>

      {/* Weekly Log Viewer Modal */}
      <WeeklyLogViewModal
        isOpen={selectedStudentForWeeklyLog !== null}
        studentId={selectedStudentForWeeklyLog?.student_id || null}
        studentName={selectedStudentForWeeklyLog ? `${selectedStudentForWeeklyLog.first_name || ''} ${selectedStudentForWeeklyLog.last_name || ''}`.trim() : ''}
        studentCode={selectedStudentForWeeklyLog?.student_code}
        onClose={() => setSelectedStudentForWeeklyLog(null)}
      />
    </div>
  );
};

export default AdvisorStudents;
