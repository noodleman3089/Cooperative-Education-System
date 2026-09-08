import React, { useState } from 'react';
import api from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

interface Mentor {
  mentor_id?: number;
  name: string;
  position: string;
  department: string;
  phone: string;
  fax: string;
  email: string;
  has_account?: boolean;
}

interface StudentAssignment {
  student_id: number;
  student_code: string;
  full_name: string;
  major_name_th: string;
  job_position: string;
  job_description: string;
  mentor_id: number | null;
}

interface Form07Data {
  company: {
    name_th: string;
    name_en: string | null;
    house_no: string;
    road: string;
    soi: string;
    subdistrict: string;
    district: string;
    province: string;
    postal_code: string;
    phone: string;
    fax: string;
    manager_name: string;
    manager_position: string;
    manager_phone: string;
    manager_email: string;
    contact_mode: 'manager' | 'delegate';
    contact_person: string;
    contact_position_department: string;
    contact_phone: string;
    contact_email: string;
  };
  mentors: Mentor[];
  students: StudentAssignment[];
  informant_name: string;
  informant_position: string;
}

const DEFAULT_FORM07: Form07Data = {
  company: {
    name_th: 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด',
    name_en: 'Seagate Technology (Thailand) Co., Ltd.',
    house_no: '90 หมู่ 15',
    road: 'มิตรภาพ',
    soi: '-',
    subdistrict: 'สูงเนิน',
    district: 'สูงเนิน',
    province: 'นครราชสีมา',
    postal_code: '30170',
    phone: '02-123-4567',
    fax: '02-123-4568',
    manager_name: 'นายวิชัย มั่นคง',
    manager_position: 'ผู้จัดการโรงงาน',
    manager_phone: '02-123-4500',
    manager_email: 'wichai@seagate.co.th',
    contact_mode: 'delegate',
    contact_person: 'นางสาวพรทิพย์ ใจดี',
    contact_position_department: 'เจ้าหน้าที่บุคคลอาวุโส / ฝ่ายบุคคล',
    contact_phone: '02-123-4567 ต่อ 210',
    contact_email: 'hr@seagate.co.th',
  },
  mentors: [
    {
      mentor_id: 21,
      name: 'นายสมศักดิ์ รักเรียน',
      position: 'Lead Engineer',
      department: 'Software Development',
      phone: '081-999-8888',
      fax: '02-123-4568',
      email: 'somsak@seagate.co.th',
      has_account: true,
    },
  ],
  students: [
    {
      student_id: 5,
      student_code: '640101001',
      full_name: 'ธนกฤต ศรีสุวรรณ',
      major_name_th: 'เทคโนโลยีสารสนเทศ',
      job_position: 'Junior Full-Stack Developer',
      job_description: 'พัฒนาหน้าจอรายงานยอดผลิตรายวันให้ฝ่ายวางแผน ร่วมทดสอบระบบ และจัดทำเอกสารประกอบ',
      mentor_id: 21,
    },
    {
      student_id: 6,
      student_code: '640101014',
      full_name: 'ปาริชาต ทองแท้',
      major_name_th: 'การจัดการโลจิสติกส์',
      job_position: 'ผู้ช่วยวิเคราะห์ข้อมูลการผลิต',
      job_description: 'รวบรวมและวิเคราะห์ข้อมูลรอบการผลิต จัดทำรายงานประจำสัปดาห์เสนอหัวหน้าแผนก',
      mentor_id: 21,
    },
  ],
  informant_name: 'นางสาวพรทิพย์ ใจดี',
  informant_position: 'เจ้าหน้าที่บุคคลอาวุโส',
};

