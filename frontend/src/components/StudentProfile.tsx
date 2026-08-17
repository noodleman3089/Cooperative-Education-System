import React, { useEffect, useRef, useState } from 'react';
import PageSkeleton from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import type { StudentProfile as StudentType } from '../types/api';
import ResumePdfModal from './ResumePdfModal';

import { loadThaiAddressData, type ProvinceItem } from '../data/thaiAddress';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
}

/** Shared styling for registry-owned fields that students can read but not edit. */
const REGISTRY_FIELD_CLASS =
  'w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 bg-gray-100 text-gray-600 cursor-not-allowed dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300';

/** Every editable field shares this; only the border changes when it is wrong. */
const FIELD_CLASS =
  'w-full px-3.5 py-2 text-xs rounded-xl border bg-white focus:outline-none dark:bg-gray-800 dark:text-white';
const FIELD_OK = 'border-gray-200 focus:border-brand-blue dark:border-gray-700';
const FIELD_BAD = 'border-red-400 focus:border-red-500 dark:border-red-500/70';

type TabId = 'personal' | 'contact' | 'guardian' | 'career';

const TABS: { id: TabId; label: string; short: string }[] = [
  { id: 'personal', label: '1. ข้อมูลส่วนตัวและการศึกษา', short: 'ส่วนตัว' },
  { id: 'contact', label: '2. การติดต่อและที่อยู่', short: 'ติดต่อ' },
  { id: 'guardian', label: '3. ผู้ปกครอง / ติดต่อฉุกเฉิน', short: 'ผู้ปกครอง' },
  { id: 'career', label: '4. สายงานที่สนใจ', short: 'สายงาน' },
];

/**
 * Which tab each field lives on, so a failed save can say *where* the problem
 * is and jump there. Splitting one 2,500px form into tabs is what makes this
 * necessary: "กรุณากรอกข้อมูลให้ครบ" was already unhelpful over 23 fields, and
 * over four tabs it would be a guessing game.
 */
/**
 * Takes the address string back apart into the five fields it was built from.
 *
 * Loading used to drop the whole stored address into the "รายละเอียดที่อยู่"
 * box and leave the three dropdowns blank, so a student who had saved an
 * address once saw it as free text and, if they touched a dropdown, got the
 * old address with a second set of ต./อ./จ. appended to it. Nothing here
 * enforced the dropdowns either, which is why they could not be made required.
 *
 * Matching is done against the real province list rather than a regular
 * expression: "จ." is dropped for Bangkok, and Thai place names have no word
 * separator to anchor a pattern on. Anything unrecognised — free text typed
 * before this screen existed — comes back whole in the detail box, which is
 * exactly what it did before.
 */
/**
 * Bangkok districts arrive from the dataset already spelled "เขตบางรัก", so
 * pasting "เขต" in front produced "เขตเขตบางรัก" in every Bangkok address the
 * screen has ever saved. Its subdistricts do *not* carry "แขวง", which is why
 * only one half of the pair looked wrong and it went unnoticed.
 */
const prefixed = (prefix: string, name: string) =>
  name.startsWith(prefix) ? name : `${prefix}${name}`;

const chopSuffix = (
  text: string,
  names: string[],
  prefixes: string[]
): { rest: string; name: string } | null => {
  let best: { rest: string; name: string; len: number } | null = null;

  for (const name of names) {
    for (const prefix of prefixes) {
      const token = prefix + name;
      // Longest wins, so "จ.ชลบุรี" is preferred over the bare "ชลบุรี" that
      // also matches and would leave a dangling "จ." behind.
      if (text.endsWith(token) && (!best || token.length > best.len)) {
        best = { rest: text.slice(0, text.length - token.length).trimEnd(), name, len: token.length };
      }
    }
  }

  return best ? { rest: best.rest, name: best.name } : null;
};

interface AddressParts {
  detail: string;
  province: string;
  district: string;
  subdistrict: string;
  zipcode: string;
}

