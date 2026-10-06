import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, ArrowLeft, Lock } from 'lucide-react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
  faculty_id: number;
  faculty_name_th: string;
}

/**
 * หน้ากรอกข้อมูลครั้งแรกของนักศึกษา — **ชั้นที่ 1 เท่านั้น**
 *
 * เจ้าของอยากได้ความรู้สึก "กรอกทีเดียวจบ" ตั้งแต่เข้าระบบครั้งแรก แต่ข้อมูลที่ใบสมัคร
 * สหกิจ 03 ต้องใช้มี **เลขบัตรประชาชน เชื้อชาติ ศาสนา** ซึ่ง SEC-12 บังคับให้เข้ารหัส
 * และลบอัตโนมัติ 90 วันหลังประเมินครบ เก็บตั้งแต่วันล็อกอินแรกแปลว่าระบบถือเลขบัตรของ
 * คนที่สุดท้ายอาจไม่ได้ไปสหกิจเลย จึงตกลงกันเมื่อ 2026-09-07 ว่าแบ่งสองชั้น:
 *
 *   ชั้นที่ 1 (หน้านี้)  ข้อมูลทั่วไป — ใช้ออกหนังสือได้ทันที
 *                        ("งานที่สนใจ" ถูกถอดออก 2026-10-05 — ไม่มีอะไรจับคู่งานจริง
 *                         ช่องนี้ยังอยู่ในหน้าโปรไฟล์เพราะใบสหกิจ 03 พิมพ์)
 *   ชั้นที่ 2 (ตอนยื่นเรื่องจริง)  ข้อมูลอ่อนไหว
 *
 * ⛔ **ห้ามเติมช่องอ่อนไหวลงหน้านี้แม้แต่ช่องเดียว** เส้นแบ่งนี้คือเหตุผลทั้งหมดของการแยก
 * กล่องสีเหลืองท้ายขั้นที่ 1 มีไว้บอกผู้ใช้ว่าจะถูกขอเมื่อไหร่ จะได้ไม่รู้สึกว่าโดนถามซ้ำ
 *
 * แบ่งสองขั้นเพราะ 12 ช่องในจอเดียวอ่านแล้วท้อ · ขั้นที่ 1 ถูก unmount ตอนไปขั้นที่ 2
 * ซึ่ง**ปลอดภัยที่นี่** เพราะค่าทั้งหมดอยู่ใน state ของหน้านี้และส่งครั้งเดียวตอนจบ
 * (คนละเรื่องกับหน้าโปรไฟล์ ที่ห้าม unmount เพราะ `updateStudent` ไม่มี COALESCE
 * ช่องที่ไม่ได้ส่งจะกลายเป็น NULL)
 */
