import React, { useState } from 'react';
import api from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { EmptyState } from '../../components/ui/EmptyState';
import { getErrorMessage } from '../../utils/errors';

interface Major {
  major_id: number;
  major_name_th: string;
}

interface JobOfferItem {
  job_id: number | null;
  title: string;
  description: string;
  quota: number | '';
  applied_count?: number;
  major_ids: number[];
  duration_term: 'term1' | 'term2' | 'full_year';
  skills_required: string;
  other_requirements: string;
  has_pay: boolean;
  pay_amount: number | '';
  pay_unit: 'day' | 'month';
  accommodation: 'none' | 'free' | 'paid';
  welfare_other: string;
  status?: string;
  reject_reason?: string | null;
  isExpanded?: boolean;
}

interface CompanyDetails {
  company_id?: number;
  name_th: string;
  name_en: string | null;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  fax: string;
  email: string;
  business_type: string;
  employee_count: number | '';
  manager_name: string;
  manager_position: string;
  manager_department: string;
  manager_phone: string;
  manager_fax: string;
  contact_mode: 'manager' | 'delegate';
  contact_person: string;
  contact_position: string;
  contact_department: string;
  contact_phone: string;
  contact_fax: string;
}

const EMPTY_COMPANY: CompanyDetails = {
  name_th: '',
  name_en: null,
  address: '',
  province: '',
  district: '',
  postal_code: '',
  phone: '',
  fax: '',
  email: '',
  business_type: '',
  employee_count: '',
  manager_name: '',
  manager_position: '',
  manager_department: '',
  manager_phone: '',
  manager_fax: '',
  contact_mode: 'manager',
  contact_person: '',
  contact_position: '',
  contact_department: '',
  contact_phone: '',
  contact_fax: '',
};

const createEmptyItem = (): JobOfferItem => ({
  job_id: null,
  title: '',
  description: '',
  quota: 1,
  applied_count: 0,
  major_ids: [],
  duration_term: 'term1',
  skills_required: '',
  other_requirements: '',
  has_pay: false,
  pay_amount: '',
  pay_unit: 'day',
  accommodation: 'none',
  welfare_other: '',
  isExpanded: true,
});

