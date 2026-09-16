import React, { useState } from 'react';
import { Search, Users } from 'lucide-react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { StudentProfile } from '../../types/api';
import AssignAdvisorModal from '../../components/AssignAdvisorModal';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';

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

const AdvisorAssignment: React.FC = () => {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [advisors, setAdvisors] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isSingleEdit, setIsSingleEdit] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [advisorFilter, setAdvisorFilter] = useState('all');

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
      console.error('Failed to load assignment data:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลนักศึกษาและรายชื่ออาจารย์ในสาขาวิชาได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  const totalStudents = students.length;

  const filteredStudents = students.filter((student) => {
    const haystack = [
      student.first_name,
      student.last_name,
      student.student_code,
      student.company_name,
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = searchText === '' || haystack.includes(searchText.toLowerCase());

    const matchesAdvisor =
      advisorFilter === 'all'
      || (advisorFilter === 'assigned' && !!student.advisor_id)
      || (advisorFilter === 'unassigned' && !student.advisor_id);

    return matchesSearch && matchesAdvisor;
  });

  const visibleIdSet = new Set(filteredStudents.map(s => s.student_id));
  const selectedVisibleIds = selectedStudentIds.filter(id => visibleIdSet.has(id));
  const hiddenSelectedCount = selectedStudentIds.length - selectedVisibleIds.length;
  const isFiltering = searchText !== '' || advisorFilter !== 'all';

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>, visible: StudentProfile[]) => {
    const visibleIds = visible.map(s => s.student_id);
    if (e.target.checked) {
      setSelectedStudentIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    } else {
      setSelectedStudentIds(prev => prev.filter(id => !visibleIds.includes(id)));
    }
  };

  const handleSelectStudent = (studentId: number, checked: boolean) => {
    if (checked) {
      setSelectedStudentIds(prev => [...prev, studentId]);
    } else {
      setSelectedStudentIds(prev => prev.filter(id => id !== studentId));
    }
  };

  const openBatchAssign = () => {
    if (selectedVisibleIds.length === 0) {
      setError('กรุณาเลือกนักศึกษาอย่างน้อยหนึ่งคนเพื่อกำหนดอาจารย์');
      return;
    }
    setIsSingleEdit(false);
    setShowAssignModal(true);
  };

  const openSingleAssign = (student: StudentProfile) => {
    setIsSingleEdit(true);
    setSelectedStudentIds([student.student_id]);
    setShowAssignModal(true);
  };

  const singleStudent = isSingleEdit && selectedStudentIds.length === 1
    ? students.find(s => s.student_id === selectedStudentIds[0])
    : null;
  const initialAdvisorId = singleStudent?.advisor_id || '';
  const initialSupervisorId = singleStudent?.supervisor_id || '';

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dept_head', 'assignment')} />;
  }

  return (
    <div className="space-y-6 page-enter">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            จัดสรรอาจารย์ที่ปรึกษาสหกิจศึกษา
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            กำหนดอาจารย์ที่ปรึกษาและอาจารย์นิเทศหลักรายกลุ่มและบุคคล
          </p>
        </div>

        <Button
          onClick={openBatchAssign}
          disabled={selectedVisibleIds.length === 0}
          className="shrink-0"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        >
          กำหนดอาจารย์แบบกลุ่ม{selectedVisibleIds.length > 0 ? ` (${selectedVisibleIds.length} คน)` : ''}
        </Button>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:flex-row md:items-center dark:border-gray-800 dark:bg-gray-900">
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600 dark:text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="ค้นหาด้วยชื่อ รหัสนักศึกษา หรือสถานประกอบการ..."
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-4 text-xs focus:border-brand-blue focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div className="flex w-full shrink-0 gap-3 md:w-auto">
          <Select
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value)}
            className="flex-1 md:flex-initial" size="sm"
          >
            <option value="all">ที่ปรึกษา: ทั้งหมด</option>
            <option value="unassigned">ยังไม่ได้จัดสรร</option>
            <option value="assigned">จัดสรรแล้ว</option>
          </Select>
        </div>

        <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">
          แสดง {filteredStudents.length} จาก {totalStudents} คน
        </span>
      </div>

      {hiddenSelectedCount > 0 && (
        <AlertBanner
          variant="error"
          message={`เลือกไว้อีก ${hiddenSelectedCount} คนที่ถูกซ่อนด้วยตัวกรองปัจจุบัน — การกำหนดแบบกลุ่มจะทำเฉพาะ ${selectedVisibleIds.length} คนที่แสดงอยู่เท่านั้น`}
        />
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-400">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    aria-label="เลือกนักศึกษาทั้งหมดที่แสดงอยู่"
                    onChange={(e) => handleSelectAll(e, filteredStudents)}
                    checked={filteredStudents.length > 0 && selectedVisibleIds.length === filteredStudents.length}
                    className="rounded text-brand-blue focus:ring-brand-blue dark:text-blue-400"
                  />
                </th>
                <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                <th className="p-4 font-semibold">สถานประกอบการ</th>
                <th className="p-4 font-semibold">อาจารย์ที่ปรึกษา (Advisor)</th>
                <th className="p-4 font-semibold">อาจารย์นิเทศ (Supervisor)</th>
                <th className="p-4 font-semibold text-right">สลับปรับเปลี่ยน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredStudents.map((student) => {
                const isSelected = selectedStudentIds.includes(student.student_id);
                const advisor = advisors.find(a => a.personnel_id === student.advisor_id);
                const supervisor = advisors.find(a => a.personnel_id === student.supervisor_id);

                return (
                  <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => handleSelectStudent(student.student_id, e.target.checked)}
                        className="rounded text-brand-blue focus:ring-brand-blue dark:text-blue-400"
                      />
                    </td>
                    <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                      <span className="block font-bold">{studentDisplayName(student)}</span>
                      <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">รหัส: {student.student_code}</span>
                    </td>
                    <td className="p-4 text-gray-800 dark:text-gray-200">
                      <span className="block text-xs font-semibold">{student.company_name || <span className="text-gray-600 dark:text-gray-400 font-normal">ยังไม่มีสถานประกอบการ</span>}</span>
                      <span className="block text-xs text-gray-600 mt-0.5 dark:text-gray-400">{student.company_province || ''}</span>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                      {advisor ? personnelDisplayName(advisor) : <span className="text-gray-600 dark:text-gray-400">ยังไม่กำหนด</span>}
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                      {supervisor ? personnelDisplayName(supervisor) : <span className="text-gray-600 dark:text-gray-400">ยังไม่กำหนด</span>}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        type="button"
                        onClick={() => openSingleAssign(student)}
                        className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                        title="แก้ไขจัดสรรอาจารย์รายบุคคล"
                        aria-label={`แก้ไขการจัดสรรอาจารย์ของ ${studentDisplayName(student)}`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredStudents.length === 0 && (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:text-gray-400 dark:bg-gray-800">
              <Users className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {isFiltering ? 'ไม่พบนักศึกษาที่ตรงกับเงื่อนไขที่เลือก' : 'ยังไม่มีนักศึกษาในสาขาวิชานี้'}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {isFiltering
                ? 'ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองด้านบน'
                : 'รายชื่อจะปรากฏเมื่อนักศึกษากรอกประวัติเข้าสู่ระบบแล้ว'}
            </p>
          </div>
        )}
      </div>

      <AssignAdvisorModal
        isOpen={showAssignModal}
        isSingleEdit={isSingleEdit}
        selectedStudentIds={isSingleEdit ? selectedStudentIds : selectedVisibleIds}
        advisors={advisors}
        initialAdvisorId={initialAdvisorId}
        initialSupervisorId={initialSupervisorId}
        onClose={() => {
          setShowAssignModal(false);
          if (isSingleEdit) setSelectedStudentIds([]);
        }}
        onSuccess={async (msg) => {
          setSuccess(msg);
          setSelectedStudentIds([]);
          setShowAssignModal(false);
          await loadData();
        }}
      />
    </div>
  );
};

export default AdvisorAssignment;