const OnboardingStudent: React.FC = () => {
  const [step, setStep] = useState<1 | 2>(1);
  const [majors, setMajors] = useState<Major[]>([]);

  // ขั้นที่ 1 — ข้อมูลทั่วไป
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [enrollmentYear, setEnrollmentYear] = useState('');
  // คณะไม่ถูกส่งไปเก็บ — คณะมาจากสาขาที่เดียว (`master_major.faculty_id`) ช่องนี้มีไว้กรองรายการสาขา
  const [selectedFacultyId, setSelectedFacultyId] = useState<number | ''>('');
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [gpa, setGpa] = useState('');
  const [phone, setPhone] = useState('');
  const [altEmail, setAltEmail] = useState('');

  // ขั้นที่ 2 — รหัสผ่าน
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ค่าทะเบียน (รหัส · สาขา · ปีที่เข้า) แก้เองไม่ได้หลังบันทึก (SEC-05) — ให้ตรวจอีกครั้งก่อนส่ง
  const [confirmOpen, setConfirmOpen] = useState(false);

  const auth = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    const storedUserStr = localStorage.getItem('auth_user');
    const isFirstTime = storedUserStr ? JSON.parse(storedUserStr).isFirstTime : false;

    if (!auth?.isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!isFirstTime || auth?.user?.roles?.includes('dean')) {
      navigate('/dashboard');
      return;
    }

    const loadMasterData = async () => {
      try {
        const response = await api.get('/master-data');
        setMajors(response.majors || []);
      } catch (err) {
        console.error('Failed to load master data:', err);
        setGlobalError('ไม่สามารถเรียกข้อมูลคณะ/สาขาวิชาจากเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      }
    };

    loadMasterData();
  }, [auth, navigate]);

  // รายการคณะดึงจากรายการสาขา — คณะที่ยังไม่มีสาขาเลือกไปก็ไปต่อไม่ได้ จึงไม่ต้องแสดง
  const faculties = majors.filter(
    (m, i) => majors.findIndex(x => x.faculty_id === m.faculty_id) === i
  );

  const clearError = (key: string) => setErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));

  const validateStepOne = () => {
    const next: Record<string, string> = {};

    if (!firstName.trim()) next.firstName = 'กรุณากรอกชื่อ';
    if (!lastName.trim()) next.lastName = 'กรุณากรอกนามสกุล';

    if (!studentCode) {
      next.studentCode = 'กรุณากรอกรหัสนักศึกษา';
    } else if (!/^\d{12}-\d$/.test(studentCode.trim())) {
      next.studentCode = 'รูปแบบรหัสนักศึกษาไม่ถูกต้อง ต้องเป็นตัวเลข 12 หลัก ตามด้วยขีดกลางและเลข 1 หลัก';
    }

    if (selectedFacultyId === '') next.faculty = 'กรุณาเลือกคณะที่สังกัด';
    if (selectedMajorId === '') next.major = 'กรุณาเลือกสาขาวิชาที่สังกัด';
    if (!enrollmentYear) next.enrollmentYear = 'กรุณาระบุปีการศึกษาที่เข้าศึกษา';
    if (!phone.trim()) next.phone = 'กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้';

    // เกรดที่นักศึกษากรอกเอง — ลง cumulative_gpa ตรงๆ (SEC-05 แก้ 2026-10-04)
    // ตรวจช่วงตรงนี้ด้วยเพื่อให้ผู้ใช้รู้ทันที แต่ด่านจริงอยู่ที่เซิร์ฟเวอร์
    const gpaNum = Number(gpa);
    if (!gpa.trim()) {
      next.gpa = 'กรุณากรอกเกรดเฉลี่ยสะสม';
    } else if (!Number.isFinite(gpaNum) || gpaNum < 0 || gpaNum > 4) {
      next.gpa = 'เกรดเฉลี่ยสะสมต้องเป็นตัวเลขระหว่าง 0.00 ถึง 4.00';
    }

    if (altEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(altEmail.trim())) {
      next.altEmail = 'รูปแบบอีเมลไม่ถูกต้อง';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateStepTwo = () => {
    const next: Record<string, string> = {};

    if (!password) {
      next.password = 'กรุณากำหนดรหัสผ่านสำหรับการใช้งานครั้งถัดไป';
    } else if (password.length < 8) {
      next.password = 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
    } else if (!/[A-Z]/.test(password)) {
      next.password = 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว';
    } else if (!/[a-z]/.test(password)) {
      next.password = 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว';
    } else if (!/[0-9]/.test(password)) {
      next.password = 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว';
    }

    if (password !== confirmPassword) {
      next.confirmPassword = 'รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goToStepTwo = () => {
    setGlobalError(null);
    if (validateStepOne()) {
      setErrors({});
      setStep(2);
      window.scrollTo({ top: 0 });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    if (!validateStepTwo()) return;
    setConfirmOpen(true);
  };

  const submitProfile = async () => {
    setIsSubmitting(true);
    try {
      await api.post('/profile/setup', {
        type: 'student',
        student_code: studentCode.trim(),
        major_id: Number(selectedMajorId),
        enrollment_year: Number(enrollmentYear),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        cumulative_gpa: Number(gpa),
        alt_email: altEmail.trim() || null,
        password,
      });

      if (auth && auth.user) {
        // พักไว้ในตัวแปรก่อนโดยตั้งใจ — `isFirstTime`/`hasPassword` ไม่ได้อยู่ในชนิด `User`
        // ส่ง object literal เข้า `login()` ตรงๆ จะโดน excess property check ปฏิเสธ
        const updatedUser = { ...auth.user, isFirstTime: false, hasPassword: true };
        auth.login(updatedUser);
        localStorage.removeItem('onboarding_type');
        navigate('/dashboard');
      }
    } catch (err) {
      // ข้อผิดพลาดของขั้นที่ 1 (รหัสซ้ำ · สาขาไม่มีจริง · รหัสผูกกับอีเมลอื่น) เด้งกลับ
      // มาตอนกดส่งจากขั้นที่ 2 — พากลับไปขั้นที่ 1 ไม่งั้นผู้ใช้เห็นข้อความที่แก้ไม่ได้
      setConfirmOpen(false);
      setStep(1);
      window.scrollTo({ top: 0 });
      setGlobalError(getErrorMessage(err, 'การบันทึกข้อมูลล้มเหลว กรุณาติดต่อผู้ดูแลระบบ'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepBar = (
    <div className="flex items-center gap-3">
      {([1, 2] as const).map(n => (
        <div key={n} className="flex grow flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step >= n
                  ? 'bg-brand-blue text-white'
                  : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {step > n ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span
              className={`text-xs ${
                step >= n
                  ? 'font-semibold text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {n === 1 ? 'ข้อมูลทั่วไป' : 'ตั้งรหัสผ่าน'}
            </span>
          </div>
          <div
            className={`h-1 rounded-full ${
              step >= n ? 'bg-brand-blue' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          />
        </div>
      ))}
    </div>
  );

  const label = (text: string) => (
    <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{text}</span>
  );

  const fieldError = (key: string) =>
    errors[key] ? <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors[key]}</p> : null;

  return (
    <div className="flex min-h-screen justify-center bg-[#F3F4F6] px-4 py-10 dark:bg-[#111827]">
      <div className="page-enter flex w-full max-w-3xl flex-col gap-5">

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ยินดีต้อนรับ — ตั้งค่าบัญชีของคุณ
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            กรอกรอบเดียวจบ แล้วเริ่มหาที่ฝึกงานได้เลย ใช้เวลาประมาณ 3 นาที
          </p>
        </div>

        {stepBar}

        <AlertBanner variant="error" message={globalError} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-gray-900">

            {step === 1 ? (
              <>
                <div className="flex flex-col gap-3.5">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">ข้อมูลนักศึกษา</h2>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      ใช้ออกหนังสือราชการ
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      {label('ชื่อ *')}
                      <Input
                        value={firstName}
                        disabled={isSubmitting}
                        error={!!errors.firstName}
                        onChange={e => { setFirstName(e.target.value); clearError('firstName'); }}
                        data-testid="onboarding-first-name"
                      />
                      {fieldError('firstName')}
                    </div>
                    <div>
                      {label('นามสกุล *')}
                      <Input
                        value={lastName}
                        disabled={isSubmitting}
                        error={!!errors.lastName}
                        onChange={e => { setLastName(e.target.value); clearError('lastName'); }}
                        data-testid="onboarding-last-name"
                      />
                      {fieldError('lastName')}
                    </div>
                    <div>
                      {label('รหัสนักศึกษา *')}
                      <Input
                        value={studentCode}
                        disabled={isSubmitting}
                        error={!!errors.studentCode}
                        placeholder="123456789012-3"
                        onChange={e => { setStudentCode(e.target.value); clearError('studentCode'); }}
                        data-testid="onboarding-student-code"
                      />
                      {fieldError('studentCode')}
                    </div>
                    <div>
                      {label('ปีการศึกษาที่เข้าศึกษา *')}
                      <Input
                        value={enrollmentYear}
                        disabled={isSubmitting}
                        error={!!errors.enrollmentYear}
                        placeholder="2564"
                        onChange={e => { setEnrollmentYear(e.target.value); clearError('enrollmentYear'); }}
                        data-testid="onboarding-enrollment-year"
                      />
                      {fieldError('enrollmentYear')}
                    </div>
                    <div className="sm:col-span-2">
                      {label('คณะ *')}
                      <Select
                        value={selectedFacultyId}
                        disabled={isSubmitting}
                        error={!!errors.faculty}
                        onChange={e => {
                          setSelectedFacultyId(e.target.value ? Number(e.target.value) : '');
                          // สาขาที่เลือกไว้เป็นของคณะเดิม — ล้างเสมอ ไม่ให้ค้างสาขาที่มองไม่เห็นในรายการ
                          setSelectedMajorId('');
                          clearError('faculty');
                        }}
                        data-testid="onboarding-faculty"
                      >
                        <option value="">-- เลือกคณะที่สังกัด --</option>
                        {faculties.map(f => (
                          <option key={f.faculty_id} value={f.faculty_id}>
                            {f.faculty_name_th}
                          </option>
                        ))}
                      </Select>
                      {fieldError('faculty')}
                    </div>
                    <div className="sm:col-span-2">
                      {label('สาขาวิชา *')}
                      <Select
                        value={selectedMajorId}
                        disabled={isSubmitting || selectedFacultyId === ''}
                        error={!!errors.major}
                        onChange={e => {
                          setSelectedMajorId(e.target.value ? Number(e.target.value) : '');
                          clearError('major');
                        }}
                        data-testid="onboarding-major"
                      >
                        <option value="">
                          {selectedFacultyId === '' ? '-- เลือกคณะก่อน --' : '-- เลือกสาขาวิชาที่สังกัด --'}
                        </option>
                        {majors.filter(m => m.faculty_id === selectedFacultyId).map(m => (
                          <option key={m.major_id} value={m.major_id}>
                            {m.major_name_th}
                          </option>
                        ))}
                      </Select>
                      {fieldError('major')}
                    </div>
                    <div>
                      {label('เกรดเฉลี่ยสะสม *')}
                      <Input
                        value={gpa}
                        disabled={isSubmitting}
                        error={!!errors.gpa}
                        placeholder="3.25"
                        inputMode="decimal"
                        onChange={e => { setGpa(e.target.value); clearError('gpa'); }}
                        data-testid="onboarding-gpa"
                      />
                      {fieldError('gpa')}
                    </div>
                    <div>
                      {label('เบอร์โทรศัพท์ *')}
                      <Input
                        value={phone}
                        disabled={isSubmitting}
                        error={!!errors.phone}
                        placeholder="081-234-5678"
                        onChange={e => { setPhone(e.target.value); clearError('phone'); }}
                        data-testid="onboarding-phone"
                      />
                      {fieldError('phone')}
                    </div>
                    <div>
                      {label('อีเมลสำรอง')}
                      <Input
                        value={altEmail}
                        disabled={isSubmitting}
                        error={!!errors.altEmail}
                        onChange={e => { setAltEmail(e.target.value); clearError('altEmail'); }}
                        data-testid="onboarding-alt-email"
                      />
                      {fieldError('altEmail')}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      ยังไม่ต้องกรอกตอนนี้: เลขบัตรประชาชน เชื้อชาติ ศาสนา
                    </span>
                    <span className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                      สามอย่างนี้ใช้เฉพาะตอนพิมพ์ใบสมัครงานสหกิจ (สหกิจ 03) ระบบจะขอตอนคุณเริ่มยื่นเรื่องจริง
                      เก็บแบบเข้ารหัส และลบทิ้งอัตโนมัติ 90 วันหลังประเมินผลครบ
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">ตั้งรหัสผ่าน</h2>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    ใช้เข้าระบบครั้งถัดไปโดยไม่ต้องผ่าน Google
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    {label('รหัสผ่าน *')}
                    <Input
                      type="password"
                      value={password}
                      disabled={isSubmitting}
                      error={!!errors.password}
                      onChange={e => { setPassword(e.target.value); clearError('password'); }}
                      data-testid="onboarding-password"
                    />
                    {fieldError('password')}
                  </div>
                  <div>
                    {label('ยืนยันรหัสผ่าน *')}
                    <Input
                      type="password"
                      value={confirmPassword}
                      disabled={isSubmitting}
                      error={!!errors.confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); clearError('confirmPassword'); }}
                      data-testid="onboarding-confirm-password"
                    />
                    {fieldError('confirmPassword')}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลขอย่างละ 1 ตัว
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            {step === 1 ? (
              <>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  ช่องที่มี * ต้องกรอก · ที่เหลือเว้นไว้แล้วมาเติมทีหลังได้
                </span>
                {/* ลูกศรอยู่หลังข้อความ จึงเขียนเป็น children ไม่ใช่ prop `icon`
                    ซึ่ง ui/Button วางไว้หน้าข้อความเสมอ (ถูกแล้วสำหรับปุ่มย้อนกลับ) */}
                <Button onClick={goToStepTwo} data-testid="onboarding-next">
                  ถัดไป — ตั้งรหัสผ่าน
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setStep(1)}
                  disabled={isSubmitting}
                  icon={<ArrowLeft className="h-4 w-4" />}
                >
                  ย้อนกลับ
                </Button>
                <Button
                  type="submit"
                  loading={isSubmitting}
                  loadingLabel="กำลังบันทึก..."
                  data-testid="onboarding-submit"
                >
                  เริ่มใช้งานระบบ
                </Button>
              </>
            )}
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันข้อมูลทะเบียน"
        confirmLabel="ยืนยันและบันทึก"
        cancelLabel="กลับไปแก้"
        confirmTestId="onboarding-confirm"
        cancelTestId="onboarding-confirm-cancel"
        busy={isSubmitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submitProfile}
        message={
          <ConfirmSummary
            lead="ตรวจอีกครั้งก่อนบันทึก รหัสและปีที่เข้าถูกพิมพ์ลงหนังสือที่คณบดีลงนาม"
            rows={[
              { label: 'รหัสนักศึกษา', value: studentCode.trim() },
              {
                label: 'คณะ',
                value: majors.find(m => m.major_id === selectedMajorId)?.faculty_name_th ?? '—',
              },
              {
                label: 'สาขาวิชา',
                value: majors.find(m => m.major_id === selectedMajorId)?.major_name_th ?? '—',
              },
              { label: 'ปีที่เข้าศึกษา', value: enrollmentYear },
              { label: 'ชื่อ-นามสกุล', value: `${firstName.trim()} ${lastName.trim()}`.trim() },
            ]}
            lockNote="รหัสและปีที่เข้า แก้เองไม่ได้หลังยืนยัน ถ้าผิดต้องแจ้งเจ้าหน้าที่ · สาขาแก้ได้ที่หน้าโปรไฟล์"
          />
        }
      />
    </div>
  );
};

export default OnboardingStudent;
