import React, { useState, useEffect } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { Calendar, Send } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Button from '../../components/ui/Button';
import { getErrorMessage } from '../../utils/errors';

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
  /**
   * The whole draft, not just its id: with ten rows on screen the dialog has to
   * say whose appointment is about to go out, and the server refuses a repeat
   * send for 24 hours, so a wrong row costs a day and cannot be undone.
   */
  const [confirmingDraft, setConfirmingDraft] = useState<AppointmentDraft | null>(null);

  const fetchDrafts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/appointments');
      setDrafts(res.data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดข้อมูล'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleSendEmail = async () => {
    if (!confirmingDraft) return;
    const draft = confirmingDraft;
    setError(null);
    setSuccess(null);
    try {
      setSendingId(draft.appointment_id);
      await api.put(`/appointments/${draft.appointment_id}/audit-send`);
      setConfirmingDraft(null);
      setSuccess(`ส่งอีเมลนัดหมายของ ${draft.first_name} ${draft.last_name} ไปยังพี่เลี้ยงเรียบร้อยแล้ว`);
      fetchDrafts();
    } catch (err) {
      setConfirmingDraft(null);
      setError(getErrorMessage(err, 'ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบว่ามีอีเมลพี่เลี้ยงหรือไม่'));
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
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">ตรวจสอบการนัดหมาย (ส่งอีเมล)</h2>
        {/* gray-600 rather than gray-500: this description sits on the page's
            grey background, not on a white card, which costs it enough contrast
            to land under AA (4.39:1 measured). */}
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
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
                      <Button
                        icon={<Send className="w-4 h-4" />}
                        onClick={() => setConfirmingDraft(draft)}
                        loading={sendingId === draft.appointment_id}
                        loadingLabel="กำลังส่ง..."
                      >
                        ส่งอีเมลแจ้งพี่เลี้ยง
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDraft !== null}
        title="ยืนยันการส่งอีเมลนัดหมาย"
        message={confirmingDraft
          ? `ส่งอีเมลนัดหมายนิเทศของ ${confirmingDraft.first_name} ${confirmingDraft.last_name} (${confirmingDraft.student_code}) วันที่ ${new Date(confirmingDraft.appointment_date).toLocaleDateString('th-TH')} ไปยังพี่เลี้ยงที่ ${confirmingDraft.company_name}? อีเมลจะมีลิงก์ให้ตอบรับหรือขอเลื่อนนัด และส่งซ้ำได้อีกครั้งหลังผ่านไป 24 ชั่วโมง`
          : ''}
        confirmLabel="ส่งอีเมล"
        busy={sendingId !== null}
        onConfirm={handleSendEmail}
        onCancel={() => setConfirmingDraft(null)}
      />
    </div>
  );
};

export default AppointmentAudit;
