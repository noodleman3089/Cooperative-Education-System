import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import PageSkeleton from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  Plus,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  Printer,
  Send,
  Lock,
  X,
  FileText,
  ShieldCheck,
} from 'lucide-react';

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
  name_en: '',
  address: '',
  province: '',
  district: '',
  postal_code: '',
  phone: '',
  fax: '',
  email: '',
  business_type: '',
  employee_count: 0,
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
  duration_term: 'full_year',
  skills_required: '',
  other_requirements: '',
  has_pay: true,
  pay_amount: 300,
  pay_unit: 'day',
  accommodation: 'none',
  welfare_other: '',
  isExpanded: true,
});

const JobOffer02Token: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const initialStatus = useMemo(() => {
    if (!token) return 'missing';
    if (token === 'expired') return 'expired';
    return 'active';
  }, [token]);

  const [loading, setLoading] = useState<boolean>(Boolean(token && token !== 'expired'));
  const [status, setStatus] = useState<'active' | 'expired' | 'submitted' | 'missing' | 'error'>(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Resend state
  const [resendLoading, setResendLoading] = useState<boolean>(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Data state
  const [offerId, setOfferId] = useState<number | null>(null);
  const [semesterLabel, setSemesterLabel] = useState<string>('');
  const [previousSemesterLabel, setPreviousSemesterLabel] = useState<string>('');
  const [expiresAtText, setExpiresAtText] = useState<string>('');
  const [sentAtText] = useState<string>('');
  const [hoursLeftText, setHoursLeftText] = useState<string>('');
  const [registeredEmail, setRegisteredEmail] = useState<string>('');

  const [company, setCompany] = useState<CompanyDetails>(EMPTY_COMPANY);
  const [items, setItems] = useState<JobOfferItem[]>([]);
  const [majors, setMajors] = useState<Major[]>([]);

  const [informantName, setInformantName] = useState<string>('');
  const [informantPosition, setInformantPosition] = useState<string>('');

  // Submit / Decline / Confirm modals
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState<boolean>(false);
  const [declineReason, setDeclineReason] = useState<string>('');
  const [isDeclineSubmitting, setIsDeclineSubmitting] = useState<boolean>(false);
  const [confirmSameOpen, setConfirmSameOpen] = useState<boolean>(false);

  // Initial Load with token validation
  useEffect(() => {
    if (!token || token === 'expired') {
      return;
    }

    const loadPublicOffer = async () => {
      try {
        setErrorMessage(null);

        // ⛔ /public/job-offer คืน body ตรง ๆ ไม่มี `.data` ห่ออีกชั้น (ต่างจาก endpoint อื่นในไฟล์นี้)
        const data = await api.get(`/public/job-offer?token=${encodeURIComponent(token)}`);

        if (data?.status === 'submitted') {
          setStatus('submitted');
          return;
        }

        if (data?.semester?.label) {
          setSemesterLabel(data.semester.label);
        }
        if (data?.offer?.offer_id) {
          setOfferId(data.offer.offer_id);
        }
        if (data?.previous?.semester_label) {
          setPreviousSemesterLabel(data.previous.semester_label);
        }
        if (data?.offer?.informant_name) {
          setInformantName(data.offer.informant_name);
        }
        if (data?.offer?.informant_position) {
          setInformantPosition(data.offer.informant_position);
        }
        if (data?.company) {
          setCompany((prev) => ({
            ...prev,
            ...data.company,
          }));
          if (data.company.email) {
            setRegisteredEmail(data.company.email);
          }
        }
        if (data?.majors && Array.isArray(data.majors)) {
          setMajors(data.majors);
        }
        if (data?.token_expires_at) {
          try {
            const expDate = new Date(data.token_expires_at);
            setExpiresAtText(
              new Intl.DateTimeFormat('th-TH', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(expDate)
            );
            const diffMs = expDate.getTime() - Date.now();
            const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
            setHoursLeftText(`${hours} ชั่วโมง`);
          } catch {
            // Keep default
          }
        }

        if (data?.items && Array.isArray(data.items)) {
          setItems(
            data.items.map((it: JobOfferItem) => ({
              ...it,
              quota: it.quota ?? 1,
              has_pay: Number(it.pay_amount ?? 0) > 0,
              pay_amount: it.pay_amount ?? 300,
              pay_unit: it.pay_unit ?? 'day',
              accommodation: it.accommodation ?? 'none',
              welfare_other: it.welfare_other ?? '',
              isExpanded: false,
            }))
          );
        } else {
          setItems([]);
        }

        setStatus('active');
      } catch (err: unknown) {
        const anyErr = err as { response?: { status?: number; data?: { message?: string } } };
        if (anyErr?.response?.status === 410) {
          setStatus('expired');
          setErrorMessage(anyErr.response.data?.message || 'ลิงก์นี้หมดอายุหรือถูกใช้งานไปแล้ว');
        } else {
          setStatus('error');
          setErrorMessage(getErrorMessage(err, 'ไม่สามารถเปิดแบบสำรวจได้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา'));
        }
      } finally {
        setLoading(false);
      }
    };

    loadPublicOffer();
  }, [token]);

  // Cooldown timer effect
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Handle Token Resend
  const handleResendToken = async () => {
    if (!token || resendCooldown > 0) return;
    try {
      setResendLoading(true);
      setErrorMessage(null);
      await api.post(`/public/job-offer/resend?token=${encodeURIComponent(token)}`);
      setSuccessBanner(`ระบบได้ส่งลิงก์ใหม่ไปยังอีเมลในทะเบียน (${registeredEmail}) เรียบร้อยแล้ว กรุณาตรวจสอบกล่องข้อความ`);
      setResendCooldown(600); // 10 minutes limit per Spec D 4.3
    } catch (err) {
      setErrorMessage(getErrorMessage(err, 'ไม่สามารถขอลิงก์ใหม่ได้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา'));
    } finally {
      setResendLoading(false);
    }
  };

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
    if (items.length <= 1) {
      setErrorMessage('ต้องมีตำแหน่งงานเสนออย่างน้อย 1 ตำแหน่ง หรือเลือก "ยังไม่รับในภาคนี้"');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToggleMajor = (itemIndex: number, majorId: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== itemIndex) return item;
        const exists = item.major_ids.includes(majorId);
        const updated = exists
          ? item.major_ids.filter((id) => id !== majorId)
          : [...item.major_ids, majorId];
        return { ...item, major_ids: updated };
      })
    );
  };

  // Choice 1: Accept Same As Previous Term
  const handleAcceptSamePrevious = async () => {
    setConfirmSameOpen(false);
    await executeSubmit();
  };

  // Choice 2: Scroll to form
  const handleScrollToForm = () => {
    const formElem = document.getElementById('token-offer-form');
    if (formElem) {
      formElem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Choice 3: Decline
  const handleConfirmDecline = async () => {
    try {
      setIsDeclineSubmitting(true);
      setErrorMessage(null);
      await api.post(`/public/job-offer/decline?token=${encodeURIComponent(token || '')}`, {
        reason: declineReason || 'สถานประกอบการไม่สะดวกรับนักศึกษาในภาคเรียนนี้',
      });
      setIsDeclineModalOpen(false);
      setStatus('submitted');
    } catch (err) {
      setErrorMessage(getErrorMessage(err, 'ไม่สามารถบันทึกการงดรับนักศึกษาในภาคเรียนนี้ได้'));
      setIsDeclineModalOpen(false);
    } finally {
      setIsDeclineSubmitting(false);
    }
  };

  // Submit Offer
  const executeSubmit = async () => {
    if (items.length === 0) {
      setErrorMessage('กรุณาเพิ่มตำแหน่งงานที่ต้องการเสนออย่างน้อย 1 รายการ');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.title.trim() || !it.quota) {
        setErrorMessage(`กรุณากรอกชื่อตำแหน่งและจำนวนอัตราในรายการที่ ${i + 1} ให้ครบถ้วน`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setErrorMessage(null);
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

      await api.put(`/public/job-offer?token=${encodeURIComponent(token || '')}`, payload);
      setStatus('submitted');
    } catch (err) {
      setErrorMessage(getErrorMessage(err, 'ไม่สามารถส่งแบบเสนองานได้'));
    } finally {
      setSubmitting(false);
    }
  };

  // Print functionality
  const handlePrint = () => {
    window.print();
  };

  // Total Quota
  const totalQuota = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.quota) || 0), 0);
  }, [items]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full">
          <PageSkeleton variant="form" />
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm text-center max-w-md w-full border border-red-200 dark:border-red-900/40">
          <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">ไม่สามารถเปิดแบบสำรวจได้</h2>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6 leading-relaxed">
            {errorMessage || 'ลิงก์ไม่ถูกต้องหรือเกิดข้อผิดพลาดในการตรวจสอบข้อมูล กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา'}
          </p>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/login')}>
            กลับหน้าเข้าสู่ระบบหลัก
          </Button>
        </div>
      </div>
    );
  }

  // Missing token state
  if (status === 'missing') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm text-center max-w-md w-full border border-red-100 dark:border-red-900/40">
          <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">ไม่พบรหัส Token เข้าถึงแบบสำรวจ</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 leading-relaxed">
            กรุณาเปิดลิงก์ที่ได้รับจากอีเมลของท่านโดยตรง หรือติดต่อเจ้าหน้าที่โครงการสหกิจศึกษา
          </p>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/login')}>
            กลับหน้าเข้าสู่ระบบหลัก
          </Button>
        </div>
      </div>
    );
  }

  // State 2: Expired Token (410 Gone / Used)
  if (status === 'expired') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        {/* แถบบน */}
        <div className="fixed top-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-brand-blue flex items-center justify-center font-black text-sm">
              RMUTTO
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base">
              งานสหกิจศึกษาและการฝึกงานวิชาชีพ · มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">ไม่ต้องเข้าสู่ระบบ</span>
        </div>

        <div className="max-w-2xl w-full mt-20" data-testid="token-expired">
          {successBanner && (
            <div className="mb-4">
              <AlertBanner message={successBanner} variant="success" />
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900/40 rounded-2xl p-8 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2">ลิงก์นี้หมดอายุแล้ว</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
                  ลิงก์ตอบแบบสำรวจมีอายุ 24 ชั่วโมงและใช้ได้ครั้งเดียว เพื่อไม่ให้ลิงก์ที่ถูกส่งต่อในอีเมลกลายเป็นทางเข้าถาวร
                  · หากท่านต้องการตอบแบบสำรวจ สามารถกดขอลิงก์ใหม่ ระบบจะส่งไปที่อีเมลผู้ประสานงานในทะเบียนเท่านั้น
                  ไม่อนุญาตให้พิมพ์อีเมลปลายทางเองเพื่อความปลอดภัย
                </p>

                <div className="flex flex-wrap gap-3 items-center">
                  <Button
                    variant="primary"
                    data-testid="token-resend"
                    onClick={handleResendToken}
                    disabled={resendLoading || resendCooldown > 0}
                    className="shadow-sm"
                  >
                    {resendLoading ? (
                      'กำลังส่งลิงก์ใหม่...'
                    ) : resendCooldown > 0 ? (
                      `ขอลิงก์ใหม่แล้ว (รอ ${Math.floor(resendCooldown / 60)} นาที)`
                    ) : (
                      `ขอลิงก์ใหม่ไปที่ ${registeredEmail}`
                    )}
                  </Button>
                </div>

                <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  จำกัดการขอลิงก์ใหม่ 1 ครั้งต่อ 10 นาที เพื่อป้องกันการส่งอีเมลซ้ำซ้อน
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // State 3: Submitted Successfully
  if (status === 'submitted') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        {/* แถบบน */}
        <div className="fixed top-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-brand-blue flex items-center justify-center font-black text-sm">
              RMUTTO
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base">
              งานสหกิจศึกษาและการฝึกงานวิชาชีพ · มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">ไม่ต้องเข้าสู่ระบบ</span>
        </div>

        <div className="max-w-xl w-full mt-20 text-center">
          <div className="bg-white dark:bg-gray-800 border border-green-200 dark:border-green-900/40 rounded-3xl p-10 shadow-sm flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 flex items-center justify-center mb-6 shadow-inner">
              <CheckCircle className="w-10 h-10" />
            </div>
            <span className="text-xs font-bold text-green-700 dark:text-green-400 uppercase tracking-widest mb-1">
              Submission Completed
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white mb-3">
              ส่งแบบเสนองาน สหกิจ 02 เรียบร้อยแล้ว
            </h2>
            <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base leading-relaxed mb-6">
              ขอขอบพระคุณ <strong className="text-gray-900 dark:text-white">{company.name_th}</strong>{' '}
              ที่ให้ความอนุเคราะห์รับนักศึกษาปฏิบัติงานสหกิจศึกษา มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก
              ข้อมูลของท่านได้รับการบันทึกเข้าสู่ระบบเรียบร้อยแล้ว และเจ้าหน้าที่จะดำเนินการต่อไป
            </p>

            <div className="w-full bg-gray-50 dark:bg-gray-900/50 rounded-2xl p-4 mb-6 border border-gray-100 dark:border-gray-800 text-left text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-2">
              <div className="flex justify-between">
                <span>ภาคการศึกษา:</span>
                <span className="font-bold text-gray-900 dark:text-white">{semesterLabel}</span>
              </div>
              <div className="flex justify-between">
                <span>จำนวนตำแหน่งที่เสนอ:</span>
                <span className="font-bold text-gray-900 dark:text-white">{items.length} ตำแหน่ง ({totalQuota} อัตรา)</span>
              </div>
              <div className="flex justify-between">
                <span>ผู้ให้ข้อมูล:</span>
                <span className="font-bold text-gray-900 dark:text-white">{informantName} ({informantPosition})</span>
              </div>
              <div className="flex justify-between">
                <span>ความปลอดภัย:</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">Token ถูกเผาทำลายแล้ว (Single-use)</span>
              </div>
            </div>

            <div className="flex gap-3 justify-center w-full">
              <Button variant="secondary" icon={<Printer className="w-4 h-4" />} onClick={handlePrint}>
                พิมพ์เอกสารยืนยัน
              </Button>
              <Button variant="primary" onClick={() => window.close()}>
                ปิดหน้าต่างนี้
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // State 1: Active Valid Token
  return (
    <div className="min-h-screen bg-[#F3F4F6] dark:bg-[#0f172a] text-gray-900 dark:text-gray-100 flex flex-col font-sans">
      {/* 1. Header (ไม่มีเมนู ไม่ต้องล็อกอิน) */}
      <header className="h-[68px] bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 sm:px-8 shrink-0 z-20 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-brand-blue flex items-center justify-center font-black text-sm">
            RMUTTO
          </div>
          <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base tracking-tight">
            งานสหกิจศึกษาและการฝึกงานวิชาชีพ · มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-medium">
            ไม่ต้องเข้าสู่ระบบ
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-[1120px] w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <AlertBanner message={errorMessage} variant="error" />
        <AlertBanner message={successBanner} variant="success" />

        {/* 2. สถานะลิงก์ (Expiration Notice Card) */}
        <div className="border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4 shadow-xs">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm sm:text-base font-bold text-amber-900 dark:text-amber-200">
                ลิงก์นี้ใช้ได้ถึง {expiresAtText} และใช้ได้ครั้งเดียว
              </span>
              <span className="text-xs sm:text-sm text-amber-800 dark:text-amber-300/80 leading-relaxed">
                ส่งไปที่ {registeredEmail} เมื่อ {sentAtText} · หมดอายุแล้วขอลิงก์ใหม่ได้จากหน้านี้ ระบบไม่ต่ออายุให้เองโดยตั้งใจ
              </span>
            </div>
          </div>
          <span className="shrink-0 text-xs sm:text-sm font-bold bg-white dark:bg-gray-800 text-amber-800 dark:text-amber-300 px-3.5 py-1.5 rounded-full border border-amber-200 dark:border-amber-800/60 shadow-xs">
            เหลือเวลา {hoursLeftText}
          </span>
        </div>

        {/* 3. การ์ดหัวเรื่อง (Title Hero Card) */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 sm:p-8 flex flex-col gap-2 shadow-xs">
          <span className="text-xs font-bold text-brand-blue uppercase tracking-wider">
            แบบเสนองานสหกิจศึกษา (สหกิจ 02) · {semesterLabel} · ใบคำขอ #{offerId}
          </span>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white leading-snug">
            {company.name_th} รับนักศึกษาสหกิจศึกษาในภาคเรียนนี้หรือไม่
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ตอบได้จากหน้านี้เลย ไม่ต้องเข้าสู่ระบบ · ถ้าท่านมีบัญชีอยู่แล้ว จะเข้าไปแก้ทีหลังในระบบก็ได้
          </span>
        </div>

        {/* 4. 3 ทางเลือกด้านบน (Quick Choices) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* ทางเลือก 1: รับเหมือนภาคที่แล้ว */}
          <div className="bg-white dark:bg-gray-800 border-2 border-blue-200 dark:border-blue-800/80 rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-xs hover:border-brand-blue transition-colors">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                รับเหมือนภาคที่แล้ว
              </span>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                2 ตำแหน่ง 3 อัตรา · ตามที่ตอบไว้ในภาค {previousSemesterLabel} · กดแล้วมีหน้าสรุปให้ตรวจก่อนส่งจริง
              </p>
            </div>
            <Button
              variant="primary"
              className="w-full mt-auto"
              onClick={() => setConfirmSameOpen(true)}
            >
              ใช้คำตอบเดิม
            </Button>
          </div>

          {/* ทางเลือก 2: รับ แต่ขอแก้รายละเอียด */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-xs">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <FileText className="w-5 h-5 text-gray-500" />
                รับ แต่ขอแก้รายละเอียด
              </span>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                เปิดฟอร์มด้านล่างเพื่อแก้จำนวน ตำแหน่ง สาขาวิชา หรือสวัสดิการตามความต้องการของหน่วยงาน
              </p>
            </div>
            <Button
              variant="secondary"
              className="w-full mt-auto"
              onClick={handleScrollToForm}
            >
              แก้ก่อนส่ง
            </Button>
          </div>

          {/* ทางเลือก 3: ภาคเรียนนี้ยังไม่รับ */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-xs">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <X className="w-5 h-5 text-red-500" />
                ภาคเรียนนี้ยังไม่รับ
              </span>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                คณะจะไม่ส่งรายชื่อนักศึกษามาให้ในภาคนี้ และจะสอบถามใหม่อีกครั้งในภาคการศึกษาถัดไป
              </p>
            </div>
            <Button
              variant="secondary"
              className="w-full mt-auto text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => setIsDeclineModalOpen(true)}
            >
              ยังไม่รับในภาคนี้
            </Button>
          </div>
        </div>

        {/* 5. ฟอร์มแบบเสนองาน (Form Container) */}
        <div
          id="token-offer-form"
          data-testid="token-offer-form"
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 sm:p-8 flex flex-col gap-6 shadow-xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                รายการตำแหน่งที่จะส่ง ({items.length} รายการ · รวม {totalQuota} อัตรา)
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                กรอกรายละเอียดตำแหน่งงานและคุณสมบัติเพื่อให้นักศึกษาได้ยื่นสมัครอย่างเหมาะสม
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              data-testid="offer-add-item"
              onClick={handleAddItem}
            >
              เพิ่มตำแหน่ง
            </Button>
          </div>

          {/* รายการตำแหน่งงาน */}
          <div className="flex flex-col gap-4">
            {items.map((item, index) => (
              <div
                key={index}
                data-testid={`offer-item-${index + 1}`}
                className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden transition-all bg-white dark:bg-gray-800/80"
              >
                {/* แถบหัวรายการ */}
                <div
                  className="p-4 bg-gray-50/70 dark:bg-gray-900/40 flex items-center justify-between cursor-pointer select-none"
                  onClick={() =>
                    setItems((prev) =>
                      prev.map((it, i) => (i === index ? { ...it, isExpanded: !it.isExpanded } : it))
                    )
                  }
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-brand-blue text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="font-bold text-sm text-gray-900 dark:text-white">
                      {item.title || '(ยังไม่ได้ระบุชื่อตำแหน่ง)'} · {item.quota || 0} อัตรา
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Copy className="w-3.5 h-3.5" />}
                      data-testid="offer-item-duplicate"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateItem(index);
                      }}
                    >
                      คัดลอก
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(index);
                      }}
                    >
                      ลบ
                    </Button>
                    {item.isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* รายละเอียดเมื่อคลี่ออก */}
                <div className={`p-5 flex flex-col gap-4 border-t border-gray-100 dark:border-gray-700 ${item.isExpanded ? 'block' : 'hidden'}`}>
                  {/* แถว 1: ตำแหน่ง, จำนวน, ระยะเวลา */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                    <div className="sm:col-span-6">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        ชื่อตำแหน่ง (Job Position) *
                      </label>
                      <Input
                        value={item.title}
                        data-testid="offer-title"
                        placeholder="เช่น Full-Stack Developer"
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) => (i === index ? { ...it, title: e.target.value } : it))
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        จำนวนที่รับ (อัตรา) *
                      </label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quota}
                        data-testid="offer-quota"
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, quota: e.target.value === '' ? '' : Number(e.target.value) } : it
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        ระยะเวลาปฏิบัติงาน
                      </label>
                      <select
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-brand-blue"
                        value={item.duration_term}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, duration_term: e.target.value as 'term1' | 'term2' | 'full_year' } : it
                            )
                          )
                        }
                      >
                        <option value="full_year">ตลอดปีการศึกษา (ทั้งปี)</option>
                        <option value="term1">ภาคเรียนที่ 1</option>
                        <option value="term2">ภาคเรียนที่ 2</option>
                      </select>
                    </div>
                  </div>

                  {/* แถว 2: ลักษณะงาน */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      ลักษณะงานที่ต้องปฏิบัติ (Job Description)
                    </label>
                    <Textarea
                      rows={2}
                      value={item.description}
                      data-testid="offer-description"
                      placeholder="อธิบายงานที่มอบหมายหรือโครงการที่นักศึกษาจะได้มีส่วนร่วม"
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) => (i === index ? { ...it, description: e.target.value } : it))
                        )
                      }
                    />
                  </div>

                  {/* แถว 3: สาขาวิชาที่ต้องการ (Checkbox) */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      สาขาวิชาที่รับ (เลือกได้มากกว่า 1 สาขา)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                      {majors.map((m) => (
                        <label
                          key={m.major_id}
                          className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            data-testid="offer-major"
                            checked={item.major_ids.includes(m.major_id)}
                            onChange={() => handleToggleMajor(index, m.major_id)}
                            className="rounded text-brand-blue focus:ring-brand-blue border-gray-300"
                          />
                          <span>{m.major_name_th}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* แถว 4: สวัสดิการ, ค่าตอบแทน, ที่พัก */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        ค่าตอบแทน (เบี้ยเลี้ยง)
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={item.pay_amount}
                          placeholder="จำนวนเงิน"
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, pay_amount: e.target.value === '' ? '' : Number(e.target.value) } : it
                              )
                            )
                          }
                        />
                        <select
                          className="px-2 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shrink-0"
                          value={item.pay_unit}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, pay_unit: e.target.value as 'day' | 'month' } : it
                              )
                            )
                          }
                        >
                          <option value="day">บาท/วัน</option>
                          <option value="month">บาท/เดือน</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        ที่พักสำหรับนักศึกษา
                      </label>
                      <select
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                        value={item.accommodation}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, accommodation: e.target.value as 'none' | 'free' | 'paid' } : it
                            )
                          )
                        }
                      >
                        <option value="none">ไม่มีที่พัก</option>
                        <option value="free">มีที่พัก · ไม่เสียค่าใช้จ่าย</option>
                        <option value="paid">มีที่พัก · นักศึกษาจ่ายเอง</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        สวัสดิการอื่นๆ
                      </label>
                      <Input
                        value={item.welfare_other}
                        placeholder="เช่น รถรับส่ง, อาหารกลางวัน"
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) => (i === index ? { ...it, welfare_other: e.target.value } : it))
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ข้อมูลผู้ให้ข้อมูล */}
          <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
            <span className="block text-sm font-bold text-gray-900 dark:text-white mb-3">
              ข้อมูลผู้ให้ข้อมูล (ฝ่ายบุคคลหรือผู้ประสานงาน)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อ – นามสกุล ผู้ให้ข้อมูล *
                </label>
                <Input
                  value={informantName}
                  data-testid="offer-informant-name"
                  placeholder="เช่น นางสาวพรทิพย์ ใจดี"
                  onChange={(e) => setInformantName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ตำแหน่ง *
                </label>
                <Input
                  value={informantPosition}
                  data-testid="offer-informant-position"
                  placeholder="เช่น เจ้าหน้าที่บุคคลอาวุโส"
                  onChange={(e) => setInformantPosition(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ป้ายเตือนความปลอดภัย + ปุ่มส่ง */}
          <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-start gap-2 max-w-xl text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
              <span>
                หน้านี้ขอเฉพาะข้อมูลของสถานประกอบการ <strong>ไม่มีข้อมูลนักศึกษาอยู่ในหน้านี้เลย</strong> — เอกสารที่มีข้อมูลนักศึกษา (ใบสมัคร สหกิจ 03 · แบบประเมิน · บันทึกการปฏิบัติงาน) ต้องเข้าสู่ระบบด้วยบัญชีเสมอ
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Button
                variant="secondary"
                icon={<Printer className="w-4 h-4" />}
                onClick={handlePrint}
              >
                พิมพ์เอกสาร
              </Button>
              <Button
                variant="primary"
                data-testid="token-submit"
                icon={<Send className="w-4 h-4" />}
                disabled={submitting}
                onClick={executeSubmit}
                className="px-6 py-2.5 shadow-sm font-bold"
              >
                {submitting ? 'กำลังส่งคำตอบ...' : 'ส่งคำตอบแบบเสนองาน'}
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* Modal ปฏิเสธไม่รับนักศึกษา */}
      {isDeclineModalOpen && (
        <Modal
          onClose={() => setIsDeclineModalOpen(false)}
          title="ยืนยันการไม่รับนักศึกษาสหกิจศึกษาในภาคเรียนนี้"
        >
          <ModalBody>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                ท่านกำลังระบุว่า <strong>{company.name_th}</strong> ไม่สะดวกรับนักศึกษาใน {semesterLabel}{' '}
                คณะจะไม่ส่งรายชื่อนักศึกษามาให้ในภาคนี้ และจะสอบถามใหม่อีกครั้งในภาคถัดไป
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  เหตุผลประกอบ (ระบุหรือไม่ระบุก็ได้)
                </label>
                <Textarea
                  rows={3}
                  value={declineReason}
                  placeholder="เช่น อยู่ระหว่างปรับปรุงโครงสร้างองค์กร หรือไม่มีพี่เลี้ยงประจำแผนก"
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setIsDeclineModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeclineSubmitting}
              onClick={handleConfirmDecline}
            >
              {isDeclineSubmitting ? 'กำลังบันทึก...' : 'ยืนยันไม่รับในภาคนี้'}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Modal ยืนยันคำตอบเดิม */}
      <ConfirmDialog
        open={confirmSameOpen}
        title="ยืนยันการใช้ข้อมูลรับนักศึกษาตามภาคเรียนที่แล้ว"
        message={`ระบบจะใช้ข้อมูลจำนวน 2 ตำแหน่ง 3 อัตรา ตามที่ท่านเคยแจ้งไว้ใน ${previousSemesterLabel} เพื่อส่งให้คณะทันที ท่านต้องการยืนยันหรือไม่?`}
        confirmLabel="ยืนยันส่งข้อมูลเดิม"
        cancelLabel="กลับไปตรวจสอบ"
        onConfirm={handleAcceptSamePrevious}
        onCancel={() => setConfirmSameOpen(false)}
      />
    </div>
  );
};

export default JobOffer02Token;
