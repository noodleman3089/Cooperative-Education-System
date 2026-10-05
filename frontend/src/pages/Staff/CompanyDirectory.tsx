import React, { useState, useEffect, useMemo } from 'react';
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
  name_en: string;
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
  name_en: '',
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
  name_en: company.name_en || '',
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

  useEffect(() => {
    if (companyParam && companies.length > 0 && !showForm) {
      const target = companies.find(c => c.company_id === Number(companyParam));
      if (target) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEditing(target);
        setForm(toForm(target));
        setFormError(null);
        setShowForm(true);
      }
    }
  }, [companyParam, companies, showForm]);

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
      return [c.name_th, c.name_en, c.province, c.district, c.contact_person]
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
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (company: Company) => {
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
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  const columns: Column<Company>[] = [
    {
      key: 'name',
      header: 'สถานประกอบการ',
      cell: company => (
        <>
          <p className="font-bold text-sm text-gray-900 dark:text-white">{company.name_th}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {company.name_en ? `${company.name_en} · ` : ''}
            {company.district ? `${company.district}, ` : ''}{company.province}
          </p>
        </>
      ),
    },
    {
      key: 'contact',
      header: 'ผู้ประสานงาน',
      cell: company => (
        <div>
          {company.contact_person ? (
            <p className="text-gray-900 dark:text-gray-100 font-medium">{company.contact_person}</p>
          ) : (
            <span className="text-gray-500 italic">ไม่ระบุชื่อ</span>
          )}
          {company.email ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">{company.email}</p>
          ) : (
            <span className="text-xs text-red-600 dark:text-red-400 font-bold block mt-0.5">ยังไม่มีอีเมล</span>
          )}
          {company.phone && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{company.phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'ที่มาของแถว',
      cell: company => {
        const usage = companyUsage[company.company_id];
        const isStudentCreated = !!(company.google_place_id || usage);
        return (
          <div className="text-xs">
            <span className="font-medium text-gray-800 dark:text-gray-200">
              {isStudentCreated ? 'นักศึกษาสร้างตอนยื่นคำร้อง' : 'เจ้าหน้าที่เพิ่มเอง'}
            </span>
            {usage?.studentName && (
              <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                {usage.studentName}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'usage',
      header: 'การใช้งาน',
      cell: company => {
        const usage = companyUsage[company.company_id];
        if (usage?.pendingCount && usage.pendingCount > 0) {
          return (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              คำร้องรอตรวจ {usage.pendingCount} ใบ
            </span>
          );
        }
        if (usage?.count && usage.count > 0) {
          return (
            <span className="text-xs text-gray-700 dark:text-gray-300">
              นักศึกษา {usage.count} คน
            </span>
          );
        }
        return <span className="text-xs text-gray-500 dark:text-gray-400">ยังไม่เคยใช้</span>;
      },
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center',
      cell: company =>
        company.is_verified ? (
          <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/40">
            รับรองแล้ว
          </span>
        ) : (
          <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40">
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
            {!company.email && (
              <Button
                variant="primary"
                size="sm"
                data-testid="company-edit-email"
                onClick={() => openEdit(company)}
              >
                เติมอีเมล
              </Button>
            )}
            {!company.is_verified && usage?.pendingCount && usage.formId ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  window.location.href = `/dashboard?queue=request&form=${usage.formId}`;
                }}
              >
                ไปที่คำร้อง
              </Button>
            ) : null}
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
              variant="danger"
              size="sm"
              data-testid="company-delete"
              onClick={() => setDeleteTarget(company)}
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
      {/* 4 Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-brand-blue dark:text-blue-400 rounded-xl">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-semibold">ทั้งหมด</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white">{companies.length}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-green-200 dark:border-green-900/40 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-green-700 dark:text-green-400 font-semibold">รับรองแล้ว</span>
            <h3 className="text-2xl font-black text-green-700 dark:text-green-400">{verifiedCount}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl">
            <ShieldOff className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-amber-800 dark:text-amber-400 font-semibold">ยังไม่รับรอง</span>
            <h3 className="text-2xl font-black text-amber-700 dark:text-amber-400">{unverifiedCount}</h3>
            <span className="text-xs text-amber-800/80 dark:text-amber-400/80">นักศึกษาเพิ่มเอง {unverifiedCount}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-red-200 dark:border-red-900/40 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-red-700 dark:text-red-400 font-semibold">ไม่มีอีเมลผู้ประสานงาน</span>
            <h3 className="text-2xl font-black text-red-700 dark:text-red-400">{noEmailCount}</h3>
            <span className="text-xs text-red-600 dark:text-red-400">ส่งแบบสำรวจไม่ได้</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-brand-blue dark:text-blue-400" />
              ทำเนียบสถานประกอบการ
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
              ต้นทางของทุกอย่างในฝ่ายนี้ — แบบสำรวจ สหกิจ 02 ส่งไปตามอีเมลในทะเบียนนี้ และหนังสือราชการพิมพ์ชื่อ/ที่อยู่จากที่นี่
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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'unverified'
                  ? 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 font-bold'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              ยังไม่รับรอง ({unverifiedCount})
            </button>
            <button
              type="button"
              data-testid="company-filter-noemail"
              onClick={() => setStatusFilter('noemail')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'noemail'
                  ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 font-bold'
                  : 'bg-white text-red-700 border-red-200 hover:bg-red-50 dark:bg-gray-800 dark:border-red-900/40 dark:text-red-400'
              }`}
            >
              ไม่มีอีเมล ({noEmailCount})
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
                companies.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="ยังไม่มีสถานประกอบการในทำเนียบ"
                    description={
                      'รายการจะเพิ่มเข้ามาเองเมื่อนักศึกษายื่นแบบหาที่ฝึกเอง หรือกดปุ่ม "เพิ่มสถานประกอบการ" เพื่อบันทึกรายที่ตอบแบบสำรวจ (สหกิจ 02) กลับมา'
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
          การรับรองไม่ใช่ปุ่มที่ต้องกดก่อนออกหนังสือ
        </div>
        <p className="leading-relaxed">
          แถวที่นักศึกษาสร้างเองจะถูก <strong>รับรองอัตโนมัติในทรานแซกชันเดียวกับตอนคุณกด “รับคำร้อง”</strong> ที่หน้าคิว — ไม่ต้องมาไล่กดที่นี่ก่อน
          <br />
          ปุ่ม “รับรอง / ถอนการรับรอง” ที่นี่มีไว้สำหรับกรณีนอกเส้นทางคำร้อง เช่น บริษัทที่คุณเพิ่มเองเพื่อส่งแบบสำรวจ หรือถอนรับรองบริษัทที่เลิกกิจการ
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
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalBody>
              <AlertBanner variant="error" message={formError} className="mb-4" />

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ชื่อสถานประกอบการ (ภาษาไทย) *
                  </label>
                  <Input required maxLength={255} {...field('name_th')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ชื่อสถานประกอบการ (ภาษาอังกฤษ)
                  </label>
                  <Input maxLength={255} {...field('name_en')} />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ที่อยู่ *
                  </label>
                  <Input required maxLength={255} {...field('address')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    อำเภอ/เขต *
                  </label>
                  <Input required maxLength={100} {...field('district')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    จังหวัด *
                  </label>
                  <Input required maxLength={100} {...field('province')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    รหัสไปรษณีย์ *
                  </label>
                  <Input required maxLength={10} {...field('postal_code')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    หมายเลขโทรศัพท์ *
                  </label>
                  <Input required maxLength={20} {...field('phone')} />
                </div>
              </div>

              <div className="mt-6 mb-2">
                <p className="text-xs text-gray-700 dark:text-gray-300 font-bold">
                  ผู้ประสานงาน — ปลายทางเดียวของแบบสำรวจ สหกิจ 02
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  อีเมลช่องนี้คือปลายทางเดียวของแบบสำรวจ สหกิจ 02 — เว้นว่างแล้วบริษัทจะถูกข้ามทุกครั้งที่กดส่ง
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ชื่อผู้ติดต่อ
                  </label>
                  <Input maxLength={255} {...field('contact_person')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    ตำแหน่ง
                  </label>
                  <Input maxLength={255} {...field('contact_position')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
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
                      ยังว่างอยู่ — เติมแล้วบริษัทนี้จะเข้าเงื่อนไขส่งแบบสำรวจได้ทันที
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
          verifyTarget?.is_verified
            ? `นักศึกษาจะไม่เห็น ${verifyTarget?.name_th} ในทำเนียบอีก และจะออกหนังสือราชการถึงที่นี่ไม่ได้จนกว่าจะรับรองใหม่ · เอกสารที่ออกไปแล้วไม่ได้รับผลกระทบ`
            : `นักศึกษาจะเห็น ${verifyTarget?.name_th ?? ''} ในทำเนียบและเลือกเป็นที่ฝึกงานได้ และเจ้าหน้าที่จะออกหนังสือราชการถึงที่นี่ได้${
                verifyTarget && contactIsIncomplete(verifyTarget)
                  ? ' · หมายเหตุ: ข้อมูลผู้ติดต่อยังไม่ครบ หนังสือที่ออกจะไม่มีชื่อผู้รับที่ถูกต้อง'
                  : ''
              }`
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
        title={`ลบ “${deleteTarget?.name_th ?? ''}” ออกจากทำเนียบ`}
        confirmTestId="company-delete-confirm"
        message={
          isDeleteBlocked ? (
            <div className="space-y-2">
              <p className="text-red-700 dark:text-red-400 font-bold">
                ลบไม่ได้ เพราะมีข้อมูลผูกอยู่:
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300">
                สถานประกอบการนี้มีใบแจ้งความจำนง/นักศึกษาผูกอยู่ {deleteTargetUsage?.count} รายการ
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ระบบไม่อนุญาตให้ลบแถวที่มีประวัติหรือรายการใช้งานค้างอยู่ เพื่อป้องกันข้อผิดพลาดในฐานข้อมูล
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-800 dark:text-gray-200">
                ลบ <strong>{deleteTarget?.name_th ?? ''}</strong> ออกจากทำเนียบ
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                แถวนี้ยังไม่มีคำร้อง ไม่มีใบสำรวจ และไม่มีนักศึกษาผูกอยู่ จึงลบได้<br />
                <strong>ถ้ามีอะไรผูกอยู่ ปุ่มลบจะปิดพร้อมบอกว่าติดอะไรอยู่กี่รายการ</strong> ไม่ปล่อยให้ error ฐานข้อมูลเด้งขึ้นจอ
              </p>
            </div>
          )
        }
        confirmLabel={isDeleteBlocked ? 'เข้าใจแล้ว' : 'ยืนยัน ลบ'}
        destructive={!isDeleteBlocked}
        busy={busy}
        onConfirm={isDeleteBlocked ? () => setDeleteTarget(null) : handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default CompanyDirectory;
