import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import AlertBanner from './ui/AlertBanner';
import { Textarea } from './ui/Input';
import { formatThaiDate } from '../utils/thaiDate';

/** ต้องตรงกับ LATE_REASON_MIN_LENGTH ใน backend/src/controllers/intent.ts */
const MIN_LENGTH = 20;

interface LateReasonModalProps {
  /** วันสุดท้ายที่ยังยื่นได้ · null เมื่อระบบไม่รู้ (ปฏิทินโหลดไม่ขึ้น) */
  lateEndDate: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * ถามเหตุผลก่อนยื่นในช่วงผ่อนผัน
 *
 * ใช้กับหน้าที่ยื่นได้ด้วยการกดปุ่มเดียว (กระดานงาน) ส่วนหน้าที่เป็นฟอร์มอยู่แล้ว
 * (หาที่ฝึกเอง) ใส่ช่องเหตุผลไว้ในฟอร์มตรงๆ ดีกว่าเปิดกล่องซ้อน
 *
 * ข้อความที่พิมพ์ตรงนี้จะถูกวางลงบรรทัด "มีความประสงค์…เนื่องจาก…" ของบันทึกข้อความ
 * ที่ระบบพิมพ์ให้ ซึ่งเป็นสิ่งที่คณบดีอ่านจริง จึงบอกผู้ใช้ให้ชัดว่าเขียนให้ใครอ่าน
 */
const LateReasonModal: React.FC<LateReasonModalProps> = ({
  lateEndDate,
  submitting,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const remaining = MIN_LENGTH - reason.trim().length;

  return (
    <Modal onClose={onCancel} closeOnBackdrop={false} size="lg" title="การยื่นครั้งนี้นับเป็นการส่งช้า">
      <ModalBody className="space-y-4">
        <AlertBanner
          variant="warning"
          message={
            <>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Clock className="h-4 w-4" />
                เลยกำหนดปกติแล้ว แต่ยังอยู่ในช่วงผ่อนผัน
              </span>
              <br />
              {lateEndDate
                ? `ระบบยังรับการยื่นได้ถึงวันที่ ${formatThaiDate(lateEndDate)} `
                : 'ระบบยังรับการยื่นได้ '}
              โดยจะบันทึกว่าเป็นการส่งช้า และพิมพ์บันทึกข้อความชี้แจงเหตุผลให้พร้อมแบบคำร้อง
              เพื่อนำไปเสนออาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาตามขั้นตอน
            </>
          }
        />

        <div>
          <label
            htmlFor="late-reason"
            className="block text-sm font-medium text-gray-800 dark:text-gray-300"
          >
            เหตุผลที่ยื่นล่าช้า
          </label>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            เขียนด้วยคำของตัวเอง ข้อความนี้จะถูกพิมพ์ลงบันทึกข้อความที่เสนอถึงคณบดี
          </p>
          <Textarea
            id="late-reason"
            rows={5}
            className="mt-2"
            placeholder="เช่น ติดต่อสถานประกอบการหลายแห่งแล้วยังไม่ได้รับคำตอบภายในกำหนด จึงยื่นได้หลังวันปิดรับ"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {remaining > 0
              ? `พิมพ์อีกอย่างน้อย ${remaining} ตัวอักษร`
              : 'ความยาวเพียงพอแล้ว'}
          </p>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          ยกเลิก
        </Button>
        <Button onClick={() => onConfirm(reason.trim())} disabled={remaining > 0 || submitting}>
          {submitting ? 'กำลังส่ง...' : 'ยืนยันการยื่นแบบส่งช้า'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default LateReasonModal;