const Form07Company: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<Form07Data>(DEFAULT_FORM07);
  const [dueDateText, setDueDateText] = useState<string>('ครบกำหนดวันศุกร์นี้');

  // Add Mentor Modal
  const [isAddMentorModalOpen, setIsAddMentorModalOpen] = useState(false);
  const [newMentor, setNewMentor] = useState<Mentor>({
    name: '',
    position: '',
    department: '',
    phone: '',
    fax: '',
    email: '',
  });

  const todayThai = new Intl.DateTimeFormat('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [form07Res, companyRes, intentsRes] = await Promise.allSettled([
        api.get('/form07'),
        api.get('/companies/my-company'),
        api.get('/intents'),
      ]);

      if (form07Res.status === 'fulfilled' && form07Res.value) {
        const data = form07Res.value;
        setFormData((prev) => ({
          ...prev,
          ...data,
          company: {
            ...prev.company,
            ...(data.company || {}),
          },
          mentors: data.mentors?.length ? data.mentors : prev.mentors,
          students: data.students?.length ? data.students : prev.students,
        }));
        if (data.due_date) {
          setDueDateText(`กำหนดส่ง ${data.due_date}`);
        }
      } else {
        // If /api/form07 is in-progress, read company and intents
        if (companyRes.status === 'fulfilled' && companyRes.value) {
          const c = companyRes.value;
          setFormData((prev) => ({
            ...prev,
            company: {
              ...prev.company,
              name_th: c.name_th || prev.company.name_th,
              name_en: c.name_en || prev.company.name_en,
              phone: c.phone || prev.company.phone,
              manager_name: c.manager_name || prev.company.manager_name,
              manager_position: c.manager_position || prev.company.manager_position,
              contact_person: c.contact_person || prev.company.contact_person,
              contact_email: c.email || prev.company.contact_email,
            },
            informant_name: c.contact_person || prev.informant_name,
            informant_position: c.contact_position || prev.informant_position,
          }));
        }

        if (intentsRes.status === 'fulfilled' && Array.isArray(intentsRes.value)) {
          const accepted = intentsRes.value.filter((it: { status?: string }) => it.status === 'accepted');
          if (accepted.length > 0) {
            setFormData((prev) => ({
              ...prev,
              students: accepted.map((it: {
                student_id?: number;
                form_id: number;
                student_code: string;
                first_name?: string | null;
                last_name?: string | null;
                major_name_th?: string;
                job_position?: string;
                job_title?: string;
                job_description?: string;
              }) => ({
                student_id: it.student_id || it.form_id,
                student_code: it.student_code,
                full_name: `${it.first_name || ''} ${it.last_name || ''}`.trim() || it.student_code,
                major_name_th: it.major_name_th || 'สาขาวิชา',
                job_position: it.job_position || it.job_title || 'นักศึกษาฝึกงาน',
                job_description: it.job_description || '',
                mentor_id: prev.mentors[0]?.mentor_id || 21,
              })),
            }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load Form07 data:', err);
      setError('ไม่สามารถโหลดข้อมูล สหกิจ 07 ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useDashboardData(loadData);

  const handleUpdateCompany = (field: keyof Form07Data['company'], value: string) => {
    setFormData((prev) => ({
      ...prev,
      company: {
        ...prev.company,
        [field]: value,
      },
    }));
  };

  const handleUpdateMentor = (index: number, field: keyof Mentor, value: string) => {
    setFormData((prev) => ({
      ...prev,
      mentors: prev.mentors.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }));
  };

  const handleUpdateStudentAssignment = (
    studentId: number,
    field: 'job_position' | 'job_description' | 'mentor_id',
    value: string | number | null
  ) => {
    setFormData((prev) => ({
      ...prev,
      students: prev.students.map((s) =>
        s.student_id === studentId ? { ...s, [field]: value } : s
      ),
    }));
  };

  const handleAddMentorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMentor.name || !newMentor.email) {
      setError('กรุณากรอกชื่อและอีเมลของพนักงานที่ปรึกษา');
      return;
    }

    const mentorId = Date.now();
    const createdMentor: Mentor = {
      ...newMentor,
      mentor_id: mentorId,
      has_account: false,
    };

    setFormData((prev) => ({
      ...prev,
      mentors: [...prev.mentors, createdMentor],
    }));

    setNewMentor({
      name: '',
      position: '',
      department: '',
      phone: '',
      fax: '',
      email: '',
    });
    setIsAddMentorModalOpen(false);
    setSuccess(`เพิ่มพนักงานที่ปรึกษา ${createdMentor.name} เรียบร้อยแล้ว`);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      await api.put('/form07', formData);
      setSuccess('บันทึกร่างแบบแจ้งรายละเอียดงานและพนักงานที่ปรึกษา (สหกิจ 07) เรียบร้อยแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกร่างแบบแจ้งรายละเอียดงานและพนักงานที่ปรึกษาได้'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await api.put('/form07', { ...formData, submitted: true });
      setSuccess('ส่งข้อมูล สหกิจ 07 ให้มหาวิทยาลัยเรียบร้อยแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถส่งข้อมูล สหกิจ 07 ให้มหาวิทยาลัยได้'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('company', 'form07')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-16">
      {/* 1. หัวเรื่อง */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-brand-blue dark:text-blue-400 tracking-wider uppercase">
            เอกสารสัปดาห์แรกของการปฏิบัติงาน
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
            แบบแจ้งรายละเอียดงาน ตำแหน่งงาน พนักงานที่ปรึกษา (สหกิจ 07)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            หน้า 1–2 ของแบบฟอร์ม · ผู้ให้ข้อมูลคือผู้จัดการฝ่ายบุคคลหรือพนักงานที่ปรึกษา · ส่งคืนภายในสัปดาห์แรกของการปฏิบัติงาน
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
          <span className="px-3 py-1 bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900 rounded-full text-xs font-bold">
            {dueDateText}
          </span>
          <Button
            data-testid="form07-print"
            variant="secondary"
            size="sm"
            onClick={() => window.open('/api/form07/print', '_blank')}
          >
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect width="12" height="8" x="6" y="14" />
            </svg>
            พิมพ์ใบ 07 (PDF)
          </Button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* แถบข้อมูลแจ้งเตือน */}
      <div className="border border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20 rounded-2xl p-4 sm:p-5 flex items-center gap-3">
        <svg className="w-5 h-5 text-brand-blue dark:text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          ข้อมูลพี่เลี้ยงที่ท่านกรอกตอนกด “ตอบรับเข้างาน” ถูกเติมไว้ให้แล้ว — ใบนี้ขอรายละเอียดเพิ่มที่กระดาษบังคับ (แผนก โทรสาร อีเมล และงานที่มอบหมายรายคน)
        </p>
      </div>

      {/* 2. ส่วนที่ 1: ชื่อและที่อยู่ของสถานประกอบการ */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-5">
        <h2 className="text-lg font-extrabold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-3">
          1 · ชื่อและที่อยู่ของสถานประกอบการ
        </h2>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          ข้อความบนกระดาษ: “โปรดให้ชื่อที่เป็นทางการ เพื่อจะนำไประบุในใบรับรองภาษาอังกฤษให้แก่นักศึกษาได้อย่างถูกต้อง” และ “เพื่อประกอบการเดินทางไปนิเทศงานนักศึกษาที่ถูกต้อง โปรดระบุที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงาน”
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ชื่อสถานประกอบการ (ภาษาไทย)
            </label>
            <Input readOnly value={formData.company.name_th} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ชื่อสถานประกอบการ (ภาษาอังกฤษ)
            </label>
            <Input readOnly value={formData.company.name_en || '-'} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
          </div>
        </div>

        {/* ที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงานจริง (แก้ได้) */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gray-900 dark:text-white">
              ที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงานจริง
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              อาจารย์นิเทศใช้ที่อยู่นี้เดินทาง — ถ้าไม่ใช่สำนักงานใหญ่ ให้แก้ไขตรงนี้
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">เลขที่</label>
              <Input
                data-testid="form07-address-house_no"
                value={formData.company.house_no}
                onChange={(e) => handleUpdateCompany('house_no', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ถนน</label>
              <Input
                data-testid="form07-address-road"
                value={formData.company.road}
                onChange={(e) => handleUpdateCompany('road', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ซอย</label>
              <Input
                data-testid="form07-address-soi"
                value={formData.company.soi}
                onChange={(e) => handleUpdateCompany('soi', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ตำบล / แขวง</label>
              <Input
                data-testid="form07-address-subdistrict"
                value={formData.company.subdistrict}
                onChange={(e) => handleUpdateCompany('subdistrict', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">อำเภอ / เขต</label>
              <Input
                data-testid="form07-address-district"
                value={formData.company.district}
                onChange={(e) => handleUpdateCompany('district', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">จังหวัด</label>
              <Input
                data-testid="form07-address-province"
                value={formData.company.province}
                onChange={(e) => handleUpdateCompany('province', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">รหัสไปรษณีย์</label>
              <Input
                data-testid="form07-address-postal_code"
                value={formData.company.postal_code}
                onChange={(e) => handleUpdateCompany('postal_code', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">โทรศัพท์</label>
              <Input
                value={formData.company.phone}
                onChange={(e) => handleUpdateCompany('phone', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">โทรสาร</label>
              <Input
                value={formData.company.fax}
                onChange={(e) => handleUpdateCompany('fax', e.target.value)}
              />
            </div>
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            นักศึกษาปักหมุดสถานที่ปฏิบัติงานไว้ใน สหกิจ 06 ด้วย — หากที่อยู่ตรงนี้กับหมุดไม่ตรงกัน หน้าจอของอาจารย์นิเทศจะแสดงทั้งสองอย่างโดยไม่เลือกให้เอง
          </p>
        </div>
      </div>

      {/* 3. ส่วนที่ 2: ผู้จัดการทั่วไป และผู้ได้รับมอบหมายให้ประสานงาน */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-5">
        <h2 className="text-lg font-extrabold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-3">
          2 · ผู้จัดการทั่วไป / ผู้จัดการโรงงาน และผู้ได้รับมอบหมายให้ประสานงาน
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ชื่อผู้จัดการสถานประกอบการ
            </label>
            <Input
              data-testid="form07-manager-name"
              value={formData.company.manager_name}
              onChange={(e) => handleUpdateCompany('manager_name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ตำแหน่ง
            </label>
            <Input
              data-testid="form07-manager-position"
              value={formData.company.manager_position}
              onChange={(e) => handleUpdateCompany('manager_position', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              โทรศัพท์ / โทรสาร
            </label>
            <Input
              value={formData.company.manager_phone}
              onChange={(e) => handleUpdateCompany('manager_phone', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              E-mail
            </label>
            <Input
              type="email"
              value={formData.company.manager_email}
              onChange={(e) => handleUpdateCompany('manager_email', e.target.value)}
            />
          </div>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="text-xs font-bold text-gray-900 dark:text-white">
            การติดต่อประสานงานกับมหาวิทยาลัย (การนิเทศงานและอื่น ๆ) ขอมอบให้
          </div>
          <div className="flex flex-col sm:flex-row gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
              <input
                data-testid="form07-contact-mode-manager"
                type="radio"
                name="contact_mode_07"
                checked={formData.company.contact_mode === 'manager'}
                onChange={() => handleUpdateCompany('contact_mode', 'manager')}
              />
              ติดต่อกับผู้จัดการโดยตรง
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
              <input
                data-testid="form07-contact-mode-delegate"
                type="radio"
                name="contact_mode_07"
                checked={formData.company.contact_mode === 'delegate'}
                onChange={() => handleUpdateCompany('contact_mode', 'delegate')}
              />
              มอบหมายให้บุคคลต่อไปนี้ประสานงานแทน
            </label>
          </div>

          {/* ซ่อนด้วย hidden ห้าม unmount */}
          <div className={`grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 ${formData.company.contact_mode === 'delegate' ? '' : 'hidden'}`}>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ชื่อ – นามสกุล
              </label>
              <Input
                value={formData.company.contact_person}
                onChange={(e) => handleUpdateCompany('contact_person', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ตำแหน่ง / แผนก
              </label>
              <Input
                value={formData.company.contact_position_department}
                onChange={(e) => handleUpdateCompany('contact_position_department', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                โทรศัพท์ / โทรสาร
              </label>
              <Input
                value={formData.company.contact_phone}
                onChange={(e) => handleUpdateCompany('contact_phone', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                E-mail
              </label>
              <Input
                type="email"
                value={formData.company.contact_email}
                onChange={(e) => handleUpdateCompany('contact_email', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. ส่วนที่ 3: พนักงานที่ปรึกษา (Job Supervisor / พี่เลี้ยง) */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
              3 · พนักงานที่ปรึกษา (Job Supervisor)
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              คือ “พี่เลี้ยง” ในระบบ — คนละบัญชีกับสถานประกอบการ และเป็นคนเดียวที่กดรับรองงานของนักศึกษาได้
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsAddMentorModalOpen(true)}
          >
            + เพิ่มพนักงานที่ปรึกษาอีกคน
          </Button>
        </div>

        <div className="space-y-4">
          {formData.mentors.map((mentor, idx) => (
            <div
              key={mentor.mentor_id || idx}
              className="border border-blue-200 dark:border-blue-900 rounded-xl overflow-hidden bg-white dark:bg-gray-900"
            >
              <div className="bg-blue-50/70 dark:bg-blue-950/40 px-4 py-2.5 flex justify-between items-center border-b border-blue-100 dark:border-blue-900">
                <span className="text-xs font-bold text-brand-blue dark:text-blue-300">
                  พนักงานที่ปรึกษาคนที่ {idx + 1}
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 text-brand-blue dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {mentor.has_account ? 'มีบัญชีในระบบแล้ว' : 'ส่งลิงก์เชิญเมื่อส่งใบนี้'}
                </span>
              </div>

              <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    ชื่อ – นามสกุล
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-name`}
                    value={mentor.name}
                    onChange={(e) => handleUpdateMentor(idx, 'name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    ตำแหน่ง
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-position`}
                    value={mentor.position}
                    onChange={(e) => handleUpdateMentor(idx, 'position', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    แผนก
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-department`}
                    value={mentor.department}
                    onChange={(e) => handleUpdateMentor(idx, 'department', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    โทรศัพท์
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-phone`}
                    value={mentor.phone}
                    onChange={(e) => handleUpdateMentor(idx, 'phone', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    โทรสาร
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-fax`}
                    value={mentor.fax}
                    onChange={(e) => handleUpdateMentor(idx, 'fax', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    E-mail
                  </label>
                  <Input
                    data-testid={`form07-mentor-${idx}-email`}
                    type="email"
                    value={mentor.email}
                    onChange={(e) => handleUpdateMentor(idx, 'email', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4 flex items-center gap-3 bg-gray-50/50 dark:bg-gray-800/30 text-xs text-gray-600 dark:text-gray-400">
          <svg className="w-5 h-5 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16v16H4z" />
            <path d="m4 7 8 6 8-6" />
          </svg>
          <span>
            พี่เลี้ยงที่ยังไม่มีบัญชี จะได้รับ <strong>ลิงก์เชิญใช้ครั้งเดียว</strong> ทางอีเมลเมื่อท่านกดส่งใบนี้ — ระบบไม่ส่งรหัสผ่านทางอีเมลไม่ว่ากรณีใด
          </span>
        </div>
      </div>

      {/* 5. ส่วนที่ 4: งานที่มอบหมายนักศึกษา */}
      <div className="card bg-white rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 overflow-hidden shadow-sm space-y-0">
        <div className="p-6 sm:p-7 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
            4 · งานที่มอบหมายนักศึกษา ({formData.students.length} คน)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            รายชื่อมาจากนักศึกษาที่ท่านตอบรับไว้แล้ว เพิ่มเองไม่ได้ · ตอนพิมพ์ ระบบแยกเป็นแผ่นละพนักงานที่ปรึกษา ตามรูปแบบของกระดาษ
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                <th className="p-4 font-semibold w-56">ชื่อนักศึกษา</th>
                <th className="p-4 font-semibold w-64">ตำแหน่งงานที่ปฏิบัติ (Job Position)</th>
                <th className="p-4 font-semibold">ลักษณะงานที่ปฏิบัติ (Job Description)</th>
                <th className="p-4 font-semibold w-60">พนักงานที่ปรึกษาที่ดูแล</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {formData.students.map((student) => (
                <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                  <td className="p-4 align-top">
                    <div className="font-bold text-gray-900 dark:text-white">
                      {student.full_name}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                      {student.student_code}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400">
                      {student.major_name_th}
                    </div>
                  </td>
                  <td className="p-4 align-top">
                    <Input
                      data-testid={`form07-assign-${student.student_id}-position`}
                      value={student.job_position}
                      onChange={(e) =>
                        handleUpdateStudentAssignment(student.student_id, 'job_position', e.target.value)
                      }
                      placeholder="เช่น Junior Developer"
                    />
                  </td>
                  <td className="p-4 align-top">
                    <Textarea
                      data-testid={`form07-assign-${student.student_id}-description`}
                      rows={2}
                      value={student.job_description}
                      onChange={(e) =>
                        handleUpdateStudentAssignment(student.student_id, 'job_description', e.target.value)
                      }
                      placeholder="ลักษณะงานที่มอบหมาย..."
                    />
                  </td>
                  <td className="p-4 align-top">
                    <select
                      data-testid={`form07-assign-${student.student_id}-mentor`}
                      value={student.mentor_id || ''}
                      onChange={(e) =>
                        handleUpdateStudentAssignment(
                          student.student_id,
                          'mentor_id',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value="">-- เลือกพนักงานที่ปรึกษา --</option>
                      {formData.mentors.map((m) => (
                        <option key={m.mentor_id} value={m.mentor_id}>
                          {m.name} ({m.position})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer actions */}
        <div className="p-6 sm:p-7 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ลงชื่อผู้ให้ข้อมูล
              </label>
              <Input
                value={formData.informant_name}
                onChange={(e) => setFormData({ ...formData, informant_name: e.target.value })}
                className="w-48"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ตำแหน่ง
              </label>
              <Input
                value={formData.informant_position}
                onChange={(e) => setFormData({ ...formData, informant_position: e.target.value })}
                className="w-44"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">
                วันที่
              </label>
              <Input
                readOnly
                value={todayThai}
                className="w-36 bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              data-testid="form07-save"
              variant="secondary"
              loading={isSaving}
              onClick={handleSave}
            >
              บันทึกร่าง
            </Button>
            <Button
              data-testid="form07-submit"
              variant="primary"
              loading={isSubmitting}
              onClick={handleSubmit}
            >
              ส่งข้อมูลให้มหาวิทยาลัย
            </Button>
          </div>
        </div>
      </div>

      {/* 6. แถบอธิบายท้ายหน้า */}
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-900 flex gap-4 items-start shadow-xs">
        <svg className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed max-w-4xl">
          หน้า 3 ของแบบฟอร์ม 07 คือ <strong>แผนปฏิบัติงาน</strong> ซึ่งนักศึกษาเป็นผู้ร่างร่วมกับพนักงานที่ปรึกษา และลงนามสองฝ่าย — จึงไม่อยู่ในหน้านี้ แต่อยู่ในเมนูของพี่เลี้ยง (รับรองแผนปฏิบัติงาน) กำหนดส่งภายในสัปดาห์ที่ 2
        </p>
      </div>

      {/* Add Mentor Modal */}
      {isAddMentorModalOpen && (
        <Modal
          onClose={() => setIsAddMentorModalOpen(false)}
          size="md"
          title="เพิ่มพนักงานที่ปรึกษา (พี่เลี้ยง)"
        >
          <form onSubmit={handleAddMentorSubmit}>
            <ModalBody className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อ – นามสกุล *
                </label>
                <Input
                  required
                  value={newMentor.name}
                  onChange={(e) => setNewMentor({ ...newMentor, name: e.target.value })}
                  placeholder="เช่น นายสมศักดิ์ รักเรียน"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    ตำแหน่ง
                  </label>
                  <Input
                    value={newMentor.position}
                    onChange={(e) => setNewMentor({ ...newMentor, position: e.target.value })}
                    placeholder="เช่น Senior Engineer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    แผนก
                  </label>
                  <Input
                    value={newMentor.department}
                    onChange={(e) => setNewMentor({ ...newMentor, department: e.target.value })}
                    placeholder="เช่น Software Dept"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    โทรศัพท์
                  </label>
                  <Input
                    value={newMentor.phone}
                    onChange={(e) => setNewMentor({ ...newMentor, phone: e.target.value })}
                    placeholder="เช่น 081-xxx-xxxx"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    โทรสาร
                  </label>
                  <Input
                    value={newMentor.fax}
                    onChange={(e) => setNewMentor({ ...newMentor, fax: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  E-mail (สำหรับส่งลิงก์เชิญเข้าระบบ) *
                </label>
                <Input
                  type="email"
                  required
                  value={newMentor.email}
                  onChange={(e) => setNewMentor({ ...newMentor, email: e.target.value })}
                  placeholder="mentor@company.com"
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsAddMentorModalOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" variant="primary" size="sm">
                บันทึกพนักงานที่ปรึกษา
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default Form07Company;
