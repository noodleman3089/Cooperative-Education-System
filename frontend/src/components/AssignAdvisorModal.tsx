import React, { useState, useEffect } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import { Select } from './ui/Input';
import type { StudentProfile } from '../types/api';

interface Personnel {
  personnel_id: number;
  email: string;
  major_id: number;
  status: string;
  first_name?: string | null;
  last_name?: string | null;
}

const studentDisplayName = (s: { first_name?: string | null; last_name?: string | null; student_code?: string }): string =>
  [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.student_code || 'ไม่ระบุชื่อ';

const advisorLabel = (p: Personnel): string => {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name ? `${name} (${p.email})` : p.email;
};

interface AssignAdvisorModalProps {
  isOpen: boolean;
  isSingleEdit: boolean;
  selectedStudentIds: number[];
  advisors: Personnel[];
  students: StudentProfile[];
  advisorLoads: Map<number, { advisor: number; supervisor: number }>;
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
  students,
  advisorLoads,
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
        supervisor_id: Number(selectedSupervisorId),
      });

      onSuccess(`กำหนดอาจารย์สำหรับนักศึกษาจำนวน ${selectedStudentIds.length} คนสำเร็จแล้ว`);
    } catch (err) {
      setError(getErrorMessage(err, 'การกำหนดอาจารย์ที่ปรึกษาและนิเทศล้มเหลว'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const targetStudents = students.filter(s => selectedStudentIds.includes(s.student_id));
  const singleStudent = isSingleEdit && targetStudents.length === 1 ? targetStudents[0] : null;

  const modalTitle = singleStudent
    ? `กำหนดอาจารย์ผู้รับผิดชอบ: ${studentDisplayName(singleStudent)}`
    : `กำหนดอาจารย์ผู้รับผิดชอบ ${selectedStudentIds.length} คน`;

  const renderSubtitle = () => {
    if (singleStudent) {
      return (
        <span className="text-xs text-gray-600 dark:text-gray-400 block mb-4">
          รหัสนักศึกษา: {singleStudent.student_code} — ค่าที่มีอยู่แล้วจะถูกแทนที่
        </span>
      );
    }
    if (targetStudents.length <= 5 && targetStudents.length > 0) {
      return (
        <span className="text-xs text-gray-600 dark:text-gray-400 block mb-4">
          {targetStudents.map(s => studentDisplayName(s)).join(' · ')} — ค่าที่มีอยู่แล้วของทั้ง {targetStudents.length} คนจะถูกแทนที่
        </span>
      );
    }
    return (
      <span className="text-xs text-gray-600 dark:text-gray-400 block mb-4">
        นักศึกษาที่เลือก {selectedStudentIds.length} คน — ค่าที่มีอยู่แล้วของทุกคนจะถูกแทนที่
      </span>
    );
  };

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={modalTitle}
    >
      <ModalBody>
        {renderSubtitle()}

        <AlertBanner variant="error" message={error} className="mb-4" />

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1">
              อาจารย์ที่ปรึกษา *
            </label>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-1.5">
              เห็นชอบโครงร่าง (สหกิจ 11) · ตรวจรับเล่ม · ลงนาม สหกิจ 14
            </p>
            <Select
              value={selectedAdvisorId}
              onChange={(e) => setSelectedAdvisorId(e.target.value !== '' ? Number(e.target.value) : '')}
            >
              <option value="">-- กรุณาเลือกอาจารย์ที่ปรึกษา --</option>
              {advisors.map((adv) => {
                const load = advisorLoads.get(adv.personnel_id) || { advisor: 0, supervisor: 0 };
                return (
                  <option key={adv.personnel_id} value={adv.personnel_id}>
                    {advisorLabel(adv)} (ที่ปรึกษา {load.advisor} · นิเทศ {load.supervisor})
                  </option>
                );
              })}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1">
              อาจารย์นิเทศ *
            </label>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-1.5">
              นัดนิเทศ (สหกิจ 12) · บันทึกการนิเทศ (สหกิจ 13) · อาจารย์คนนี้จะเห็นเมนูฝ่ายนิเทศหลังเข้าระบบใหม่
            </p>
            <Select
              value={selectedSupervisorId}
              onChange={(e) => setSelectedSupervisorId(e.target.value !== '' ? Number(e.target.value) : '')}
            >
              <option value="">-- กรุณาเลือกอาจารย์นิเทศ --</option>
              {advisors.map((sup) => {
                const load = advisorLoads.get(sup.personnel_id) || { advisor: 0, supervisor: 0 };
                return (
                  <option key={sup.personnel_id} value={sup.personnel_id}>
                    {advisorLabel(sup)} (ที่ปรึกษา {load.advisor} · นิเทศ {load.supervisor})
                  </option>
                );
              })}
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

