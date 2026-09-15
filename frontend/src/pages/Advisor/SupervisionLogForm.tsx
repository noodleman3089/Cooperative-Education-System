import React, { useState } from 'react';
import api from '../../services/api';
import { X, Upload, Save, Send } from 'lucide-react';
import { useAutoSave } from '../../hooks/useAutoSave';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { getErrorMessage } from '../../utils/errors';
import { Textarea } from '../../components/ui/Input';

interface SupervisionLogFormProps {
  appointmentId: number;
  onClose: () => void;
  onSuccess: () => void;
}

const SupervisionLogForm: React.FC<SupervisionLogFormProps> = ({ appointmentId, onClose, onSuccess }) => {
  const [formData, setFormData, clearDraft] = useAutoSave(`supervision_draft_${appointmentId}`, {
    preliminaryScore: 0,
    behaviorNotes: ''
  });

  const [photos, setPhotos] = useState<File[]>([]);
  
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (photos.length + newFiles.length > 5) {
        setError('อัปโหลดรูปได้สูงสุด 5 รูปเท่านั้น');
        return;
      }
      
      const oversizedFiles = newFiles.filter(file => file.size > 5 * 1024 * 1024);
      if (oversizedFiles.length > 0) {
        setError('มีไฟล์รูปภาพขนาดเกิน 5MB กรุณาเลือกไฟล์ใหม่');
        return;
      }

      setPhotos([...photos, ...newFiles]);
    }
  };

  const removePhoto = (index: number) => {
    const newPhotos = [...photos];
    newPhotos.splice(index, 1);
    setPhotos(newPhotos);
  };

  const saveToApi = async (status: 'draft' | 'submitted') => {
    if (status === 'submitted' && formData.preliminaryScore === 0) {
      setError('กรุณาให้คะแนนประเมินเบื้องต้นก่อนส่ง');
      return;
    }

    try {
      if (status === 'draft') setSaving(true);
      else setSubmitting(true);
      setError(null);

      let evidence_photos: string[] = [];

      // 1. Upload photos first if there are any
      if (photos.length > 0) {
        const formDataUpload = new FormData();
        photos.forEach(p => formDataUpload.append('photos', p));
        
        const uploadRes = await api.post('/supervision-logs/upload-evidence', formDataUpload);
        evidence_photos = uploadRes.data?.file_paths || [];
      }

      // 2. Save Log
      await api.post('/supervision-logs', {
        appointment_id: appointmentId,
        preliminary_score: formData.preliminaryScore,
        behavior_notes: formData.behaviorNotes,
        evidence_photos,
        status
      });

      // Clear local storage
      clearDraft();
      
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} size="2xl" closeOnBackdrop={false} title="บันทึกผลการนิเทศนักศึกษา">
        <ModalBody className="space-y-6">
          <AlertBanner variant="error" message={error} />

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">คะแนนประเมินเบื้องต้น (1-100)</label>
            <input 
              type="number" 
              min="0" max="100"
              value={formData.preliminaryScore || ''}
              onChange={e => setFormData({ ...formData, preliminaryScore: Number(e.target.value) })}
              className="w-32 px-4 py-2 text-xl font-semibold text-center rounded-xl border border-gray-200 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">บันทึกพฤติกรรมนักศึกษา / ปัญหาที่พบ</label>
            <Textarea 
              rows={4}
              value={formData.behaviorNotes}
              onChange={e => setFormData({ ...formData, behaviorNotes: e.target.value })}
              placeholder="ระบุพฤติกรรมการทำงาน ความตรงต่อเวลา ปัญหาที่พี่เลี้ยงฝากแจ้ง..."
              className="resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">อัปโหลดรูปภาพขณะนิเทศ (สูงสุด 5 รูป)</label>
            <div className="flex flex-wrap gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="relative w-24 h-24 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden group">
                  <img src={URL.createObjectURL(photo)} alt="preview" className="w-full h-full object-cover" />
                  <button 
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white p-1 rounded-full transition-colors cursor-pointer"
                    title="ลบรูปภาพ"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              {photos.length < 5 && (
                <label className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-gray-500 dark:text-gray-400">
                  <Upload className="w-6 h-6 mb-1" />
                  <span className="text-xs">เพิ่มรูปภาพ</span>
                  <input type="file" multiple accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2 dark:text-gray-400">รูปถ่ายคู่กับนักศึกษา หรือบรรยากาศการทำงาน (ขนาดไฟล์ละไม่เกิน 5MB)</p>
          </div>
        </ModalBody>

        <ModalFooter className="justify-between">
          <Button
            variant="secondary"
            onClick={() => saveToApi('draft')}
            disabled={submitting}
            loading={saving}
            loadingLabel="บันทึกแบบร่าง (Draft)"
            icon={<Save className="w-4 h-4" />}
          >
            บันทึกแบบร่าง (Draft)
          </Button>

          <Button
            onClick={() => saveToApi('submitted')}
            disabled={saving}
            loading={submitting}
            loadingLabel="ส่งผลประเมินนิเทศ (Submit)"
            icon={<Send className="w-4 h-4" />}
          >
            ส่งผลประเมินนิเทศ (Submit)
          </Button>
        </ModalFooter>
    </Modal>
  );
};

export default SupervisionLogForm;
