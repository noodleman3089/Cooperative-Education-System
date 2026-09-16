import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { StudentProfile } from '../../types/api';
import AssignAdvisorModal from '../../components/AssignAdvisorModal';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { getErrorMessage } from '../../utils/errors';

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

type AssignmentFilter = 'incomplete' | 'complete' | 'all';

const AdvisorAssignment: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [advisors, setAdvisors] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isSingleEdit, setIsSingleEdit] = useState(false);

  const [searchText, setSearchText] = useState('');

  // Initial filter from query param if provided
  const queryFilter = searchParams.get('filter');
  const [filter, setFilter] = useState<AssignmentFilter>(() => {
    if (queryFilter === 'incomplete' || queryFilter === 'complete' || queryFilter === 'all') {
      return queryFilter;
    }
    return 'all'; // Will update to 'incomplete' if any incomplete student exists once data loads
  });

  const [hasSetInitialFilter, setHasSetInitialFilter] = useState(false);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [studentsRes, personnelRes] = await Promise.all([
        api.get('/students'),
        api.get('/personnel?role=advisor'),
      ]);
      const studentList: StudentProfile[] = studentsRes || [];
      setStudents(studentList);
      setAdvisors(personnelRes || []);

      // If user did not specify a ?filter in query string and this is initial load,
      // default to 'incomplete' if incomplete students exist, else 'all'
      if (!hasSetInitialFilter && !queryFilter) {
        const hasIncomplete = studentList.some(s => !s.advisor_id || !s.supervisor_id);
        if (hasIncomplete) {
          setFilter('incomplete');
        }
        setHasSetInitialFilter(true);
      }
    } catch (err) {
      console.error('Failed to load assignment data:', err);
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถเรียกข้อมูลนักศึกษาและรายชื่ออาจารย์ในสาขาวิชาได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  // Update query string when filter changes
  const handleFilterChange = (newFilter: AssignmentFilter) => {
    setFilter(newFilter);
    const newParams = new URLSearchParams(searchParams);
    if (newFilter === 'all') {
      newParams.delete('filter');
    } else {
      newParams.set('filter', newFilter);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Compute counts
  const incompleteCount = useMemo(() => students.filter(s => !s.advisor_id || !s.supervisor_id).length, [students]);
  const completeCount = useMemo(() => students.filter(s => !!s.advisor_id && !!s.supervisor_id).length, [students]);
  const allCount = students.length;

  // Compute advisor workloads
  const advisorLoads = useMemo(() => {
    const map = new Map<number, { advisor: number; supervisor: number }>();
    for (const p of advisors) {
      map.set(p.personnel_id, { advisor: 0, supervisor: 0 });
    }
    for (const s of students) {
      if (s.advisor_id && map.has(s.advisor_id)) {
        map.get(s.advisor_id)!.advisor += 1;
      }
      if (s.supervisor_id && map.has(s.supervisor_id)) {
        map.get(s.supervisor_id)!.supervisor += 1;
      }
    }
    return map;
  }, [advisors, students]);

  // Filter students
  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const haystack = [
        student.first_name,
        student.last_name,
        student.student_code,
        student.company_name,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = searchText === '' || haystack.includes(searchText.toLowerCase());

      const isComplete = !!student.advisor_id && !!student.supervisor_id;
      const matchesFilter =
        filter === 'all' ||
        (filter === 'incomplete' && !isComplete) ||
        (filter === 'complete' && isComplete);

      return matchesSearch && matchesFilter;
    });
  }, [students, searchText, filter]);

  const visibleIdSet = useMemo(() => new Set(filteredStudents.map(s => s.student_id)), [filteredStudents]);
  const selectedVisibleIds = useMemo(() => selectedStudentIds.filter(id => visibleIdSet.has(id)), [selectedStudentIds, visibleIdSet]);
  const hiddenSelectedCount = selectedStudentIds.length - selectedVisibleIds.length;
  const isFiltering = searchText !== '' || filter !== 'all';

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
      {/* ══ Header ══ */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            จัดสรรอาจารย์ที่ปรึกษา &amp; นิเทศ
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            อาจารย์คนเดียวเป็นได้ทั้งสองตำแหน่ง · เลือกได้เฉพาะอาจารย์ในสาขาเดียวกับนักศึกษา (เซิร์ฟเวอร์ตรวจอีกชั้น)
          </p>
        </div>

        <Button
          data-testid="assign-batch-open"
          onClick={openBatchAssign}
          disabled={selectedVisibleIds.length === 0}
          className="shrink-0 font-bold"
        >
          กำหนดอาจารย์แบบกลุ่ม{selectedVisibleIds.length > 0 ? ` (${selectedVisibleIds.length} คน)` : ''}
        </Button>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* ══ Layout: Table on Left + Load Panel on Right ══ */}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        {/* Left Column: Card with Search, Chips, Table */}
        <div className="card flex-grow w-full min-w-0 bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs dark:bg-gray-900 dark:border-gray-800">
          {/* Search bar & Filter Chips */}
          <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-b border-gray-100 dark:border-gray-800">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600 dark:text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="ค้นหาชื่อ รหัส หรือสถานประกอบการ"
                className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-600 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="assign-filter-incomplete"
                onClick={() => handleFilterChange('incomplete')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  filter === 'incomplete'
                    ? 'bg-blue-900 text-white dark:bg-blue-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                ยังไม่ครบ {incompleteCount}
              </button>

              <button
                type="button"
                data-testid="assign-filter-complete"
                onClick={() => handleFilterChange('complete')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  filter === 'complete'
                    ? 'bg-blue-900 text-white dark:bg-blue-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                ครบแล้ว {completeCount}
              </button>

              <button
                type="button"
                data-testid="assign-filter-all"
                onClick={() => handleFilterChange('all')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  filter === 'all'
                    ? 'bg-blue-900 text-white dark:bg-blue-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                ทั้งหมด {allCount}
              </button>
            </div>
          </div>

          {/* Hidden selected count warning / active selection info */}
          {hiddenSelectedCount > 0 && (
            <div
              data-testid="assign-hidden-selected-warning"
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 bg-blue-50 border-b border-blue-200 text-xs text-blue-900 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200"
            >
              <span>
                <strong>เลือกอยู่ {selectedVisibleIds.length} คน</strong> ที่แสดงบนจอ
              </span>
              <span className="text-amber-800 font-semibold dark:text-amber-300">
                อีก {hiddenSelectedCount} คนที่เลือกไว้ถูกซ่อนด้วยตัวกรอง — ไม่ถูกรวมในการกำหนดแบบกลุ่ม
              </span>
            </div>
          )}

          {hiddenSelectedCount === 0 && selectedVisibleIds.length > 0 && (
            <div className="flex items-center justify-between px-5 py-2 bg-blue-50/70 border-b border-blue-100 text-xs text-blue-900 dark:bg-blue-950/30 dark:border-blue-900/60 dark:text-blue-200">
              <span>
                <strong>เลือกอยู่ {selectedVisibleIds.length} คน</strong> ที่แสดงบนจอ
              </span>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-300">
                  <th className="p-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกนักศึกษาทั้งหมดที่แสดงอยู่"
                      onChange={(e) => handleSelectAll(e, filteredStudents)}
                      checked={filteredStudents.length > 0 && selectedVisibleIds.length === filteredStudents.length}
                      className="h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:bg-gray-800 dark:text-blue-400"
                    />
                  </th>
                  <th className="p-3.5 font-bold">นักศึกษา</th>
                  <th className="p-3.5 font-bold">สถานประกอบการ</th>
                  <th className="p-3.5 font-bold">
                    <div>อาจารย์ที่ปรึกษา</div>
                    <div className="text-[11px] font-normal text-gray-600 dark:text-gray-400 mt-0.5">
                      เห็นชอบโครงร่าง (สหกิจ 11) · ตรวจรับเล่ม · ลงนาม สหกิจ 14
                    </div>
                  </th>
                  <th className="p-3.5 font-bold">
                    <div>อาจารย์นิเทศ</div>
                    <div className="text-[11px] font-normal text-gray-600 dark:text-gray-400 mt-0.5">
                      นัดนิเทศ (สหกิจ 12) · บันทึกการนิเทศ (สหกิจ 13) · อาจารย์คนนี้จะเห็นเมนูฝ่ายนิเทศหลังเข้าระบบใหม่
                    </div>
                  </th>
                  <th className="p-3.5 font-bold text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredStudents.map((student) => {
                  const isSelected = selectedStudentIds.includes(student.student_id);
                  const advisor = advisors.find(a => a.personnel_id === student.advisor_id);
                  const supervisor = advisors.find(a => a.personnel_id === student.supervisor_id);

                  return (
                    <tr
                      key={student.student_id}
                      data-testid={`assign-row-${student.student_id}`}
                      className={
                        isSelected
                          ? 'bg-blue-50/50 hover:bg-blue-50/80 dark:bg-blue-950/20 dark:hover:bg-blue-950/30'
                          : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/40'
                      }
                    >
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleSelectStudent(student.student_id, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:bg-gray-800 dark:text-blue-400"
                        />
                      </td>
                      <td className="p-3.5">
                        <span className="name font-bold text-gray-900 text-sm block dark:text-white">
                          {studentDisplayName(student)}
                        </span>
                        <span className="sub text-xs text-gray-600 block mt-0.5 dark:text-gray-400">
                          {student.student_code}
                        </span>
                      </td>
                      <td className="p-3.5">
                        {student.company_name ? (
                          <>
                            <span className="text-xs font-semibold text-gray-900 block dark:text-white">
                              {student.company_name}
                            </span>
                            {student.company_province && (
                              <span className="sub text-xs text-gray-600 block mt-0.5 dark:text-gray-400">
                                จ.{student.company_province}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-gray-600 dark:text-gray-400">
                            ยังไม่มีสถานประกอบการ
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {advisor ? (
                          <span className="text-xs text-gray-800 font-medium dark:text-gray-200">
                            {personnelDisplayName(advisor)}
                          </span>
                        ) : (
                          <span className="pill inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                            ยังไม่กำหนด
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {supervisor ? (
                          <span className="text-xs text-gray-800 font-medium dark:text-gray-200">
                            {personnelDisplayName(supervisor)}
                          </span>
                        ) : (
                          <span
                            className={`pill inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                              advisor
                                ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                            }`}
                          >
                            ยังไม่กำหนด
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => openSingleAssign(student)}
                          className="btn btn-ghost btn-sm px-3 py-1 text-xs font-bold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          แก้รายคน
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredStudents.length === 0 && (
            <div className="p-8">
              <EmptyState
                title={isFiltering ? 'ไม่พบนักศึกษาที่ตรงกับเงื่อนไขที่เลือก' : 'ยังไม่มีนักศึกษาในสาขาวิชานี้'}
                description={
                  isFiltering
                    ? 'ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองด้านบน'
                    : 'รายชื่อจะปรากฏเมื่อนักศึกษากรอกประวัติเข้าสู่ระบบแล้ว'
                }
              />
            </div>
          )}
        </div>

        {/* Right Column: Advisor Workload Panel */}
        <div
          data-testid="assign-load-panel"
          className="card w-full lg:w-80 shrink-0 bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3 shadow-xs dark:bg-gray-900 dark:border-gray-800"
        >
          <div>
            <h3 className="h3 text-base font-bold text-gray-900 dark:text-white">ภาระของอาจารย์ในสาขา</h3>
            <p className="meta text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              จำนวนนักศึกษาที่ถูกกำหนดแล้ว · ไว้ดูก่อนเลือก
            </p>
          </div>

          <div className="grid grid-cols-[1fr_60px_60px] gap-2 text-xs font-bold text-gray-600 border-b border-gray-100 pb-2 dark:border-gray-800 dark:text-gray-400">
            <span>อาจารย์</span>
            <span className="text-right">ที่ปรึกษา</span>
            <span className="text-right">นิเทศ</span>
          </div>

          <div className="divide-y divide-gray-100 max-h-[440px] overflow-y-auto dark:divide-gray-800">
            {advisors.map((adv) => {
              const load = advisorLoads.get(adv.personnel_id) || { advisor: 0, supervisor: 0 };
              return (
                <div key={adv.personnel_id} className="grid grid-cols-[1fr_60px_60px] gap-2 py-2 text-xs items-center">
                  <span className="text-gray-800 font-medium truncate dark:text-gray-200" title={personnelDisplayName(adv)}>
                    {personnelDisplayName(adv)}
                  </span>
                  <span className={`text-right ${load.advisor > 0 ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                    {load.advisor}
                  </span>
                  <span className={`text-right ${load.supervisor > 0 ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                    {load.supervisor}
                  </span>
                </div>
              );
            })}
            {advisors.length === 0 && (
              <p className="text-xs text-gray-600 py-4 text-center dark:text-gray-400">
                ยังไม่พบข้อมูลอาจารย์ในสาขาวิชานี้
              </p>
            )}
          </div>

          <span className="text-[11px] text-gray-600 pt-2 border-t border-gray-100 dark:border-gray-800 dark:text-gray-400">
            ไม่มีเกณฑ์ว่าเท่าไหร่ถึงเยอะ — ระบบไม่ตัดสินแทน
          </span>
        </div>
      </div>

      {/* ══ Assignment Modal ══ */}
      <AssignAdvisorModal
        isOpen={showAssignModal}
        isSingleEdit={isSingleEdit}
        selectedStudentIds={isSingleEdit ? selectedStudentIds : selectedVisibleIds}
        advisors={advisors}
        students={students}
        advisorLoads={advisorLoads}
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
          await loadData(true);
        }}
      />
    </div>
  );
};

export default AdvisorAssignment;
