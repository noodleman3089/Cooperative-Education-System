import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { Calendar, CheckCircle, Clock, Check, X } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { getErrorMessage } from '../../utils/errors';

interface AppointmentInfo {
  appointment_id: number;
  appointment_date: string | null;
  student_time: string | null;
  mentor_time: string | null;
  tour_requested: boolean;
  status: string;
  proposed_reschedule_date: string | null;
  proposed_mentor_time: string | null;
  student_first_name: string | null;
  student_last_name: string | null;
  student_code: string;
  company_name: string;
  advisor_first_name: string | null;
  advisor_last_name: string | null;
}

/** Today as YYYY-MM-DD, for the date field's `min`. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};

const formatThaiDate = (value: string | null): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'long' }).format(parsed);
};

const AppointmentResponse: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The appointment the mentor is being asked about. The page used to show only
  // "กรุณาเลือกเพื่อยืนยันหรือขอเลื่อนวันนัดหมาย" and two buttons — no student,
  // no date, no time, no company — so answering meant going back to the email.
  const [info, setInfo] = useState<AppointmentInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [action, setAction] = useState<'accept' | 'reschedule' | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  const isAwaitingResponse = Boolean(info && (info.status === 'pending_company' || info.status === 'rescheduled'));

  useEffect(() => {
    if (!token) {
      setInfoLoading(false);
      return;
    }

    const load = async () => {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const res = await api.post(`/appointments/${payload.appointment_id}/respond-info`, { token });
        setInfo(res.data || null);
      } catch (err) {
        setInfoError(getErrorMessage(err)
          ? 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา'
          : 'ไม่สามารถโหลดรายละเอียดการนัดหมายได้ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setInfoLoading(false);
      }
    };

    load();
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 dark:bg-gray-800">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center max-w-md w-full border border-red-100 dark:bg-gray-900">
          <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-white">ลิงก์ไม่ถูกต้อง</h2>
          <p className="text-gray-500 text-sm dark:text-gray-400">กรุณาตรวจสอบลิงก์จากอีเมลอีกครั้ง</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (selectedAction: 'accept' | 'reschedule') => {
    if (selectedAction === 'reschedule') {
      if (!newDate || !newTime) {
        setError('กรุณาระบุวันที่และเวลาใหม่ที่ต้องการเลื่อน');
        return;
      }
      // The server refuses a past date too; saying so here saves a round trip
      // and explains it next to the field that is wrong.
      if (newDate < todayIso()) {
        setError('ไม่สามารถเสนอวันนัดหมายที่เป็นวันย้อนหลังได้ กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป');
        return;
      }
    }

    try {
      setLoading(true);
      setAction(selectedAction);
      setError(null);

      const payload = JSON.parse(atob(token.split('.')[1]));
      const appointmentId = payload.appointment_id;

      await api.put(`/appointments/${appointmentId}/respond`, {
        token,
        action: selectedAction,
        new_date: newDate,
        new_time: newTime
      });

      setSuccess(selectedAction === 'accept' ? 'ยืนยันการนัดหมายเรียบร้อยแล้ว' : 'ส่งคำขอเลื่อนนัดหมายเรียบร้อยแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'ลิงก์หมดอายุ หรือเกิดข้อผิดพลาด'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 dark:bg-gray-800">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center max-w-md w-full border border-green-100 dark:bg-gray-900">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2 dark:text-white">ดำเนินการสำเร็จ</h2>
          <p className="text-gray-500 text-sm mb-8 dark:text-gray-400">{success}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">ระบบได้แจ้งให้อาจารย์ที่ปรึกษาทราบแล้ว ท่านสามารถปิดหน้านี้ได้</p>
        </div>
      </div>
    );
  }

  const studentName = info && (info.student_first_name || info.student_last_name)
    ? `${info.student_first_name ?? ''} ${info.student_last_name ?? ''}`.trim()
    : info?.student_code ?? '';
  const advisorName = info && (info.advisor_first_name || info.advisor_last_name)
    ? `${info.advisor_first_name ?? ''} ${info.advisor_last_name ?? ''}`.trim()
    : null;

  const detailRow = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0 dark:border-gray-800">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-gray-800 text-right dark:text-gray-200">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 py-12 dark:bg-gray-800">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg w-full overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="bg-brand-blue p-6 text-center text-white">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-90" />
          <h1 className="text-xl font-bold">ตอบรับการนัดหมายนิเทศนักศึกษา</h1>
          <p className="text-sm text-white mt-1">มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก</p>
        </div>

        <div className="p-8">
          <AlertBanner variant="error" message={error} className="mb-6" />
          <AlertBanner variant="error" message={infoError} className="mb-6" />

          {infoLoading ? (
            <div className="space-y-2 mb-6" aria-hidden="true">
              <div className="h-4 rounded-lg shimmer-placeholder" />
              <div className="h-4 rounded-lg shimmer-placeholder" />
              <div className="h-4 w-2/3 rounded-lg shimmer-placeholder" />
            </div>
          ) : info ? (
            <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-800/50">
              {detailRow('นักศึกษา', `${studentName} (${info.student_code})`)}
              {detailRow('สถานประกอบการ', info.company_name)}
              {detailRow('วันที่นัดหมาย', formatThaiDate(info.appointment_date))}
              {detailRow('เวลาที่ขอพบพี่เลี้ยง', info.mentor_time || '-')}
              {detailRow('เวลาที่ขอพบนักศึกษา', info.student_time || '-')}
              {advisorName && detailRow('อาจารย์นิเทศ', advisorName)}
              {info.tour_requested && detailRow('เพิ่มเติม', 'ขอเยี่ยมชมสถานประกอบการด้วย')}
              {info.status === 'rescheduled' && info.proposed_reschedule_date &&
                detailRow('วันที่ท่านเสนอเลื่อนไว้', `${formatThaiDate(info.proposed_reschedule_date)} ${info.proposed_mentor_time ?? ''}`)}
            </div>
          ) : null}

          {info && !isAwaitingResponse ? (
            <AlertBanner
              data-testid="appointment-closed-note"
              variant="info"
              message={
                info.status === 'draft'
                  ? 'อาจารย์นิเทศกำลังแก้ไขวันนัด ท่านจะได้รับอีเมลฉบับใหม่'
                  : 'นัดหมายนี้ยืนยันแล้ว หากต้องการเปลี่ยนแปลงกรุณาติดต่ออาจารย์นิเทศ'
              }
              className="mb-6"
            />
          ) : isAwaitingResponse ? (
            <>
              {info?.status === 'rescheduled' && (
                <AlertBanner
                  variant="info"
                  message="ท่านได้ขอเลื่อนวันนัดหมายนี้แล้ว อยู่ระหว่างรออาจารย์นิเทศตอบ หากต้องการเสนอวันอื่น ส่งคำขอเลื่อนอีกครั้งได้ด้านล่าง"
                  className="mb-6"
                />
              )}

              {info?.status !== 'rescheduled' && (
                <p className="text-gray-700 text-sm mb-6 text-center dark:text-gray-300">
                  กรุณาเลือกเพื่อยืนยันหรือขอเลื่อนวันนัดหมาย
                </p>
              )}

              <div className="space-y-4">
                {/* ขอเลื่อนค้างอยู่ = เซิร์ฟเวอร์ไม่รับการยืนยันวันเดิม (409) จึงไม่แสดงปุ่มที่กดแล้วถูกปฏิเสธ */}
                {action !== 'reschedule' && info?.status !== 'rescheduled' && (
                  <Button
                    variant="success"
                    size="lg"
                    icon={<Check className="w-5 h-5" />}
                    loading={loading && action === 'accept'}
                    loadingLabel="กำลังยืนยัน..."
                    onClick={() => handleSubmit('accept')}
                  >
                    ยืนยันการนัดหมายตามกำหนดการ
                  </Button>
                )}

                {action !== 'reschedule' && (
                  <Button variant="secondary" size="lg" onClick={() => setAction('reschedule')}>
                    ขอเลื่อนวัน/เวลานัดหมาย
                  </Button>
                )}

                {action === 'reschedule' && (
                  <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 space-y-4 animate-in fade-in slide-in-from-top-4 dark:bg-gray-800 dark:border-gray-800">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 dark:text-white">
                      <Clock className="w-4 h-4 text-brand-blue dark:text-blue-400" /> เสนอวันและเวลาใหม่
                    </h3>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">วันที่ต้องการเลื่อนไป</label>
                      <input
                        type="date"
                        value={newDate}
                        min={todayIso()}
                        onChange={e => setNewDate(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">เวลา</label>
                      <input
                        type="time"
                        value={newTime}
                        onChange={e => setNewTime(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                      />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button variant="secondary" className="flex-1" onClick={() => setAction(null)}>
                        ยกเลิก
                      </Button>
                      <Button
                        className="flex-1"
                        loading={loading}
                        loadingLabel="กำลังส่ง..."
                        onClick={() => handleSubmit('reschedule')}
                      >
                        ส่งคำขอเลื่อน
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AppointmentResponse;
