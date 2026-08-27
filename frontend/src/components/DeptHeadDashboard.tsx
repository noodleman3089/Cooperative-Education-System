import React, { useState } from 'react';
import { Search, Users } from 'lucide-react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api from '../services/api';
import type { StudentProfile, IntentForm } from '../types/api';
import AssignAdvisorModal from './AssignAdvisorModal';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';
import { intentDisplayStatus } from '../utils/intentStatus';
import { Select } from './ui/Input';

/**
 * สถานะที่แปลว่า "ใบนี้ตายแล้ว" — ต้องตรงกับที่ `models/intent.ts` ใช้
 * (`AdvisorDashboard` มีลิสต์เดียวกันด้วยเหตุผลเดียวกัน)
 */
const DEAD_INTENT_STATUSES = ['rejected', 'company_rejected'];

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
  first_name?: string | null;
  last_name?: string | null;
}

interface DeptHeadDashboardProps {
  activeMenu?: string;
}


/** `/students` sends first_name/last_name; every table here showed only the code. */
const studentDisplayName = (s: { first_name?: string | null; last_name?: string | null; student_code?: string }): string =>
  [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.student_code || 'ไม่ระบุชื่อ';

/** Falls back to the email only when the personnel record has no name on it. */
const personnelDisplayName = (p?: Personnel): string =>
  p ? ([p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email) : '';

const DeptHeadDashboard: React.FC<DeptHeadDashboardProps> = ({ activeMenu = 'dashboard' }) => {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [advisors, setAdvisors] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Intent Approval States
  const [pendingIntents, setPendingIntents] = useState<IntentForm[]>([]);

  // Assignment Modal States
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isSingleEdit, setIsSingleEdit] = useState(false);

  // Search & filter for the two long student tables. Same three controls the
  // advisor's roster has had all along — the head oversees more students than
  // any single advisor and had none of them.
  const [searchText, setSearchText] = useState('');
  const [eligibilityFilter, setEligibilityFilter] = useState('all');
  const [advisorFilter, setAdvisorFilter] = useState('all');

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);

      // The approval queue needs the intents; nothing else does. All three were
      // fetched on every menu, repeated by `useDashboardData` every ten seconds,
      // so reading the approval queue also pulled every student and every
      // advisor in the department six times a minute to draw nothing.
      if (activeMenu === 'approval') {
        // ⚠️ เดิมกรอง `approved_by_advisor` ซึ่งเป็นสถานะของเส้นทางเก่าที่ไม่มีใบไหน
        // ไปถึงอีกแล้วตั้งแต่ 2026-08-26 (ลายเซ็นย้ายไปอยู่บนกระดาษ) หน้านี้จึงว่างเปล่า
        // ตลอดกาล · แก้ครั้งนั้นเป็นการดึงสองสถานะที่ยังเดินกระดาษอยู่ — ซึ่งยังไม่พอ
        // เพราะพอเจ้าหน้าที่กดรับ ใบก็หายจากหน้า "ติดตาม" ทันที (เจอตอนเดินจริง
        // 2026-08-27) · ตอนนี้ดึงทั้งสาขาแล้วคัดเฉพาะใบที่ยังมีชีวิตอยู่
        const all = (await api.get('/intents').catch(() => [])) as IntentForm[] | null;
        setPendingIntents((all || []).filter((i) => !DEAD_INTENT_STATUSES.includes(i.status)));
      } else {
        const [studentsRes, personnelRes] = await Promise.all([
          api.get('/students'),
          api.get('/personnel?role=advisor'),
        ]);
        setStudents(studentsRes || []);
        setAdvisors(personnelRes || []);
      }
    } catch (err) {
      console.error('Failed to load department head dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลนักศึกษาและรายชื่ออาจารย์ในสาขาวิชาได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, [activeMenu]);

  // ⚠️ handleApproveIntent / handleRejectIntent / closeRejectDialog ถูกลบเมื่อ
  // 2026-08-26 — หัวหน้าสาขาลงนามช่อง "อนุญาต / ไม่อนุญาต" บนแบบคำร้อง
  // (เอกสารหมายเลข 1) ด้วยปากกา · endpoint PATCH /intents/:id/dept-head-status
  // **ถูกลบทิ้งจากเซิร์ฟเวอร์แล้ว** เมื่อ 2026-08-27 พร้อมสถานะ rejected_by_dept_head

  /**
   * Select-all covers what is on screen, not the whole department. Ticking it
   * against the unfiltered list meant a head who had narrowed the table to five
   * people could select forty without seeing them.
   */
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

  if (loading) {
    return (
      <PageSkeleton variant={skeletonFor('dept_head', activeMenu)} />
    );
  }

  // Calculated Stats
  const totalStudents = students.length;
  const assignedAdvisorCount = students.filter(s => s.advisor_id).length;
  const unassignedAdvisorCount = totalStudents - assignedAdvisorCount;
  const assignedSupervisorCount = students.filter(s => s.supervisor_id).length;

  const filteredStudents = students.filter((student) => {
    const haystack = [
      student.first_name,
      student.last_name,
      student.student_code,
      student.company_name,
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = searchText === '' || haystack.includes(searchText.toLowerCase());

    const matchesEligibility =
      eligibilityFilter === 'all'
      || (eligibilityFilter === 'eligible' && student.is_eligible === true)
      || (eligibilityFilter === 'ineligible' && student.is_eligible === false);

    const matchesAdvisor =
      advisorFilter === 'all'
      || (advisorFilter === 'assigned' && !!student.advisor_id)
      || (advisorFilter === 'unassigned' && !student.advisor_id);

    return matchesSearch && matchesEligibility && matchesAdvisor;
  });

  /**
   * Only the students currently on screen count as selected. Filtering does not
   * clear the tick boxes, so without this a head could tick ten people, narrow
   * the filter until they are hidden, and then batch-assign ten students they
   * can no longer see. Batch assign, the counter and the header checkbox all
   * read from here.
   */
  const visibleIdSet = new Set(filteredStudents.map(s => s.student_id));
  const selectedVisibleIds = selectedStudentIds.filter(id => visibleIdSet.has(id));
  const hiddenSelectedCount = selectedStudentIds.length - selectedVisibleIds.length;
  const isFiltering = searchText !== '' || eligibilityFilter !== 'all' || advisorFilter !== 'all';

  // Single student initial values lookup
  const singleStudent = isSingleEdit && selectedStudentIds.length === 1
    ? students.find(s => s.student_id === selectedStudentIds[0])
    : null;
  const initialAdvisorId = singleStudent?.advisor_id || '';
  const initialSupervisorId = singleStudent?.supervisor_id || '';

  return (
    <div className="space-y-6 page-enter">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            {activeMenu === 'dashboard' && 'ภาพรวมนักศึกษาสหกิจสาขาวิชา'}
            {activeMenu === 'approval' && 'ติดตามคำร้องใบความจำนงของสาขาวิชา'}
            {activeMenu === 'assignment' && 'จัดสรรอาจารย์ที่ปรึกษาสหกิจศึกษา'}
            {activeMenu === 'students' && 'ตรวจสอบสถานะคุณสมบัติและสิทธิ์นักศึกษา'}
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {activeMenu === 'dashboard' && 'สถิติการดำเนินการสหกิจศึกษาและข่าวสารภาพรวมภายในภาควิชา'}
            {activeMenu === 'approval' && 'การลงนามอนุมัติอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — หน้านี้ไว้ดูว่าคำร้องไปถึงขั้นไหนแล้ว'}
            {activeMenu === 'assignment' && 'กำหนดอาจารย์ที่ปรึกษาและอาจารย์นิเทศหลักรายกลุ่มและบุคคล'}
            {activeMenu === 'students' && 'ตรวจสอบความพร้อม สิทธิ์สะสม และข้อมูลการปฐมนิเทศของนักศึกษา'}
          </p>
        </div>

        {activeMenu === 'assignment' && (
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
            {/* The count was missing, so the only way to know what a batch
                assign was about to touch was to count the ticks by eye. */}
            กำหนดอาจารย์แบบกลุ่ม{selectedVisibleIds.length > 0 ? ` (${selectedVisibleIds.length} คน)` : ''}
          </Button>
        )}
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {/* Search and filters for the two tables that list every student in the
          department. Neither had any, while the advisor's shorter roster has
          had all three since round 8. */}
      {(activeMenu === 'assignment' || activeMenu === 'students') && (
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
              value={eligibilityFilter}
              onChange={(e) => setEligibilityFilter(e.target.value)}
              className="flex-1 md:flex-initial" size="sm"
            >
              <option value="all">สิทธิ์สะสม: ทั้งหมด</option>
              <option value="eligible">ผ่านเกณฑ์</option>
              <option value="ineligible">ไม่ผ่านเกณฑ์</option>
            </Select>

            {/* "Who still has nobody" is the question this screen exists to
                answer, so it is a filter rather than something to eyeball. */}
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

          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            แสดง {filteredStudents.length} จาก {totalStudents} คน
          </span>
        </div>
      )}

      {/* Ticks survive a filter change, so say so rather than quietly batching
          up people the head can no longer see. */}
      {activeMenu === 'assignment' && hiddenSelectedCount > 0 && (
        <AlertBanner
          variant="error"
          message={`เลือกไว้อีก ${hiddenSelectedCount} คนที่ถูกซ่อนด้วยตัวกรองปัจจุบัน — การกำหนดแบบกลุ่มจะทำเฉพาะ ${selectedVisibleIds.length} คนที่แสดงอยู่เท่านั้น`}
        />
      )}

      {/* ── VIEW 1: DASHBOARD OVERVIEW ── */}
      {activeMenu === 'dashboard' && (
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
            {/* Was headed "ล่าสุด" while showing whichever five the API happened
                to return first, with nothing to say the list was cut off. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                รายชื่อนักศึกษาในสาขาวิชา
                {totalStudents > 5 && (
                  <span className="ml-2 font-normal text-xs text-gray-500 dark:text-gray-400">
                    แสดง 5 จาก {totalStudents} คน
                  </span>
                )}
              </h3>
              {totalStudents > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'students' }))}
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
                    <th className="p-4 font-semibold">สถานะสิทธิ์</th>
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
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            student.is_eligible 
                              ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                              : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                          }`}>
                            {student.is_eligible ? 'ผ่านเกณฑ์สหกิจ' : 'ไม่ผ่านเกณฑ์'}
                          </span>
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
      )}

      {/* ── VIEW 2: ASSIGN ADVISOR ── */}
      {activeMenu === 'assignment' && (
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
                  <th className="p-4 font-semibold">สิทธิ์สะสม</th>
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
                        <span className="block text-xs text-gray-500 mt-0.5 dark:text-gray-400">{student.company_province || ''}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          student.is_eligible
                            ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                        }`}>
                          {student.is_eligible ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์'}
                        </span>
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
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {isFiltering
                  ? 'ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองด้านบน'
                  : 'รายชื่อจะปรากฏเมื่อนักศึกษากรอกประวัติเข้าสู่ระบบแล้ว'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── VIEW 3: STUDENT STATUS CHECK ── */}
      {activeMenu === 'students' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-400">
                  <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                  <th className="p-4 font-semibold">สิทธิ์สะสม (Eligibility)</th>
                  <th className="p-4 font-semibold">สถานะปฐมนิเทศ (Orientation)</th>
                  <th className="p-4 font-semibold">อาจารย์ที่ปรึกษา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredStudents.map((student) => {
                  const advisor = advisors.find(a => a.personnel_id === student.advisor_id);
                  return (
                    <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">{studentDisplayName(student)}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">รหัส: {student.student_code}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          student.is_eligible 
                            ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                            : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                        }`}>
                          {student.is_eligible ? 'ผ่านเกณฑ์สหกิจศึกษา' : 'ไม่ผ่านเกณฑ์สหกิจศึกษา'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          student.is_orientation_passed 
                            ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                            : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400'
                        }`}>
                          {student.is_orientation_passed ? 'ผ่านการปฐมนิเทศแล้ว' : 'ยังไม่ปฐมนิเทศ'}
                        </span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {advisor ? personnelDisplayName(advisor) : <span className="text-gray-600 dark:text-gray-400">ยังไม่ระบุอาจารย์ที่ปรึกษา</span>}
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
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {isFiltering
                  ? 'ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองด้านบน'
                  : 'รายชื่อจะปรากฏเมื่อนักศึกษากรอกประวัติเข้าสู่ระบบแล้ว'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── VIEW 4: INTENT APPROVAL ── */}
      {activeMenu === 'approval' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              คำร้องใบความจำนงในสาขาวิชา ({pendingIntents.length} รายการ)
            </span>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              การลงนามอนุญาตอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — หน้านี้ไว้ดูว่ามีใคร
              ยื่นที่ไหนบ้าง และตรวจทานรายละเอียดก่อนลงนามบนกระดาษ
            </p>
          </div>

          {pendingIntents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-400">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">ตำแหน่งงาน</th>
                    {/* หน้านี้เป็นหน้าติดตามแล้ว สถานะจึงเป็นคอลัมน์ที่คนเปิดมาหา */}
                    <th className="p-4 font-semibold">สถานะ</th>
                    <th className="p-4 font-semibold text-center">รายละเอียด</th>
                    <th className="p-4 font-semibold text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pendingIntents.map((intent) => {
                    return (
                      <tr key={intent.form_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                          <span className="block font-bold">{studentDisplayName(intent)}</span>
                          <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">รหัส: {intent.student_code}</span>
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {intent.company_name_th}
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {intent.job_title || 'ฝึกงานทั่วไป'}
                        </td>
                        <td className="p-4">
                          <StatusBadge
                            status={intentDisplayStatus(intent.status, intent.cover_letter_status)}
                            domain="intent"
                          />
                        </td>
                        <td className="p-4 text-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: intent.form_id }))}
                          >
                            ตรวจทาน
                          </Button>
                        </td>
                        <td className="p-4 text-right text-xs text-gray-600 dark:text-gray-400">
                          {/* ⚠️ ปุ่มอนุมัติ/ตีกลับถูกถอดออกเมื่อ 2026-08-26 — ช่อง
                              "อนุญาต / ไม่อนุญาต" ของหัวหน้าสาขาอยู่บนแบบคำร้อง
                              (เอกสารหมายเลข 1) ที่นักศึกษานำมาให้ลงนามด้วยปากกา
                              ระบบไม่ได้รอการกดที่นี่อีกแล้ว */}
                          ลงนามบนแบบคำร้อง
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 px-6 text-center">
              <div className="max-w-md mx-auto">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-brand-blue dark:text-blue-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="text-base font-semibold text-gray-800 dark:text-white mb-1">
                  ยังไม่มีคำร้องใบความจำนงในสาขาวิชา
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                  รายการจะปรากฏเมื่อนักศึกษายื่นคำร้อง — ท่านลงนามบนกระดาษ ไม่ต้องกดอนุมัติในระบบ
                </p>
                {/* แถบเส้นทางนี้เคยเขียนว่า "อาจารย์อนุมัติ → รอหัวหน้าสาขาวิชา" ซึ่งเป็น
                    เส้นทางเดิมที่ถูกยกไปอยู่บนกระดาษเมื่อ 2026-08-26 */}
                <div className="inline-flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                  <span>นักศึกษายื่นคำร้อง</span>
                  <span>→</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">ลงนามบนกระดาษ</span>
                  <span>→</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">เจ้าหน้าที่รับคำร้อง</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ⚠️ ConfirmDialog อนุมัติ และ Modal ตีกลับ ถูกลบเมื่อ 2026-08-26 —
          หัวหน้าสาขาลงนามบนแบบคำร้อง (เอกสารหมายเลข 1) ด้วยปากกาแทน
          หน้าจอนี้จึงไม่มีปุ่มที่เปลี่ยนสถานะใบความจำนงอีกแล้ว */}
      {/* Assignment Modal Component */}
      <AssignAdvisorModal
        isOpen={showAssignModal}
        isSingleEdit={isSingleEdit}
        // Batch acts on what is on screen; a single edit is always the row that
        // was clicked, so it is visible by definition.
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

export default DeptHeadDashboard;
