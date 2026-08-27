import React, { useEffect, useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import { Download, CheckSquare } from 'lucide-react';
import Modal, { ModalBody } from './ui/Modal';
import { statusText } from './ui/StatusBadge';

/**
 * ⛔ `currentRole` กับ `onSuccess` ถูกถอดออก 2026-08-27 — มันมีไว้ให้ปุ่มอนุมัติ/ตีกลับ
 *    ซึ่งไม่มีอยู่แล้ว โมดัลนี้อ่านอย่างเดียว ไม่เปลี่ยนสถานะอะไรทั้งนั้น
 */
interface IntentReviewModalProps {
  intentId: number | null;
  onClose: () => void;
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
  status: string;
}

const IntentReviewModal: React.FC<IntentReviewModalProps> = ({
  intentId,
  onClose,
}) => {
  const [modalLoading, setModalLoading] = useState(false);
  const [intentDetail, setIntentDetail] = useState<IntentDetail | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    const loadIntentDetail = async () => {
      if (intentId === null) {
        setIntentDetail(null);
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

  // ⛔ `handleIntentAction` ถูกลบ 2026-08-27 — มันยิง PATCH /intents/:id/status
  //    กับ /dept-head-status ซึ่งถูกถอดออกจาก backend แล้ว โมดัลนี้อ่านอย่างเดียว

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
            <span className="text-xs text-gray-600 dark:text-gray-400">กำลังโหลดรายละเอียด...</span>
          </div>
        ) : modalError ? (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl text-xs dark:bg-red-950/20 dark:text-red-400">
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
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">ชื่อ-นามสกุล:</span> {intentDetail.first_name || ''} {intentDetail.last_name || ''} ({intentDetail.nickname || 'ไม่มีชื่อเล่น'})</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">รหัสนักศึกษา:</span> {intentDetail.student_code}</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">ระดับชั้นปี:</span> ปีที่ {intentDetail.year_level || '-'}</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">เกรดเฉลี่ยสะสม (GPA):</span> <span className="font-bold text-brand-blue dark:text-blue-400">{intentDetail.cumulative_gpa ? Number(intentDetail.cumulative_gpa).toFixed(2) : '-'}</span></p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">เบอร์โทรศัพท์:</span> {intentDetail.student_phone || '-'}</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">อีเมลติดต่อสำรอง:</span> {intentDetail.alt_email || '-'}</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">ที่อยู่ติดต่อ:</span> {intentDetail.current_address || '-'}</p>
                  <p><span className="text-gray-600 dark:text-gray-400 font-medium">ผู้ปกครอง:</span> {intentDetail.parent_name || '-'} (เบอร์โทร: {intentDetail.parent_phone || '-'})</p>
                </div>
              </div>

              {/* Right: Company Placement & Documents */}
              <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-800 flex flex-col justify-between">
                <div className="space-y-2">
                  <h4 className="font-bold text-sm text-brand-navy dark:text-white border-b pb-1.5 dark:border-gray-700">
                    รายละเอียดสถานที่ปฏิบัติงาน
                  </h4>
                  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                    <p><span className="text-gray-600 dark:text-gray-400 font-medium">สถานประกอบการ:</span> {intentDetail.company_name_th}</p>
                    <p><span className="text-gray-600 dark:text-gray-400 font-medium">ตำแหน่งงาน:</span> {intentDetail.job_title || 'ฝึกงานทั่วไป'}</p>
                    <p><span className="text-gray-600 dark:text-gray-400 font-medium">ผู้ประสานงาน HR:</span> {intentDetail.company_contact_person || '-'}</p>
                    <p><span className="text-gray-600 dark:text-gray-400 font-medium">เบอร์ติดต่อบริษัท:</span> {intentDetail.company_phone || '-'}</p>
                    <p><span className="text-gray-600 dark:text-gray-400 font-medium">วันที่เริ่มฝึกงาน:</span> {intentDetail.start_date ? new Date(intentDetail.start_date).toLocaleDateString('th-TH') : '-'}</p>
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

            {/* ⛔ ปุ่ม อนุมัติ/ตีกลับ และแผงเลือกเหตุผล ถูกถอดออก 2026-08-27
                — **ห้ามเอากลับมา** การลงนามของอาจารย์ที่ปรึกษาและหัวหน้าสาขาอยู่บน
                กระดาษ (แบบคำร้อง เอกสารหมายเลข 1) ตั้งแต่ 2026-08-26 และ route ที่
                ปุ่มพวกนี้ยิง (`PATCH /intents/:id/status`, `/dept-head-status`) ถูกลบแล้ว
                กดไปก็ได้ 404 · โมดัลนี้เหลือหน้าที่เดียวคืออ่านข้อมูลคำร้อง */}
            <div className="flex flex-col gap-3 border-t pt-4 dark:border-gray-800 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                สถานะปัจจุบัน: {statusText(intentDetail.status, 'intent')}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="py-2 px-4 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-800 self-end sm:self-auto"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        ) : null}
      </ModalBody>
    </Modal>
  );
};

export default IntentReviewModal;
