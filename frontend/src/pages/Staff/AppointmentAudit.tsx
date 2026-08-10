import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { Calendar, Send } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

interface AppointmentDraft {
  appointment_id: number;
  student_id: number;
  first_name: string;
  last_name: string;
  student_code: string;
  company_name: string;
  appointment_date: string;
  student_time: string;
  mentor_time: string;
  tour_requested: boolean;
  status: string;
}

const AppointmentAudit: React.FC = () => {
  const [drafts, setDrafts] = useState<AppointmentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const fetchDrafts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/appointments');
      setDrafts(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleSendEmail = async () => {
    if (confirmingId === null) return;
    setError(null);
    setSuccess(null);
    try {
      setSendingId(confirmingId);
      await api.put(`/appointments/${confirmingId}/audit-send`);
      setConfirmingId(null);
      setSuccess('ส่งอีเมลเรียบร้อยแล้ว');
      fetchDrafts();
    } catch (err: any) {
      setConfirmingId(null);
      setError(err.response?.data?.message || 'ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบว่ามีอีเมลพี่เลี้ยงหรือไม่');
    } finally {
      setSendingId(null);
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='table' />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">ตรวจสอบการนัดหมาย (ส่งอีเมล)</h2>
        <p className="text-xs text-gray-400 mt-1">
          ตรวจสอบวันนัดหมายนิเทศที่อาจารย์ที่ปรึกษากำหนดไว้ และส่งอีเมลแจ้งสถานประกอบการ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        {drafts.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            ไม่มีแบบร่างนัดหมายที่รอส่ง
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4 font-semibold">นักศึกษา</th>
                  <th className="px-6 py-4 font-semibold">สถานประกอบการ</th>
                  <th className="px-6 py-4 font-semibold">วันนัดหมาย</th>
                  <th className="px-6 py-4 font-semibold text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {drafts.map(draft => (
                  <tr key={draft.appointment_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-900 dark:text-white">{draft.first_name} {draft.last_name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">รหัส: {draft.student_code}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                      {draft.company_name}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-brand-blue dark:text-blue-400" />
                        {new Date(draft.appointment_date).toLocaleDateString('th-TH')}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                        เวลาพบพี่เลี้ยง: {draft.mentor_time} น.
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setConfirmingId(draft.appointment_id)}
                        disabled={sendingId === draft.appointment_id}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-blue hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                      >
                        {sendingId === draft.appointment_id ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        ส่งอีเมลแจ้งพี่เลี้ยง
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingId !== null}
        title="ยืนยันการส่งอีเมลนัดหมาย"
        message="ระบบจะส่งอีเมลแจ้งวันและเวลานิเทศไปยังพี่เลี้ยงที่สถานประกอบการ พร้อมลิงก์สำหรับตอบรับหรือขอเลื่อนนัด"
        confirmLabel="ส่งอีเมล"
        busy={sendingId !== null}
        onConfirm={handleSendEmail}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
};

export default AppointmentAudit;
