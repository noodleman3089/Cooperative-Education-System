import React, { useState, useContext, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import { AuthContext } from '../../context/AuthContext';
import { MapPin, Calendar, Send, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import SupervisionLogForm from './SupervisionLogForm';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';
import type { WeeklyPlan } from '../../types/api';

/** นักศึกษาในความดูแล พร้อมข้อมูลที่พักและแผนงาน สำหรับวางแผนนิเทศ */
interface SupervisedStudent {
  student_id: number;
  student_code: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  advisor_id?: number | null;
  supervisor_id?: number | null;
  company_name?: string | null;
  company_province?: string | null;
  company_district?: string | null;
  mentor_name?: string | null;
  mentor_phone?: string | null;
  /** ประกอบจากช่องย่อยที่เซิร์ฟเวอร์ (utils/accommodationAddress.ts) — หน้าจอไม่ต่อเอง */
  accommodation_address?: string | null;
  accommodation_phone?: string | null;
  accommodation_mobile?: string | null;
  /** มีค่าเมื่อนักศึกษาปักหมุดที่พักไว้ — ใช้ตอนวางแผนเดินทางไปนิเทศ */
  accommodation_maps_link?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  weekly_plans?: WeeklyPlan[];
}

/** นัดหมายนิเทศหนึ่งครั้ง เท่าที่หน้าจอนี้อ่าน */
interface SupervisionAppointment {
  appointment_id: number;
  student_id: number;
  advisor_id?: number;
  appointment_date?: string | null;
  student_time?: string | null;
  mentor_time?: string | null;
  tour_requested?: boolean;
  /** 'draft' | 'pending_company' | 'accepted' | 'rescheduled' | 'offline_agreed' */
  status: string;
  proposed_reschedule_date?: string | null;
  proposed_mentor_time?: string | null;
  visit_number?: number;
  first_name?: string | null;
  last_name?: string | null;
  student_code?: string | null;
  company_name?: string | null;
  company_name_th?: string | null;
}

const getStatusInfo = (status?: string) => {
  switch (status) {
    case 'draft':
      return {
        text: 'ร่าง · รอเจ้าหน้าที่ตรวจและส่งอีเมล',
        pillClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
      };
    case 'pending_company':
      return {
        text: 'ส่งแล้ว · รอพี่เลี้ยงตอบ',
        pillClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
      };
    case 'rescheduled':
      return {
        text: 'พี่เลี้ยงขอเลื่อน · รอคุณตอบ',
        pillClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
      };
    case 'accepted':
      return {
        text: 'พี่เลี้ยงยืนยันแล้ว',
        pillClass: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0] dark:bg-green-950/40 dark:text-green-300 dark:border-green-800'
      };
    case 'offline_agreed':
      return {
        text: 'ตกลงนอกระบบ (อาจารย์บันทึก)',
        pillClass: 'bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
      };
    default:
      return {
        text: status || 'ยังไม่นัด',
        pillClass: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
      };
  }
};

const formatThaiDate = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const SupervisionTracking: React.FC = () => {
  const auth = useContext(AuthContext);
  const currentUserId = auth?.user?.userId;
  const [, setSearchParams] = useSearchParams();

  const [students, setStudents] = useState<SupervisedStudent[]>([]);
  const [appointments, setAppointments] = useState<SupervisionAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Scope: 'mine' (supervisor of student) vs 'advisor_only'
  const [scope, setScope] = useState<'mine' | 'advisor_only'>('mine');

  // Expanded weekly plan accordion per student ID
  const [expandedPlans, setExpandedPlans] = useState<Record<number, boolean>>({});

  // Which appointment the "agreed out of band" confirmation is asking about.
  const [bypassingId, setBypassingId] = useState<number | null>(null);
  /** Which appointment the "accept the mentor's new date" confirmation is about. */
  const [acceptingRescheduleId, setAcceptingRescheduleId] = useState<number | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Create draft form state
  const [draftStudentId, setDraftStudentId] = useState<number | null>(null);
  const [draftVisitNumber, setDraftVisitNumber] = useState<1 | 2>(1);
  const [draftData, setDraftData] = useState({
    appointment_date: '',
    student_time: '',
    mentor_time: '',
    tour_requested: false
  });
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Edit draft form state
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null);
  const [editingAppointmentStatus, setEditingAppointmentStatus] = useState<string | null>(null);

  // Deleting draft state
  const [deletingAppointment, setDeletingAppointment] = useState<{
    id: number;
    studentName: string;
    visitNumber: number;
  } | null>(null);

  // Log form state (SupervisionLogForm modal)
  const [showLogForm, setShowLogForm] = useState<number | null>(null);

  // Travel Request Memo state (Spec §6.4 & DC lines 198-216)
  const [travelVisit, setTravelVisit] = useState<1 | 2>(1);
  const [selectedTravelIds, setSelectedTravelIds] = useState<number[]>([]);

  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const [studentsRes, appRes] = await Promise.all([
        api.get('/personnel/supervised-students'),
        api.get('/appointments')
      ]);
      setStudents(studentsRes || []);
      setAppointments(appRes?.data || appRes || []);
    } catch (err) {
      console.error('Fetch supervision data error:', err);
      if (!isBackground) {
        setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลการนิเทศได้'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(fetchData);

  const handleOpenDraft = (studentId: number, visit: 1 | 2) => {
    setDraftStudentId(studentId);
    setDraftVisitNumber(visit);
    setEditingAppointmentId(null);
    setEditingAppointmentStatus(null);
    setDraftData({
      appointment_date: '',
      student_time: '09:00',
      mentor_time: '10:00',
      tour_requested: false
    });
    setDraftError(null);
  };

  const handleOpenEdit = (student: SupervisedStudent, app: SupervisionAppointment) => {
    setDraftStudentId(student.student_id);
    setDraftVisitNumber((app.visit_number as 1 | 2) || 1);
    setEditingAppointmentId(app.appointment_id);
    setEditingAppointmentStatus(app.status);
    const rawDate = app.appointment_date || '';
    const dateStr = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
    setDraftData({
      appointment_date: dateStr,
      student_time: app.student_time ? app.student_time.slice(0, 5) : '',
      mentor_time: app.mentor_time ? app.mentor_time.slice(0, 5) : '',
      tour_requested: !!app.tour_requested,
    });
    setDraftError(null);
  };

  const handleCancelDraft = () => {
    setDraftStudentId(null);
    setEditingAppointmentId(null);
    setEditingAppointmentStatus(null);
    setDraftError(null);
  };

  const handleSaveDraft = async () => {
    if (!draftStudentId) return;
    setDraftError(null);
    setDraftSubmitting(true);
    try {
      if (editingAppointmentId) {
        const res = await api.put(`/appointments/${editingAppointmentId}`, draftData);
        setSuccess(res?.message || 'บันทึกการแก้ไขนัดหมายสำเร็จ');
        handleCancelDraft();
        fetchData();
      } else {
        await api.post('/appointments/draft', {
          student_id: draftStudentId,
          ...draftData
        });
        setSuccess(`บันทึกแบบร่างการนิเทศครั้งที่ ${draftVisitNumber} สำเร็จ ส่งให้เจ้าหน้าที่ประสานงานต่อไป`);
        handleCancelDraft();
        fetchData();
      }
    } catch (err) {
      setDraftError(getErrorMessage(err, editingAppointmentId ? 'ไม่สามารถบันทึกการแก้ไขนัดหมายได้' : 'ไม่สามารถบันทึกแบบร่างนัดหมายได้'));
    } finally {
      setDraftSubmitting(false);
    }
  };

  const handleOpenDelete = (student: SupervisedStudent, app: SupervisionAppointment) => {
    const studentName = student.first_name ? `${student.first_name} ${student.last_name || ''}`.trim() : student.student_code;
    setDeletingAppointment({
      id: app.appointment_id,
      studentName,
      visitNumber: app.visit_number || 1,
    });
  };

  const handleDeleteDraft = async () => {
    if (!deletingAppointment) return;
    setError(null);
    setSuccess(null);
    setConfirmBusy(true);
    try {
      await api.delete(`/appointments/${deletingAppointment.id}`);
      if (editingAppointmentId === deletingAppointment.id) {
        handleCancelDraft();
      }
      setDeletingAppointment(null);
      setSuccess('ลบร่างนัดนิเทศแล้ว');
      fetchData();
    } catch (err) {
      setDeletingAppointment(null);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการลบร่างนัดหมาย'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleBypass = async () => {
    if (bypassingId === null) return;
    setError(null);
    setSuccess(null);
    setConfirmBusy(true);
    try {
      await api.put(`/appointments/${bypassingId}/bypass`);
      setBypassingId(null);
      setSuccess('บันทึกสถานะตกลงนอกรอบสำเร็จ');
      fetchData();
    } catch (err) {
      setBypassingId(null);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกสถานะ'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleAcceptReschedule = async () => {
    if (acceptingRescheduleId === null) return;
    setError(null);
    setSuccess(null);
    setConfirmBusy(true);
    try {
      await api.put(`/appointments/${acceptingRescheduleId}/accept-reschedule`);
      setAcceptingRescheduleId(null);
      setSuccess('ยอมรับการเลื่อนนัดหมายสำเร็จ วันและเวลานัดหมายถูกเปลี่ยนตามที่พี่เลี้ยงเสนอแล้ว');
      fetchData();
    } catch (err) {
      setAcceptingRescheduleId(null);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการยอมรับการเลื่อนนัด'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleNavigateRecord = (studentId: number, visit: 1 | 2) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('menu', 'supervision_record');
      next.set('student', studentId.toString());
      next.set('visit', visit.toString());
      return next;
    });
  };

  const toggleExpandPlan = (studentId: number) => {
    setExpandedPlans(prev => ({ ...prev, [studentId]: !prev[studentId] }));
  };

  // Filter students based on role scope
  // "นักศึกษาที่ฉันนิเทศ" vs "ที่ปรึกษาอย่างเดียว"
  const supervisedStudents = useMemo(() => {
    return students.filter(s => s.supervisor_id === currentUserId);
  }, [students, currentUserId]);

  const advisorOnlyStudents = useMemo(() => {
    return students.filter(s => s.advisor_id === currentUserId && s.supervisor_id !== currentUserId);
  }, [students, currentUserId]);

  const displayStudents = scope === 'mine' ? supervisedStudents : advisorOnlyStudents;

  // Province summary for badge list
  const provinceSummary = useMemo(() => {
    return Object.entries(
      students.reduce<Record<string, number>>((acc, s) => {
        const province = s.company_province || 'ไม่ระบุจังหวัด';
        acc[province] = (acc[province] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);
  }, [students]);

  // Appointments for Travel Request Memo (filtered by chosen visit_number)
  const travelCandidates = useMemo(() => {
    return appointments.filter(a => a.visit_number === travelVisit);
  }, [appointments, travelVisit]);

  const handleToggleTravelPick = (appointmentId: number) => {
    setSelectedTravelIds(prev => {
      if (prev.includes(appointmentId)) {
        return prev.filter(id => id !== appointmentId);
      }
      if (prev.length >= 10) {
        return prev;
      }
      return [...prev, appointmentId];
    });
  };

  const handlePrintTravelMemo = () => {
    if (selectedTravelIds.length === 0) return;
    const url = `/api/appointments/travel-request/print?visit=${travelVisit}&ids=${selectedTravelIds.join(',')}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return <PageSkeleton variant="cards" />;
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Header section matching SupervisionVisits.dc.html */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            นัดหมายนิเทศ (สหกิจ 12)
          </h1>
          <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400 m-0">
            คุณร่างวันเวลา → เจ้าหน้าที่ตรวจแล้วส่งแบบยืนยันการนิเทศทางอีเมล → พนักงานที่ปรึกษาตอบ “ไม่ขัดข้อง” หรือ “ขอเลื่อน” · คู่มือกำหนดนิเทศ 2 ครั้ง
          </p>
        </div>

        {/* Scope Pill Toggle */}
        <div className="inline-flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200/60 dark:border-gray-700/60 shrink-0 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setScope('mine')}
            className={`px-3 py-1.5 rounded-[9px] text-[13px] font-sans transition-all cursor-pointer border-none ${
              scope === 'mine'
                ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            นักศึกษาที่ฉันนิเทศ ({supervisedStudents.length})
          </button>
          <button
            type="button"
            onClick={() => setScope('advisor_only')}
            className={`px-3 py-1.5 rounded-[9px] text-[13px] font-sans transition-all cursor-pointer border-none ${
              scope === 'advisor_only'
                ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            ที่ปรึกษาอย่างเดียว ({advisorOnlyStudents.length})
          </button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* พื้นที่ที่ต้องเดินทาง — matching SupervisionVisits.dc.html lines 100-105 */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:px-5 sm:py-3.5 shadow-sm flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold text-gray-800 dark:text-gray-200 shrink-0 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-red-500" />
          พื้นที่ที่ต้องเดินทางไปนิเทศ
        </span>
        {provinceSummary.length > 0 ? (
          provinceSummary.map(([province, count]) => (
            <span
              key={province}
              className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
            >
              {province} · {count} คน
            </span>
          ))
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">ยังไม่มีข้อมูลจังหวัดของสถานประกอบการ</span>
        )}
      </div>

      {/* Student Cards List */}
      <div className="space-y-4">
        {displayStudents.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 text-sm">
            {scope === 'mine' ? 'ไม่มีนักศึกษาที่คุณเป็นผู้นิเทศ' : 'ไม่มีนักศึกษาที่เป็นที่ปรึกษาอย่างเดียว'}
          </div>
        ) : (
          displayStudents.map((student) => {
            // Find appointments by visit_number from server
            const visit1 = appointments.find(a => a.student_id === student.student_id && a.visit_number === 1);
            const visit2 = appointments.find(a => a.student_id === student.student_id && a.visit_number === 2);

            const isAdvisor = student.advisor_id === currentUserId;
            const isSupervisor = student.supervisor_id === currentUserId;

            const isVisit1Confirmed = visit1 && (visit1.status === 'accepted' || visit1.status === 'offline_agreed');
            const isDraftingThisStudent = draftStudentId === student.student_id;

            return (
              <div
                key={student.student_id}
                data-testid={`supervision-card-${student.student_id}`}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden"
              >
                {/* Card Top Header */}
                <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex flex-col md:flex-row justify-between md:items-start gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[17px] font-bold text-gray-900 dark:text-white">
                        {student.first_name ? `${student.first_name} ${student.last_name}` : 'ไม่ระบุชื่อ'}
                      </span>
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                        {student.student_code}
                      </span>
                      {isAdvisor && isSupervisor ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1E3A8A] border border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                          ที่ปรึกษา &amp; นิเทศ
                        </span>
                      ) : isSupervisor ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 whitespace-nowrap">
                          นิเทศ
                        </span>
                      ) : isAdvisor ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1E3A8A] border border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                          ที่ปรึกษา
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {student.company_name || 'ยังไม่มีสถานประกอบการ'}
                      {student.company_district ? ` · อ.${student.company_district}` : ''}
                      {student.company_province ? ` จ.${student.company_province}` : ''}
                    </span>
                  </div>

                  {/* Mentor & Accommodation Info (Right Side) */}
                  <div className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300 md:text-right">
                    <div>
                      {student.mentor_name ? (
                        <span>พี่เลี้ยง: {student.mentor_name} {student.mentor_phone ? `· ${student.mentor_phone}` : ''}</span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">ยังไม่ระบุพี่เลี้ยง</span>
                      )}
                    </div>
                    <div>
                      {student.accommodation_address ? (
                        <span data-testid="supervision-accommodation">
                          ที่พัก: {student.accommodation_address}
                          {student.accommodation_maps_link && (
                            <a
                              href={student.accommodation_maps_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="supervision-maps-link"
                              className="ml-2 font-semibold text-brand-blue hover:underline dark:text-blue-400"
                            >
                              เปิดใน Google Maps
                            </a>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">ยังไม่ได้ปักหมุดที่พัก</span>
                      )}
                    </div>
                    <div>
                      {student.emergency_contact ? (
                        <span data-testid="supervision-emergency-contact">
                          ฉุกเฉิน: {student.emergency_contact}
                          {student.emergency_phone ? ` · ${student.emergency_phone}` : ''}
                        </span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">ยังไม่มีผู้ติดต่อฉุกเฉิน</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2-Column Visits Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 dark:divide-gray-800">
                  {/* Column 1: การนิเทศครั้งที่ 1 */}
                  <div
                    data-testid={`supervision-visit-${student.student_id}-1`}
                    data-status={visit1?.status || 'none'}
                    className="p-4 sm:p-5 flex flex-col gap-3"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900 dark:text-white m-0">
                        การนิเทศครั้งที่ 1
                      </h3>
                      {visit1 ? (
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusInfo(visit1.status).pillClass}`}>
                          {getStatusInfo(visit1.status).text}
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                          ยังไม่นัด
                        </span>
                      )}
                    </div>

                    {visit1 ? (
                      <div className="flex flex-col gap-3">
                        {/* If rescheduled by company */}
                        {visit1.status === 'rescheduled' && visit1.proposed_reschedule_date ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-xl">
                              <span className="text-xs font-bold text-gray-500 block">ที่คุณเสนอ</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 line-through block mt-0.5">
                                {formatThaiDate(visit1.appointment_date)} · พบพี่เลี้ยง {visit1.mentor_time || '-'}
                              </span>
                            </div>
                            <div className="p-3 border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl">
                              <span className="text-xs font-bold text-amber-800 dark:text-amber-400 block">พี่เลี้ยงเสนอใหม่</span>
                              <span className="text-xs font-bold text-gray-900 dark:text-white block mt-0.5">
                                {formatThaiDate(visit1.proposed_reschedule_date)} · พบพี่เลี้ยง {visit1.proposed_mentor_time || '-'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {formatThaiDate(visit1.appointment_date)}
                            </span>
                            {' · '}
                            พบนักศึกษา {visit1.student_time || '-'} · พบพี่เลี้ยง {visit1.mentor_time || '-'}
                            {visit1.tour_requested && (
                              <span className="block text-gray-500 dark:text-gray-400 mt-0.5">
                                ขอเยี่ยมชมสถานประกอบการด้วย
                              </span>
                            )}
                          </div>
                        )}

                        {/* Action Buttons for Visit 1 */}
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <button
                            type="button"
                            data-testid={`supervision-edit-${visit1.appointment_id}`}
                            onClick={() => handleOpenEdit(student, visit1)}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                          >
                            แก้ไขนัด
                          </button>

                          {visit1.status === 'draft' && (
                            <button
                              type="button"
                              data-testid={`supervision-delete-${visit1.appointment_id}`}
                              onClick={() => handleOpenDelete(student, visit1)}
                              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                            >
                              ลบร่าง
                            </button>
                          )}

                          {visit1.status === 'rescheduled' && (
                            <>
                              <button
                                type="button"
                                data-testid={`supervision-accept-reschedule-${visit1.appointment_id}`}
                                onClick={() => setAcceptingRescheduleId(visit1.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 transition-colors cursor-pointer"
                              >
                                ใช้วันที่พี่เลี้ยงเสนอ
                              </button>
                              <button
                                type="button"
                                data-testid={`supervision-bypass-${visit1.appointment_id}`}
                                onClick={() => setBypassingId(visit1.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                              >
                                ตกลงกับสถานประกอบการนอกระบบแล้ว
                              </button>
                            </>
                          )}

                          {visit1.status === 'pending_company' && (
                            <button
                              type="button"
                              data-testid={`supervision-bypass-${visit1.appointment_id}`}
                              onClick={() => setBypassingId(visit1.appointment_id)}
                              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            >
                              ตกลงกับสถานประกอบการนอกระบบแล้ว
                            </button>
                          )}

                          {(visit1.status === 'accepted' || visit1.status === 'offline_agreed') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleNavigateRecord(student.student_id, 1)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 transition-colors cursor-pointer"
                              >
                                บันทึกการนิเทศ (สหกิจ 13)
                              </button>
                              <button
                                type="button"
                                data-testid={`supervision-log-open-${visit1.appointment_id}`}
                                onClick={() => setShowLogForm(visit1.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                              >
                                รูปถ่าย &amp; บันทึกย่อ
                              </button>
                            </>
                          )}
                        </div>

                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          บันทึก สหกิจ 13 ได้ตั้งแต่วันนัด · ไม่บังคับให้มีนัดในระบบก่อน
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ยังไม่มีการนัดหมายนิเทศครั้งที่ 1
                        </span>
                        <div>
                          <button
                            type="button"
                            data-testid={`supervision-draft-open-${student.student_id}`}
                            onClick={() => handleOpenDraft(student.student_id, 1)}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            ร่างนัดครั้งที่ 1
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Column 2: การนิเทศครั้งที่ 2 */}
                  <div
                    data-testid={`supervision-visit-${student.student_id}-2`}
                    data-status={visit2?.status || 'none'}
                    className="p-4 sm:p-5 flex flex-col gap-3 bg-gray-50/50 dark:bg-gray-800/20"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900 dark:text-white m-0">
                        การนิเทศครั้งที่ 2
                      </h3>
                      {visit2 ? (
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusInfo(visit2.status).pillClass}`}>
                          {getStatusInfo(visit2.status).text}
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                          ยังไม่นัด
                        </span>
                      )}
                    </div>

                    {visit2 ? (
                      <div className="flex flex-col gap-3">
                        {/* If rescheduled by company */}
                        {visit2.status === 'rescheduled' && visit2.proposed_reschedule_date ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-xl">
                              <span className="text-xs font-bold text-gray-500 block">ที่คุณเสนอ</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 line-through block mt-0.5">
                                {formatThaiDate(visit2.appointment_date)} · พบพี่เลี้ยง {visit2.mentor_time || '-'}
                              </span>
                            </div>
                            <div className="p-3 border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl">
                              <span className="text-xs font-bold text-amber-800 dark:text-amber-400 block">พี่เลี้ยงเสนอใหม่</span>
                              <span className="text-xs font-bold text-gray-900 dark:text-white block mt-0.5">
                                {formatThaiDate(visit2.proposed_reschedule_date)} · พบพี่เลี้ยง {visit2.proposed_mentor_time || '-'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {formatThaiDate(visit2.appointment_date)}
                            </span>
                            {' · '}
                            พบนักศึกษา {visit2.student_time || '-'} · พบพี่เลี้ยง {visit2.mentor_time || '-'}
                            {visit2.tour_requested && (
                              <span className="block text-gray-500 dark:text-gray-400 mt-0.5">
                                ขอเยี่ยมชมสถานประกอบการด้วย
                              </span>
                            )}
                          </div>
                        )}

                        {/* Action Buttons for Visit 2 */}
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <button
                            type="button"
                            data-testid={`supervision-edit-${visit2.appointment_id}`}
                            onClick={() => handleOpenEdit(student, visit2)}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                          >
                            แก้ไขนัด
                          </button>

                          {visit2.status === 'draft' && (
                            <button
                              type="button"
                              data-testid={`supervision-delete-${visit2.appointment_id}`}
                              onClick={() => handleOpenDelete(student, visit2)}
                              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                            >
                              ลบร่าง
                            </button>
                          )}

                          {visit2.status === 'rescheduled' && (
                            <>
                              <button
                                type="button"
                                data-testid={`supervision-accept-reschedule-${visit2.appointment_id}`}
                                onClick={() => setAcceptingRescheduleId(visit2.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 transition-colors cursor-pointer"
                              >
                                ใช้วันที่พี่เลี้ยงเสนอ
                              </button>
                              <button
                                type="button"
                                data-testid={`supervision-bypass-${visit2.appointment_id}`}
                                onClick={() => setBypassingId(visit2.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                              >
                                ตกลงกับสถานประกอบการนอกระบบแล้ว
                              </button>
                            </>
                          )}

                          {visit2.status === 'pending_company' && (
                            <button
                              type="button"
                              data-testid={`supervision-bypass-${visit2.appointment_id}`}
                              onClick={() => setBypassingId(visit2.appointment_id)}
                              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            >
                              ตกลงกับสถานประกอบการนอกระบบแล้ว
                            </button>
                          )}

                          {(visit2.status === 'accepted' || visit2.status === 'offline_agreed') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleNavigateRecord(student.student_id, 2)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 transition-colors cursor-pointer"
                              >
                                บันทึกการนิเทศ (สหกิจ 13)
                              </button>
                              <button
                                type="button"
                                data-testid={`supervision-log-open-${visit2.appointment_id}`}
                                onClick={() => setShowLogForm(visit2.appointment_id)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                              >
                                รูปถ่าย &amp; บันทึกย่อ
                              </button>
                            </>
                          )}
                        </div>

                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          บันทึก สหกิจ 13 ได้ตั้งแต่วันนัด · ไม่บังคับให้มีนัดในระบบก่อน
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {isVisit1Confirmed ? (
                          <>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              ครั้งที่ 1 ได้รับการยืนยันแล้ว สามารถนัดครั้งที่ 2 ได้
                            </span>
                            <div>
                              <button
                                type="button"
                                data-testid={`supervision-draft-open-${student.student_id}`}
                                onClick={() => handleOpenDraft(student.student_id, 2)}
                                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                                ร่างนัดครั้งที่ 2
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              นัดครั้งที่ 2 ได้เมื่อครั้งที่ 1 ได้รับการยืนยันแล้ว
                            </span>
                            <div>
                              <button
                                type="button"
                                disabled
                                className="px-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed inline-flex items-center gap-1.5"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                                ร่างนัดครั้งที่ 2
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Draft Form if active for this student */}
                {isDraftingThisStudent && (
                  <div className="p-4 sm:p-5 bg-[#F8FAFF] dark:bg-blue-950/20 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-3">
                    <span className="text-sm font-bold text-[#1E3A8A] dark:text-blue-300">
                      {editingAppointmentId
                        ? `แก้ไขนัดการนิเทศครั้งที่ ${draftVisitNumber}`
                        : `ร่างนัดการนิเทศครั้งที่ ${draftVisitNumber}`}
                    </span>

                    {editingAppointmentId && editingAppointmentStatus && editingAppointmentStatus !== 'draft' && (
                      <AlertBanner
                        data-testid="supervision-edit-warning"
                        variant="warning"
                        message="นัดนี้ส่งถึงพี่เลี้ยงแล้ว เมื่อแก้ นัดจะกลับเป็นร่าง เจ้าหน้าที่ต้องตรวจและส่งใหม่ และพี่เลี้ยงต้องตอบอีกครั้ง"
                      />
                    )}

                    {draftError && <AlertBanner variant="error" message={draftError} />}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          วันที่
                        </label>
                        <input
                          type="date"
                          data-testid="supervision-draft-date"
                          value={draftData.appointment_date}
                          onChange={(e) => setDraftData({ ...draftData, appointment_date: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          เวลาพบนักศึกษา
                        </label>
                        <input
                          type="time"
                          data-testid="supervision-draft-student-time"
                          value={draftData.student_time}
                          onChange={(e) => setDraftData({ ...draftData, student_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          เวลาพบพี่เลี้ยง
                        </label>
                        <input
                          type="time"
                          data-testid="supervision-draft-mentor-time"
                          value={draftData.mentor_time}
                          onChange={(e) => setDraftData({ ...draftData, mentor_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="flex items-center pb-2">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            data-testid="supervision-draft-tour"
                            checked={draftData.tour_requested}
                            onChange={(e) => setDraftData({ ...draftData, tour_requested: e.target.checked })}
                            className="w-4 h-4 rounded text-brand-blue focus:ring-brand-blue"
                          />
                          ขอเยี่ยมชมสถานประกอบการ
                        </label>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {editingAppointmentId
                          ? (editingAppointmentStatus !== 'draft'
                              ? 'บันทึกแล้วนัดจะกลับเป็นร่าง เจ้าหน้าที่ต้องตรวจและส่งใหม่'
                              : 'บันทึกการแก้ไขร่างนัดนิเทศ')
                          : 'บันทึกแล้วเป็น “ร่าง · รอเจ้าหน้าที่ตรวจและส่งอีเมล” — ยังไม่มีอะไรถึงบริษัท'}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCancelDraft}
                          className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          data-testid="supervision-draft-submit"
                          disabled={draftSubmitting || !draftData.appointment_date || !draftData.student_time || !draftData.mentor_time}
                          onClick={handleSaveDraft}
                          className="px-3 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {draftSubmitting
                            ? 'กำลังบันทึก...'
                            : editingAppointmentId
                            ? 'บันทึกการแก้ไข'
                            : 'บันทึกร่างส่งเจ้าหน้าที่'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Collapsible Weekly Plans (System 3) for backwards compatibility with E2E */}
                {student.weekly_plans && student.weekly_plans.length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-800 p-4 bg-gray-50/30 dark:bg-gray-900/30">
                    <button
                      type="button"
                      onClick={() => toggleExpandPlan(student.student_id)}
                      className="flex items-center justify-between w-full text-left text-xs font-bold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    >
                      <span>แผนปฏิบัติงานรายสัปดาห์: ({student.weekly_plans.length} สัปดาห์)</span>
                      {expandedPlans[student.student_id] ? (
                        <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      )}
                    </button>

                    {expandedPlans[student.student_id] && (
                      <div className="mt-3 max-h-[160px] overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-800">
                        {student.weekly_plans.map((p: WeeklyPlan) => (
                          <div key={p.plan_id} className="p-2.5 text-xs flex justify-between gap-4">
                            <div>
                              <span className="font-bold block text-gray-700 dark:text-gray-300">
                                สัปดาห์ที่ {p.week_number}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400 block mt-0.5">
                                {p.tasks}
                              </span>
                            </div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 self-start whitespace-nowrap">
                              {p.start_date && p.end_date
                                ? `${new Date(p.start_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} - ${new Date(p.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ══ พิมพ์บันทึกขออนุมัติเดินทางไปราชการ (Spec §6.4 & DC lines 198-216) ══ */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white m-0">
              พิมพ์บันทึกขออนุมัติเดินทางไปราชการ
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 m-0 mt-0.5">
              หนึ่งใบต่อการออกนิเทศหนึ่งรอบ · ส่งผ่านหัวหน้าสาขาทาง E-document ล่วงหน้าไม่น้อยกว่า 1 สัปดาห์
            </p>
          </div>

          {/* Toggle Visit 1 vs 2 */}
          <div className="inline-flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200/60 dark:border-gray-700/60 shrink-0">
            <button
              type="button"
              data-testid="travel-memo-visit-1"
              onClick={() => {
                setTravelVisit(1);
                setSelectedTravelIds([]);
              }}
              className={`px-3 py-1.5 rounded-[9px] text-xs font-sans transition-all cursor-pointer border-none ${
                travelVisit === 1
                  ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                  : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              นิเทศสหกิจ ครั้งที่ 1
            </button>
            <button
              type="button"
              data-testid="travel-memo-visit-2"
              onClick={() => {
                setTravelVisit(2);
                setSelectedTravelIds([]);
              }}
              className={`px-3 py-1.5 rounded-[9px] text-xs font-sans transition-all cursor-pointer border-none ${
                travelVisit === 2
                  ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                  : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              ครั้งที่ 2
            </button>
          </div>
        </div>

        {/* Travel Candidates Table / List */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {travelCandidates.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
              ยังไม่มีนัดครั้งที่ {travelVisit} ที่ยืนยันแล้ว
            </div>
          ) : (
            travelCandidates.map((app) => {
              const isConfirmed = app.status === 'accepted' || app.status === 'offline_agreed';
              const isSelected = selectedTravelIds.includes(app.appointment_id);

              return (
                <div
                  key={app.appointment_id}
                  className={`flex items-center gap-3 p-3 text-xs transition-colors ${
                    !isConfirmed
                      ? 'bg-gray-50/60 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400'
                      : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/60 text-gray-900 dark:text-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    data-testid={`travel-memo-pick-${app.appointment_id}`}
                    disabled={!isConfirmed}
                    checked={isSelected}
                    onChange={() => handleToggleTravelPick(app.appointment_id)}
                    className="w-4 h-4 rounded text-brand-blue focus:ring-brand-blue cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="flex-grow font-medium">
                    {app.first_name} {app.last_name} {app.company_name ? `· ${app.company_name}` : ''}
                  </span>
                  {isConfirmed ? (
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">
                      {formatThaiDate(app.appointment_date)}
                    </span>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-400 shrink-0">
                      ยังไม่ได้ยืนยันวันนัด
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Action Bottom */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            เลือกได้เฉพาะนัดที่ยืนยันแล้ว · สูงสุด 10 คน (ตารางบนแบบฟอร์ม)
          </span>
          <button
            type="button"
            data-testid="travel-memo-print"
            disabled={selectedTravelIds.length === 0}
            onClick={handlePrintTravelMemo}
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-brand-blue text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            พิมพ์บันทึกข้อความ ({selectedTravelIds.length} คน)
          </button>
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          เลขที่หนังสือ ลายเซ็น และความเห็นคณบดีเว้นว่างให้กรอกนอกระบบ · ไม่มีสถานะ “รออนุมัติ” ในระบบ
        </span>
      </div>

      {/* Render SupervisionLogForm modal if open */}
      {showLogForm && (
        <SupervisionLogForm
          appointmentId={showLogForm}
          onClose={() => setShowLogForm(null)}
          onSuccess={() => {
            setShowLogForm(null);
            fetchData();
          }}
        />
      )}

      {/* Confirm Dialogs for accepting reschedule and bypass */}
      <ConfirmDialog
        open={acceptingRescheduleId !== null}
        title="ยืนยันการยอมรับวันนัดหมายใหม่"
        message="ยอมรับวันและเวลาที่พี่เลี้ยงเสนอมาใช่หรือไม่? วันและเวลานัดหมายเดิมจะถูกแทนที่ และเวลานัดของนักศึกษาจะถูกปรับตามไปด้วย"
        confirmLabel="ยืนยัน ใช้วันใหม่"
        busy={confirmBusy}
        onConfirm={handleAcceptReschedule}
        onCancel={() => setAcceptingRescheduleId(null)}
      />

      <ConfirmDialog
        open={bypassingId !== null}
        title="ยืนยันการตกลงนัดหมายนอกรอบ"
        message="ยืนยันว่าได้ตกลงวันและเวลานิเทศกับสถานประกอบการนอกระบบเรียบร้อยแล้ว? ระบบจะข้ามขั้นตอนการส่งอีเมลนัดหมายให้พี่เลี้ยง"
        confirmLabel="ยืนยัน ตกลงนอกรอบแล้ว"
        busy={confirmBusy}
        onConfirm={handleBypass}
        onCancel={() => setBypassingId(null)}
      />

      <ConfirmDialog
        open={deletingAppointment !== null}
        title="ยืนยันการลบร่างนัดหมายนิเทศ"
        message={`ต้องการลบร่างนัดหมายนิเทศครั้งที่ ${deletingAppointment?.visitNumber} ของ ${deletingAppointment?.studentName} ใช่หรือไม่?`}
        confirmLabel="ลบร่างนัด"
        destructive
        busy={confirmBusy}
        onConfirm={handleDeleteDraft}
        onCancel={() => setDeletingAppointment(null)}
      />
    </div>
  );
};

export default SupervisionTracking;
