import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api from '../services/api';
import type { StudentProfile, IntentForm } from '../types/api';
import AssignAdvisorModal from './AssignAdvisorModal';
import AlertBanner from './ui/AlertBanner';

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
}

interface DeptHeadDashboardProps {
  activeMenu?: string;
}

const DeptHeadDashboard: React.FC<DeptHeadDashboardProps> = ({ activeMenu = 'dashboard' }) => {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [advisors, setAdvisors] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Intent Approval States
  const [pendingIntents, setPendingIntents] = useState<IntentForm[]>([]);
  const [submittingAction, setSubmittingAction] = useState<number | null>(null);

  // Assignment Modal States
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isSingleEdit, setIsSingleEdit] = useState(false);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [studentsRes, personnelRes, intentsRes] = await Promise.all([
        api.get('/students'),
        api.get('/personnel?role=advisor'),
        api.get('/intents?status=approved_by_advisor')
      ]);
      setStudents(studentsRes || []);
      setAdvisors(personnelRes || []);
      setPendingIntents(intentsRes || []);
    } catch (err) {
      console.error('Failed to load department head dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลนักศึกษาและรายชื่ออาจารย์ในสาขาวิชาได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData);

  // ── Intent Approval Quick Handler ──
  const handleApproveIntent = async (id: number) => {
    setSubmittingAction(id);
    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/intents/${id}/dept-head-status`, { status: 'approved_by_dept_head' });
      setSuccess('อนุมัติคำร้องสำเร็จ — สถานะเปลี่ยนเป็น "ผ่านการพิจารณา รอออกจดหมายขอความอนุเคราะห์"');
      await loadData();
      window.dispatchEvent(new CustomEvent('intent-updated'));
    } catch (err: any) {
      setError(err.response?.data?.message || 'การอนุมัติคำร้องล้มเหลว');
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleRejectIntent = async (id: number) => {
    setSubmittingAction(id);
    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/intents/${id}/dept-head-status`, { status: 'rejected_by_dept_head' });
      setSuccess('ปฏิเสธคำร้องสำเร็จ — คำร้องถูกส่งกลับให้นักศึกษาแก้ไข');
      await loadData();
      window.dispatchEvent(new CustomEvent('intent-updated'));
    } catch (err: any) {
      setError(err.response?.data?.message || 'การปฏิเสธคำร้องล้มเหลว');
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedStudentIds(students.map(s => s.student_id));
    } else {
      setSelectedStudentIds([]);
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
    if (selectedStudentIds.length === 0) {
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
            {activeMenu === 'approval' && 'ตรวจสอบและอนุมัติคำร้องใบความจำนง'}
            {activeMenu === 'assignment' && 'จัดสรรอาจารย์ที่ปรึกษาสหกิจศึกษา'}
            {activeMenu === 'students' && 'ตรวจสอบสถานะคุณสมบัติและสิทธิ์นักศึกษา'}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {activeMenu === 'dashboard' && 'สถิติการดำเนินการสหกิจศึกษาและข่าวสารภาพรวมภายในภาควิชา'}
            {activeMenu === 'approval' && 'พิจารณาอนุมัติคำขอฝึกงานที่ผ่านการตรวจสอบจากอาจารย์ที่ปรึกษาแล้ว'}
            {activeMenu === 'assignment' && 'กำหนดอาจารย์ที่ปรึกษาและอาจารย์นิเทศหลักรายกลุ่มและบุคคล'}
            {activeMenu === 'students' && 'ตรวจสอบความพร้อม สิทธิ์สะสม และข้อมูลการปฐมนิเทศของนักศึกษา'}
          </p>
        </div>

        {activeMenu === 'assignment' && (
          <button
            type="button"
            onClick={openBatchAssign}
            className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-brand-blue hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            กำหนดอาจารย์แบบกลุ่ม (Batch Assign)
          </button>
        )}
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {/* ── VIEW 1: DASHBOARD OVERVIEW ── */}
      {activeMenu === 'dashboard' && (
        <div className="space-y-6">
          {/* Bento Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              <span className="text-xs font-medium text-gray-400">นักศึกษาในภาควิชาทั้งหมด</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-gray-800 dark:text-white">{totalStudents}</span>
                <span className="text-xs text-gray-400 font-medium">คน</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              <span className="text-xs font-medium text-gray-400">จัดสรรอาจารย์ที่ปรึกษาแล้ว</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-green-600 dark:text-green-400">{assignedAdvisorCount}</span>
                <span className="text-xs text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((assignedAdvisorCount / totalStudents) * 100) : 0}%)</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              <span className="text-xs font-medium text-gray-400">ยังไม่ได้รับการจัดสรร</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-yellow-600 dark:text-yellow-400">{unassignedAdvisorCount}</span>
                <span className="text-xs text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((unassignedAdvisorCount / totalStudents) * 100) : 0}%)</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              <span className="text-xs font-medium text-gray-400">จัดสรรอาจารย์นิเทศแล้ว</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-brand-blue dark:text-blue-400">{assignedSupervisorCount}</span>
                <span className="text-xs text-gray-400 font-medium">คน ({totalStudents > 0 ? Math.round((assignedSupervisorCount / totalStudents) * 100) : 0}%)</span>
              </div>
            </div>
          </div>

          {/* Activity/Status Summary Table (Preview) */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 p-6 space-y-4">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">ข้อมูลรายชื่อนักศึกษาล่าสุด</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
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
                          {student.student_code}
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
                          {advisor?.email || <span className="text-gray-400">ยังไม่ระบุ</span>}
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {supervisor?.email || <span className="text-gray-400">ยังไม่ระบุ</span>}
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
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 w-12 text-center">
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={students.length > 0 && selectedStudentIds.length === students.length}
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
                {students.map((student) => {
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
                        <span className="block font-bold">รหัส: {student.student_code}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">ID: #{student.student_id}</span>
                      </td>
                      <td className="p-4 text-gray-800 dark:text-gray-200">
                        <span className="block text-xs font-semibold">{student.company_name || <span className="text-gray-400 font-normal">ยังไม่มีสถานประกอบการ</span>}</span>
                        <span className="block text-xs text-gray-500 mt-0.5 dark:text-gray-400">{student.company_province || ''}</span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {student.is_eligible ? 'ผ่านเกณฑ์แล้ว' : 'ไม่ผ่านเกณฑ์'}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {advisor?.email || <span className="text-gray-400">ยังไม่กำหนด</span>}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                        {supervisor?.email || <span className="text-gray-400">ยังไม่กำหนด</span>}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => openSingleAssign(student)}
                          className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
                          title="แก้ไขจัดสรรอาจารย์รายบุคคล"
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
        </div>
      )}

      {/* ── VIEW 3: STUDENT STATUS CHECK ── */}
      {activeMenu === 'students' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                  <th className="p-4 font-semibold">สิทธิ์สะสม (Eligibility)</th>
                  <th className="p-4 font-semibold">สถานะปฐมนิเทศ (Orientation)</th>
                  <th className="p-4 font-semibold">อาจารย์ที่ปรึกษา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {students.map((student) => {
                  const advisor = advisors.find(a => a.personnel_id === student.advisor_id);
                  return (
                    <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                        <span className="block font-bold">{student.student_code}</span>
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
                        {advisor?.email || <span className="text-gray-400">ยังไม่ระบุอาจารย์ที่ปรึกษา</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VIEW 4: INTENT APPROVAL ── */}
      {activeMenu === 'approval' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              คำร้องที่รอพิจารณาอนุมัติ ({pendingIntents.length} รายการ)
            </span>
          </div>

          {pendingIntents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">ตำแหน่งงาน</th>
                    <th className="p-4 font-semibold text-center">รายละเอียด</th>
                    <th className="p-4 font-semibold text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pendingIntents.map((intent) => {
                    const isPendingAction = submittingAction === intent.form_id;

                    return (
                      <tr key={intent.form_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-4 font-medium text-gray-800 dark:text-gray-200">
                          <span className="block font-bold">{intent.first_name || ''} {intent.last_name || ''}</span>
                          <span className="block text-xs text-gray-400 mt-0.5">รหัส: {intent.student_code}</span>
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {intent.company_name_th}
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {intent.job_title || 'ฝึกงานทั่วไป'}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('open-intent-review', { detail: intent.form_id }))}
                            className="py-1 px-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold transition-all text-gray-700 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800"
                          >
                            ตรวจทาน
                          </button>
                        </td>
                        <td className="p-4 text-right flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleApproveIntent(intent.form_id)}
                            disabled={isPendingAction}
                            className={`py-1.5 px-2.5 rounded-lg text-white font-bold transition-all ${
                              !isPendingAction
                                ? 'bg-brand-blue hover:bg-blue-600 shadow-sm'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800'
                            }`}
                          >
                            {isPendingAction ? 'รอ...' : 'อนุมัติ'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectIntent(intent.form_id)}
                            disabled={isPendingAction}
                            className={`py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all ${
                              !isPendingAction
                                ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 dark:border-red-900/30 dark:bg-red-950/20 dark:hover:bg-red-900/40'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800'
                            }`}
                          >
                            {isPendingAction ? 'รอ...' : 'ปฏิเสธ'}
                          </button>
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
                  ไม่มีรายการคำร้องใบความจำนงรอตรวจสอบในขณะนี้
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                  รายการจะปรากฏในหน้านี้เมื่อคำร้องยื่นจากนักศึกษาถูกอนุมัติผ่านด่านอาจารย์ที่ปรึกษาแล้ว (สถานะ: approved_by_advisor)
                </p>
                <div className="inline-flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                  <span>นักศึกษายื่นคำร้อง</span>
                  <span>→</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">อาจารย์อนุมัติ</span>
                  <span>→</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">รอหัวหน้าสาขาวิชา</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Assignment Modal Component */}
      <AssignAdvisorModal
        isOpen={showAssignModal}
        isSingleEdit={isSingleEdit}
        selectedStudentIds={selectedStudentIds}
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
