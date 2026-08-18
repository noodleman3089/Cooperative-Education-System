import React, { useState, useContext } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api, { API_BASE_URL } from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import { AuthContext } from '../../context/AuthContext';
import { MapPin, Calendar, Users, FileText, Send } from 'lucide-react';
import SupervisionLogForm from './SupervisionLogForm';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Button from '../../components/ui/Button';
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
  mentor_name?: string | null;
  mentor_phone?: string | null;
  accommodation_address?: string | null;
  accommodation_phone?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  weekly_plans?: WeeklyPlan[];
}

/** นัดหมายนิเทศหนึ่งครั้ง เท่าที่หน้าจอนี้อ่าน */
interface SupervisionAppointment {
  appointment_id: number;
  student_id: number;
  appointment_date?: string | null;
  student_time?: string | null;
  mentor_time?: string | null;
  tour_requested?: boolean;
  /** 'draft' | 'pending_company' | 'accepted' | 'rescheduled' | 'offline_agreed' */
  status: string;
  proposed_reschedule_date?: string | null;
  proposed_mentor_time?: string | null;
}

const SupervisionTracking: React.FC = () => {
  const auth = useContext(AuthContext);
  const [students, setStudents] = useState<SupervisedStudent[]>([]);
  const [appointments, setAppointments] = useState<SupervisionAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Which appointment the "agreed out of band" confirmation is asking about.
  const [bypassingId, setBypassingId] = useState<number | null>(null);
  /** Which appointment the "accept the mentor's new date" confirmation is about. */
  const [acceptingRescheduleId, setAcceptingRescheduleId] = useState<number | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Create draft form state
  const [showDraftForm, setShowDraftForm] = useState<number | null>(null);
  const [draftData, setDraftData] = useState({
    appointment_date: '',
    student_time: '',
    mentor_time: '',
    tour_requested: false
  });
  
  // Log form state
  const [showLogForm, setShowLogForm] = useState<number | null>(null); // appointmentId

  const fetchData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [studentsRes, appRes] = await Promise.all([
        api.get('/personnel/supervised-students'),
        api.get('/appointments')
      ]);
      setStudents(studentsRes || []);
      setAppointments(appRes.data || []);
    } catch (err) {
      console.error('Fetch supervision data error:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // This screen sits waiting for a mentor to answer an email — accept the visit
  // or propose another day — and it was the one screen that never refreshed,
  // while AdvisorDashboard polled every ten seconds for data that only the
  // advisor changes. Same hook, same visibility check, no bespoke timer.
  useDashboardData(fetchData);

  const handleCreateDraft = async (studentId: number) => {
    setError(null);
    setSuccess(null);
    try {
      await api.post('/appointments/draft', {
        student_id: studentId,
        ...draftData
      });
      setSuccess('สร้างแบบร่างสำเร็จ ส่งให้เจ้าหน้าที่ประสานงานต่อไป');
      setShowDraftForm(null);
      setDraftData({ appointment_date: '', student_time: '', mentor_time: '', tour_requested: false });
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาด'));
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
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาด'));
    } finally {
      setConfirmBusy(false);
    }
  };

  // Accepting overwrites the agreed date and time with the mentor's proposal,
  // so it asks first and blocks a second click while it is in flight.
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
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาด'));
    } finally {
      setConfirmBusy(false);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='cards' />
    );
  }

  // Province → how many students are placed there, busiest first.
  const provinceSummary = Object.entries(
    students.reduce<Record<string, number>>((acc, s) => {
      const province = s.company_province || 'ไม่ระบุจังหวัด';
      acc[province] = (acc[province] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6 page-enter">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">นิเทศและติดตามนักศึกษา</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            จัดการการนัดหมาย บันทึกผลการนิเทศ และติดตามความคืบหน้าของนักศึกษา
          </p>
        </div>

        {/* This button, and the whole panel of visit information below it, used
            to live in AdvisorDashboard's `activeMenu === 'supervision'` branch —
            which Dashboard.tsx never routes to, because it sends `supervision`
            here instead. The template exists on the server and nothing else in
            the application links to it, so until now an advisor could not print
            the travel memo at all. */}
        <Button
          variant="secondary"
          icon={<FileText className="h-4 w-4" />}
          onClick={() => window.open(`${API_BASE_URL}/files/download/travel-request-template`, '_blank')}
          className="shrink-0 self-start sm:self-auto"
        >
          พิมพ์บันทึกข้อความขออนุมัติเดินทางราชการ
        </Button>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Where the students actually are. This was a 256px grey box captioned
          "Google Maps API Integration" that claimed to plot 15 students — a
          fixed number, printed above an empty list reading "ไม่มีนักศึกษาใน
          ความดูแล" for an advisor who had none. The real map is still a plan
          (.system_memory/design_student_address_map.md); grouping by the
          province already in the payload answers the same question — how far
          do I have to travel, and how many stops — without inventing data. */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
          <MapPin className="text-red-500 w-5 h-5" />
          พื้นที่ที่ต้องเดินทางไปนิเทศ
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          นักศึกษาในความดูแล {students.length} คน ใน {provinceSummary.length} จังหวัด
        </p>

        {provinceSummary.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {provinceSummary.map(([province, count]) => (
              <span
                key={province}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200"
              >
                {province}
                <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-brand-navy dark:bg-blue-900/40 dark:text-blue-300">
                  {count} คน
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ยังไม่มีข้อมูลจังหวัดของสถานประกอบการ
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {students.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
            ไม่มีนักศึกษาในความดูแล
          </div>
        )}

        {students.map(student => {
          const appointment = appointments.find(a => a.student_id === student.student_id);

          // `/personnel/supervised-students` returns anyone this account advises
          // *or* supervises, and the two jobs are different on a visit day. The
          // old version of this read `localStorage.getItem('userId')`, which is
          // never written anywhere in the app — so it compared against 0 and
          // every student came out as the generic "ผู้ดูแล".
          const myId = auth?.user?.userId;
          const isAdvisor = !!myId && student.advisor_id === myId;
          const isSupervisor = !!myId && student.supervisor_id === myId;
          const roleTag =
            isAdvisor && isSupervisor ? 'ที่ปรึกษา & ผู้นิเทศ'
            : isAdvisor ? 'ที่ปรึกษาสหกิจ'
            : isSupervisor ? 'อาจารย์นิเทศ'
            : 'ผู้ดูแล';

          return (
            <div key={student.student_id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div>
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white flex flex-wrap items-center gap-2">
                    <Users className="w-5 h-5 text-brand-blue dark:text-blue-400" />
                    {student.first_name} {student.last_name} ({student.student_code})
                    <span className="rounded-full border border-blue-200 bg-brand-blue/10 px-2 py-0.5 text-xs font-bold text-brand-navy dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                      {roleTag}
                    </span>
                  </h3>
                  <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {student.company_name || 'ไม่ระบุ'}</span>
                  </div>

                  {/* Who and where to call on the day. Also stranded in the
                      unreachable branch until now — the advisor had the company
                      name and nothing else. */}
                  <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs text-gray-600 sm:grid-cols-2 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                    <div className="sm:col-span-2 font-bold text-gray-700 dark:text-gray-300">
                      ข้อมูลติดต่อสำหรับวันนิเทศ
                    </div>
                    <div>จังหวัดที่ตั้ง: {student.company_province || 'ไม่ระบุ'}</div>
                    <div>เบอร์นักศึกษา: {student.phone || 'ไม่ระบุ'}</div>
                    <div>พี่เลี้ยง: {student.mentor_name || 'ยังไม่ระบุ'}</div>
                    <div>เบอร์พี่เลี้ยง: {student.mentor_phone || 'ไม่ระบุ'}</div>
                  </div>

                  {/* Accommodation info (System 3) */}
                  {student.accommodation_address && (
                    <div className="mt-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-xs space-y-1 text-gray-600 dark:text-gray-300">
                      <div className="font-bold text-gray-700 dark:text-gray-300">ข้อมูลที่พัก & ติดต่อฉุกเฉิน</div>
                      <div>ที่พัก: {student.accommodation_address}</div>
                      <div>เบอร์ติดต่อที่พัก: {student.accommodation_phone || '-'}</div>
                      <div>ผู้ติดต่อฉุกเฉิน: {student.emergency_contact || '-'} ({student.emergency_phone || '-'})</div>
                    </div>
                  )}

                  {/* Weekly Plans (System 3) */}
                  {student.weekly_plans && student.weekly_plans.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-300">แผนปฏิบัติงานรายสัปดาห์:</div>
                      <div className="max-h-[150px] overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 bg-gray-50/30 dark:bg-gray-900/30">
                        {student.weekly_plans.map((p: WeeklyPlan) => (
                          <div key={p.plan_id} className="p-3 text-xs flex justify-between gap-4">
                            <div>
                              <span className="font-bold block text-gray-600 dark:text-gray-400">สัปดาห์ที่ {p.week_number}</span>
                              <span className="text-gray-500 block mt-0.5 dark:text-gray-400">{p.tasks}</span>
                            </div>
                            <span className="text-xs text-gray-600 dark:text-gray-400 self-start whitespace-nowrap">
                              {new Date(p.start_date).toLocaleDateString('th-TH', {day: 'numeric', month: 'short'})} - {new Date(p.end_date).toLocaleDateString('th-TH', {day: 'numeric', month: 'short'})}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {appointment ? (
                  <div className="text-right">
                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${
                      appointment.status === 'accepted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      appointment.status === 'draft' ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' :
                      appointment.status === 'offline_agreed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                    }`}>
                      สถานะนัดหมาย: {
                        appointment.status === 'draft' ? 'แบบร่าง (รอส่ง)' :
                        appointment.status === 'pending_company' ? 'รอสถานประกอบการตอบกลับ' :
                        appointment.status === 'rescheduled' ? 'ขอเลื่อนเวลา' :
                        appointment.status === 'accepted' ? 'ยืนยันนัดหมายแล้ว' :
                        appointment.status === 'offline_agreed' ? 'ตกลงนอกรอบแล้ว' : appointment.status
                      }
                    </span>
                  </div>
                ) : (
                  <div>
                    <Button
                      icon={<Calendar className="w-4 h-4" />}
                      onClick={() => setShowDraftForm(showDraftForm === student.student_id ? null : student.student_id)}
                    >
                      กำหนดวันนิเทศ
                    </Button>
                  </div>
                )}
              </div>

              {/* Appointment Details / Actions */}
              {appointment && (
                <div className="p-6 bg-gray-50 dark:bg-gray-900/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">รายละเอียดการนัดหมาย</h4>
                      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                        <p><strong>วันที่:</strong> {appointment.appointment_date ? new Date(appointment.appointment_date).toLocaleDateString('th-TH') : 'ยังไม่กำหนด'}</p>
                        <p><strong>เวลานิเทศนักศึกษา:</strong> {appointment.student_time}</p>
                        <p><strong>เวลาพบพี่เลี้ยง:</strong> {appointment.mentor_time}</p>
                        <p><strong>รูปแบบ:</strong> {appointment.tour_requested ? 'ขอเยี่ยมชมสถานประกอบการด้วย' : 'พบปะพูดคุยปกติ'}</p>
                        
                        {appointment.status === 'rescheduled' && appointment.proposed_reschedule_date && (
                          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <p className="font-semibold text-yellow-800 dark:text-yellow-500 mb-1">พี่เลี้ยงขอเลื่อนเป็น:</p>
                            <p className="text-yellow-700 dark:text-yellow-600"><strong>วันที่:</strong> {new Date(appointment.proposed_reschedule_date).toLocaleDateString('th-TH')}</p>
                            <p className="text-yellow-700 dark:text-yellow-600"><strong>เวลาพบพี่เลี้ยง:</strong> {appointment.proposed_mentor_time}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col justify-end gap-3">
                      {(appointment.status === 'pending_company' || appointment.status === 'rescheduled') && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setBypassingId(appointment.appointment_id)}
                          className="self-start md:self-end"
                        >
                          ตกลงกับสถานประกอบการนอกรอบแล้ว (Bypass)
                        </Button>
                      )}

                      {appointment.status === 'rescheduled' && (
                        <Button
                          size="sm"
                          onClick={() => setAcceptingRescheduleId(appointment.appointment_id)}
                          className="self-start md:self-end"
                        >
                          ยอมรับการเลื่อนนัดหมาย (Accept Reschedule)
                        </Button>
                      )}

                      {(appointment.status === 'accepted' || appointment.status === 'offline_agreed') && (
                        <Button
                          variant="success"
                          size="sm"
                          icon={<FileText className="w-4 h-4" />}
                          onClick={() => setShowLogForm(appointment.appointment_id)}
                          className="self-start md:self-end"
                        >
                          บันทึกผลการนิเทศ (Log)
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Draft Form */}
              {showDraftForm === student.student_id && (
                <div className="p-6 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-100 dark:border-gray-800">
                  <h4 className="font-semibold text-sm text-brand-blue mb-4 dark:text-blue-400">สร้างแบบร่างวันนิเทศ</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">วันที่</label>
                      <input 
                        type="date" 
                        value={draftData.appointment_date}
                        onChange={e => setDraftData({...draftData, appointment_date: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">เวลาพบนิสิต</label>
                      <input 
                        type="time" 
                        value={draftData.student_time}
                        onChange={e => setDraftData({...draftData, student_time: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">เวลาพบพี่เลี้ยง</label>
                      <input 
                        type="time" 
                        value={draftData.mentor_time}
                        onChange={e => setDraftData({...draftData, mentor_time: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div className="flex items-center mt-6">
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                        <input 
                          type="checkbox" 
                          checked={draftData.tour_requested}
                          onChange={e => setDraftData({...draftData, tour_requested: e.target.checked})}
                          className="w-4 h-4 rounded text-brand-blue focus:ring-brand-blue dark:text-blue-400"
                        />
                        ต้องการเยี่ยมชมสถานประกอบการด้วย
                      </label>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => setShowDraftForm(null)}>
                      ยกเลิก
                    </Button>
                    <Button
                      icon={<Send className="w-4 h-4" />}
                      disabled={!draftData.appointment_date || !draftData.student_time || !draftData.mentor_time}
                      onClick={() => handleCreateDraft(student.student_id)}
                    >
                      บันทึกและส่งให้ส่วนกลาง
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Render SupervisionLogForm full screen modal if open */}
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
    </div>
  );
};

export default SupervisionTracking;
