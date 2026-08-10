import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';

const CoopApplicationForm: React.FC = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    semester_id: '',
    expected_region: '',
    special_skills: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/applications', {
        semester_id: formData.semester_id,
        expected_region: formData.expected_region,
        special_skills: formData.special_skills,
      });

      setSuccessMsg('Application submitted successfully.');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        
        {/* Header Section */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-semibold tracking-tighter text-gray-900 dark:text-gray-50">
            ใบสมัครเข้าร่วมโครงการสหกิจศึกษา
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Cooperative Education Application Form (System 1)
          </p>
        </div>

        {/* Form Container (Bento / Clean aesthetic) */}
        <div className="bg-white p-8 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800 rounded-2xl">
          
          <AlertBanner variant="error" message={errorMsg} className="mb-6" />
          
          <AlertBanner variant="success" message={successMsg} className="mb-6" />

          <form onSubmit={handleSubmit} className="space-y-8 divide-y divide-gray-200 dark:divide-gray-800/50">
            
            {/* Section 1: Academic Data */}
            <div className="pt-2">
              <h2 className="text-base font-medium leading-7 text-gray-900 dark:text-gray-100">
                ข้อมูลภาคการศึกษา
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-6">
                <div className="sm:col-span-3">
                  <label htmlFor="semester_id" className="block text-sm font-medium leading-6 text-gray-900 dark:text-gray-300">
                    เลือกรอบสหกิจศึกษา (Semester)
                  </label>
                  <div className="mt-2">
                    <select
                      id="semester_id"
                      name="semester_id"
                      value={formData.semester_id}
                      onChange={handleChange}
                      className="block w-full rounded-xl border-0 py-2.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-gray-900 dark:text-white dark:ring-gray-700"
                      required
                    >
                      <option value="">-- กรุณาเลือกรอบ --</option>
                      {/* TODO: Fetch from /api/semesters */}
                      <option value="1">ภาคเรียนที่ 1/2567</option>
                      <option value="2">ภาคเรียนที่ 2/2567</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Preferences */}
            <div className="pt-8">
              <h2 className="text-base font-medium leading-7 text-gray-900 dark:text-gray-100">
                ความประสงค์และทักษะ
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-6">
                
                <div className="col-span-full">
                  <label htmlFor="expected_region" className="block text-sm font-medium leading-6 text-gray-900 dark:text-gray-300">
                    ภูมิภาค/จังหวัด ที่ต้องการไปปฏิบัติงาน (ถ้ามี)
                  </label>
                  <div className="mt-2">
                    <input
                      type="text"
                      name="expected_region"
                      id="expected_region"
                      value={formData.expected_region}
                      onChange={handleChange}
                      placeholder="เช่น กรุงเทพมหานคร, ชลบุรี, ระยอง"
                      className="block w-full rounded-xl border-0 py-2.5 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-gray-900 dark:text-white dark:ring-gray-700"
                    />
                  </div>
                </div>

                <div className="col-span-full">
                  <label htmlFor="special_skills" className="block text-sm font-medium leading-6 text-gray-900 dark:text-gray-300">
                    ความสามารถพิเศษ (Special Skills)
                  </label>
                  <div className="mt-2">
                    <textarea
                      id="special_skills"
                      name="special_skills"
                      rows={3}
                      value={formData.special_skills}
                      onChange={handleChange}
                      placeholder="อธิบายทักษะที่โดดเด่น เช่น การเขียนโปรแกรม, ภาษาอังกฤษ, กราฟิกดีไซน์..."
                      className="block w-full rounded-xl border-0 py-2.5 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-gray-900 dark:text-white dark:ring-gray-700"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-8 flex items-center justify-end gap-x-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'กำลังบันทึก...' : 'ยื่นใบสมัคร'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CoopApplicationForm;
