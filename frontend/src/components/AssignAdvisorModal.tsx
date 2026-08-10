import React, { useState, useEffect } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
}

interface AssignAdvisorModalProps {
  isOpen: boolean;
  isSingleEdit: boolean;
  selectedStudentIds: number[];
  advisors: Personnel[];
  initialAdvisorId: number | '';
  initialSupervisorId: number | '';
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const AssignAdvisorModal: React.FC<AssignAdvisorModalProps> = ({
  isOpen,
  isSingleEdit,
  selectedStudentIds,
  advisors,
  initialAdvisorId,
  initialSupervisorId,
  onClose,
  onSuccess,
}) => {
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<number | ''>('');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedAdvisorId(initialAdvisorId);
      setSelectedSupervisorId(initialSupervisorId);
      setError(null);
    }
  }, [isOpen, initialAdvisorId, initialSupervisorId]);

  const handleAssignSubmit = async () => {
    if (selectedAdvisorId === '' || selectedSupervisorId === '') {
      setError('กรุณามอบหมายอาจารย์ให้ครบทั้ง 2 ตำแหน่ง');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.put(`/students/batch-assign-personnel`, {
        studentIds: selectedStudentIds,
        advisor_id: Number(selectedAdvisorId),
        supervisor_id: Number(selectedSupervisorId)
      });

      onSuccess(`กำหนดอาจารย์สำหรับนักศึกษาจำนวน ${selectedStudentIds.length} คนสำเร็จแล้ว`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'การกำหนดอาจารย์ที่ปรึกษาและนิเทศล้มเหลว');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={isSingleEdit ? 'สลับปรับเปลี่ยนผู้รับผิดชอบรายบุคคล' : 'กำหนดอาจารย์ผู้รับผิดชอบแบบกลุ่ม'}
    >
      <ModalBody>
        <p className="text-xs text-gray-400 mb-4">
          ดำเนินการกำหนดอาจารย์ที่ปรึกษาสหกิจ และอาจารย์ผู้นิเทศตรวจงาน ให้กับนักศึกษาที่เลือก (จำนวน {selectedStudentIds.length} คน)
        </p>

        <AlertBanner variant="error" message={error} className="mb-4" />

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              อาจารย์ที่ปรึกษาสหกิจ (Advisor) *
            </label>
            <select
              value={selectedAdvisorId}
              onChange={(e) => setSelectedAdvisorId(e.target.value !== '' ? Number(e.target.value) : '')}
              className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            >
              <option value="">-- กรุณาเลือกอาจารย์ที่ปรึกษา --</option>
              {advisors.map((adv) => (
                <option key={adv.personnel_id} value={adv.personnel_id}>
                  {adv.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              อาจารย์นิเทศสหกิจ (Supervisor) *
            </label>
            <select
              value={selectedSupervisorId}
              onChange={(e) => setSelectedSupervisorId(e.target.value !== '' ? Number(e.target.value) : '')}
              className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            >
              <option value="">-- กรุณาเลือกอาจารย์นิเทศ --</option>
              {advisors.map((sup) => (
                <option key={sup.personnel_id} value={sup.personnel_id}>
                  {sup.email}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          size="sm"
          onClick={handleAssignSubmit}
          loading={isSubmitting}
          loadingLabel="กำลังบันทึก..."
        >
          บันทึกการจัดสรร
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AssignAdvisorModal;
