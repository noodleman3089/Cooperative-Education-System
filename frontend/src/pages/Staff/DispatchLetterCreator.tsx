import React, { useState } from 'react';
import { useDashboardData } from '../../hooks/useDashboardData';
import PageSkeleton from '../../components/ui/Skeleton';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';

interface DispatchEligibleStudent {
  form_id: number;
  student_id: number;
  company_id: number;
  student_code: string;
  student_first_name: string;
  student_last_name: string;
  company_name_th: string;
  mentor_name: string | null;
  start_date: string | null;
}

const DispatchLetterCreator: React.FC = () => {
  const [students, setStudents] = useState<DispatchEligibleStudent[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [documentNumber, setDocumentNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchEligibleStudents = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const data = await api.get('/documents/dispatch-eligible');
      setStudents(data || []);
    } catch (err: any) {
      console.error('Failed to fetch eligible students:', err);
      if (!isBackground) setError(err.message || 'ไม่สามารถดึงข้อมูลนักศึกษาได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(fetchEligibleStudents);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedStudentIds(students.map(s => s.student_id));
    } else {
      setSelectedStudentIds([]);
    }
  };

  const handleSelectStudent = (studentId: number) => {
    setSelectedStudentIds(prev => 
      prev.includes(studentId) 
        ? prev.filter(id => id !== studentId) 
        : [...prev, studentId]
    );
  };

  const handleGenerate = async () => {
    if (selectedStudentIds.length === 0) {
      setError('กรุณาเลือกนักศึกษาอย่างน้อย 1 คน');
      return;
    }
    if (!documentNumber.trim()) {
      setError('กรุณากรอกเลขที่หนังสือส่งออก');
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);

      await api.post('/documents/generate-dispatch', {
        studentIds: selectedStudentIds,
        documentNumber: documentNumber.trim()
      });

      setSuccess('สร้างหนังสือส่งตัวสำเร็จ และได้ส่งเข้าระบบคณบดีเพื่อรอลงนามเรียบร้อยแล้ว');
      setDocumentNumber('');
      setSelectedStudentIds([]);
      await fetchEligibleStudents(); // Refresh the list
    } catch (err: any) {
      console.error('Failed to generate dispatch letters:', err);
      setError(err.message || 'เกิดข้อผิดพลาดในการสร้างหนังสือส่งตัว');
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="table" />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6 dark:text-gray-200">ออกหนังสือส่งตัวนักศึกษาสหกิจศึกษา (Dispatch Letters)</h1>

      <AlertBanner variant="error" message={error} className="mb-4" />

      <AlertBanner variant="success" message={success} className="mb-4" />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div className="w-full md:w-1/3">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
              เลขที่หนังสือส่งออก <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="เช่น ศธ 0584.09/123"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div>
            {/* Was a hand-rolled button whose base `text-white` fought the
                disabled branch's own text colour — two utilities for the same
                property, where the winner is decided by stylesheet order
                rather than by which one is written last. */}
            <Button
              onClick={handleGenerate}
              disabled={selectedStudentIds.length === 0}
              loading={isGenerating}
              loadingLabel="กำลังสร้างเอกสาร..."
            >
              {`สร้างหนังสือส่งตัว (${selectedStudentIds.length} รายการ)`}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200 dark:bg-gray-800 dark:border-gray-800 dark:text-gray-300">
              <tr>
                <th className="py-3 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={students.length > 0 && selectedStudentIds.length === students.length}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700"
                  />
                </th>
                <th className="py-3 px-4">รหัสนักศึกษา</th>
                <th className="py-3 px-4">ชื่อ-นามสกุล</th>
                <th className="py-3 px-4">สถานประกอบการ</th>
                <th className="py-3 px-4">วันเริ่มงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 px-6">
                    <div className="max-w-md mx-auto text-center">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900 mb-1 dark:text-white">ยังไม่มีนักศึกษาที่พร้อมออกหนังสือส่งตัวในขณะนี้</h3>
                      <p className="text-xs text-gray-500 mb-4 leading-relaxed dark:text-gray-400">
                        เมนูนี้นักศึกษาจะปรากฏขึ้นเมื่อผ่านกระบวนการตามลำดับ (Sequential Workflow) ครบทุกขั้นตอนแล้วเท่านั้น:
                      </p>
                      
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-left border border-gray-200 space-y-2 mb-4 dark:bg-gray-800 dark:border-gray-800">
                        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-300">
                          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                          <span>1. นักศึกษายื่นความจำนงสหกิจศึกษา</span>
                        </div>
                        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-300">
                          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">✓</span>
                          <span>2. อาจารย์ที่ปรึกษาพิจารณาอนุมัติ</span>
                        </div>
                        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-300">
                          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">✓</span>
                          <span>3. หัวหน้าสาขาวิชาพิจารณาอนุมัติ</span>
                        </div>
                        <div className="flex items-center space-x-2 text-amber-700 font-medium dark:text-amber-400">
                          <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400 flex items-center justify-center font-bold text-xs">!</span>
                          <span>4. สถานประกอบการตอบรับ (สถานะ: accepted)</span>
                        </div>
                      </div>

                      <p className="text-xs text-gray-400">
                        * เมื่อมีนักศึกษาถึงขั้นตอนที่ 4 รายชื่อจะปรากฏในหน้านี้ให้ออกหนังสือส่งตัวทันที
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.student_id} className="hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors">
                    <td className="py-3 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.includes(student.student_id)}
                        onChange={() => handleSelectStudent(student.student_id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700"
                      />
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{student.student_code}</td>
                    <td className="py-3 px-4">{student.student_first_name} {student.student_last_name}</td>
                    <td className="py-3 px-4">{student.company_name_th}</td>
                    <td className="py-3 px-4">
                      {student.start_date ? new Date(student.start_date).toLocaleDateString('th-TH') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DispatchLetterCreator;