const splitStoredAddress = (raw: string, provinces: ProvinceItem[]): AddressParts => {
  const whole: AddressParts = { detail: raw, province: '', district: '', subdistrict: '', zipcode: '' };
  if (!raw.trim() || provinces.length === 0) return whole;

  let rest = raw.trim();

  let zipcode = '';
  const zip = rest.match(/(\d{5})$/);
  if (zip) {
    zipcode = zip[1];
    rest = rest.slice(0, rest.length - zip[1].length).trimEnd();
  }

  const prov = chopSuffix(rest, provinces.map((p) => p.name), ['จ.', '']);
  if (!prov) return whole;
  const provinceItem = provinces.find((p) => p.name === prov.name)!;

  const dist = chopSuffix(prov.rest, provinceItem.districts.map((d) => d.name), ['อ.', 'เขต', '']);
  if (!dist) return whole;
  const districtItem = provinceItem.districts.find((d) => d.name === dist.name)!;

  const sub = chopSuffix(dist.rest, districtItem.subdistricts.map((s) => s.name), ['ต.', 'แขวง', '']);
  if (!sub) return whole;

  return {
    detail: sub.rest,
    province: prov.name,
    district: dist.name,
    subdistrict: sub.name,
    zipcode: zipcode || districtItem.subdistricts.find((s) => s.name === sub.name)?.zipcode || '',
  };
};

const FIELD_TAB: Record<string, TabId> = {
  firstName: 'personal',
  lastName: 'personal',
  phone: 'contact',
  altEmail: 'contact',
};