const JobOffer02: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [offerId, setOfferId] = useState<number>(0);
  const [semesterLabel, setSemesterLabel] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [isCopiedFromPrevious, setIsCopiedFromPrevious] = useState<boolean>(false);
  const [previousSemesterLabel, setPreviousSemesterLabel] = useState<string>('');
  const [hasNoOffer, setHasNoOffer] = useState<boolean>(false);
  const [noOfferSemesterLabel, setNoOfferSemesterLabel] = useState<string>('');

  const [company, setCompany] = useState<CompanyDetails>(EMPTY_COMPANY);
  const [items, setItems] = useState<JobOfferItem[]>([]);
  const [majors, setMajors] = useState<Major[]>([]);

  const [informantName, setInformantName] = useState<string>('');
  const [informantPosition, setInformantPosition] = useState<string>('');

  // Decline Modal state
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [isSubmittingDecline, setIsSubmittingDecline] = useState(false);

  const todayThai = new Intl.DateTimeFormat('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [currentOfferRes, masterRes, companyRes] = await Promise.allSettled([
        api.get('/job-offers/current'),
        api.get('/master-data'),
        api.get('/companies/my-company'),
      ]);

      if (masterRes.status === 'fulfilled' && masterRes.value?.majors) {
        setMajors(masterRes.value.majors);
      }

      if (companyRes.status === 'fulfilled' && companyRes.value) {
        const c = companyRes.value;
        setCompany((prev) => ({
          ...prev,
          company_id: c.company_id,
          name_th: c.name_th || prev.name_th,
          name_en: c.name_en || prev.name_en,
          address: c.address || prev.address,
          province: c.province || prev.province,
          district: c.district || prev.district,
          postal_code: c.postal_code || prev.postal_code,
          phone: c.phone || prev.phone,
          fax: c.fax || prev.fax,
          email: c.email || prev.email,
          business_type: c.business_type || prev.business_type,
          employee_count: c.employee_count ?? prev.employee_count,
          manager_name: c.manager_name || prev.manager_name,
          manager_position: c.manager_position || prev.manager_position,
          manager_department: c.manager_department || prev.manager_department,
          manager_phone: c.manager_phone || prev.manager_phone,
          manager_fax: c.manager_fax || prev.manager_fax,
          contact_mode: c.contact_mode || prev.contact_mode,
          contact_person: c.contact_person || prev.contact_person,
          contact_position: c.contact_position || prev.contact_position,
          contact_department: c.contact_department || prev.contact_department,
          contact_phone: c.contact_phone || prev.contact_phone,
          contact_fax: c.contact_fax || prev.contact_fax,
        }));
        if (c.contact_person) setInformantName(c.contact_person);
        if (c.contact_position) setInformantPosition(c.contact_position);
      }

      if (currentOfferRes.status === 'fulfilled' && currentOfferRes.value) {
        const data = currentOfferRes.value;
        if (!data || !data.offer) {
          setHasNoOffer(true);
          if (data?.semester?.label) setNoOfferSemesterLabel(data.semester.label);
          setLoading(false);
          return;
        }

        setHasNoOffer(false);
        setOfferId(data.offer.offer_id);
        if (data.offer.due_date) setDueDate(data.offer.due_date);
        if (data.offer.informant_name) setInformantName(data.offer.informant_name);
        if (data.offer.informant_position) setInformantPosition(data.offer.informant_position);
        setIsCopiedFromPrevious(Boolean(data.offer.copied_from_offer_id));

        if (data.semester?.label) setSemesterLabel(data.semester.label);
        if (data.previous?.semester_label) setPreviousSemesterLabel(data.previous.semester_label);

        if (data.company) {
          setCompany((prev) => ({
            ...prev,
            ...data.company,
          }));
          if (data.company.contact_person && !data.offer.informant_name) {
            setInformantName(data.company.contact_person);
          }
          if (data.company.contact_position && !data.offer.informant_position) {
            setInformantPosition(data.company.contact_position);
          }
        }

        if (data.majors && Array.isArray(data.majors)) {
          setMajors(data.majors);
        }

        if (data.items && Array.isArray(data.items)) {
          setItems(
            data.items.map((it: Partial<JobOfferItem>) => ({
              job_id: it.job_id ?? null,
              title: it.title || '',
              description: it.description || '',
              quota: it.quota || 1,
              applied_count: it.applied_count || 0,
              major_ids: it.major_ids || [],
              duration_term: it.duration_term || 'term1',
              skills_required: it.skills_required || '',
              other_requirements: it.other_requirements || '',
              has_pay: Boolean(it.pay_amount && it.pay_amount > 0),
              pay_amount: it.pay_amount ?? '',
              pay_unit: it.pay_unit || 'day',
              accommodation: it.accommodation || 'none',
              welfare_other: it.welfare_other || '',
              status: it.status,
              reject_reason: it.reject_reason,
              isExpanded: true,
            }))
          );
        } else {
          setItems([]);
        }
      } else {
        setHasNoOffer(true);
      }
    } catch (err) {
      console.error('Failed to load JobOffer02 data:', err);
      setError('ไม่สามารถโหลดข้อมูลแบบเสนองานได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useDashboardData(loadData);

  // Item Management
  const handleAddItem = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };

  const handleDuplicateItem = (index: number) => {
    const target = items[index];
    if (!target) return;
    const duplicated: JobOfferItem = {
      ...target,
      job_id: null,
      title: `${target.title} (สำเนา)`,
      applied_count: 0,
      isExpanded: true,
    };
    const newItems = [...items];
    newItems.splice(index + 1, 0, duplicated);
    setItems(newItems);
  };

  const handleDeleteItem = (index: number) => {
    const target = items[index];
    if (!target) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToggleExpand = (index: number) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, isExpanded: !item.isExpanded } : item))
    );
  };

  const handleUpdateItem = <K extends keyof JobOfferItem>(
    index: number,
    field: K,
    value: JobOfferItem[K]
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleToggleMajor = (itemIndex: number, majorId: number) => {
    const currentMajors = items[itemIndex]?.major_ids || [];
    const nextMajors = currentMajors.includes(majorId)
      ? currentMajors.filter((id) => id !== majorId)
      : [...currentMajors, majorId];
    handleUpdateItem(itemIndex, 'major_ids', nextMajors);
  };

  // Copy previous response
  const handleCopyPrevious = async () => {
    try {
      setError(null);
      await api.post(`/job-offers/${offerId}/copy-previous`);
      setIsCopiedFromPrevious(true);
      setSuccess('คัดลอกคำตอบจากภาคเรียนที่แล้วเรียบร้อยแล้ว');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถคัดลอกคำตอบจากภาคเรียนที่แล้วได้'));
    }
  };

  // Clear all
  const handleClearAll = () => {
    setIsCopiedFromPrevious(false);
    setItems([createEmptyItem()]);
    setSuccess('ล้างข้อมูลเรียบร้อยแล้ว เริ่มกรอกใหม่ได้ทันที');
  };

  // Save Draft (PUT /api/job-offers/:id)
  const handleSaveDraft = async () => {
    try {
      setSavingDraft(true);
      setError(null);
      const payload = {
        company,
        offer: {
          informant_name: informantName,
          informant_position: informantPosition,
        },
        items: items.map((it) => ({
          job_id: it.job_id,
          title: it.title,
          description: it.description,
          quota: Number(it.quota) || 1,
          major_ids: it.major_ids,
          duration_term: it.duration_term,
          skills_required: it.skills_required,
          other_requirements: it.other_requirements,
          pay_amount: it.has_pay ? Number(it.pay_amount) || 0 : null,
          pay_unit: it.has_pay ? it.pay_unit : null,
          accommodation: it.accommodation,
          welfare_other: it.welfare_other,
        })),
      };

      await api.put(`/job-offers/${offerId}`, payload);
      setSuccess('บันทึกร่างแบบเสนองาน (สหกิจ 02) เรียบร้อยแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกร่างแบบเสนองานได้'));
    } finally {
      setSavingDraft(false);
    }
  };

  // Submit Offer (POST /api/job-offers/:id/submit)
  const handleSubmitOffer = async () => {
    if (items.length === 0) {
      setError('กรุณาเพิ่มตำแหน่งงานที่ต้องการเสนออย่างน้อย 1 รายการ');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.title.trim() || !it.quota) {
        setError(`กรุณากรอกชื่อตำแหน่งและจำนวนอัตราในรายการที่ ${i + 1} ให้ครบถ้วน`);
        return;
      }
    }

    try {
      setSubmittingOffer(true);
      setError(null);
      await api.post(`/job-offers/${offerId}/submit`);
      setSuccess('ส่งแบบเสนองานสหกิจศึกษาให้มหาวิทยาลัยเรียบร้อยแล้ว เจ้าหน้าที่จะตรวจสอบข้อมูลต่อไป');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถส่งแบบเสนองานได้'));
    } finally {
      setSubmittingOffer(false);
    }
  };

  // Decline Offer
  const handleConfirmDecline = async () => {
    try {
      setIsSubmittingDecline(true);
      setError(null);
      await api.post(`/job-offers/${offerId}/decline`, { reason: declineReason });
      setSuccess('บันทึกแจ้งงดรับนักศึกษาในภาคเรียนนี้เรียบร้อยแล้ว');
      setIsDeclineModalOpen(false);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกการงดรับนักศึกษาในภาคเรียนนี้ได้'));
      setIsDeclineModalOpen(false);
    } finally {
      setIsSubmittingDecline(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('company', 'jobs')} />;
  }

  if (hasNoOffer) {
    return (
      <div className="card bg-white p-12 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm text-center">
        <EmptyState
          title="ยังไม่มีแบบสำรวจความต้องการรับนักศึกษาในขณะนี้"
          description={
            noOfferSemesterLabel
              ? `เจ้าหน้าที่งานสหกิจศึกษายังไม่ได้จัดส่งแบบสำรวจ (สหกิจ 02) ประจำ${noOfferSemesterLabel} มายังสถานประกอบการของท่าน เมื่อมีการเปิดรับแบบสำรวจ ระบบจะแจ้งเตือนและเปิดให้กรอกข้อมูลที่หน้านี้`
              : 'เจ้าหน้าที่งานสหกิจศึกษายังไม่ได้จัดส่งแบบสำรวจความต้องการรับนักศึกษา (สหกิจ 02) มายังสถานประกอบการของท่าน เมื่อมีการจัดส่งแบบสำรวจ ระบบจะเปิดให้กรอกข้อมูลตำแหน่งงานที่หน้านี้'
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 page-enter pb-16">
      {/* 1. หัวเรื่อง */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-brand-blue dark:text-blue-400 tracking-wider uppercase">
            {semesterLabel}
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
            แบบเสนองานสหกิจศึกษา (สหกิจ 02)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            ใบเดียวต่อหนึ่งภาคการศึกษา · ข้างในเสนอได้หลายตำแหน่ง หลายสาขา — ไม่ต้องทำสำเนาแยกแผ่นเหมือนกระดาษ
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
          <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900 rounded-full text-xs font-bold">
            ส่งกลับก่อนวันที่ {dueDate}
          </span>
          <Button
            data-testid="offer-print"
            variant="secondary"
            size="sm"
            onClick={() => window.open(`/api/job-offers/${offerId}/print`, '_blank')}
          >
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect width="12" height="8" x="6" y="14" />
            </svg>
            พิมพ์แบบฟอร์ม (PDF)
          </Button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. แถบใช้คำตอบเดิม */}
      <div className="border border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-brand-blue dark:text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-white">
              {isCopiedFromPrevious ? `คัดลอกคำตอบของ${previousSemesterLabel} มาให้แล้ว` : `สามารถคัดลอกคำตอบจาก${previousSemesterLabel} ได้`}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              ทุกช่องแก้ได้ตามปกติ · การส่งใบนี้ไม่ไปแตะข้อมูลของภาคที่แล้ว
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isCopiedFromPrevious && (
            <Button
              data-testid="offer-copy-previous"
              variant="secondary"
              size="sm"
              onClick={handleCopyPrevious}
            >
              คัดลอกคำตอบภาคที่แล้ว
            </Button>
          )}
          <Button
            data-testid="offer-clear"
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
          >
            ล้างทั้งหมด เริ่มกรอกใหม่
          </Button>
        </div>
      </div>

      {/* 3. ส่วนที่ 1 · รายละเอียดสถานประกอบการ */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-6">
        <div className="flex justify-between items-baseline border-b border-gray-100 dark:border-gray-800 pb-3">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
            ส่วนที่ 1 · รายละเอียดสถานประกอบการ
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ตรงกับหน้า 1/2 ของแบบฟอร์มกระดาษ
          </span>
        </div>

        {/* ข้อมูลที่เจ้าหน้าที่รับรองไว้แล้ว (readOnly) */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-300">
            <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            ข้อมูลที่เจ้าหน้าที่รับรองไว้แล้ว — แก้ในหน้านี้ไม่ได้
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อสถานประกอบการ (ภาษาไทย)
              </label>
              <Input readOnly value={company.name_th} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อสถานประกอบการ (ภาษาอังกฤษ)
              </label>
              <Input readOnly value={company.name_en || '-'} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ที่อยู่</label>
              <Input readOnly value={company.address} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">จังหวัด</label>
              <Input readOnly value={company.province} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">รหัสไปรษณีย์</label>
              <Input readOnly value={company.postal_code} className="bg-gray-100/70 dark:bg-gray-800/80 cursor-not-allowed" />
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            ผิดตรงไหนแจ้งเจ้าหน้าที่งานสหกิจศึกษาแก้ให้ — ข้อมูลชุดนี้ถูกพิมพ์ลงหนังสือราชการที่คณบดีลงนาม
          </p>
        </div>

        {/* ช่องติดต่อและข้อมูลสถานประกอบการที่แก้ได้ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              โทรศัพท์
            </label>
            <Input
              value={company.phone}
              onChange={(e) => setCompany({ ...company, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              โทรสาร
            </label>
            <Input
              value={company.fax}
              onChange={(e) => setCompany({ ...company, fax: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              E-mail
            </label>
            <Input
              type="email"
              value={company.email}
              onChange={(e) => setCompany({ ...company, email: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ผลิตภัณฑ์ / ลักษณะการดำเนินงาน
            </label>
            <Input
              value={company.business_type}
              onChange={(e) => setCompany({ ...company, business_type: e.target.value })}
              placeholder="เช่น การผลิตฮาร์ดดิสก์, พัฒนาซอฟต์แวร์..."
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              จำนวนพนักงานรวม (คน)
            </label>
            <Input
              type="number"
              value={company.employee_count}
              onChange={(e) =>
                setCompany({
                  ...company,
                  employee_count: e.target.value !== '' ? Number(e.target.value) : '',
                })
              }
            />
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-4">
          <div className="text-sm font-bold text-gray-900 dark:text-white">
            ผู้จัดการสถานประกอบการ / หัวหน้าหน่วยงาน
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ชื่อ – นามสกุล
              </label>
              <Input
                value={company.manager_name}
                onChange={(e) => setCompany({ ...company, manager_name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ตำแหน่ง
              </label>
              <Input
                value={company.manager_position}
                onChange={(e) => setCompany({ ...company, manager_position: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                แผนก
              </label>
              <Input
                value={company.manager_department}
                onChange={(e) => setCompany({ ...company, manager_department: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                โทรศัพท์ / โทรสาร
              </label>
              <Input
                value={company.manager_phone}
                onChange={(e) => setCompany({ ...company, manager_phone: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* การติดต่อประสานงาน */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="text-xs font-bold text-gray-900 dark:text-white">
            หากมหาวิทยาลัยประสงค์จะติดต่อประสานงาน ขอให้
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
              <input
                type="radio"
                name="contact_mode"
                checked={company.contact_mode === 'manager'}
                onChange={() => setCompany({ ...company, contact_mode: 'manager' })}
                className="w-4 h-4 text-brand-blue"
              />
              ติดต่อโดยตรงกับผู้จัดการ / หัวหน้าหน่วยงาน
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
              <input
                type="radio"
                name="contact_mode"
                checked={company.contact_mode === 'delegate'}
                onChange={() => setCompany({ ...company, contact_mode: 'delegate' })}
                className="w-4 h-4 text-brand-blue"
              />
              ติดต่อกับบุคคลที่สถานประกอบการมอบหมาย
            </label>
          </div>

          {/* ซ่อนด้วย hidden ห้าม unmount (Rule 0) */}
          <div className={`grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 ${company.contact_mode === 'delegate' ? '' : 'hidden'}`}>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ชื่อ – นามสกุล
              </label>
              <Input
                value={company.contact_person}
                onChange={(e) => setCompany({ ...company, contact_person: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ตำแหน่ง
              </label>
              <Input
                value={company.contact_position}
                onChange={(e) => setCompany({ ...company, contact_position: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                แผนก
              </label>
              <Input
                value={company.contact_department}
                onChange={(e) => setCompany({ ...company, contact_department: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                โทรศัพท์ / โทรสาร
              </label>
              <Input
                value={company.contact_phone}
                onChange={(e) => setCompany({ ...company, contact_phone: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. ส่วนที่ 2 · ตำแหน่งที่เสนอ */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
              ส่วนที่ 2 · ตำแหน่งที่เสนอ ({items.length} รายการ)
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              ตรงกับหน้า 2/2 ของกระดาษ — ตอนพิมพ์ ระบบวนพิมพ์หน้านี้หนึ่งแผ่นต่อหนึ่งรายการ
            </p>
          </div>
          <Button
            data-testid="offer-add-item"
            variant="secondary"
            size="sm"
            onClick={handleAddItem}
          >
            + เพิ่มตำแหน่ง
          </Button>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20 p-3.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          ข้อความบนกระดาษ: “หากต้องการมากกว่า 1 สาขาวิชา กรุณาทำสำเนาเฉพาะแผ่นนี้และเขียนรายละเอียดแยกสาขาวิชาละ 1 แผ่น” — ในระบบไม่ต้องทำสำเนา สามารถระบุหลายสาขาในรายการเดียว หรือเพิ่มรายการแยกได้
        </div>

        {/* รายการตำแหน่งงาน */}
        <div className="space-y-4">
          {items.map((item, index) => (
            <div
              key={index}
              data-testid={`offer-item-${index}`}
              className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900"
            >
              {/* Item Header */}
              <div className="bg-gray-50 dark:bg-gray-800/80 px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-brand-blue dark:text-blue-400">
                    รายการที่ {index + 1}
                  </span>
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    {item.title || '(ยังไม่ได้ระบุชื่อตำแหน่ง)'} · {item.quota || 0} อัตรา
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    data-testid="offer-item-duplicate"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicateItem(index)}
                  >
                    ทำสำเนารายการ
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleExpand(index)}
                  >
                    {item.isExpanded ? 'ย่อ' : 'กางเพื่อแก้'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50 dark:text-red-400"
                    onClick={() => handleDeleteItem(index)}
                  >
                    ลบรายการนี้
                  </Button>
                </div>
              </div>

              {/* Item Body (ซ่อนด้วย hidden ห้าม unmount) */}
              <div className={`p-5 space-y-4 ${item.isExpanded ? '' : 'hidden'}`}>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* สาขาที่ต้องการ */}
                  <div className="md:col-span-6 space-y-1.5">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                      สาขาวิชาที่ต้องการ
                    </label>
                    <div
                      data-testid="offer-major"
                      className="border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-wrap gap-1.5 min-h-[42px] bg-white dark:bg-gray-800"
                    >
                      {majors.map((m) => {
                        const isSelected = item.major_ids.includes(m.major_id);
                        return (
                          <button
                            key={m.major_id}
                            type="button"
                            onClick={() => handleToggleMajor(index, m.major_id)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                              isSelected
                                ? 'bg-blue-50 text-brand-blue border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                            }`}
                          >
                            {m.major_name_th} {isSelected ? '✕' : '+'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* จำนวนรับ */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      จำนวนงานที่เสนอ (อัตรา)
                    </label>
                    <Input
                      data-testid="offer-quota"
                      type="number"
                      min={1}
                      value={item.quota}
                      onChange={(e) =>
                        handleUpdateItem(
                          index,
                          'quota',
                          e.target.value !== '' ? Number(e.target.value) : ''
                        )
                      }
                    />
                  </div>

                  {/* ตำแหน่งงาน */}
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      ตำแหน่งงานที่เสนอ (Job Position)
                    </label>
                    <Input
                      data-testid="offer-title"
                      value={item.title}
                      onChange={(e) => handleUpdateItem(index, 'title', e.target.value)}
                      placeholder="เช่น Full-Stack Developer"
                    />
                  </div>
                </div>

                {/* ลักษณะงาน */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    ลักษณะงานที่นักศึกษาต้องปฏิบัติ (Job Description)
                  </label>
                  <Textarea
                    data-testid="offer-description"
                    rows={3}
                    value={item.description}
                    onChange={(e) => handleUpdateItem(index, 'description', e.target.value)}
                    placeholder="ระบุภาระงานและหน้าที่ความรับผิดชอบ..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      ความสามารถทางวิชาการหรือทักษะที่ควรมี
                    </label>
                    <Textarea
                      data-testid="offer-skills"
                      rows={2}
                      value={item.skills_required}
                      onChange={(e) => handleUpdateItem(index, 'skills_required', e.target.value)}
                      placeholder="เช่น ทักษะภาษาโปรแกรม, ฐานข้อมูล, ภาษาอังกฤษ..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      ข้อกำหนดอื่น ๆ
                    </label>
                    <Textarea
                      data-testid="offer-requirements"
                      rows={2}
                      value={item.other_requirements}
                      onChange={(e) => handleUpdateItem(index, 'other_requirements', e.target.value)}
                      placeholder="อุปกรณ์ที่ต้องเตรียมมา, สถานที่ปฏิบัติงานจริง..."
                    />
                  </div>
                </div>

                {/* ระยะเวลาและสวัสดิการ */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
                  {/* ระยะเวลา */}
                  <div className="lg:col-span-5 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-2.5">
                    <div className="text-xs font-bold text-gray-900 dark:text-white">
                      ระยะเวลาที่ต้องการให้ไปปฏิบัติงาน
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-term-term1"
                          type="radio"
                          name={`duration_term_${index}`}
                          checked={item.duration_term === 'term1'}
                          onChange={() => handleUpdateItem(index, 'duration_term', 'term1')}
                        />
                        ภาคเรียนที่ 1
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-term-term2"
                          type="radio"
                          name={`duration_term_${index}`}
                          checked={item.duration_term === 'term2'}
                          onChange={() => handleUpdateItem(index, 'duration_term', 'term2')}
                        />
                        ภาคเรียนที่ 2
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-term-full_year"
                          type="radio"
                          name={`duration_term_${index}`}
                          checked={item.duration_term === 'full_year'}
                          onChange={() => handleUpdateItem(index, 'duration_term', 'full_year')}
                        />
                        ตลอดปีการศึกษา (ภาค 1 และ ภาค 2)
                      </label>
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      “ตลอดปีการศึกษา” จะปรากฏในแบบสำรวจของทั้งสองภาคโดยไม่ต้องกรอกซ้ำ
                    </p>
                  </div>

                  {/* สวัสดิการ */}
                  <div className="lg:col-span-7 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-bold text-gray-900 dark:text-white">
                      สวัสดิการของตำแหน่งนี้
                    </div>

                    {/* ค่าตอบแทน */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-16">
                        ค่าตอบแทน:
                      </span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-pay-none"
                          type="radio"
                          name={`pay_${index}`}
                          checked={!item.has_pay}
                          onChange={() => handleUpdateItem(index, 'has_pay', false)}
                        />
                        ไม่มี
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-pay-has"
                          type="radio"
                          name={`pay_${index}`}
                          checked={item.has_pay}
                          onChange={() => handleUpdateItem(index, 'has_pay', true)}
                        />
                        มี
                      </label>

                      {/* ซ่อนด้วย hidden ห้าม unmount */}
                      <div className={`flex items-center gap-2 ${item.has_pay ? '' : 'hidden'}`}>
                        <Input
                          data-testid="offer-pay-amount"
                          type="number"
                          placeholder="จำนวนเงิน"
                          value={item.pay_amount}
                          onChange={(e) =>
                            handleUpdateItem(
                              index,
                              'pay_amount',
                              e.target.value !== '' ? Number(e.target.value) : ''
                            )
                          }
                          className="w-24"
                        />
                        <select
                          data-testid="offer-pay-unit"
                          value={item.pay_unit}
                          onChange={(e) =>
                            handleUpdateItem(index, 'pay_unit', e.target.value as 'day' | 'month')
                          }
                          className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800"
                        >
                          <option value="day">บาท / วัน</option>
                          <option value="month">บาท / เดือน</option>
                        </select>
                      </div>
                    </div>

                    {/* ที่พัก */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-16">
                        ที่พัก:
                      </span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-acc-none"
                          type="radio"
                          name={`acc_${index}`}
                          checked={item.accommodation === 'none'}
                          onChange={() => handleUpdateItem(index, 'accommodation', 'none')}
                        />
                        ไม่มี
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-acc-free"
                          type="radio"
                          name={`acc_${index}`}
                          checked={item.accommodation === 'free'}
                          onChange={() => handleUpdateItem(index, 'accommodation', 'free')}
                        />
                        มี · ไม่เสียค่าใช้จ่าย
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                        <input
                          data-testid="offer-acc-paid"
                          type="radio"
                          name={`acc_${index}`}
                          checked={item.accommodation === 'paid'}
                          onChange={() => handleUpdateItem(index, 'accommodation', 'paid')}
                        />
                        มี · นักศึกษาจ่ายเอง
                      </label>
                    </div>

                    {/* สวัสดิการอื่น */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        สวัสดิการอื่น ๆ (ถ้ามี)
                      </label>
                      <Input
                        data-testid="offer-welfare-other"
                        value={item.welfare_other}
                        onChange={(e) => handleUpdateItem(index, 'welfare_other', e.target.value)}
                        placeholder="เช่น รถรับส่งพนักงาน, อาหารกลางวัน..."
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. ผู้ให้ข้อมูลและการส่งกลับ */}
      <div className="card bg-white p-6 sm:p-7 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm space-y-6">
        <h2 className="text-lg font-extrabold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-3">
          ผู้ให้ข้อมูลและการส่งกลับ
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ลงชื่อผู้ให้ข้อมูล
            </label>
            <Input
              data-testid="offer-informant-name"
              value={informantName}
              onChange={(e) => setInformantName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ตำแหน่ง
            </label>
            <Input
              data-testid="offer-informant-position"
              value={informantPosition}
              onChange={(e) => setInformantPosition(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              วันที่
            </label>
            <Input
              readOnly
              value={todayThai}
              className="bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl leading-relaxed">
            เมื่อส่งแล้ว เจ้าหน้าที่จะตรวจก่อนเปิดให้นักศึกษาเห็น · ระหว่างรอตรวจ ท่านยังแก้และส่งใหม่ได้ · หลังเปิดให้นักศึกษาเห็นแล้ว การแก้จะกลับไปรอตรวจอีกครั้ง
          </p>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              data-testid="offer-decline"
              variant="ghost"
              size="sm"
              className="text-red-600 hover:bg-red-50 dark:text-red-400"
              onClick={() => setIsDeclineModalOpen(true)}
            >
              งดรับนักศึกษา
            </Button>
            <Button
              data-testid="offer-save-draft"
              variant="secondary"
              loading={savingDraft}
              onClick={handleSaveDraft}
            >
              บันทึกร่างไว้ก่อน
            </Button>
            <Button
              data-testid="offer-submit"
              variant="primary"
              loading={submittingOffer}
              onClick={handleSubmitOffer}
            >
              ส่งแบบเสนองานให้มหาวิทยาลัย
            </Button>
          </div>
        </div>
      </div>

      {/* 6. สถานะหลังส่ง */}
      <div className="card bg-white p-5 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs shadow-xs">
        <span className="font-bold text-gray-900 dark:text-white shrink-0">
          เส้นทางของใบนี้หลังกดส่ง:
        </span>
        <div className="flex items-center gap-2 flex-wrap text-gray-600 dark:text-gray-400">
          <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 font-medium">
            ร่าง
          </span>
          <span>→</span>
          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 font-medium">
            ส่งแล้ว · รอเจ้าหน้าที่ตรวจ
          </span>
          <span>→</span>
          <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 font-medium">
            เปิดให้นักศึกษาเห็นแล้ว
          </span>
          <span>/</span>
          <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 font-medium">
            เจ้าหน้าที่ส่งกลับให้แก้
          </span>
        </div>
      </div>

      {/* Decline Offer Modal */}
      {isDeclineModalOpen && (
        <Modal
          onClose={() => setIsDeclineModalOpen(false)}
          size="md"
          title="ยืนยันการงดรับนักศึกษาในภาคเรียนนี้"
        >
          <ModalBody className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              สถานประกอบการของท่านจะแจ้งไปยังงานสหกิจศึกษาว่าไม่ประสงค์รับนักศึกษาใน{semesterLabel} (การงดรับไม่ส่งผลต่อการส่งแบบสำรวจในภาคถัดไป)
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เหตุผล (ระบุหรือไม่ระบุก็ได้)
              </label>
              <Textarea
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="ระบุเหตุผลในการงดรับนักศึกษา..."
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setIsDeclineModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isSubmittingDecline}
              onClick={handleConfirmDecline}
            >
              ยืนยันงดรับนักศึกษา
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default JobOffer02;
