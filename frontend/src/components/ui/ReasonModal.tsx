import React, { useState } from 'react';
import type { ReactNode } from 'react';
import Modal, { ModalBody, ModalFooter } from './Modal';
import Button from './Button';
import AlertBanner from './AlertBanner';
import { Textarea } from './Input';
import { getErrorMessage } from '../../utils/errors';

interface ReasonModalProps {
  title: string;
  /** บอกว่ากำลังทำกับของใคร — ชื่อนักศึกษา สถานประกอบการ เลขที่หนังสือ */
  intro: ReactNode;
  /** ข้อความใต้ช่องเหตุผล — บอกว่าเหตุผลนี้ใครจะได้อ่าน */
  hint?: ReactNode;
  submitLabel: string;
  /** `${testIdPrefix}-reason` ช่องเหตุผล · `${testIdPrefix}-submit` ปุ่มยืนยัน */
  testIdPrefix: string;
  /** โยน error = ข้อความขึ้น **ใน** กล่องนี้และกล่องไม่ปิด · สำเร็จ = ผู้เรียกปิดกล่องเอง */
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

/**
 * กล่องกรอกเหตุผลก่อนทำรายการที่ย้อนไม่ได้ง่ายๆ — ใช้ตอนตีกลับ/ดึงกลับหนังสือ (คณบดี · เจ้าหน้าที่)
 * เหตุผลบังคับ (ไม่ว่าง) · ข้อผิดพลาดแสดงในกล่อง ไม่ใช่แถบหลังกล่อง (กฎ UX ของโปรเจค)
 */
export const ReasonModal: React.FC<ReasonModalProps> = ({
  title,
  intro,
  hint,
  submitLabel,
  testIdPrefix,
  onSubmit,
  onClose,
}) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(getErrorMessage(err, 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} size="md" title={title} closeOnBackdrop={false}>
      <ModalBody>
        <div className="space-y-3">
          <AlertBanner variant="error" message={error} />
          <div className="text-sm text-gray-700 dark:text-gray-300">{intro}</div>
          <div>
            <label
              htmlFor={`${testIdPrefix}-reason`}
              className="mb-1 block text-sm font-bold text-gray-900 dark:text-gray-100"
            >
              เหตุผล
            </label>
            <Textarea
              id={`${testIdPrefix}-reason`}
              data-testid={`${testIdPrefix}-reason`}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {hint && <p className="mt-1 text-[13px] text-gray-600 dark:text-gray-400">{hint}</p>}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={!reason.trim()}
          data-testid={`${testIdPrefix}-submit`}
          onClick={submit}
        >
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ReasonModal;
