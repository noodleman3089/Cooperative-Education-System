import React, { useState } from 'react';
import api from '../services/api';
import { UserCheck } from 'lucide-react';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';

/** เอกสารที่คณบดีกำลังเปิดดูก่อนลงนาม (แถวจาก /documents) */
export interface SignableDocument {
  doc_id?: number;
  type?: string;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name_th?: string | null;
}

interface DeanSignModalProps {
  docId: number | null;
  docDetail: SignableDocument | null;
  onClose: () => void;
  onSuccess: () => void;
}

const DeanSignModal: React.FC<DeanSignModalProps> = ({
  docId,
  docDetail,
  onClose,
  onSuccess,
}) => {
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const handleDeanSign = async () => {
    if (!docId) return;
    setActionLoading(true);
    setModalError(null);
    try {
      // ระบบวาดหนังสือใหม่พร้อมลายเซ็นให้เลย — ไม่มีเส้นทางเซ็นภายนอกแล้ว
      // (DocuSign ถูกถอดออกทั้งหมด 2026-08-26)
      await api.post('/documents/batch-sign', { doc_ids: [docId] });
      onSuccess();
    } catch (err) {
      setModalError(getErrorMessage(err, 'การลงนามเอกสารล้มเหลว'));
    } finally {
      setActionLoading(false);
    }
  };

  if (docId === null) return null;

  return (
    <Modal
      onClose={onClose}
      size="2xl"
      title={
        <span className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-brand-blue shrink-0 dark:text-blue-400" />
          ลงนามเอกสารสหกิจศึกษา (คณบดี)
        </span>
      }
    >
      <ModalBody>
        <AlertBanner variant="error" message={modalError} className="mb-4" />

        {docDetail ? (
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-800 text-xs space-y-2">
            <p><span className="text-gray-600 dark:text-gray-400 font-medium">รหัสนักศึกษา:</span> {docDetail.student_code}</p>
            <p><span className="text-gray-600 dark:text-gray-400 font-medium">ชื่อ-นามสกุล:</span> {docDetail.first_name || ''} {docDetail.last_name || ''}</p>
            <p><span className="text-gray-600 dark:text-gray-400 font-medium">สถานประกอบการ:</span> {docDetail.company_name_th}</p>
            <p><span className="text-gray-600 dark:text-gray-400 font-medium">ประเภทเอกสาร:</span> {docDetail.type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์รับนักศึกษา' : 'หนังสือส่งตัวนักศึกษา'}</p>
            <p><span className="text-gray-600 dark:text-gray-400 font-medium">สถานะ:</span> <span className="font-bold text-yellow-600 dark:text-yellow-400">รอการลงนาม (Dean Signature Pending)</span></p>
          </div>
        ) : (
          <div className="py-12 flex justify-center">
            <span className="text-xs text-gray-600 dark:text-gray-400">ไม่พบรายละเอียดเอกสาร</span>
          </div>
        )}
      </ModalBody>

      {docDetail && (
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            ปิดหน้าต่าง
          </Button>
          <Button
            variant="success"
            size="sm"
            loading={actionLoading}
            loadingLabel="กำลังลงนาม..."
            onClick={handleDeanSign}
          >
            ลงนามเอกสารนี้
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
};

export default DeanSignModal;
