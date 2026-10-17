import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import {
  Building2,
  ShieldCheck,
  ShieldOff,
  AlertTriangle,
  Search,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import DataTable, { type Column } from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import useResource from '../../hooks/useResource';
import { getErrorMessage } from '../../utils/errors';
import type { Company } from '../../types/api';

/**
 * ทำเนียบสถานประกอบการของเจ้าหน้าที่
 *
 * หน้านี้ไม่ใช่ "ระบบบริหารฐานข้อมูล" แต่เป็น **ด่านตรวจก่อนออกหนังสือราชการ**
 * แถวใน `companies` ถูกสร้างโดยนักศึกษาเป็นหลัก (ค้นจาก Google Maps หรือกรอกเอง
 * ตอนยื่นแบบหาที่ฝึกเอง) แล้วชื่อกับที่อยู่นั้นจะถูกพิมพ์ลงหนังสือที่คณบดีเซ็น
 * — การรับรองคือจุดเดียวที่มีมนุษย์ตรวจก่อนถึงตรงนั้น
 *
 * การรับรองมีผลจริง 2 อย่างเท่านั้น อย่าเขียนข้อความบนจอที่สัญญามากกว่านี้:
 *   1. นักศึกษาเห็นบริษัทนี้ในทำเนียบและเลือกเป็นที่ฝึกงานได้
 *   2. เจ้าหน้าที่ออกหนังสือราชการถึงบริษัทนี้ได้
 */

type StatusFilter = 'all' | 'unverified' | 'verified' | 'noemail';

/** ฟิลด์ที่ฟอร์มเพิ่ม/แก้ไขจัดการ — ตรงกับที่ backend รับ */
interface CompanyForm {
  name_th: string;
  address: string;
  district: string;
  province: string;
  postal_code: string;
  phone: string;
  contact_person: string;
  contact_position: string;
  email: string;
}

const EMPTY_FORM: CompanyForm = {
  name_th: '',
  address: '',
  district: '',
  province: '',
  postal_code: '',
  phone: '',
  contact_person: '',
  contact_position: '',
  email: '',
};

const toForm = (company: Company): CompanyForm => ({
  name_th: company.name_th,
  address: company.address,
  district: company.district,
  province: company.province,
  postal_code: company.postal_code,
  phone: company.phone,
  contact_person: company.contact_person || '',
  contact_position: company.contact_position || '',
  email: company.email || '',
});

/** ออกหนังสือราชการถึงบริษัทไม่ได้ถ้าไม่รู้ว่าจะจ่าหน้าถึงใคร */
const contactIsIncomplete = (c: Company) => !c.contact_person || !c.email;

interface IntentRef {
  form_id: number;
  company_id: number;
  status: string;
  first_name?: string;
  last_name?: string;
  created_at?: string;
}

const CompanyDirectory: React.FC = () => {
  /**
   * ไม่ส่ง is_verified ไปเลย เพื่อให้ได้ทั้งที่รับรองแล้วและยังไม่รับรอง —
   * backend แปลงค่าที่ไม่ใช่ 'true'/'1' เป็น false จึงส่งคำว่า all ไปไม่ได้
   */
  const directory = useResource<Company[]>('/companies', {
    initial: [],
    select: raw => (Array.isArray(raw) ? (raw as Company[]) : []),
    errorFallback: 'ไม่สามารถโหลดทำเนียบสถานประกอบการได้',
  });
  const companies = directory.data;
  const loading = directory.loading;
  const loadData = directory.reload;

  const [intents, setIntents] = useState<IntentRef[]>([]);
  useEffect(() => {
    api.get('/intents')
      .then(res => {
        if (Array.isArray(res)) setIntents(res as IntentRef[]);
      })
      // ตั้งใจเงียบ: ตัวเลขสรุปใบความจำนงเป็นข้อมูลประกอบของทำเนียบสถานประกอบการ
      // ไม่ใช่เนื้อหาหลักของหน้า · หน้าหลักยังใช้งานได้ตามปกติ
      // eslint-disable-next-line no-restricted-syntax
      .catch(() => {
        // fail-safe: intents summary is non-blocking
      });
  }, []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  /** error ของ *การกระทำ* (รับรอง/ลบ) เท่านั้น — error ของการโหลดมาจาก `directory.error` */
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /** เก็บทั้งแถว ไม่ใช่แค่ id เพื่อให้กล่องยืนยันบอกได้ว่ากำลังทำกับใคร */
  const [verifyTarget, setVerifyTarget] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const companyParam = searchParams.get('company');

  const [editing, setEditing] = useState<Company | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // เปิดกล่องแก้ไขจาก ?company= ได้ครั้งเดียวต่อค่า — เดิมดูจาก `!showForm` ตอนกดปิด showForm เป็น false
  // ก่อนที่พารามิเตอร์จะหายจาก URL กล่องจึงเด้งเปิดกลับทันที ต้องกดปิดสองครั้ง
  const openedParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!companyParam) {
      openedParamRef.current = null;
      return;
    }
    if (companies.length > 0 && openedParamRef.current !== companyParam) {
      const target = companies.find(c => c.company_id === Number(companyParam));
      if (target) {
        openedParamRef.current = companyParam;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEditing(target);
        setForm(toForm(target));
        setFormError(null);
        setShowForm(true);
      }
    }
  }, [companyParam, companies]);

  // โหลดครั้งแรกไม่สำเร็จ — ตัวนับและข้อความ "ยังไม่มี…" ต้องไม่ขึ้นคู่กับแถบ error
  const loadFailed = !!directory.error && companies.length === 0;
  const shown = (n: number) => (loadFailed ? '–' : n);

  const unverifiedCount = companies.filter(c => !c.is_verified).length;
  const verifiedCount = companies.length - unverifiedCount;
  const noEmailCount = companies.filter(c => !c.email).length;

  const companyUsage = useMemo(() => {
    const map: Record<number, { count: number; pendingCount: number; studentName?: string; date?: string; formId?: number }> = {};
    for (const item of intents) {
      if (!map[item.company_id]) {
        map[item.company_id] = {
          count: 0,
          pendingCount: 0,
          studentName: item.first_name ? `${item.first_name} ${item.last_name || ''}`.trim() : undefined,
          date: item.created_at,
          formId: item.form_id,
        };
      }
      map[item.company_id].count += 1;
      if (item.status === 'pending_officer_request' || item.status === 'pending_dept_head') {
        map[item.company_id].pendingCount += 1;
      }
    }
    return map;
  }, [intents]);

  const visible = companies
    .filter(c => {
      if (statusFilter === 'verified' && !c.is_verified) return false;
      if (statusFilter === 'unverified' && c.is_verified) return false;
      if (statusFilter === 'noemail' && c.email) return false;
      const keyword = search.trim().toLowerCase();
      if (!keyword) return true;
      return [c.name_th, c.province, c.district, c.contact_person]
        .some(field => (field || '').toLowerCase().includes(keyword));
    })
    // ที่ยังไม่รับรองขึ้นก่อนเสมอ — คิวงานอยู่บนสุดโดยไม่ต้องซ่อนแถวอื่น
    .sort((a, b) =>
      a.is_verified === b.is_verified
        ? a.name_th.localeCompare(b.name_th, 'th')
        : Number(a.is_verified) - Number(b.is_verified)
    );

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('company');
      return next;
    }, { replace: false });
  };

  const openCreate = () => {
    // error ของการกระทำก่อนหน้า (รับรอง/ลบ) ต้องไม่ค้างอยู่ใต้กล่องที่เพิ่งเปิด
    setError(null);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (company: Company) => {
    setError(null);
    openedParamRef.current = String(company.company_id);
    setEditing(company);
    setForm(toForm(company));
    setFormError(null);
    setShowForm(true);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('company', String(company.company_id));
      return next;
    }, { replace: false });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setFormError('รูปแบบอีเมลไม่ถูกต้อง');
      return;
    }

    // Alternative flow ของ Use Case: เตือนตั้งแต่ก่อนส่ง ไม่ต้องรอ 409 จากเซิร์ฟเวอร์
    const duplicate = companies.find(
      c =>
        c.company_id !== editing?.company_id &&
        c.name_th.trim().toLowerCase() === form.name_th.trim().toLowerCase()
    );
    if (duplicate) {
      setFormError('ชื่อสถานประกอบการนี้มีอยู่ในระบบแล้ว');
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        await api.put(`/companies/${editing.company_id}`, form);
      } else {
        await api.post('/companies', form);
      }
      closeForm();
      setSuccess('บันทึกทำเนียบสถานประกอบการสำเร็จ');
      await loadData();
    } catch (err) {
      setFormError(getErrorMessage(err, 'บันทึกข้อมูลไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVerify = async () => {
    const company = verifyTarget;
    if (!company) return;
    const turningOn = !company.is_verified;
    try {
      setBusy(true);
      setError(null);
      await api.put(`/companies/${company.company_id}/${turningOn ? 'verify' : 'unverify'}`, {});
      setVerifyTarget(null);
      setSuccess(
        turningOn
          ? `รับรอง ${company.name_th} เรียบร้อยแล้ว`
          : `ยกเลิกการรับรอง ${company.name_th} แล้ว`
      );
      await loadData();
    } catch (err) {
      setVerifyTarget(null);
      setError(getErrorMessage(err, 'ไม่สามารถเปลี่ยนสถานะการรับรองได้'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const company = deleteTarget;
    if (!company) return;
    try {
      setBusy(true);
      setError(null);
      await api.delete(`/companies/${company.company_id}`);
      setDeleteTarget(null);
      setSuccess(`ลบ ${company.name_th} ออกจากทำเนียบแล้ว`);
      await loadData();
    } catch (err: unknown) {
      setDeleteTarget(null);
      // ข้อความจากเซิร์ฟเวอร์บอกว่าติดอะไรอยู่กี่รายการ จึงต้องส่งต่อให้ผู้ใช้เห็น
      const errObj = err as { response?: { data?: { message?: string } } };
      const serverMsg = errObj?.response?.data?.message || getErrorMessage(err, 'ลบสถานประกอบการไม่สำเร็จ');
      setError(serverMsg);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof CompanyForm) => ({
    // id คู่กับ htmlFor ของ label — โปรแกรมอ่านหน้าจอและการคลิกที่ป้ายจึงไปถูกช่อง
    id: `company-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  const columns: Column<Company>[] = [
    {
      key: 'name',
      header: 'สถานประกอบการ',
      cell: company => {
        const isFromGoogle = Boolean(company.google_place_id);
        const usage = companyUsage[company.company_id];
        return (
          <div className="space-y-1">
            <p className="font-bold text-sm text-gray-900 dark:text-white">{company.name_th}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {isFromGoogle ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-brand-blue dark:bg-blue-950/40 dark:text-blue-300">
                  Google Maps
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  กรอกเอง
                </span>
              )}
              {usage?.studentName && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  โดย {usage.studentName}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'usage',
      header: 'จำนวนเด็กที่ยื่น',
      cell: company => {
        const usage = companyUsage[company.company_id];
        if (usage?.count && usage.count > 0) {
          return (
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {usage.count} คน
              {usage.pendingCount > 0 && (
                <span className="ml-1 text-amber-700 dark:text-amber-400 font-normal">
                  (รอตรวจ {usage.pendingCount})
                </span>
              )}
            </span>
          );
        }
        return <span className="text-xs text-gray-500 dark:text-gray-400">ยังไม่มีผู้ยื่น</span>;
      },
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center',
      cell: company =>
        company.is_verified ? (
          <span className="inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-bold border bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/40">
            รับรองแล้ว
          </span>
        ) : (
          <span className="inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-bold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40">
            ยังไม่รับรอง
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'จัดการ',
      align: 'right',
      cell: company => {
        const usage = companyUsage[company.company_id];
        const isBlocked = !!(usage?.count && usage.count > 0);
        return (
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            <Button
              variant={company.is_verified ? 'secondary' : 'success'}
              size="sm"
              data-testid={company.is_verified ? 'company-unverify' : 'company-verify'}
              onClick={() => setVerifyTarget(company)}
              icon={
                company.is_verified ? (
                  <ShieldOff className="w-3.5 h-3.5" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )
              }
            >
              {company.is_verified ? 'ยกเลิกรับรอง' : 'รับรอง'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openEdit(company)}
              title="แก้ไขข้อมูล"
              aria-label={`แก้ไขข้อมูล ${company.name_th}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="company-delete"
              className="!border-red-200 !text-red-700 hover:!bg-red-50 dark:!border-red-800 dark:!text-red-300 dark:hover:!bg-red-950/40"
              onClick={() => {
                setError(null);
                setDeleteTarget(company);
              }}
              title={isBlocked ? `ลบไม่ได้ เพราะมีข้อมูลผูกอยู่ (${usage?.count} รายการ)` : 'ลบออกจากทำเนียบ'}
              aria-label={`ลบ ${company.name_th} ออกจากทำเนียบ`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  const deleteTargetUsage = deleteTarget ? companyUsage[deleteTarget.company_id] : undefined;
  const isDeleteBlocked = !!(deleteTargetUsage?.count && deleteTargetUsage.count > 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6 page-enter">
      {/* 3 Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-brand-blue dark:text-blue-400 rounded-xl">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-semibold">ทั้งหมด</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white">{shown(companies.length)}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-green-200 dark:border-green-900/40 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-green-700 dark:text-green-400 font-semibold">รับรองแล้ว</span>
            <h3 className="text-2xl font-black text-green-700 dark:text-green-400">{shown(verifiedCount)}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl">
            <ShieldOff className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-amber-800 dark:text-amber-400 font-semibold">ยังไม่รับรอง</span>
            <h3 className="text-2xl font-black text-amber-700 dark:text-amber-400">{shown(unverifiedCount)}</h3>
            <span className="text-xs text-amber-800/80 dark:text-amber-400/80">นักศึกษากรอกเอง {shown(unverifiedCount)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-brand-blue dark:text-blue-400" />
              ทำเนียบสถานประกอบการ
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
              ต้นทางของทุกอย่างในฝ่ายนี้ — หนังสือราชการพิมพ์ชื่อ/ที่อยู่จากที่นี่ และนักศึกษาเลือกบริษัทที่รับรองแล้วจากทะเบียนนี้ตอนยื่นคำร้อง
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadData()}
              title="ดึงข้อมูลใหม่"
              aria-label="ดึงข้อมูลใหม่"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
              เพิ่มสถานประกอบการ
            </Button>
          </div>
        </div>

        {/* Filter Chips & Search Input */}
        <div className="flex flex-col md:flex-row gap-3 items-center mb-6">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-4 top-3 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              data-testid="company-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อไทย ชื่ออังกฤษ หรือจังหวัด..."
              className="w-full pl-11 pr-4 py-2 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`pointer-coarse:min-h-11 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-blue-50 text-brand-navy border-brand-blue dark:bg-brand-blue dark:text-white font-bold'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('verified')}
              className={`pointer-coarse:min-h-11 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'verified'
                  ? 'bg-blue-50 text-brand-navy border-brand-blue dark:bg-brand-blue dark:text-white font-bold'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              รับรองแล้ว
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unverified')}
              className={`pointer-coarse:min-h-11 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'unverified'
                  ? 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 font-bold'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              ยังไม่รับรอง ({shown(unverifiedCount)})
            </button>
            <button
              type="button"
              data-testid="company-filter-noemail"
              onClick={() => setStatusFilter('noemail')}
              className={`hidden pointer-coarse:min-h-11 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'noemail'
                  ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 font-bold'
                  : 'bg-white text-red-700 border-red-200 hover:bg-red-50 dark:bg-gray-800 dark:border-red-900/40 dark:text-red-400'
              }`}
            >
              ไม่มีอีเมล ({shown(noEmailCount)})
            </button>
          </div>
        </div>

        <AlertBanner variant="error" message={error ?? directory.error} className="mb-6" />
        <AlertBanner variant="success" message={success} className="mb-6" />

        {loading ? (
          <PageSkeleton variant="table" />
        ) : (
          <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
            <DataTable
              rows={visible}
              columns={columns}
              rowKey={company => company.company_id}
              rowTestId={company => `company-row-${company.company_id}`}
              refreshing={directory.refreshing}
              testId="company-directory-table"
              empty={
                loadFailed ? (
                  <EmptyState
                    icon={AlertTriangle}
                    title="โหลดทำเนียบไม่สำเร็จ"
                    description="กดปุ่มดึงข้อมูลใหม่เพื่อลองอีกครั้ง"
                  />
                ) : companies.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="ยังไม่มีสถานประกอบการในทำเนียบ"
                    description={
                      'รายการจะเพิ่มเข้ามาเองเมื่อนักศึกษายื่นแบบหาที่ฝึกเอง หรือกดปุ่ม "เพิ่มสถานประกอบการ" เพื่อบันทึกรายที่คณะรู้จักอยู่แล้ว'
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Search}
                    title="ไม่พบสถานประกอบการตรงตามเงื่อนไขที่เลือก"
                    description={`ในทำเนียบมีทั้งหมด ${companies.length} แห่ง แต่ตัวกรองที่เลือกอยู่ซ่อนไว้ทั้งหมด`}
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearch('');
                          setStatusFilter('all');
                        }}
                      >
                        แสดงทุกสถานะ ({companies.length} แห่ง)
                      </Button>
                    }
                  />
                )
              }
            />
          </div>
        )}
      </div>

      {/* Explanation Box */}
      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20 flex flex-col gap-2 text-xs text-amber-900 dark:text-amber-300">
        <div className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          การรับรองสถานประกอบการ
        </div>
        <p className="leading-relaxed">
          สถานประกอบการที่นักศึกษาค้นหาและเลือกผ่าน <strong>Google Maps</strong> จะได้รับการรับรองอัตโนมัติทันที
          <br />
          สำหรับสถานประกอบการที่นักศึกษากรอกข้อมูลเองด้วยตนเอง เจ้าหน้าที่สามารถตรวจสอบความถูกต้องและกดปุ่ม “รับรอง” ได้จากตารางนี้
        </p>
      </div>

      {showForm && (
        <Modal
          onClose={closeForm}
          size="3xl"
          closeOnBackdrop={false}
          title={editing ? `แก้ไขข้อมูล ${editing.name_th}` : 'เพิ่มสถานประกอบการเข้าทำเนียบ'}
        >
          {/* ponytail: flex-col with min-h-0 ensures ModalBody scrolls within 90vh without pushing ModalFooter off-screen */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <ModalBody>
              <AlertBanner variant="error" message={formError} className="mb-4" />

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="sm:col-span-4">
                  <label htmlFor="company-name_th" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ชื่อสถานประกอบการ *
                  </label>
                  <Input required maxLength={255} {...field('name_th')} />
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="company-address" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ที่อยู่ *
                  </label>
                  <Input required maxLength={255} {...field('address')} />
                </div>
                <div>
                  <label htmlFor="company-district" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    อำเภอ/เขต *
                  </label>
                  <Input required maxLength={100} {...field('district')} />
                </div>
                <div>
                  <label htmlFor="company-province" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    จังหวัด *
                  </label>
                  <Input required maxLength={100} {...field('province')} />
                </div>
                <div>
                  <label htmlFor="company-postal_code" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    รหัสไปรษณีย์ *
                  </label>
                  <Input required maxLength={10} {...field('postal_code')} />
                </div>
                <div>
                  <label htmlFor="company-phone" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    หมายเลขโทรศัพท์ *
                  </label>
                  <Input required maxLength={20} {...field('phone')} />
                </div>
              </div>

              <div className="mt-6 mb-2">
                <p className="text-xs text-gray-700 dark:text-gray-300 font-bold">
                  ผู้ประสานงาน — ผู้รับหนังสือขอความอนุเคราะห์
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ชื่อและตำแหน่งถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์ · อีเมลถูกเติมให้นักศึกษาเป็นค่าเริ่มต้นตอนส่งหนังสือถึงสถานประกอบการ
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="company-contact_person" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ชื่อผู้ติดต่อ
                  </label>
                  <Input maxLength={255} {...field('contact_person')} />
                </div>
                <div>
                  <label htmlFor="company-contact_position" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ตำแหน่ง
                  </label>
                  <Input maxLength={255} {...field('contact_position')} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="company-email" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    อีเมลผู้ประสานงาน
                  </label>
                  <Input
                    type="email"
                    maxLength={255}
                    {...field('email')}
                    className={!form.email.trim() ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : ''}
                  />
                  {!form.email.trim() && (
                    <span className="text-xs text-amber-700 dark:text-amber-400 mt-1 block">
                      ยังว่างอยู่ — นักศึกษาจะต้องกรอกอีเมลสถานประกอบการเองตอนส่งหนังสือ
                    </span>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={closeForm}>
                ยกเลิก
              </Button>
              <Button type="submit" loading={saving} loadingLabel="กำลังบันทึก...">
                บันทึกข้อมูล
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={verifyTarget !== null}
        title={verifyTarget?.is_verified ? 'ยกเลิกการรับรองสถานประกอบการ' : 'รับรองสถานประกอบการ'}
        message={
          verifyTarget ? (
            <ConfirmSummary
              lead={
                verifyTarget.is_verified
                  ? 'ยกเลิกการรับรองสถานประกอบการนี้ในทำเนียบ'
                  : 'รับรองสถานประกอบการนี้เข้าสู่ทำเนียบ'
              }
              rows={[
                { label: 'ชื่อสถานประกอบการ', value: verifyTarget.name_th },
                { label: 'จังหวัด', value: verifyTarget.province || '—' },
              ]}
              lockNote={
                verifyTarget.is_verified
                  ? 'นักศึกษาจะไม่เห็นในทำเนียบอีก และจะออกหนังสือราชการถึงที่นี่ไม่ได้จนกว่าจะรับรองใหม่ · เอกสารที่ออกไปแล้วไม่ได้รับผลกระทบ'
                  : `นักศึกษาจะเห็นในทำเนียบและเลือกเป็นที่ฝึกงานได้ และเจ้าหน้าที่จะออกหนังสือราชการถึงที่นี่ได้${
                      contactIsIncomplete(verifyTarget)
                        ? ' · หมายเหตุ: ข้อมูลผู้ติดต่อยังไม่ครบ หนังสือที่ออกจะไม่มีชื่อผู้รับที่ถูกต้อง'
                        : ''
                    }`
              }
            />
          ) : (
            ''
          )
        }
        confirmLabel={verifyTarget?.is_verified ? 'ยืนยัน ยกเลิกการรับรอง' : 'ยืนยัน รับรอง'}
        destructive={!!verifyTarget?.is_verified}
        busy={busy}
        onConfirm={handleToggleVerify}
        onCancel={() => setVerifyTarget(null)}
      />

      {/* Level 3 ConfirmDialog for Delete */}
      <ConfirmDialog
        open={deleteTarget !== null}
        level={3}
        title={`ลบ “${deleteTarget?.name_th ?? ''}” ออกจากทำเนียบ`}
        confirmTestId="company-delete-confirm"
        message={
          isDeleteBlocked ? (
            <ConfirmSummary
              lead="ลบไม่ได้ เพราะมีข้อมูลผูกอยู่กับสถานประกอบการนี้"
              rows={[
                { label: 'ชื่อสถานประกอบการ', value: deleteTarget?.name_th ?? '' },
                { label: 'จังหวัด', value: deleteTarget?.province || '—' },
                { label: 'รายการที่ผูกอยู่', value: `${deleteTargetUsage?.count ?? 0} รายการ (ใบแจ้งความจำนง/นักศึกษา)` },
              ]}
              lockNote="ระบบไม่อนุญาตให้ลบแถวที่มีประวัติหรือรายการใช้งานค้างอยู่ เพื่อป้องกันข้อผิดพลาดในฐานข้อมูล"
            />
          ) : (
            <ConfirmSummary
              lead="แถวนี้ยังไม่มีคำร้องและไม่มีนักศึกษาผูกอยู่ จึงลบได้"
              rows={[
                { label: 'ชื่อสถานประกอบการ', value: deleteTarget?.name_th ?? '' },
                { label: 'จังหวัด', value: deleteTarget?.province || '—' },
              ]}
              effects={['สถานประกอบการนี้ถูกลบออกจากทำเนียบอย่างถาวร']}
              lockNote="หากต้องการใช้ในอนาคต จะต้องเพิ่มข้อมูลสถานประกอบการใหม่"
            />
          )
        }
        confirmLabel={isDeleteBlocked ? 'เข้าใจแล้ว' : 'ลบออกจากทำเนียบ'}
        destructive={!isDeleteBlocked}
        busy={busy}
        onConfirm={isDeleteBlocked ? () => setDeleteTarget(null) : handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default CompanyDirectory;
