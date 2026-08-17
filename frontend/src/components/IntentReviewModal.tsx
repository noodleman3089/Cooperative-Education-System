import React, { useEffect, useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import { Download, CheckSquare } from 'lucide-react';
import Modal, { ModalBody } from './ui/Modal';
import { statusText } from './ui/StatusBadge';
import { getErrorMessage } from '../utils/errors';

interface IntentReviewModalProps {
  intentId: number | null;
  onClose: () => void;
  currentRole: string;
  onSuccess: () => void;
}

/**
 * รายละเอียดใบความจำนงหนึ่งใบ ตามที่ `GET /intents/:id` ส่งกลับมา
 * (endpoint นี้จงใจไม่ส่งข้อมูลส่วนตัวให้ role ที่ไม่ควรเห็น — ดู SEC-10)
 */
interface IntentDetail {
  form_id?: number;
  student_id?: number;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  year_level?: number | null;
  cumulative_gpa?: number | string | null;
  student_phone?: string | null;
  alt_email?: string | null;
  current_address?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  company_name_th?: string | null;
  company_contact_person?: string | null;
  company_phone?: string | null;
  job_title?: string | null;
  start_date?: string | null;
  status?: string;
}

const IntentReviewModal: React.FC<IntentReviewModalProps> = ({
  intentId,
  onClose,
  currentRole,
  onSuccess,
}) => {
  const [modalLoading, setModalLoading] = useState(false);
  const [intentDetail, setIntentDetail] = useState<IntentDetail | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    const loadIntentDetail = async () => {
      if (intentId === null) {
        setIntentDetail(null);
        setIsRejecting(false);
        setRejectReason('');
        setCustomReason('');
        setModalError(null);
        return;
      }

      setModalLoading(true);
      setModalError(null);
      try {
        const res = await api.get(`/intents/${intentId}`);
        setIntentDetail(res);
      } catch (err) {
        console.error('Failed to load intent detail:', err);
        setModalError('ไม่สามารถโหลดรายละเอียดใบความจำนงได้');
      } finally {
        setModalLoading(false);
      }
    };

    loadIntentDetail();
  }, [intentId]);

  const handleIntentAction = async (status: string, reasonText?: string) => {
    if (!intentId) return;
    setActionLoading(true);
    setModalError(null);
    try {
      if (currentRole === 'advisor') {
        await api.patch(`/intents/${intentId}/status`, {
          status,
          reason: reasonText,
        });
      } else if (currentRole === 'dept_head') {
        const finalStatus = status === 'approved_by_advisor' ? 'approved_by_dept_head' : 'rejected_by_dept_head';
        await api.patch(`/intents/${intentId}/dept-head-status`, {
          status: finalStatus,
          reason: reasonText,
        });
      }
      onSuccess();
    } catch (err) {
      setModalError(getErrorMessage(err, 'การบันทึกสถานะล้มเหลว'));
    } finally {
      setActionLoading(false);
    }
  };

  if (intentId === null) return null;

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      title={
        <span className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-brand-blue shrink-0 dark:text-blue-400" />
          ตรวจทานคำร้องขอปฏิบัติงานสหกิจศึกษา
        </span>
      }
    >
      <ModalBody>
        {modalLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"></div>
            <span className="text-xs text-gray-400">กำลังโหลดรายละเอียด...</span>
          </div>
        ) : modalError ? (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl text-xs dark:bg-red-950/20 dark:text-red-400">
            {modalError}
          </div>
        ) : intentDetail ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Student Personal & Contact Info */}
              <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-800">
                <h4 className="font-bold text-sm text-brand-navy dark:text-white border-b pb-1.5 dark:border-gray-700">
                  ข้อมูลประวัตินักศึกษา
                </h4>
                <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                  <p><span className="text-gray-400 font-medium">ชื่อ-นามสกุล:</span> {intentDetail.first_name || ''} {intentDetail.last_name || ''} ({intentDetail.nickname || 'ไม่มีชื่อเล่น'})</p>
                  <p><span className="text-gray-400 font-medium">รหัสนักศึกษา:</span> {intentDetail.student_code}</p>
                  <p><span className="text-gray-400 font-medium">ระดับชั้นปี:</span> ปีที่ {intentDetail.year_level || '-'}</p>
                  <p><span className="text-gray-400 font-medium">เกรดเฉลี่ยสะสม (GPA):</span> <span className="font-bold text-brand-blue dark:text-blue-400">{intentDetail.cumulative_gpa ? Number(intentDetail.cumulative_gpa).toFixed(2) : '-'}</span></p>
                  <p><span className="text-gray-400 font-medium">เบอร์โทรศัพท์:</span> {intentDetail.student_phone || '-'}</p>
                  <p><span className="text-gray-400 font-medium">อีเมลติดต่อสำรอง:</span> {intentDetail.alt_email || '-'}</p>
                  <p><span className="text-gray-400 font-medium">ที่อยู่ติดต่อ:</span> {intentDetail.current_address || '-'}</p>
                  <p><span className="text-gray-400 font-medium">ผู้ปกครอง:</span> {intentDetail.parent_name || '-'} (เบอร์โทร: {intentDetail.parent_phone || '-'})</p>
                </div>
              </div>

              {/* Right: Company Placement & Documents */}
              <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-800 flex flex-col justify-between">
                <div className="space-y-2">
                  <h4 className="font-bold text-sm text-brand-navy dark:text-white border-b pb-1.5 dark:border-gray-700">
                    รายละเอียดสถานที่ปฏิบัติงาน
                  </h4>
                  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                    <p><span className="text-gray-400 font-medium">สถานประกอบการ:</span> {intentDetail.company_name_th}</p>
                    <p><span className="text-gray-400 font-medium">ตำแหน่งงาน:</span> {intentDetail.job_title || 'ฝึกงานทั่วไป'}</p>
                    <p><span className="text-gray-400 font-medium">ผู้ประสานงาน HR:</span> {intentDetail.company_contact_person || '-'}</p>
                    <p><span className="text-gray-400 font-medium">เบอร์ติดต่อบริษัท:</span> {intentDetail.company_phone || '-'}</p>
                    <p><span className="text-gray-400 font-medium">วันที่เริ่มฝึกงาน:</span> {intentDetail.start_date ? new Date(intentDetail.start_date).toLocaleDateString('th-TH') : '-'}</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t dark:border-gray-700">
                  <a
                    href={`${API_BASE_URL}/files/download/resumes/resume-user-${intentDetail.student_id}.pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg bg-blue-50 hover:bg-blue-100 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-900/40 font-bold transition-all text-xs border border-blue-100 dark:border-blue-900/50"
                  >
                    <Download className="h-4 w-4" />
                    เปิดอ่านหรือดาวน์โหลดเรซูเม่ (PDF)
                  </a>
                </div>
              </div>
            </div>

            {/* Rejection Input Section */}
            {isRejecting ? (
              <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl space-y-4">
                <h5 className="text-xs font-bold text-red-600 dark:text-red-400">ระบุสาเหตุที่ปฏิเสธ/ตีกลับคำร้อง</h5>
                <div className="space-y-3">
                  <div>
                    <select
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-full px-4 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    >
                      <option value="">-- กรุณาเลือกสาเหตุการปฏิเสธ --</option>
                      <option value="ตำแหน่งงานไม่ตรงกับสาขาวิชาที่เรียน">ตำแหน่งงานไม่ตรงกับสาขาวิชาที่เรียน</option>
                      <option value="สถานประกอบการไม่ผ่านเกณฑ์มาตรฐานของหลักสูตร">สถานประกอบการไม่ผ่านเกณฑ์มาตรฐานของหลักสูตร</option>
                      <option value="ข้อมูลประวัตินักศึกษาหรือเกรดไม่ถูกต้อง">ข้อมูลประวัตินักศึกษาหรือเกรดไม่ถูกต้อง</option>
                      <option value="other">ระบุเหตุผลอื่นๆ ด้วยตนเอง</option>
                    </select>
                  </div>

                  {rejectReason === 'other' && (
                    <textarea
                      rows={2}
                      placeholder="กรอกเหตุผลรายละเอียดที่จะตีกลับแจ้งไปยังนักศึกษา"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      className="w-full px-4 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                  )}

                  <div className="flex justify-end gap-2 text-xs">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => setIsRejecting(false)}
                      className="py-1.5 px-3 rounded-lg border border-gray-200 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-800"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || (!rejectReason || (rejectReason === 'other' && !customReason))}
                      onClick={() => handleIntentAction('rejected', rejectReason === 'other' ? customReason : rejectReason)}
                      className="py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50"
                    >
                      {actionLoading ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธคำขอ'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center border-t pt-4 dark:border-gray-800 text-xs">
                <div>
                  {intentDetail.status !== 'pending_advisor' && intentDetail.status !== 'approved_by_advisor' && (
                    <span className="text-gray-400">สถานะปัจจุบัน: {statusText(intentDetail.status)} (ผ่านกระบวนการแล้ว)</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="py-2 px-4 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-800"
                  >
                    ปิดหน้าต่าง
                  </button>

                  {/* Approval buttons depending on user role and intent status */}
                  {currentRole === 'advisor' && intentDetail.status === 'pending_advisor' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsRejecting(true)}
                        disabled={actionLoading}
                        className="py-2 px-4 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold border border-red-100"
                      >
                        ตีกลับคำขอ
                      </button>
                      <button
                        type="button"
                        onClick={() => handleIntentAction('approved_by_advisor')}
                        disabled={actionLoading}
                        className="py-2 px-4 rounded-lg bg-brand-blue hover:bg-blue-600 text-white font-bold"
                      >
                        อนุมัติคำขอ
                      </button>
                    </>
                  )}

                  {currentRole === 'dept_head' && intentDetail.status === 'approved_by_advisor' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsRejecting(true)}
                        disabled={actionLoading}
                        className="py-2 px-4 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold border border-red-100"
                      >
                        ตีกลับคำขอ (หัวหน้าภาค)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleIntentAction('approved_by_advisor')} // Triggers approved_by_dept_head in handleIntentAction
                        disabled={actionLoading}
                        className="py-2 px-4 rounded-lg bg-brand-blue hover:bg-blue-600 text-white font-bold"
                      >
                        อนุมัติคำขอ (หัวหน้าภาค)
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </ModalBody>
    </Modal>
  );
};

export default IntentReviewModal;
