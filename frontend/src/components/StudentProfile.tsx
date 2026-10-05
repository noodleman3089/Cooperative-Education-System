import React, { useEffect, useRef, useState } from 'react';
import PageSkeleton from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile as StudentType, LanguageProficiency } from '../types/api';
import ResumePdfModal from './ResumePdfModal';
import AlertBanner from './ui/AlertBanner';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import {
  JOB_TYPE_OPTIONS,
  WORK_REGION_OPTIONS,
  getRecommendedJobTypes,
} from '../config/studentInterests';
import { FileText, Upload, Eye, Download } from 'lucide-react';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
}

const StudentProfile: React.FC = () => {
  const [profile, setProfile] = useState<StudentType | null>(null);
  const [majors, setMajors] = useState<Major[]>([]);

  // Base profile fields
  const [studentCode, setStudentCode] = useState('');
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [yearLevel, setYearLevel] = useState<number | ''>(4);
  const [section, setSection] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [altEmail, setAltEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');

  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [enrollmentYear, setEnrollmentYear] = useState<number | ''>('');
  const [cumulativeGpa, setCumulativeGpa] = useState<string>('');

  // Career & Work Preferences
  const [skillsAndActivities, setSkillsAndActivities] = useState('');
  const [preferredRegion, setPreferredRegion] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [showAllJobTypes, setShowAllJobTypes] = useState(false);

  // Language proficiency (English)
  const [engReading, setEngReading] = useState('ดี');
  const [engSpeaking, setEngSpeaking] = useState('พอใช้');
  const [engWriting, setEngWriting] = useState('ดี');

  // Profile Avatar & Resume File States
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [storedAvatar, setStoredAvatar] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);

  // Status & Submit States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const alertRef = useRef<HTMLDivElement>(null);

  const regionOptions = WORK_REGION_OPTIONS;
  const jobTypeOptions = JOB_TYPE_OPTIONS;

  const currentMajor = majors.find((m) => m.major_id === selectedMajorId);
  const majorIdentifier =
    currentMajor?.major_code ||
    profile?.major_code ||
    currentMajor?.major_name_th ||
    profile?.major_name_th ||
    '';
  const recommendedTypes = getRecommendedJobTypes(majorIdentifier);

  const visibleJobTypes =
    recommendedTypes.length > 0 && !showAllJobTypes
      ? Array.from(new Set([...recommendedTypes, ...jobTypes]))
      : jobTypeOptions;

  const loadProfile = async () => {
    try {
      setLoading(true);
      const [profileResult, masterResult] = await Promise.allSettled([
        api.get('/profile/me'),
        api.get('/master-data'),
      ]);

      if (masterResult.status === 'fulfilled') {
        setMajors(masterResult.value.majors || []);
      }

      if (profileResult.status === 'rejected') {
        const notOnboarded = getErrorStatus(profileResult.reason) === 404;
        setNotice(
          notOnboarded
            ? 'ยังไม่มีข้อมูลประวัติของคุณในระบบ กรุณากรอกข้อมูลแล้วกดปุ่มบันทึกข้อมูลส่วนตัว'
            : null
        );
        setError(notOnboarded ? null : 'ไม่สามารถดึงข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
        return;
      }

      setError(null);
      setNotice(null);
      const prof = profileResult.value.profile as StudentType;
      setProfile(prof);

      if (prof) {
        setStudentCode(prof.student_code || '');
        setStoredAvatar(prof.profile_image || null);
        setSelectedMajorId(prof.major_id || '');
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setNickname(prof.nickname || '');
        setYearLevel(prof.year_level === 3 ? 3 : 4);
        setSection(prof.section || '');
        setBirthDate(prof.birth_date ? prof.birth_date.split('T')[0] : '');
        setAltEmail(prof.alt_email || '');
        setPhone(prof.phone || '');
        setCurrentAddress(prof.current_address || '');
        setParentName(prof.parent_name || '');
        setParentPhone(prof.parent_phone || '');
        setEnrollmentYear(
          prof.enrollment_year !== null && prof.enrollment_year !== undefined ? prof.enrollment_year : ''
        );
        setCumulativeGpa(
          prof.cumulative_gpa !== null && prof.cumulative_gpa !== undefined
            ? Number(prof.cumulative_gpa).toFixed(2)
            : ''
        );

        setSkillsAndActivities(prof.skills_and_activities || '');
        setPreferredRegion(prof.preferred_work_region || '');
        setJobTypes(Array.isArray(prof.interested_job_types) ? prof.interested_job_types : []);

        // Load language proficiency
        if (Array.isArray(prof.language_proficiency)) {
          const eng = (prof.language_proficiency as LanguageProficiency[]).find(
            (l) => l.language === 'ภาษาอังกฤษ' || l.language === 'English'
          );
          if (eng) {
            if (eng.reading) setEngReading(eng.reading);
            if (eng.speaking) setEngSpeaking(eng.speaking);
            if (eng.writing) setEngWriting(eng.writing);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load student profile:', err);
      setError('ไม่สามารถดึงข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    e.target.value = '';
    if (!selected) return;

    if (!selected.type.startsWith('image/')) {
      setError('รูปโปรไฟล์ต้องเป็นไฟล์รูปภาพ (.jpg, .jpeg, .png) เท่านั้น');
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (selected.size > 2 * 1024 * 1024) {
      setError('ขนาดรูปถ่ายต้องไม่เกิน 2 MB');
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const preview = URL.createObjectURL(selected);
    setAvatarPreviewUrl(preview);
    setError(null);
    setAvatarUploading(true);

    try {
      const formData = new FormData();
      formData.append('avatar', selected);
      const res = await api.post('/profile/student/avatar', formData);
      setStoredAvatar(res.profile_image || null);
      setSuccess('อัปโหลดรูปโปรไฟล์เรียบร้อยแล้ว');
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถอัปโหลดรูปโปรไฟล์ได้'));
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setAvatarPreviewUrl(null);
      URL.revokeObjectURL(preview);
      setAvatarUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const selected = e.target.files?.[0] || null;
    if (!selected) {
      setResumeFile(null);
      return;
    }

    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setFileError('ไฟล์ที่เลือกต้องเป็นนามสกุล PDF เท่านั้น');
      setResumeFile(null);
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setFileError('ขนาดไฟล์ต้องไม่เกิน 5 MB');
      setResumeFile(null);
      return;
    }

    setResumeFile(selected);
  };

  const handleJobTypeToggle = (type: string) => {
    if (jobTypes.includes(type)) {
      setJobTypes(jobTypes.filter((t) => t !== type));
    } else {
      setJobTypes([...jobTypes, type]);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล');
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // ตรวจช่วงเกรดตรงนี้ให้รู้ทันที · ด่านจริงอยู่ที่เซิร์ฟเวอร์
    if (cumulativeGpa.trim() !== '') {
      const gpaNum = Number(cumulativeGpa);
      if (!Number.isFinite(gpaNum) || gpaNum < 0 || gpaNum > 4) {
        setError('เกรดเฉลี่ยสะสมต้องเป็นตัวเลขระหว่าง 0.00 ถึง 4.00');
        alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      if (selectedMajorId !== '') {
        formData.append('major_id', String(selectedMajorId));
      }
      formData.append('cumulative_gpa', cumulativeGpa.trim());
      formData.append('first_name', firstName.trim());
      formData.append('last_name', lastName.trim());
      formData.append('nickname', nickname.trim());
      if (yearLevel !== '') {
        formData.append('year_level', String(yearLevel));
      }
      formData.append('section', section.trim());
      formData.append('birth_date', birthDate);
      formData.append('alt_email', altEmail.trim());
      formData.append('phone', phone.trim());
      formData.append('current_address', currentAddress.trim());
      formData.append('parent_name', parentName.trim());
      formData.append('parent_phone', parentPhone.trim());

      if (resumeFile) {
        formData.append('resume', resumeFile);
      }

      // Preserve existing language proficiency items
      const existingLanguages: LanguageProficiency[] = Array.isArray(profile?.language_proficiency)
        ? [...profile.language_proficiency]
        : [];
      const engIdx = existingLanguages.findIndex(
        (l: LanguageProficiency) => l.language === 'ภาษาอังกฤษ' || l.language === 'English'
      );
      const engObj = engIdx >= 0 ? existingLanguages[engIdx] : { language: 'ภาษาอังกฤษ' };
      const mergedEnglish: LanguageProficiency = {
        ...engObj,
        language: 'ภาษาอังกฤษ',
        reading: engReading,
        speaking: engSpeaking,
        writing: engWriting,
      };

      if (engIdx >= 0) {
        existingLanguages[engIdx] = mergedEnglish;
      } else {
        existingLanguages.push(mergedEnglish);
      }

      await Promise.all([
        api.put('/profile/student', formData),
        api.put('/profile/student/optional', {
          skills_and_activities: skillsAndActivities,
          preferred_work_region: preferredRegion || null,
          interested_job_types: jobTypes.length > 0 ? jobTypes : null,
          language_proficiency: existingLanguages,
        }),
      ]);

      setSuccess('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว');
      setResumeFile(null);
      await loadProfile();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
      // สาขาที่ขอเปลี่ยนอาจถูกปฏิเสธ (409) — ให้ช่องกลับไปตรงกับของจริงในระบบ
      setSelectedMajorId(profile?.major_id || '');
    } finally {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="form" />;
  }

  const initialLetters = (firstName?.[0] || 'ส') + (lastName?.[0] || 'ห');
  const resumeFileName = profile?.resume_file ? profile.resume_file.split('/').pop() || 'resume.pdf' : '';
  const resumeDownloadUrl = profile?.resume_file
    ? `${API_BASE_URL}/files/download/resumes/${resumeFileName}`
    : '';

  const avatarUrl =
    avatarPreviewUrl || (storedAvatar ? `${API_BASE_URL}/files/${storedAvatar}` : null);

  const displayAdvisor =
    profile?.advisor_first_name
      ? `${profile.advisor_first_name} ${profile.advisor_last_name || ''}`.trim()
      : 'อาจารย์ที่ปรึกษา';

  return (
    <div className="max-w-5xl mx-auto space-y-6 page-enter pb-16">
      {/* Top Banner */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">ข้อมูลส่วนตัวและเรซูเม่</h1>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
          หน้านี้ไม่ใช่แบบฟอร์มสหกิจใบไหน — เป็นแหล่งข้อมูลกลางที่ใบอื่นดึงไปใช้ · แก้ที่นี่ที่เดียว ใบที่เกี่ยวข้องเปลี่ยนตาม
        </p>
      </div>

      <div ref={alertRef}>
        <AlertBanner variant="info" message={notice} />
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />
      </div>

      <form onSubmit={handleUpdate} className="space-y-6">
        {/* ========================================================================= */}
        {/* CARD 1: ข้อมูลส่วนตัว — รหัส/ปีที่เข้า/ที่ปรึกษาอ่านอย่างเดียว · สาขากับเกรดแก้เองได้  */}
        {/* ========================================================================= */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">ข้อมูลส่วนตัว</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                รหัสนักศึกษา
              </label>
              <input
                type="text"
                readOnly
                data-testid="profile-student-code"
                value={studentCode || '—'}
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                สาขาวิชา *
              </label>
              <select
                data-testid="profile-major"
                value={selectedMajorId}
                onChange={(e) => setSelectedMajorId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              >
                {majors.map((m) => (
                  <option key={m.major_id} value={m.major_id}>
                    {m.major_name_th}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                เลือกผิดแก้ได้ตอนยังไม่มีใบแจ้งความจำนงที่ดำเนินการอยู่ · เปลี่ยนแล้วที่ปรึกษาจะถูกล้างให้หัวหน้าสาขาใหม่ตั้งใหม่
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เกรดเฉลี่ยสะสม (0.00 – 4.00)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="4"
                inputMode="decimal"
                data-testid="profile-gpa"
                value={cumulativeGpa}
                onChange={(e) => setCumulativeGpa(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                placeholder="เช่น 3.25"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ปีการศึกษาที่เข้าศึกษา (Enrollment Year)
              </label>
              <input
                type="text"
                readOnly
                value={enrollmentYear !== '' ? String(enrollmentYear) : '—'}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                อาจารย์ที่ปรึกษา
              </label>
              <input
                type="text"
                readOnly
                value={displayAdvisor}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
            </div>
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            รหัสนักศึกษาและปีที่เข้าศึกษาแก้เองไม่ได้ — ถ้าไม่ตรงให้แจ้งเจ้าหน้าที่งานสหกิจศึกษา
          </p>
        </div>

        {/* ========================================================================= */}
        {/* CARD 2: ข้อมูลติดต่อและรูป (Editable Fields)                                  */}
        {/* ========================================================================= */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">ข้อมูลติดต่อ</h3>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Left: Avatar Column (1-inch blue background) */}
            <div className="w-full md:w-44 shrink-0 flex flex-col items-center gap-3">
              <div className="w-[118px] h-[148px] rounded-xl bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-200 dark:border-blue-800 flex items-center justify-center overflow-hidden relative shadow-xs">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="รูปโปรไฟล์นักศึกษา"
                    data-testid="profile-avatar-image"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-black text-brand-blue dark:text-blue-400">
                    {initialLetters}
                  </span>
                )}
              </div>

              <label className="w-full px-3 py-2 text-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
                {avatarUploading ? 'กำลังอัปโหลด...' : 'เปลี่ยนรูป'}
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/jpg"
                  data-testid="profile-avatar-input"
                  disabled={avatarUploading}
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>

              <span className="text-[11px] text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                รูปนี้ถูกใช้เป็น<strong className="text-gray-700 dark:text-gray-300">รูปติดใบสมัคร สหกิจ 03</strong> ด้วย — ควรเป็นรูปหน้าตรง 1 นิ้ว พื้นหลังสีฟ้า
              </span>
            </div>

            {/* Right: Form Inputs */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อ (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  data-testid="profile-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="กรอกชื่อ"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  นามสกุล (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  data-testid="profile-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="กรอกนามสกุล"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อเล่น
                </label>
                <input
                  type="text"
                  data-testid="profile-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="เช่น กฤต"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชั้นปีที่ *
                </label>
                <select
                  data-testid="profile-year-level"
                  value={yearLevel}
                  onChange={(e) => setYearLevel(e.target.value !== '' ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                >
                  <option value={3}>ชั้นปีที่ 3</option>
                  <option value={4}>ชั้นปีที่ 4</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ห้องเรียน (Section)
                </label>
                <input
                  type="text"
                  data-testid="profile-section"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue font-semibold"
                  placeholder="เช่น IT4/1"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  วันเกิด
                </label>
                <input
                  type="date"
                  data-testid="profile-birth-date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  โทรศัพท์ *
                </label>
                <input
                  type="tel"
                  data-testid="profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="08X-XXX-XXXX"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  อีเมลสำรอง
                </label>
                <input
                  type="email"
                  data-testid="profile-alt-email"
                  value={altEmail}
                  onChange={(e) => setAltEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="example@gmail.com"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ที่อยู่ปัจจุบัน
                </label>
                <input
                  type="text"
                  data-testid="profile-current-address"
                  value={currentAddress}
                  onChange={(e) => setCurrentAddress(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="บ้านเลขที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อผู้ปกครอง
                </label>
                <input
                  type="text"
                  data-testid="profile-parent-name"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="ชื่อ-นามสกุล ผู้ปกครอง"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  โทรศัพท์ผู้ปกครอง
                </label>
                <input
                  type="tel"
                  data-testid="profile-parent-phone"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="08X-XXX-XXXX"
                />
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
            <span className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              ชื่อภาษาอังกฤษ · เพศ · สัญชาติ · ผู้ติดต่อฉุกเฉิน อยู่ที่{' '}
              <a href="/dashboard?menu=job_application" className="font-bold text-brand-blue dark:text-blue-400 hover:underline">
                ใบสมัครงานสหกิจ (สหกิจ 03)
              </a>{' '}
              เพราะเป็นช่องที่มีเฉพาะบนใบนั้น — ไม่ทำซ้ำสองที่เพื่อไม่ให้ค่าขัดกัน
            </span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* CARD 3: เรซูเม่ ทักษะ และงานที่สนใจ                                           */}
        {/* ========================================================================= */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              เรซูเม่ ทักษะ และงานที่สนใจ
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
              ระบบใช้ข้อมูลชุดนี้จับคู่ตำแหน่งงานที่เปิดรับให้คุณบนหน้า “หาที่ฝึกงาน”
            </p>
          </div>

          {/* Resume Upload and Preview Box */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-gray-900 dark:text-white">
                  {resumeFile ? resumeFile.name : (profile?.resume_file ? resumeFileName : 'ยังไม่ได้อัปโหลดเรซูเม่')}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {profile?.resume_file ? 'ไฟล์เรซูเม่ออนไลน์ปัจจุบัน (PDF)' : 'อัปโหลดไฟล์เรซูเม่เป็น .PDF ขนาดไม่เกิน 5 MB'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {profile?.resume_file && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsPdfPreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    เปิดดู
                  </button>
                  <a
                    href={resumeDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    ดาวน์โหลด
                  </a>
                </>
              )}
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {profile?.resume_file ? 'อัปโหลดใหม่' : 'เลือกไฟล์ PDF'}
                <input
                  type="file"
                  accept=".pdf"
                  data-testid="profile-resume-input"
                  disabled={isSubmitting}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          {fileError && <p className="text-xs text-red-600 font-semibold">{fileError}</p>}

          {/* Skills and Activities */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ทักษะและกิจกรรมที่เคยทำ
            </label>
            <textarea
              rows={3}
              data-testid="profile-skills"
              value={skillsAndActivities}
              onChange={(e) => setSkillsAndActivities(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue resize-vertical"
              placeholder="พัฒนาเว็บด้วย React และ Node.js · เขียน SQL ระดับใช้งานจริง · เคยเป็นกรรมการชมรมคอมพิวเตอร์ดูแลงานอบรมให้รุ่นน้อง"
            />
          </div>

          {/* Job Types and Region */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  ประเภทงานที่สนใจ
                </label>
                {recommendedTypes.length > 0 && !showAllJobTypes && (
                  <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
                    ✨ แนะนำตามสาขาของคุณ
                  </span>
                )}
              </div>
              <div
                data-testid="profile-interests"
                className="flex flex-wrap gap-1.5 p-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 min-h-[42px]"
              >
                {visibleJobTypes.map((type) => {
                  const isChecked = jobTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleJobTypeToggle(type)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                        isChecked
                          ? 'bg-blue-50 text-brand-blue border border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      {type} {isChecked ? '✓' : '+'}
                    </button>
                  );
                })}
              </div>
              {recommendedTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllJobTypes((prev) => !prev)}
                  className="-mt-1.5 -mb-3 py-3 text-xs text-brand-blue dark:text-blue-400 font-semibold hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  {showAllJobTypes
                    ? '▲ ยุบแสดงเฉพาะสายงานแนะนำ'
                    : `+ ดูสายงานอื่นทั้งหมด (อีก ${jobTypeOptions.length - visibleJobTypes.length} สายงาน)`}
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                ภูมิภาคที่สะดวกไปฝึกงาน
              </label>
              <select
                data-testid="profile-region"
                value={preferredRegion}
                onChange={(e) => setPreferredRegion(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              >
                <option value="">-- เลือกภูมิภาคที่สะดวก --</option>
                {regionOptions.map((reg) => (
                  <option key={reg} value={reg}>
                    {reg}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Language Proficiency */}
          <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              ความสามารถทางภาษา
            </label>
            <div className="grid grid-cols-4 gap-2 items-center text-xs">
              <span className="font-bold text-gray-500 dark:text-gray-400">ภาษา</span>
              <span className="font-bold text-gray-500 dark:text-gray-400">อ่าน</span>
              <span className="font-bold text-gray-500 dark:text-gray-400">พูด</span>
              <span className="font-bold text-gray-500 dark:text-gray-400">เขียน</span>

              <div className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-bold text-gray-800 dark:text-gray-200">
                ภาษาอังกฤษ
              </div>
              <select
                value={engReading}
                onChange={(e) => setEngReading(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none"
              >
                <option value="ดีมาก">ดีมาก</option>
                <option value="ดี">ดี</option>
                <option value="พอใช้">พอใช้</option>
                <option value="น้อย">น้อย</option>
              </select>
              <select
                value={engSpeaking}
                onChange={(e) => setEngSpeaking(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none"
              >
                <option value="ดีมาก">ดีมาก</option>
                <option value="ดี">ดี</option>
                <option value="พอใช้">พอใช้</option>
                <option value="น้อย">น้อย</option>
              </select>
              <select
                value={engWriting}
                onChange={(e) => setEngWriting(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none"
              >
                <option value="ดีมาก">ดีมาก</option>
                <option value="ดี">ดี</option>
                <option value="พอใช้">พอใช้</option>
                <option value="น้อย">น้อย</option>
              </select>
            </div>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 block leading-relaxed">
              ช่องชุดนี้เป็นชุดเดียวกับในใบสมัคร สหกิจ 03 — แก้ที่ใดที่หนึ่งแล้วอีกใบเปลี่ยนตาม
            </span>
          </div>

          {/* Bottom Save Bar */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              type="submit"
              data-testid="profile-save"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูลส่วนตัว'}
            </button>
          </div>
        </div>
      </form>

      {/* PDF Modal */}
      <ResumePdfModal
        isOpen={isPdfPreviewOpen}
        onClose={() => setIsPdfPreviewOpen(false)}
        pdfUrl={resumeDownloadUrl}
        fileName={resumeFileName}
      />
    </div>
  );
};

export default StudentProfile;