const StudentProfile: React.FC = () => {
  const [profile, setProfile] = useState<StudentType | null>(null);
  const [majors, setMajors] = useState<Major[]>([]);

  // Base profile fields
  const [studentCode, setStudentCode] = useState('');
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [titleTh, setTitleTh] = useState('นาย');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [yearLevel, setYearLevel] = useState<number | ''>(3);
  const [birthDate, setBirthDate] = useState('');
  const [altEmail, setAltEmail] = useState('');
  const [phone, setPhone] = useState('');
  
  // Cascading Address Fields
  const [addrHouseNo, setAddrHouseNo] = useState('');
  const [selectedProv, setSelectedProv] = useState('');
  const [selectedDist, setSelectedDist] = useState('');
  const [selectedSubdist, setSelectedSubdist] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');

  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [enrollmentYear, setEnrollmentYear] = useState<number | ''>('');
  const [cumulativeGpa, setCumulativeGpa] = useState<string>('');

  // Career & Work Preferences (Optional)
  const [skillsAndActivities, setSkillsAndActivities] = useState('');
  const [preferredRegion, setPreferredRegion] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);

  // Profile Avatar & Resume File States
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);

  // Status & Submit States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>('personal');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const alertRef = useRef<HTMLDivElement>(null);

  // Fetched rather than imported — see the note in data/thaiAddress.ts. Empty
  // until it lands, which only leaves the province dropdown briefly bare.
  const [thaiAddress, setThaiAddress] = useState<ProvinceItem[]>([]);

  const regionOptions = [
    'กรุงเทพมหานครและปริมณฑล',
    'ภาคกลาง',
    'ภาคตะวันออก',
    'ภาคเหนือ',
    'ภาคตะวันออกเฉียงเหนือ (อีสาน)',
    'ภาคใต้',
    'ภาคตะวันตก',
    'ต่างประเทศ',
  ];

  const jobTypeOptions = [
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานออกแบบ (Design)',
    'งานวิจัยและพัฒนา (R&D)',
    'งานห้องปฏิบัติการ (Lab)',
    'งานภาคสนาม (Fieldwork)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานโรงงานและฝ่ายผลิต (Production)',
    'งานเอกสารและธุรการ (Admin)',
  ];

  // Derived lists for cascading dropdowns
  const availableDistricts = thaiAddress.find((p) => p.name === selectedProv)?.districts || [];
  const availableSubdistricts = availableDistricts.find((d) => d.name === selectedDist)?.subdistricts || [];

  // Synchronize full current address whenever address components change
  useEffect(() => {
    const isBangkok = selectedProv === 'กรุงเทพมหานคร';
    const parts = [
      addrHouseNo,
      selectedSubdist ? prefixed(isBangkok ? 'แขวง' : 'ต.', selectedSubdist) : '',
      selectedDist ? prefixed(isBangkok ? 'เขต' : 'อ.', selectedDist) : '',
      selectedProv ? (isBangkok ? selectedProv : prefixed('จ.', selectedProv)) : '',
      zipcode,
    ].filter(Boolean);
    
    // Written unconditionally. It used to skip when every field was empty,
    // which meant clearing the address left the old one in place and saved it
    // straight back — there was no way to remove an address once entered.
    setCurrentAddress(parts.join(' '));
  }, [addrHouseNo, selectedProv, selectedDist, selectedSubdist, zipcode]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      // The address data is fetched here rather than in its own effect so the
      // stored address can be split against it in the same pass — splitting it
      // needs the province list, and a separate effect would have raced.
      // `loadThaiAddressData` caches, so the reload after a save is free.
      const [profileData, masterData, addressData] = await Promise.all([
        api.get('/profile/me'),
        api.get('/master-data'),
        loadThaiAddressData(),
      ]);

      const prof = profileData.profile as StudentType;
      setProfile(prof);
      setMajors(masterData.majors || []);
      setThaiAddress(addressData);

      if (prof) {
        setStudentCode(prof.student_code || '');
        setSelectedMajorId(prof.major_id || '');
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setNickname(prof.nickname || '');
        setYearLevel(prof.year_level === 4 ? 4 : 3);
        setBirthDate(prof.birth_date ? prof.birth_date.split('T')[0] : '');
        setAltEmail(prof.alt_email || '');
        setPhone(prof.phone || '');
        if (prof.current_address) {
          const parts = splitStoredAddress(prof.current_address, addressData);
          setCurrentAddress(prof.current_address);
          setAddrHouseNo(parts.detail);
          setSelectedProv(parts.province);
          setSelectedDist(parts.district);
          setSelectedSubdist(parts.subdistrict);
          setZipcode(parts.zipcode);
        }
        setParentName(prof.parent_name || '');
        setParentPhone(prof.parent_phone || '');
        setEnrollmentYear(prof.enrollment_year !== null && prof.enrollment_year !== undefined ? prof.enrollment_year : '');
        setCumulativeGpa(prof.cumulative_gpa ? Number(prof.cumulative_gpa).toFixed(2) : '');

        setSkillsAndActivities(prof.skills_and_activities || '');
        setPreferredRegion(prof.preferred_work_region || '');
        setJobTypes(Array.isArray(prof.interested_job_types) ? prof.interested_job_types : []);
      }
    } catch (err) {
      console.error('Failed to load student profile:', err);
      setError('ไม่สามารถดึงข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (!selected) return;

    if (!selected.type.startsWith('image/')) {
      setError('รูปโปรไฟล์ต้องเป็นไฟล์รูปภาพ (.jpg, .jpeg, .png) เท่านั้น');
      return;
    }

    if (selected.size > 2 * 1024 * 1024) {
      setError('ขนาดรูปถ่ายต้องไม่เกิน 2 MB');
      return;
    }

    setAvatarPreviewUrl(URL.createObjectURL(selected));
    setError(null);
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

  /**
   * The old check was `!studentCode || selectedMajorId === ''`, which since
   * SEC-05 asks the student to fix two fields they are not allowed to edit —
   * both are registry data, rendered read-only. It could only ever produce an
   * error nobody could clear. These are the fields a student actually owns.
   */
  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};

    if (!firstName.trim()) next.firstName = 'กรุณากรอกชื่อ';
    if (!lastName.trim()) next.lastName = 'กรุณากรอกนามสกุล';
    if (!phone.trim()) {
      next.phone = 'กรุณากรอกเบอร์โทรศัพท์มือถือ';
    } else if ((phone.match(/\d/g) || []).length < 9) {
      next.phone = 'เบอร์โทรศัพท์ต้องมีตัวเลขอย่างน้อย 9 หลัก';
    }
    // Optional, but if it is filled in it has to be reachable — this is the
    // address the co-op office falls back to when the university mail bounces.
    if (altEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(altEmail.trim())) {
      next.altEmail = 'รูปแบบอีเมลไม่ถูกต้อง';
    }

    return next;
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const found = validate();
    setFieldErrors(found);
    const missing = Object.keys(found);

    if (missing.length > 0) {
      // Land on the first tab that is actually wrong, otherwise the message
      // points at fields the student cannot see from where they are standing.
      const firstTab = TABS.find((t) => missing.some((f) => FIELD_TAB[f] === t.id));
      if (firstTab) setActiveTab(firstTab.id);
      setError(
        `ยังบันทึกไม่ได้ ข้อมูล ${missing.length} ช่องยังไม่ถูกต้อง: ${missing
          .map((f) => found[f])
          .join(' · ')}`
      );
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Primary profile payload
      // student_code, major_id, enrollment_year and cumulative_gpa are registry
      // data owned by the co-op office; the API ignores them here, so they are not
      // sent at all and are rendered read-only below.
      const formData = new FormData();
      formData.append('first_name', firstName);
      formData.append('last_name', lastName);
      formData.append('nickname', nickname);
      if (yearLevel !== '') {
        formData.append('year_level', String(yearLevel));
      }
      formData.append('birth_date', birthDate);
      formData.append('alt_email', altEmail);
      formData.append('phone', phone);
      formData.append('current_address', currentAddress);
      formData.append('parent_name', parentName);
      formData.append('parent_phone', parentPhone);

      if (resumeFile) {
        formData.append('resume', resumeFile);
      }

      // 2. Optional profile payload
      await Promise.all([
        api.put('/profile/student', formData),
        api.put('/profile/student/optional', {
          skills_and_activities: skillsAndActivities,
          preferred_work_region: preferredRegion || null,
          interested_job_types: jobTypes.length > 0 ? jobTypes : null,
        }),
      ]);

      setSuccess('บันทึกการแก้ไขข้อมูลโปรไฟล์และเรซูเม่สำเร็จเรียบร้อย');
      setResumeFile(null);
      await loadProfile();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถแก้ไขข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsSubmitting(false);
    }
  };

  /** Clears a field's complaint the moment the student starts fixing it. */
  const clearFieldError = (name: string) =>
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));

  const fieldClass = (name: string) =>
    `${FIELD_CLASS} ${fieldErrors[name] ? FIELD_BAD : FIELD_OK}`;

  const errorCountFor = (tab: TabId) =>
    Object.entries(fieldErrors).filter(([f, msg]) => msg && FIELD_TAB[f] === tab).length;

  const FieldError: React.FC<{ name: string }> = ({ name }) =>
    fieldErrors[name] ? (
      <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{fieldErrors[name]}</p>
    ) : null;

  if (loading) {
    return (
      <PageSkeleton variant='form' />
    );
  }

  const selectedMajorObj = majors.find((m) => m.major_id === selectedMajorId);
  const fullNameStr = [titleTh, firstName, lastName].filter(Boolean).join(' ') || 'นักศึกษาสหกิจศึกษา';
  const initialLetters = (firstName?.[0] || 'S') + (lastName?.[0] || 'T');

  const resumeFileName = profile?.resume_file ? profile.resume_file.split('/').pop() || 'Resume.pdf' : '';
  const resumeDownloadUrl = profile?.resume_file
    ? `${API_BASE_URL}/files/download/resumes/${resumeFileName}`
    : '';

  return (
    <div className="max-w-7xl mx-auto space-y-6 page-enter">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/50 text-brand-blue dark:text-blue-400 text-xs font-bold uppercase tracking-wider">
              Student Profile & CV Hub
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">
            ข้อมูลส่วนตัว & เรซูเม่ (Co-op 01 / 03)
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            การจัดจัดการข้อมูลพื้นฐานนักศึกษาและไฟล์เรซูเม่ออนไลน์สำหรับการสมัครงานสหกิจศึกษา
          </p>
        </div>

        {/* The save button used to be here *and* at the foot of the form, with
            different wording on each ("บันทึกข้อมูลโปรไฟล์" / "บันทึกข้อมูลและ
            อัปโหลด") though they ran the same handler. There is one now, and it
            follows the student down the page. */}
      </div>

      {/* Alert Messages. Anchored so a failed save can bring the reason back
          into view — the save button now sits at the bottom of the page, and an
          answer the student has to scroll up to find reads as no answer. */}
      <div ref={alertRef}>
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />
      </div>

      {/* Main 2-Column Responsive Dashboard Grid */}
      <form onSubmit={handleUpdate} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: Profile Header & Resume Document Hub (Sticky)               */}
        {/* ========================================================================= */}
        <div className="lg:col-span-4 lg:sticky lg:top-6 self-start space-y-6">
          {/* Identity Card with Profile Avatar Photo Upload */}
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs text-center space-y-4">
            <div className="relative group inline-block">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-black text-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mx-auto border-4 border-white dark:border-gray-800 overflow-hidden relative">
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} alt="Profile Photo" className="w-full h-full object-cover" />
                ) : (
                  initialLetters.toUpperCase()
                )}

                {/* Hover Overlay to Change Profile Photo */}
                <label className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all cursor-pointer">
                  <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-xs font-bold">อัปโหลดรูปถ่าย</span>
                  <input
                    type="file"
                    accept="image/png, image/jpeg, image/jpg"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </label>
              </div>
              <span className="absolute bottom-0 right-0 w-5 h-5 bg-emerald-500 border-2 border-white dark:border-gray-800 rounded-full" title="Active Student Profile"></span>
            </div>

            <div>
              <h2 className="text-lg font-extrabold text-gray-800 dark:text-white">
                {fullNameStr} {nickname && <span className="text-gray-400 font-normal">({nickname})</span>}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                รหัสนักศึกษา: {studentCode || 'ยังไม่ได้ระบุ'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold">
                {selectedMajorObj?.major_name_th || 'สาขาวิชา'}
              </span>
              {cumulativeGpa && (
                <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-brand-blue dark:text-blue-400 text-xs font-bold">
                  GPAX: {cumulativeGpa}
                </span>
              )}
              {yearLevel && (
                <span className="px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                  ชั้นปีที่ {yearLevel}
                </span>
              )}
            </div>
          </div>

          {/* Resume Document Box */}
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                จัดการไฟล์ Resume (PDF)
              </h3>
              {profile?.resume_file ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                  พร้อมใช้งาน
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-xs font-bold">
                  ยังไม่ได้อัปโหลด
                </span>
              )}
            </div>

            {/* Current Uploaded Resume Display */}
            {profile?.resume_file && (
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-800 dark:text-white truncate">
                      {resumeFileName}
                    </p>
                    <p className="text-xs text-gray-400">ไฟล์เรซูไม่ออนไลน์ปัจจุบัน</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsPdfPreviewOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-blue/10 hover:bg-brand-blue/20 text-brand-blue dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    ดูตัวอย่าง PDF
                  </button>

                  <a
                    href={resumeDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-bold transition-colors text-center"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    ดาวน์โหลด
                  </a>
                </div>
              </div>
            )}

            {/* Custom Upload Dropzone */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                {profile?.resume_file ? 'อัปโหลดไฟล์เรซูเม่ใหม่ (เพื่อเปลี่ยน)' : 'อัปโหลดไฟล์เรซูเม่ (PDF)'}
              </label>
              <div className="relative border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-brand-blue dark:hover:border-brand-blue rounded-xl p-4 text-center transition-all bg-gray-50/50 dark:bg-gray-800/30">
                <input
                  type="file"
                  accept=".pdf"
                  disabled={isSubmitting}
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <svg className="w-8 h-8 mx-auto text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {resumeFile ? resumeFile.name : 'คลิกเลือกไฟล์ หรือลากวางไฟล์ PDF'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">เฉพาะไฟล์ .PDF ขนาดไม่เกิน 5 MB</p>
              </div>

              {fileError && (
                <p className="text-xs text-red-500 font-semibold mt-1">{fileError}</p>
              )}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: Structured Section Form Cards                              */}
        {/* ========================================================================= */}
        <div className="lg:col-span-8 space-y-6">
          {/* One page of 23 fields was 2,500px on a laptop and 3,900px on a
              phone, and the student had no way of knowing how much was left.
              Same fields, same single save — four bites instead of one. */}
          <div
            role="tablist"
            aria-label="หมวดข้อมูลประวัตินักศึกษา"
            className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 dark:border-gray-800 dark:bg-gray-900"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const errs = errorCountFor(tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-brand-blue text-white shadow-sm shadow-blue-500/20'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="sm:hidden">{tab.short}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  {errs > 0 && (
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                        isActive ? 'bg-white text-red-600' : 'bg-red-500 text-white'
                      }`}
                      title={`ยังมี ${errs} ช่องที่ต้องแก้ในหมวดนี้`}
                    >
                      {errs}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Card 1: ข้อมูลส่วนตัวและการศึกษา (Personal & Academic Info) */}
          <div className={`bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4 ${activeTab === 'personal' ? '' : 'hidden'}`}>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-brand-blue flex items-center justify-center shrink-0 dark:text-blue-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">1. ข้อมูลส่วนตัวและการศึกษา (Co-op 01)</h3>
                <p className="text-xs text-gray-400">ชื่อ-นามสกุล รหัสนักศึกษา เกรดสะสม และสถานะทางการศึกษา</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  คำนำหน้า *
                </label>
                <select
                  disabled={isSubmitting}
                  value={titleTh}
                  onChange={(e) => setTitleTh(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white font-semibold"
                >
                  <option value="นาย">นาย</option>
                  <option value="นางสาว">นางสาว</option>
                  <option value="นาง">นาง</option>
                </select>
              </div>

              <div className="sm:col-span-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  ชื่อ (First Name) *
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  placeholder="กรอกชื่อ"
                  value={firstName}
                  aria-invalid={!!fieldErrors.firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    clearFieldError('firstName');
                  }}
                  className={fieldClass('firstName')}
                />
                <FieldError name="firstName" />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  นามสกุล (Last Name) *
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  placeholder="กรอกนามสกุล"
                  value={lastName}
                  aria-invalid={!!fieldErrors.lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    clearFieldError('lastName');
                  }}
                  className={fieldClass('lastName')}
                />
                <FieldError name="lastName" />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  ชื่อเล่น (Nickname)
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  placeholder="เช่น สมชาย"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  รหัสนักศึกษา
                </label>
                <input
                  type="text"
                  readOnly
                  value={studentCode}
                  className={REGISTRY_FIELD_CLASS + ' font-mono'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  สาขาวิชา
                </label>
                <input
                  type="text"
                  readOnly
                  value={majors.find((m) => m.major_id === selectedMajorId)?.major_name_th || '—'}
                  className={REGISTRY_FIELD_CLASS}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  เกรดเฉลี่ยสะสม (GPAX)
                </label>
                <input
                  type="text"
                  readOnly
                  value={cumulativeGpa || 'ยังไม่มีข้อมูลจากงานทะเบียน'}
                  className={REGISTRY_FIELD_CLASS + ' font-bold'}
                />
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              รหัสนักศึกษา สาขาวิชา เกรดเฉลี่ย และปีการศึกษาที่เข้าศึกษา เป็นข้อมูลจากงานทะเบียน/เจ้าหน้าที่สหกิจศึกษา
              หากไม่ถูกต้องกรุณาติดต่อเจ้าหน้าที่เพื่อแก้ไข
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  ชั้นปีที่ (Year Level) *
                </label>
                <select
                  disabled={isSubmitting}
                  value={yearLevel}
                  onChange={(e) => setYearLevel(e.target.value !== '' ? Number(e.target.value) : '')}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="" disabled hidden>-- เลือกชั้นปี --</option>
                  <option value={3}>ชั้นปีที่ 3</option>
                  <option value={4}>ชั้นปีที่ 4</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  ปีการศึกษาที่เข้าศึกษา (Enrollment Year)
                </label>
                <input
                  type="text"
                  readOnly
                  value={enrollmentYear !== '' ? String(enrollmentYear) : '—'}
                  className={REGISTRY_FIELD_CLASS}
                />
              </div>
            </div>
          </div>

          {/* Card 2: ข้อมูลการติดต่อและที่อยู่ปัจจุบัน (Contact & Residence) */}
          <div className={`bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4 ${activeTab === 'contact' ? '' : 'hidden'}`}>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">2. ข้อมูลการติดต่อและที่อยู่ปัจจุบัน</h3>
                <p className="text-xs text-gray-400">เบอร์โทรศัพท์ อีเมลสำรอง วันเกิด และที่อยู่จัดส่งเอกสาร</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  เบอร์โทรศัพท์มือถือ *
                </label>
                <input
                  type="tel"
                  disabled={isSubmitting}
                  placeholder="08X-XXX-XXXX"
                  value={phone}
                  aria-invalid={!!fieldErrors.phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearFieldError('phone');
                  }}
                  className={fieldClass('phone')}
                />
                <FieldError name="phone" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  E-mail สำรอง (นอกเหนือจากสถาบัน)
                </label>
                <input
                  type="email"
                  disabled={isSubmitting}
                  placeholder="example@gmail.com"
                  value={altEmail}
                  aria-invalid={!!fieldErrors.altEmail}
                  onChange={(e) => {
                    setAltEmail(e.target.value);
                    clearFieldError('altEmail');
                  }}
                  className={fieldClass('altEmail')}
                />
                <FieldError name="altEmail" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  วันเกิด (Date of Birth)
                </label>
                <input
                  type="date"
                  disabled={isSubmitting}
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white cursor-pointer"
                />
              </div>
            </div>

            {/* Cascading Address Selection */}
            <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-200">
                ที่อยู่ปัจจุบันสำหรับการติดต่อ
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  {/* Still no asterisk on the three address dropdowns. They
                      now refill from a stored address (splitStoredAddress
                      above), but an address typed as free text before this
                      screen existed cannot be split, and requiring these would
                      stop those students saving anything at all until they
                      redid an address that was never wrong. */}
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    จังหวัด
                  </label>
                  <select
                    disabled={isSubmitting || thaiAddress.length === 0}
                    value={selectedProv}
                    onChange={(e) => {
                      setSelectedProv(e.target.value);
                      setSelectedDist('');
                      setSelectedSubdist('');
                      setZipcode('');
                    }}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800/50"
                  >
                    <option value="">
                      {thaiAddress.length === 0 ? 'กำลังโหลดข้อมูลจังหวัด...' : '-- เลือกจังหวัด --'}
                    </option>
                    {thaiAddress.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    เขต / อำเภอ
                  </label>
                  <select
                    disabled={isSubmitting || !selectedProv}
                    value={selectedDist}
                    onChange={(e) => {
                      setSelectedDist(e.target.value);
                      setSelectedSubdist('');
                      setZipcode('');
                    }}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800/50"
                  >
                    <option value="">-- เลือกเขต/อำเภอ --</option>
                    {availableDistricts.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    แขวง / ตำบล
                  </label>
                  <select
                    disabled={isSubmitting || !selectedDist}
                    value={selectedSubdist}
                    onChange={(e) => {
                      const sub = e.target.value;
                      setSelectedSubdist(sub);
                      const found = availableSubdistricts.find((s) => s.name === sub);
                      if (found) setZipcode(found.zipcode);
                    }}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800/50"
                  >
                    <option value="">-- เลือกแขวง/ตำบล --</option>
                    {availableSubdistricts.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    รายละเอียดที่อยู่ (บ้านเลขที่, ซอย, ถนน, หมู่บ้าน/อาคาร)
                  </label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    placeholder="เช่น 123/45 ซ.สุขุมวิท 55 ถ.สุขุมวิท"
                    value={addrHouseNo}
                    onChange={(e) => setAddrHouseNo(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    รหัสไปรษณีย์
                  </label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    placeholder="เช่น 10110"
                    value={zipcode}
                    onChange={(e) => setZipcode(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: ข้อมูลผู้ปกครอง / บุคคลติดต่อฉุกเฉิน (Guardian & Emergency Contact) */}
          <div className={`bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4 ${activeTab === 'guardian' ? '' : 'hidden'}`}>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5 5 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">3. ข้อมูลผู้ปกครอง / บุคคลติดต่อฉุกเฉิน</h3>
                <p className="text-xs text-gray-400">ผู้ปกครองหรือบุคคลเร่งด่วนที่สามารถติดต่อได้ในระหว่างการปฏิบัติงานสหกิจ</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  ชื่อ-นามสกุล ผู้ปกครอง / ผู้ติดต่อฉุกเฉิน
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  placeholder="ชื่อ-นามสกุล ผู้ปกครอง"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  เบอร์โทรศัพท์ผู้ปกครองที่ติดต่อได้
                </label>
                <input
                  type="tel"
                  disabled={isSubmitting}
                  placeholder="08X-XXX-XXXX"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Card 4: สายงานและพื้นที่ปฏิบัติงานที่สนใจ (Career Preferences - Optional) */}
          <div className={`bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4 ${activeTab === 'career' ? '' : 'hidden'}`}>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">4. สายงานและพื้นที่ปฏิบัติงานที่สนใจ (Optional)</h3>
                <p className="text-xs text-gray-400">ข้อมูลประกอบการพิจารณาจัดคู่ตำแหน่งงานและสถานประกอบการที่เหมาะสม</p>
              </div>
            </div>

            {/* Preferred Region */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                ภูมิภาคที่สนใจไปปฏิบัติงาน
              </label>
              <select
                disabled={isSubmitting}
                value={preferredRegion}
                onChange={(e) => setPreferredRegion(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              >
                <option value="" disabled hidden>-- เลือกภูมิภาคที่สนใจ --</option>
                {regionOptions.map((reg) => (
                  <option key={reg} value={reg}>
                    {reg}
                  </option>
                ))}
              </select>
            </div>

            {/* Job Type Checkboxes */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                ประเภทงานที่สนใจ (เลือกได้มากกว่า 1 ข้อ)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {jobTypeOptions.map((type) => {
                  const isChecked = jobTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleJobTypeToggle(type)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-blue-50 border-blue-200 text-brand-blue dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-400'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <span className="truncate">{type}</span>
                      {isChecked && (
                        <svg className="w-4 h-4 text-brand-blue shrink-0 ml-1 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Skills & Activities */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                ทักษะความสามารถพิเศษ หรือ ผลงานกิจกรรมที่เคยทำ
              </label>
              <textarea
                rows={3}
                disabled={isSubmitting}
                placeholder="เช่น ความสามารถทางภาษา ทักษะการใช้ซอฟต์แวร์/โปรแกรมมิ่ง หรือรางวัลและกิจกรรมที่เคยเข้าร่วม"
                value={skillsAndActivities}
                onChange={(e) => setSkillsAndActivities(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white resize-none"
              />
            </div>

          </div>

          {/* One save for the whole record, reachable from every tab. It saves
              all four sections at once — the API replaces the row wholesale, so
              a per-tab save would blank the tabs the student was not looking
              at (see models/student.ts updateStudent). */}
          <div className="sticky bottom-0 z-10 rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
            <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ปุ่มนี้บันทึกข้อมูลทั้ง 4 หมวดพร้อมกัน ไม่ต้องกดทีละหมวด
              </p>
              <Button
                type="submit"
                loading={isSubmitting}
                loadingLabel="กำลังบันทึกข้อมูล..."
                className="shrink-0"
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                }
              >
                บันทึกข้อมูลโปรไฟล์
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Live Resume PDF Previewer Modal */}
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
