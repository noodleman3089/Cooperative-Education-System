import React, { useState, useEffect, useCallback } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import { ChevronRight, Phone, FileText } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal, { ModalBody } from '../../components/ui/Modal';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';

/**
 * E9 · นัดหมายนิเทศ สหกิจ 12 (Appointments.dc.html)
 *
 * เส้นทางของหนึ่งนัดหมาย:
 * 1. อาจารย์ร่าง -> 2. คุณตรวจแล้วสั่งส่ง -> 3. บริษัทกดยืนยัน / ขอเลื่อน -> 4. อาจารย์เดินทางไปนิเทศ
 *
 * กฎสำคัญ:
 * - ปุ่ม "บันทึกว่านัดทางโทรศัพท์แล้ว" (PUT /appointments/:id/bypass):
 *   เป็นการบันทึกว่ายืนยันนอกระบบ (ไม่ใช่ปลอมว่าบริษัทกดยืนยันในระบบ)
 */

interface AppointmentRow {
  appointment_id: number;
  student_id: number;
  first_name: string;
  last_name: string;
  student_code: string;
  company_name: string;
  advisor_name?: string;
  appointment_date: string;
  student_time?: string;
  mentor_time?: string;
  mentor_email?: string | null;
  tour_requested?: boolean;
  visit_number?: number;
  // ชื่อสถานะต้องตรงกับ supervision_appointments.status ใน backend — เดิมหน้านี้ใช้ชื่อที่
  // backend ไม่มี (sent / reschedule_requested / confirmed / bypassed) กองนับจึงเป็นศูนย์ตลอด
  status: string; // 'draft' | 'pending_company' | 'rescheduled' | 'accepted' | 'offline_agreed'
  proposed_reschedule_date?: string | null;
  proposed_mentor_time?: string | null;
  created_at?: string;
}

