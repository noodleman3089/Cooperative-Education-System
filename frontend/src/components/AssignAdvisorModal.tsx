import React, { useState, useEffect } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import { Select } from './ui/Input';

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
  first_name?: string | null;
  last_name?: string | null;
}

/**
 * These dropdowns are how a department head picks the person who will look
 * after a student, and they used to list nothing but email addresses.
 * The address stays as a secondary line — two advisors can share a surname.
 */
const advisorLabel = (p: Personnel): string => {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name ? `${name} (${p.email})` : p.email;
};

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
    } catch (err) {
      setError(getErrorMessage(err, 'การกำหนดอาจารย์ที่ปรึกษาและนิเทศล้มเหลว'));
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
            <Select
              value={selectedAdvisorId}
              onChange={(e) => setSelectedAdvisorId(e.target.value !== '' ? Number(e.target.value) : '')}
            >
              <option value="">-- กรุณาเลือกอาจารย์ที่ปรึกษา --</option>
              {advisors.map((adv) => (
                <option key={adv.personnel_id} value={adv.personnel_id}>
                  {advisorLabel(adv)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              อาจารย์นิเทศสหกิจ (Supervisor) *
            </label>
            <Select
              value={selectedSupervisorId}
              onChange={(e) => setSelectedSupervisorId(e.target.value !== '' ? Number(e.target.value) : '')}
            >
              <option value="">-- กรุณาเลือกอาจารย์นิเทศ --</option>
              {advisors.map((sup) => (
                <option key={sup.personnel_id} value={sup.personnel_id}>
                  {advisorLabel(sup)}
                </option>
              ))}
            </Select>
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
