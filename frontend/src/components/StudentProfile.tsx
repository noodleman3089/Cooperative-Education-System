import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/authContextValue';
import PageSkeleton from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile as StudentType } from '../types/api';
import AlertBanner from './ui/AlertBanner';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import { NAME_PREFIXES } from '../utils/namePrefix';
import { Download, FileText, Upload } from 'lucide-react';
import FileViewButton from './FileViewButton';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
  faculty_id: number;
  faculty_name_th: string;
}

const StudentProfile: React.FC = () => {
  const auth = useContext(AuthContext);
  const navigate = useNavigate();
  const [profile, setProfile] = useState<StudentType | null>(null);
  const [majors, setMajors] = useState<Major[]>([]);

  // Base profile fields
  const [studentCode, setStudentCode] = useState('');
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [namePrefix, setNamePrefix] = useState('');
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

  // Profile Avatar States
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [storedAvatar, setStoredAvatar] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Status & Submit States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // โหลดโปรไฟล์พัง (ไม่ใช่ 404 ของคนที่ยังไม่เคยตั้งโปรไฟล์) — ห้ามเปิดฟอร์มเปล่าให้กดบันทึกทับของเดิม
  const [loadFailed, setLoadFailed] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // เรซูเม่: บังคับมีก่อนยื่นคำร้องขอหนังสือ (เจ้าของสั่ง 2026-10-18) — บริษัท อาจารย์ที่ปรึกษา และอาจารย์นิเทศเปิดดูได้
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const alertRef = useRef<HTMLDivElement>(null);

  const currentMajor = majors.find((m) => m.major_id === selectedMajorId);
  const displayFaculty = currentMajor?.faculty_name_th || profile?.faculty_name_th || '—';
  const displayMajor = currentMajor?.major_name_th || profile?.major_name_th || '—';

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
        // ยังไม่มีแถว students: หน้านี้ "แก้" ได้แต่ "สร้าง" ไม่ได้ (PUT /profile/student ตอบ 404) เดิมจึงเป็นทางตัน —
        // คำแนะนำบนหน้าแรกพามาที่นี่ กรอกครบแล้วบันทึกไม่ได้ · พาไปหน้าตั้งโปรไฟล์ซึ่งสร้างแถวได้จริงแทน
        // `isFirstTime` เป็นธงนำทางฝั่งหน้าจอที่ ProtectedRoute/OnboardingStudent อ่าน ไม่ใช่สิทธิ์ (ด่านจริงอยู่ที่ /profile/setup)
        if (notOnboarded && auth?.user?.roles?.includes('student')) {
          // พักไว้ในตัวแปรก่อนโดยตั้งใจ — `isFirstTime` ไม่ได้อยู่ในชนิด User (แบบเดียวกับ OnboardingStudent)
          const flaggedUser = { ...auth.user, isFirstTime: true };
          auth.login(flaggedUser);
          localStorage.setItem('onboarding_type', 'student');
          navigate('/onboarding/student', { replace: true });
          return;
        }
        setNotice(
          notOnboarded
            ? 'ยังไม่มีข้อมูลประวัติของคุณในระบบ กรุณากรอกข้อมูลแล้วกดปุ่มบันทึกข้อมูลส่วนตัว'
            : null
        );
        setError(notOnboarded ? null : 'ไม่สามารถดึงข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
        setLoadFailed(!notOnboarded);
        return;
      }

      setError(null);
      setNotice(null);
      setLoadFailed(false);
      const prof = profileResult.value.profile as StudentType;
      setProfile(prof);

      if (prof) {
        setStudentCode(prof.student_code || '');
        setStoredAvatar(prof.profile_image || null);
        setSelectedMajorId(prof.major_id || '');
        setNamePrefix(prof.name_prefix || '');
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
      }
    } catch (err) {
      console.error('Failed to load student profile:', err);
      setError('ไม่สามารถดึงข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
    // โหลดครั้งเดียวตอนเปิดหน้า — loadProfile อ่าน auth/navigate เฉพาะตอนพาคนที่ยังไม่มีโปรไฟล์ไปหน้าตั้งโปรไฟล์
    // ใส่เป็น dependency จะทำให้โหลดซ้ำทุกครั้งที่ context เปลี่ยน
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // ว่าง = เซิร์ฟเวอร์คงค่าเดิม (ล้างคำนำหน้าที่ตั้งแล้วไม่ได้ — หนังสือราชการต้องมี)
      formData.append('name_prefix', namePrefix);
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

      await api.put('/profile/student', formData);

      setSuccess('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว');
      setResumeFile(null);
      await loadProfile();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
      setSelectedMajorId(profile?.major_id || '');
    } finally {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsSubmitting(false);
    }
  };

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  if (loading) {
    return <PageSkeleton variant="form" />;
  }

  // `profile` มีค่า = เคยโหลดสำเร็จแล้ว (โหลดซ้ำหลังบันทึกพัง) ค่าในฟอร์มยังเป็นของจริง จึงไม่ต้องซ่อน
  if (loadFailed && !profile) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <AlertBanner variant="error" message={error} />
      </div>
    );
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
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">ข้อมูลส่วนตัวและเรซูเม่</h1>
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
                คณะ
              </label>
              <input
                type="text"
                readOnly
                data-testid="profile-faculty"
                value={displayFaculty}
                className="w-full px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                สาขาวิชา
              </label>
              <input
                type="text"
                readOnly
                data-testid="profile-major"
                value={displayMajor}
                className="w-full px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
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
                className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                className="w-full px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
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
                className="w-full px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-gray-900 dark:text-white cursor-default focus:outline-none"
              />
            </div>
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            รหัสนักศึกษา คณะ สาขาวิชา และปีที่เข้าศึกษาแก้เองไม่ได้ — ถ้าไม่ตรงให้แจ้งเจ้าหน้าที่งานสหกิจศึกษา
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
                <label htmlFor="profile-name-prefix" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  คำนำหน้าชื่อ
                </label>
                <select
                  id="profile-name-prefix"
                  data-testid="profile-name-prefix"
                  value={namePrefix}
                  onChange={(e) => setNamePrefix(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                >
                  {/* ยังไม่เคยเลือก = มีตัวเลือกว่างให้เห็นว่ายังขาด · เลือกแล้วล้างกลับเป็นว่างไม่ได้ */}
                  {!profile?.name_prefix && <option value="">-- ยังไม่ได้เลือก --</option>}
                  {NAME_PREFIXES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-gray-600 dark:text-gray-400">
                  พิมพ์ลงหนังสือขอความอนุเคราะห์
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อ (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  data-testid="profile-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                >
                  <option value={3}>ชั้นปีที่ 3</option>
                  <option value={4}>ชั้นปีที่ 4</option>
                </select>
              </div>

              <div>
                <label htmlFor="profile-section" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ห้องเรียน
                </label>
                <input
                  id="profile-section"
                  type="text"
                  data-testid="profile-section"
                  list="classroom-suggestions"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue font-semibold"
                  placeholder="เช่น 1, 2"
                />
                <datalist id="classroom-suggestions">
                  <option value="1" />
                  <option value="2" />
                  <option value="3" />
                  <option value="4" />
                </datalist>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  กรอกเลขห้อง เช่น 1 หรือ 2 (สำหรับระบุในเอกสาร สหกิจ 06)
                </p>
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue cursor-pointer"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="08X-XXX-XXXX"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  อีเมลสำหรับติดต่องาน
                </label>
                <input
                  type="email"
                  data-testid="profile-alt-email"
                  value={altEmail}
                  onChange={(e) => setAltEmail(e.target.value)}
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
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
                  className="w-full px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                  placeholder="08X-XXX-XXXX"
                />
              </div>
            </div>
          </div>

          {/* เรซูเม่ — บังคับมีก่อนยื่นคำร้องขอหนังสือ · สถานประกอบการ อาจารย์ที่ปรึกษา และอาจารย์นิเทศเปิดดูได้ */}
          <div
            data-testid="profile-resume-box"
            className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900 dark:text-white">
                    {resumeFile ? resumeFile.name : profile?.resume_file ? resumeFileName : 'ยังไม่ได้อัปโหลดเรซูเม่'}
                  </div>
                  <div className="mt-0.5 text-[13px] text-gray-600 dark:text-gray-400">
                    {profile?.resume_file ? 'ไฟล์เรซูเม่ออนไลน์ปัจจุบัน (PDF)' : 'อัปโหลดไฟล์เรซูเม่เป็น .PDF ขนาดไม่เกิน 5 MB'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {profile?.resume_file && (
                  <>
                    <FileViewButton src={resumeDownloadUrl} title="เรซูเม่" data-testid="profile-resume-view" />
                    <a
                      href={resumeDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      ดาวน์โหลด
                    </a>
                  </>
                )}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-brand-blue px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  {profile?.resume_file ? 'อัปโหลดใหม่' : 'เลือกไฟล์ PDF'}
                  <input
                    type="file"
                    accept=".pdf"
                    data-testid="profile-resume-input"
                    disabled={isSubmitting}
                    onChange={handleResumeChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
            {!profile?.resume_file && (
              <p data-testid="profile-resume-required" className="text-[13px] font-semibold text-amber-900 dark:text-amber-300">
                จำเป็นต้องมีเรซูเม่ก่อนยื่นคำร้องขอหนังสือ — สถานประกอบการ อาจารย์ที่ปรึกษา และอาจารย์นิเทศจะเห็นไฟล์นี้
              </p>
            )}
            {fileError && <p className="text-xs font-semibold text-red-700 dark:text-red-400">{fileError}</p>}
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
            <span className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              ชื่อภาษาอังกฤษ · เพศ · สัญชาติ · ผู้ติดต่อฉุกเฉิน อยู่ที่{' '}
              <a href="/dashboard?menu=job_application" className="py-1.5 font-bold text-brand-blue dark:text-blue-400 hover:underline">
                ใบสมัครงานสหกิจ (สหกิจ 03)
              </a>{' '}
              เพราะเป็นช่องที่มีเฉพาะบนใบนั้น — ไม่ทำซ้ำสองที่เพื่อไม่ให้ค่าขัดกัน
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
    </div>
  );
};

export default StudentProfile;