export const AppointmentAudit: React.FC = () => {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmingDraft, setConfirmingDraft] = useState<AppointmentRow | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const [bypassingDraft, setBypassingDraft] = useState<AppointmentRow | null>(null);
  const [bypassingBusy, setBypassingBusy] = useState(false);

  const [acceptingRescheduleDraft, setAcceptingRescheduleDraft] = useState<AppointmentRow | null>(null);
  const [acceptingBusy, setAcceptingBusy] = useState(false);

  const [viewingDraft, setViewingDraft] = useState<AppointmentRow | null>(null);
  const [memoModalOpen, setMemoModalOpen] = useState(false);

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/appointments');
      setAppointments(res.data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดข้อมูลนัดหมาย'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAppointments();
  }, [fetchAppointments]);

  // 1. Send / Re-send email
  const handleSendEmail = async () => {
    if (!confirmingDraft) return;
    const draft = confirmingDraft;
    setError(null);
    setSuccess(null);
    try {
      setSendingId(draft.appointment_id);
      await api.put(`/appointments/${draft.appointment_id}/audit-send`);
      setConfirmingDraft(null);
      setSuccess(`ส่งอีเมลนัดหมายนิเทศของ ${draft.first_name} ${draft.last_name} ไปยังสถานประกอบการเรียบร้อยแล้ว`);
      await fetchAppointments();
    } catch (err) {
      setConfirmingDraft(null);
      setError(getErrorMessage(err, 'ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบว่ามีอีเมลสถานประกอบการ/พี่เลี้ยงหรือไม่'));
    } finally {
      setSendingId(null);
    }
  };

  // 2. Bypass / Record Phone Confirmation (ยืนยันนอกระบบ)
  const handleBypass = async () => {
    if (!bypassingDraft) return;
    const draft = bypassingDraft;
    setError(null);
    setSuccess(null);
    try {
      setBypassingBusy(true);
      await api.put(`/appointments/${draft.appointment_id}/bypass`);
      setBypassingDraft(null);
      setSuccess(`บันทึกการยืนยันนัดหมายทางโทรศัพท์ (ยืนยันนอกระบบ) ของ ${draft.first_name} เรียบร้อยแล้ว`);
      await fetchAppointments();
    } catch (err) {
      setBypassingDraft(null);
      setError(getErrorMessage(err, 'บันทึกการยืนยันนอกระบบไม่สำเร็จ'));
    } finally {
      setBypassingBusy(false);
    }
  };

  // 3. Accept Reschedule (รับวันใหม่)
  const handleAcceptReschedule = async () => {
    if (!acceptingRescheduleDraft) return;
    const draft = acceptingRescheduleDraft;
    setError(null);
    setSuccess(null);
    try {
      setAcceptingBusy(true);
      await api.put(`/appointments/${draft.appointment_id}/accept-reschedule`);
      setAcceptingRescheduleDraft(null);
      setSuccess(`ตอบรับวันนัดหมายใหม่สำหรับ ${draft.first_name} เรียบร้อยแล้ว`);
      await fetchAppointments();
    } catch (err) {
      setAcceptingRescheduleDraft(null);
      setError(getErrorMessage(err, 'ไม่สามารถตอบรับวันใหม่ได้'));
    } finally {
      setAcceptingBusy(false);
    }
  };

  // Stats
  const draftCount = appointments.filter((a) => a.status === 'draft').length;
  const sentCount = appointments.filter((a) => a.status === 'pending_company').length;
  const rescheduleCount = appointments.filter((a) => a.status === 'rescheduled').length;
  const confirmedCount = appointments.filter((a) => a.status === 'accepted' || a.status === 'offline_agreed').length;

  return (
    <div className="max-w-[1360px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching Appointments.dc.html */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            นัดหมายนิเทศ (สหกิจ 12)
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            อาจารย์ร่างวันเวลา คุณตรวจแล้วสั่งส่งหนังสือนัดหมายไปยังสถานประกอบการ · บริษัทตอบกลับผ่านลิงก์ในอีเมลโดยไม่ต้องล็อกอิน
          </p>
        </div>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          ภาคเรียนที่ 1/2570 · สัปดาห์ที่ 6 จาก 16
        </span>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. Stepper Card matching Appointments.dc.html */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-5 flex-wrap shadow-xs text-xs">
        <span className="font-bold text-gray-900 dark:text-white mr-2">
          เส้นทางของหนึ่งนัดหมาย
        </span>

        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#1E3A8A] dark:text-blue-300 font-extrabold text-[11px] inline-flex items-center justify-center shrink-0">
            1
          </span>
          <span className="text-gray-700 dark:text-gray-300">อาจารย์ร่าง</span>
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />

        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-extrabold text-[11px] inline-flex items-center justify-center shrink-0 shadow-xs">
            2
          </span>
          <strong className="font-bold text-gray-900 dark:text-white">คุณตรวจแล้วสั่งส่ง</strong>
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />

        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#1E3A8A] dark:text-blue-300 font-extrabold text-[11px] inline-flex items-center justify-center shrink-0">
            3
          </span>
          <span className="text-gray-700 dark:text-gray-300">บริษัทกดยืนยัน / ขอเลื่อน</span>
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />

        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#1E3A8A] dark:text-blue-300 font-extrabold text-[11px] inline-flex items-center justify-center shrink-0">
            4
          </span>
          <span className="text-gray-700 dark:text-gray-300">อาจารย์เดินทางไปนิเทศ</span>
        </div>
      </div>

      {/* 3. Stat Cards matching Appointments.dc.html */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-gray-800 border-2 border-blue-600 dark:border-blue-500 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-[#1E3A8A] dark:text-blue-300">
            ร่างรอคุณตรวจ
          </div>
          <div className="text-2xl font-black text-[#1E3A8A] dark:text-blue-400 mt-1">
            {draftCount}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            ส่งแล้ว รอบริษัทตอบ
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white mt-1">
            {sentCount}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700/80 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-[#92400E] dark:text-amber-400">
            บริษัทขอเลื่อน
          </div>
          <div className="text-2xl font-black text-[#B45309] dark:text-amber-400 mt-1">
            {rescheduleCount}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            ยืนยันแล้ว
          </div>
          <div className="text-2xl font-black text-[#15803D] dark:text-emerald-400 mt-1">
            {confirmedCount}
          </div>
        </div>
      </div>

      {/* 4. Table matching Appointments.dc.html */}
      {loading ? (
        <PageSkeleton variant="table" />
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[950px]">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  <th className="p-3.5 font-bold">นักศึกษา / สถานประกอบการ</th>
                  <th className="p-3.5 font-bold">อาจารย์ผู้นิเทศ</th>
                  <th className="p-3.5 font-bold">วันเวลาที่เสนอ</th>
                  <th className="p-3.5 font-bold">ปลายทางอีเมล</th>
                  <th className="p-3.5 font-bold">สถานะ</th>
                  <th className="p-3.5 font-bold text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-700 dark:text-gray-300">
                {appointments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500 dark:text-gray-400">
                      ไม่มีรายการนัดหมายในขณะนี้
                    </td>
                  </tr>
                ) : (
                  appointments.map((a) => {
                    const isDraft = a.status === 'draft';
                    const isReschedule = a.status === 'rescheduled';
                    const isSent = a.status === 'pending_company';
                    const isConfirmed = a.status === 'accepted';
                    const isBypassed = a.status === 'offline_agreed';
                    const hasNoEmail = !a.mentor_email;
                    // "ส่งไม่ได้" มีความหมายเฉพาะนัดที่ยังต้องส่งอีเมล — นัดที่ตกลงแล้วไม่ต้องขึ้นปุ่มโทรศัพท์
                    const cannotEmail = hasNoEmail && (isDraft || isSent);

                    return (
                      <tr
                        key={a.appointment_id}
                        data-testid={`appointment-row-${a.appointment_id}`}
                        className={`hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors ${
                          isReschedule ? 'bg-[#FFFBEB] dark:bg-amber-950/20' : ''
                        }`}
                      >
                        {/* นักศึกษา / สถานประกอบการ */}
                        <td className="p-3.5">
                          <span className="font-bold text-gray-900 dark:text-white block">
                            {a.first_name} {a.last_name}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                            {a.company_name} · {a.student_code}
                          </span>
                        </td>

                        {/* อาจารย์ผู้นิเทศ */}
                        <td className="p-3.5">
                          <span className="font-medium text-gray-800 dark:text-gray-200">
                            {a.advisor_name || 'อาจารย์ที่ปรึกษา'}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">ครั้งที่ {a.visit_number ?? 1}</span>
                        </td>

                        {/* วันเวลาที่เสนอ */}
                        <td className="p-3.5">
                          {isReschedule ? (
                            <div>
                              <s className="text-gray-500 dark:text-gray-400">
                                {formatThaiDate(a.appointment_date)} · {a.mentor_time || a.student_time || '10:00'} น.
                              </s>
                              <span className="block text-[#B45309] dark:text-amber-400 font-semibold mt-0.5">
                                บริษัทขอเลื่อนเป็น {a.proposed_reschedule_date ? formatThaiDate(a.proposed_reschedule_date) : 'วันใหม่'} · {a.proposed_mentor_time || '-'} น.
                              </span>
                            </div>
                          ) : (
                            <span>
                              {formatThaiDate(a.appointment_date)} · {a.mentor_time || a.student_time || '10:00'} น.
                            </span>
                          )}
                        </td>

                        {/* ปลายทางอีเมล */}
                        <td className="p-3.5 font-mono">
                          {hasNoEmail ? (
                            <span className="text-red-600 dark:text-red-400 font-semibold">
                              — ไม่มีอีเมลในทะเบียน
                            </span>
                          ) : (
                            <span className="text-gray-700 dark:text-gray-300">
                              {a.mentor_email}
                            </span>
                          )}
                        </td>

                        {/* สถานะ */}
                        <td className="p-3.5">
                          {cannotEmail ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                              ส่งไม่ได้
                            </span>
                          ) : isDraft ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-blue-50 text-[#1E3A8A] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                              ร่างรอตรวจ
                            </span>
                          ) : isReschedule ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-amber-50 text-[#B45309] border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                              ขอเลื่อน
                            </span>
                          ) : isSent ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600">
                              ส่งแล้ว
                            </span>
                          ) : isBypassed ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-[#15803D] border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              ยืนยันนอกระบบ (โทรศัพท์)
                            </span>
                          ) : isConfirmed ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-[#15803D] border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              ยืนยันแล้ว
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-gray-200">
                              {a.status}
                            </span>
                          )}
                        </td>

                        {/* จัดการ */}
                        <td className="p-3.5 text-right">
                          {cannotEmail ? (
                            <div className="flex flex-col items-end gap-1">
                              <button
                                type="button"
                                onClick={() => setBypassingDraft(a)}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition-colors"
                              >
                                บันทึกว่านัดทางโทรศัพท์แล้ว
                              </button>
                              <span className="text-[10px] text-red-600 dark:text-red-400">
                                หรือเติมอีเมลที่ทำเนียบก่อน
                              </span>
                            </div>
                          ) : isDraft ? (
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => setViewingDraft(a)}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50"
                              >
                                ดูร่าง
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDraft(a)}
                                className="px-3 py-1 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
                              >
                                ตรวจแล้ว ส่งเลย
                              </button>
                            </div>
                          ) : isReschedule ? (
                            <button
                              type="button"
                              onClick={() => setAcceptingRescheduleDraft(a)}
                              className="px-3 py-1 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
                            >
                              รับวันใหม่
                            </button>
                          ) : isSent ? (
                            <button
                              type="button"
                              onClick={() => setConfirmingDraft(a)}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50"
                            >
                              ส่งซ้ำ
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">เสร็จสิ้น</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Bottom Clarification Cards matching Appointments.dc.html */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-2">
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2.5 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-white">
            <Phone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>“บันทึกว่านัดทางโทรศัพท์แล้ว” คืออะไร</span>
          </div>
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            ของจริงเจ้าหน้าที่โทรนัดเองได้ และบางบริษัทไม่มีอีเมล · ปุ่มนี้บันทึกว่านัดหมายถูกยืนยันนอกระบบ เพื่อให้อาจารย์เห็นว่ามีนัดจริง <strong>ไม่ใช่การปลอมว่าบริษัทกดยืนยันในระบบ</strong> — สถานะที่บันทึกจึงต้องอ่านออกว่าเป็นการยืนยันนอกระบบ ไม่ใช่ป้ายเดียวกับที่บริษัทกดเอง
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2.5 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-white">
            <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>บันทึกข้อความขออนุมัติเดินทางไปราชการ</span>
          </div>
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            คู่มือกำหนดว่าอาจารย์ต้องได้รับอนุมัติเดินทางก่อนออกนิเทศ · ระบบออกเอกสารนี้ให้ได้แล้ว — ปุ่มอยู่ฝั่งอาจารย์ และเจ้าหน้าที่สั่งออกแทนได้จากที่นี่
          </p>
          <button
            type="button"
            onClick={() => setMemoModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50"
          >
            ออกบันทึกข้อความให้อาจารย์
          </button>
        </div>
      </div>

      {/* Confirm Send Email Dialog */}
      <ConfirmDialog
        open={confirmingDraft !== null}
        title="ยืนยันการส่งอีเมลนัดหมายนิเทศ"
        message={
          confirmingDraft
            ? `ส่งอีเมลนัดหมายนิเทศของ ${confirmingDraft.first_name} ${confirmingDraft.last_name} วันที่ ${formatThaiDate(confirmingDraft.appointment_date)} ไปยังพี่เลี้ยงที่ ${confirmingDraft.company_name}? อีเมลจะมีลิงก์ให้ตอบรับหรือขอเลื่อนนัด`
            : ''
        }
        confirmLabel="ตรวจแล้ว ส่งเลย"
        busy={sendingId !== null}
        onConfirm={handleSendEmail}
        onCancel={() => setConfirmingDraft(null)}
      />

      {/* Confirm Phone Bypass Dialog */}
      <ConfirmDialog
        open={bypassingDraft !== null}
        title="ยืนยันการบันทึกว่านัดทางโทรศัพท์แล้ว"
        message={
          bypassingDraft
            ? `บันทึกว่าได้รับการยืนยันวันนัดหมายนิเทศของ ${bypassingDraft.first_name} (${bypassingDraft.company_name}) ทางโทรศัพท์เรียบร้อยแล้วใช่หรือไม่? ระบบจะแสดงสถานะเป็น "ยืนยันนอกระบบ (โทรศัพท์)" เพื่อให้อาจารย์รับทราบ`
            : ''
        }
        confirmLabel="บันทึกว่านัดแล้ว (ยืนยันนอกระบบ)"
        busy={bypassingBusy}
        onConfirm={handleBypass}
        onCancel={() => setBypassingDraft(null)}
      />

      {/* Confirm Accept Reschedule Dialog */}
      <ConfirmDialog
        open={acceptingRescheduleDraft !== null}
        title="ยืนยันการรับวันนัดหมายใหม่"
        message={
          acceptingRescheduleDraft
            ? `ยอมรับวันนัดหมายใหม่ที่บริษัทขอเลื่อน (${acceptingRescheduleDraft.proposed_reschedule_date ? formatThaiDate(acceptingRescheduleDraft.proposed_reschedule_date) : 'วันใหม่'}) สำหรับนักศึกษา ${acceptingRescheduleDraft.first_name} ใช่หรือไม่?`
            : ''
        }
        confirmLabel="ยอมรับวันใหม่"
        busy={acceptingBusy}
        onConfirm={handleAcceptReschedule}
        onCancel={() => setAcceptingRescheduleDraft(null)}
      />

      {/* View Draft Modal */}
      {viewingDraft && (
        <Modal
          onClose={() => setViewingDraft(null)}
          title={`แบบร่างนัดหมายนิเทศ: ${viewingDraft.first_name} ${viewingDraft.last_name}`}
        >
          <ModalBody>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl">
                <div>
                  <span className="text-gray-600 dark:text-gray-400 block">นักศึกษา</span>
                  <span className="font-bold text-gray-800 dark:text-gray-100">
                    {viewingDraft.first_name} {viewingDraft.last_name} ({viewingDraft.student_code})
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400 block">สถานประกอบการ</span>
                  <span className="font-bold text-gray-800 dark:text-gray-100">
                    {viewingDraft.company_name}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400 block">วันนัดหมายที่เสนอ</span>
                  <span className="font-bold text-gray-800 dark:text-gray-100">
                    {formatThaiDate(viewingDraft.appointment_date)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400 block">เวลา</span>
                  <span className="font-bold text-gray-800 dark:text-gray-100">
                    {viewingDraft.mentor_time || viewingDraft.student_time || '10:00'} น.
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setViewingDraft(null)}
                  className="px-3 py-1.5 rounded-lg border font-semibold"
                >
                  ปิด
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = viewingDraft;
                    setViewingDraft(null);
                    setConfirmingDraft(d);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold"
                >
                  ตรวจแล้ว สั่งส่งอีเมล
                </button>
              </div>
            </div>
          </ModalBody>
        </Modal>
      )}

      {/* Travel Memo Helper Modal */}
      {memoModalOpen && (
        <Modal
          onClose={() => setMemoModalOpen(false)}
          title="ออกบันทึกข้อความขออนุมัติเดินทางไปราชการ"
        >
          <ModalBody>
            <div className="space-y-3 text-xs">
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                ระบบได้สร้างแบบฟอร์มขออนุมัติเดินทางไปราชการเพื่อการนิเทศสหกิจศึกษาตามระเบียบมหาวิทยาลัย อาจารย์สามารถกดขออนุมัติได้จากหน้า &quot;ติดตามการนิเทศ&quot; หรือเจ้าหน้าที่สามารถพิมพ์หนังสือบันทึกข้อความสรุปได้
              </p>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 rounded-xl">
                พร้อมพิมพ์หนังสือบันทึกข้อความรวมตามรอบการนิเทศประจำภาคการศึกษา
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setMemoModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
};

export default AppointmentAudit;
