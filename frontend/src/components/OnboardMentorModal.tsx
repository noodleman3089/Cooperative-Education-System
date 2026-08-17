import React, { useState, useEffect } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import { Input } from './ui/Input';

/** Today as YYYY-MM-DD. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};

interface OnboardMentorModalProps {
  isOpen: boolean;
  intentId: number | null;
  /** Who is being taken on — the dialog never said, and the table has many rows. */
  studentLabel?: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const OnboardMentorModal: React.FC<OnboardMentorModalProps> = ({
  isOpen,
  intentId,
  studentLabel,
  onClose,
  onSuccess,
}) => {
  const [mentorName, setMentorName] = useState('');
  const [mentorEmail, setMentorEmail] = useState('');
  const [mentorPhone, setMentorPhone] = useState('');
  const [mentorPosition, setMentorPosition] = useState('');
  const [mentorDepartment, setMentorDepartment] = useState('');
  const [startDate, setStartDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMentorName('');
      setMentorEmail('');
      setMentorPhone('');
      setMentorPosition('');
      setMentorDepartment('');
      setStartDate('');
      setError(null);
    }
  }, [isOpen]);

  const handleAcceptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (intentId === null) return;

    if (!mentorName || !mentorEmail || !mentorPhone || !mentorPosition || !mentorDepartment || !startDate) {
      setError('กรุณากรอกข้อมูลผู้ควบคุมดูแลและวันเริ่มงานให้ครบถ้วน');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.patch(`/acceptances/company/${intentId}/status`, {
        status: 'accepted',
        name: mentorName,
        email: mentorEmail,
        phone: mentorPhone,
        position: mentorPosition,
        department: mentorDepartment,
        start_date: startDate
      });
      onSuccess('ยืนยันตอบรับนักศึกษาเข้าฝึกปฏิบัติงานสหกิจเรียบร้อยแล้ว');
    } catch (err) {
      console.error('Accept applicant error:', err);
      setError(getErrorMessage(err, 'การตอบรับใบสมัครงานล้มเหลว'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    // A form the user has typed into: a stray backdrop click must not discard it.
    <Modal onClose={onClose} size="lg" closeOnBackdrop={false} title="ระบุข้อมูลพี่เลี้ยงดูแลรับนักศึกษา (Mentor Details)">
      <ModalBody>
        <AlertBanner variant="error" message={error} className="mb-4" />

        {studentLabel && (
          <p className="mb-4 text-xs text-gray-600 dark:text-gray-300">
            กำลังตอบรับนักศึกษา:{' '}
            <span className="font-bold text-gray-800 dark:text-gray-100">{studentLabel}</span>
          </p>
        )}

        <form onSubmit={handleAcceptSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อ-นามสกุล พี่เลี้ยงฝึกงาน
              </label>
              <Input
                type="text"
                required
                value={mentorName}
                onChange={(e) => setMentorName(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                อีเมลพี่เลี้ยง
              </label>
              <Input
                type="email"
                required
                value={mentorEmail}
                onChange={(e) => setMentorEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                เบอร์โทรศัพท์ติดต่อ
              </label>
              <Input
                type="text"
                required
                value={mentorPhone}
                onChange={(e) => setMentorPhone(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                ตำแหน่งงานพี่เลี้ยง
              </label>
              <Input
                type="text"
                required
                value={mentorPosition}
                onChange={(e) => setMentorPosition(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                แผนก/ฝ่ายสังกัด
              </label>
              <Input
                type="text"
                required
                value={mentorDepartment}
                onChange={(e) => setMentorDepartment(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium text-gray-500 dark:text-gray-400 mb-1">
                วันที่เริ่มฝึกงาน (Start Date)
              </label>
              {/* The placement has not happened yet, so a start date before
                  today is a typo rather than a choice. */}
              <Input
                type="date"
                required
                min={todayIso()}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-gray-100 dark:border-gray-800 mt-6">
            <Button variant="secondary" size="sm" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={isSubmitting}
              loadingLabel="กำลังตอบรับ..."
            >
              ตอบรับและบันทึกข้อมูลพี่เลี้ยง
            </Button>
          </div>
        </form>
      </ModalBody>
    </Modal>
  );
};

export default OnboardMentorModal;
