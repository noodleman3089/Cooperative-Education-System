import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { Calendar, CheckCircle, Clock, Check, X } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';

const AppointmentResponse: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<'accept' | 'reschedule' | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  // Extract appointment ID from token payload (client-side decoding for UI if needed, but not secure for logic)
  // We just send the token back to API

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
    if (selectedAction === 'reschedule' && (!newDate || !newTime)) {
      setError('กรุณาระบุวันที่และเวลาใหม่ที่ต้องการเลื่อน');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Dummy ID '0' because backend extracts ID from token! Wait, backend expects /:id/respond.
      // But we can decode token to get ID, or we can just send to a token-only route.
      // Let's check backend route: `PUT /api/appointments/:id/respond`
      // We need to parse JWT on frontend to get ID.
      const payload = JSON.parse(atob(token.split('.')[1]));
      const appointmentId = payload.appointment_id;

      await api.put(`/appointments/${appointmentId}/respond`, {
        token,
        action: selectedAction,
        new_date: newDate,
        new_time: newTime
      });

      setSuccess(selectedAction === 'accept' ? 'ยืนยันการนัดหมายเรียบร้อยแล้ว' : 'ส่งคำขอเลื่อนนัดหมายเรียบร้อยแล้ว');
    } catch (err: any) {
      setError(err.response?.data?.message || 'ลิงก์หมดอายุ หรือเกิดข้อผิดพลาด');
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
          <p className="text-xs text-gray-400">ระบบได้แจ้งให้อาจารย์ที่ปรึกษาทราบแล้ว ท่านสามารถปิดหน้านี้ได้</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 py-12 dark:bg-gray-800">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg w-full overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="bg-brand-blue p-6 text-center text-white">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-90" />
          <h1 className="text-xl font-bold">ตอบรับการนัดหมายนิเทศนักศึกษา</h1>
          <p className="text-sm opacity-80 mt-1">มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก</p>
        </div>

        <div className="p-8">
          <AlertBanner variant="error" message={error} className="mb-6" />

          <p className="text-gray-700 text-sm mb-6 text-center dark:text-gray-300">
            กรุณาเลือกเพื่อยืนยันหรือขอเลื่อนวันนัดหมาย
          </p>

          <div className="space-y-4">
            {action !== 'reschedule' && (
              <button
                onClick={() => handleSubmit('accept')}
                disabled={loading}
                className="w-full flex justify-center items-center gap-2 py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold transition-all disabled:opacity-50"
              >
                {loading && action === 'accept' ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Check className="w-5 h-5" />
                )}
                ยืนยันการนัดหมายตามกำหนดการ
              </button>
            )}

            {action !== 'reschedule' && (
              <button
                onClick={() => setAction('reschedule')}
                className="w-full py-3.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-all dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-400"
              >
                ขอเลื่อนวัน/เวลานัดหมาย
              </button>
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
                    onChange={e => setNewDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none dark:border-gray-700"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">เวลา</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={e => setNewTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none dark:border-gray-700"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setAction(null)}
                    className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-700"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={() => handleSubmit('reschedule')}
                    disabled={loading}
                    className="flex-1 py-2.5 bg-brand-blue text-white rounded-xl font-medium hover:bg-blue-600 flex justify-center items-center"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      'ส่งคำขอเลื่อน'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentResponse;
