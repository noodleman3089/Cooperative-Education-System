import React, { useState } from 'react';
import api from '../services/api';
import type { StudentProfile } from '../types/api';
import AlertBanner from './ui/AlertBanner';
import { getErrorMessage } from '../utils/errors';
import { Select, Textarea } from './ui/Input';
import { JOB_TYPE_OPTIONS, WORK_REGION_OPTIONS } from '../config/studentInterests';

interface StudentProfileExtraProps {
  profile: StudentProfile;
  onProfileUpdated: () => void;
}

interface LanguageItem {
  language: string;
  level: string;
}

const StudentProfileExtra: React.FC<StudentProfileExtraProps> = ({ profile, onProfileUpdated }) => {
  const [skillsAndActivities, setSkillsAndActivities] = useState(profile.skills_and_activities || '');
  
  const [languages, setLanguages] = useState<LanguageItem[]>(
    profile.language_proficiency ? (profile.language_proficiency as LanguageItem[]) : []
  );
  
  const [preferredRegion, setPreferredRegion] = useState(profile.preferred_work_region || '');
  
  const [jobTypes, setJobTypes] = useState<string[]>(
    profile.interested_job_types ? (profile.interested_job_types as string[]) : []
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⛔ รายการอยู่ที่ `config/studentInterests.ts` ที่เดียว — ก๊อปเดิมของไฟล์นี้มีค่าเท่ากัน
  //    แต่ **เรียงคนละลำดับ** กับหน้าโปรไฟล์ ผู้ใช้จึงเห็นสองหน้าไม่เหมือนกันโดยไม่มีเหตุผล
  const regionOptions = WORK_REGION_OPTIONS;
  const jobTypeOptions = JOB_TYPE_OPTIONS;

  const handleAddLanguage = () => {
    setLanguages([...languages, { language: '', level: 'พอใช้' }]);
  };

  const handleLanguageChange = (index: number, field: keyof LanguageItem, value: string) => {
    const updated = [...languages];
    updated[index][field] = value;
    setLanguages(updated);
  };

  const handleRemoveLanguage = (index: number) => {
    const updated = [...languages];
    updated.splice(index, 1);
    setLanguages(updated);
  };

  const handleJobTypeToggle = (type: string) => {
    if (jobTypes.includes(type)) {
      setJobTypes(jobTypes.filter(t => t !== type));
    } else {
      setJobTypes([...jobTypes, type]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSuccessMessage(null);
    setError(null);

    // Clean up empty language entries
    const cleanedLanguages = languages.filter(l => l.language.trim() !== '');

    try {
      await api.put('/profile/student/optional', {
        skills_and_activities: skillsAndActivities,
        language_proficiency: cleanedLanguages.length > 0 ? cleanedLanguages : null,
        preferred_work_region: preferredRegion || null,
        interested_job_types: jobTypes.length > 0 ? jobTypes : null
      });
      setSuccessMessage('บันทึกข้อมูลส่วนเสริมเรียบร้อยแล้ว');
      onProfileUpdated();
    } catch (err) {
      console.error('Update extra profile error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-2xl border border-blue-100 shadow-sm mt-8 dark:bg-gray-900 dark:border-gray-800">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-brand-blue dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
          </svg>
          ข้อมูลส่วนเสริม (Optional)
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          ข้อมูลในส่วนนี้ไม่บังคับ แต่จะเป็นประโยชน์อย่างมากในการใช้พิจารณาหาตำแหน่งงานและสถานประกอบการที่เหมาะสมกับคุณ
        </p>
      </div>

      <AlertBanner variant="success" message={successMessage} className="mb-4" />

      <AlertBanner variant="error" message={error} className="mb-4" />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ความสามารถพิเศษ */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
            ความสามารถพิเศษ / กิจกรรมที่เคยทำ
          </label>
          <Textarea
            rows={3}
            disabled={isSubmitting}
            placeholder="เช่น ทักษะการเขียนโปรแกรมเฉพาะทาง, การเป็นผู้นำค่าย, การเล่นดนตรี, รางวัลที่เคยได้รับ"
            value={skillsAndActivities}
            onChange={(e) => setSkillsAndActivities(e.target.value)}
            className="resize-none"
          />
        </div>

        {/* ภาษา */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-3">
            ทักษะภาษาต่างประเทศ
          </label>
          
          <div className="space-y-3 mb-3">
            {languages.map((lang, index) => (
              <div key={index} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="เช่น ภาษาอังกฤษ, ภาษาญี่ปุ่น"
                  value={lang.language}
                  onChange={(e) => handleLanguageChange(index, 'language', e.target.value)}
                  className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
                <Select
                  value={lang.level}
                  onChange={(e) => handleLanguageChange(index, 'level', e.target.value)}
                  className="sm:w-40"
                >
                  <option value="ดีมาก">ดีมาก (Excellent)</option>
                  <option value="ดี">ดี (Good)</option>
                  <option value="พอใช้">พอใช้ (Fair)</option>
                  <option value="พื้นฐาน">พื้นฐาน (Basic)</option>
                </Select>
                <button
                  type="button"
                  onClick={() => handleRemoveLanguage(index)}
                  className="text-red-500 hover:text-red-700 px-2 flex items-center justify-center text-sm font-bold"
                >
                  ลบ
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddLanguage}
            className="text-xs font-bold text-brand-blue hover:text-blue-700 flex items-center gap-1 dark:text-blue-400"
          >
            + เพิ่มทักษะภาษา
          </button>
        </div>

        {/* ภูมิภาคที่สนใจ */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
            ภูมิภาคที่สนใจไปปฏิบัติงานสหกิจศึกษา
          </label>
          <Select
            disabled={isSubmitting}
            value={preferredRegion}
            onChange={(e) => setPreferredRegion(e.target.value)}
            className="sm:w-1/2"
          >
            <option value="">-- ไม่ระบุ --</option>
            {regionOptions.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </Select>
        </div>

        {/* ลักษณะงานที่สนใจ */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-3">
            ลักษณะงานที่สนใจ (เลือกได้มากกว่า 1 ข้อ)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {jobTypeOptions.map((type) => (
              <label key={type} className="flex items-start gap-2 cursor-pointer group">
                <div className="relative flex items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={jobTypes.includes(type)}
                    onChange={() => handleJobTypeToggle(type)}
                    className="w-4 h-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                  />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200">
                  {type}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="py-2.5 px-6 rounded-xl bg-gray-900 hover:bg-black text-white font-bold text-xs transition-all shadow-md disabled:opacity-50 dark:bg-brand-blue dark:hover:bg-blue-600"
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูลส่วนเสริม'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default StudentProfileExtra;
