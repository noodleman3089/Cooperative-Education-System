import React, { useState, useEffect } from 'react';
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
import { Input, Select } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
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

type StatusFilter = 'all' | 'unverified' | 'verified';

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

const CompanyDirectory: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /** เก็บทั้งแถว ไม่ใช่แค่ id เพื่อให้กล่องยืนยันบอกได้ว่ากำลังทำกับใคร */
  const [verifyTarget, setVerifyTarget] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Company | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      // ไม่ส่ง is_verified ไปเลย เพื่อให้ได้ทั้งที่รับรองแล้วและยังไม่รับรอง —
      // backend แปลงค่าที่ไม่ใช่ 'true'/'1' เป็น false จึงส่งคำว่า all ไปไม่ได้
      const rows = await api.get('/companies');
      setCompanies(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดทำเนียบสถานประกอบการได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const unverifiedCount = companies.filter(c => !c.is_verified).length;
  const incompleteCount = companies.filter(contactIsIncomplete).length;

  const visible = companies
    .filter(c => {
      if (statusFilter === 'verified' && !c.is_verified) return false;
      if (statusFilter === 'unverified' && c.is_verified) return false;
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
      setShowForm(false);
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
    } catch (err) {
      setDeleteTarget(null);
      // ข้อความจากเซิร์ฟเวอร์บอกว่าติดอะไรอยู่กี่รายการ จึงต้องส่งต่อให้ผู้ใช้เห็น
      setError(getErrorMessage(err, 'ลบสถานประกอบการไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof CompanyForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 page-enter">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-brand-blue dark:text-blue-400 rounded-xl">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400">สถานประกอบการทั้งหมด</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">{companies.length} แห่ง</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl">
            <ShieldOff className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400">รอตรวจรับรอง</span>
            <h3 className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1">{unverifiedCount} แห่ง</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-600 dark:text-gray-400">ข้อมูลติดต่อไม่ครบ</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">{incompleteCount} แห่ง</h3>
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
              ตรวจสอบและรับรองสถานประกอบการก่อนที่นักศึกษาจะเลือก และก่อนออกหนังสือราชการถึงที่นั่น
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadData}
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

        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-3 text-gray-600 dark:text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อสถานประกอบการ จังหวัด หรือชื่อผู้ติดต่อ..."
              className="w-full pl-11 pr-4 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-brand-blue dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <Select
            size="sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="md:w-64"
          >
            <option value="all">ทุกสถานะ ({companies.length})</option>
            <option value="unverified">ยังไม่รับรอง ({unverifiedCount})</option>
            <option value="verified">รับรองแล้ว ({companies.length - unverifiedCount})</option>
          </Select>
        </div>

        <AlertBanner variant="error" message={error} className="mb-6" />
        <AlertBanner variant="success" message={success} className="mb-6" />

        {loading ? (
          <PageSkeleton variant="table" />
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-600 dark:text-gray-400">
            {companies.length === 0 ? (
              <>
                <p>ยังไม่มีสถานประกอบการในทำเนียบ</p>
                <p className="mt-1 text-xs">
                  รายการจะเพิ่มเข้ามาเองเมื่อนักศึกษายื่นแบบหาที่ฝึกเอง หรือกดปุ่ม "เพิ่มสถานประกอบการ" เพื่อบันทึกรายที่ตอบแบบสำรวจ (สหกิจ 02) กลับมา
                </p>
              </>
            ) : (
              <>
                <p>ไม่พบสถานประกอบการตรงตามเงื่อนไขที่เลือก</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                  }}
                  className="mt-2 text-xs font-bold text-brand-blue dark:text-blue-400 hover:underline"
                >
                  แสดงทุกสถานะ ({companies.length} แห่ง)
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-700 rounded-xl">
            <table className="w-full border-collapse text-left text-xs min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  <th className="p-4 font-bold">สถานประกอบการ</th>
                  <th className="p-4 font-bold">ที่ตั้ง</th>
                  <th className="p-4 font-bold">ผู้ติดต่อ</th>
                  <th className="p-4 font-bold text-center">สถานะ</th>
                  <th className="p-4 font-bold text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visible.map(company => (
                  <tr
                    key={company.company_id}
                    className="hover:bg-gray-50/40 dark:hover:bg-gray-800/20 align-top"
                  >
                    <td className="p-4">
                      <p className="font-bold text-sm text-gray-900 dark:text-white">{company.name_th}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        {company.name_en || (!company.google_place_id ? 'กรอกข้อมูลด้วยมือ' : '—')}
                      </p>
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-300">
                      {company.district}
                      <span className="block text-gray-600 dark:text-gray-400">{company.province}</span>
                    </td>
                    <td className="p-4">
                      {company.contact_person ? (
                        <>
                          <p className="text-gray-900 dark:text-gray-100">{company.contact_person}</p>
                          <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                            {company.contact_position || 'ไม่ระบุตำแหน่ง'}
                          </p>
                          {!company.email && (
                            <p className="text-red-700 dark:text-red-400 mt-0.5">ยังไม่มีอีเมล</p>
                          )}
                        </>
                      ) : (
                        <span className="text-red-700 dark:text-red-400 font-medium">ยังไม่มีผู้ติดต่อ</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {company.is_verified ? (
                        <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/40">
                          รับรองแล้ว
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40">
                          ยังไม่รับรอง
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant={company.is_verified ? 'secondary' : 'success'}
                          size="sm"
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
                          onClick={() => setDeleteTarget(company)}
                          title="ลบออกจากทำเนียบ"
                          aria-label={`ลบ ${company.name_th} ออกจากทำเนียบ`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          size="xl"
          closeOnBackdrop={false}
          title={editing ? `แก้ไขข้อมูล ${editing.name_th}` : 'เพิ่มสถานประกอบการเข้าทำเนียบ'}
        >
          {/* ponytail: flex-col with min-h-0 ensures ModalBody scrolls within 90vh without pushing ModalFooter off-screen */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalBody>
              <AlertBanner variant="error" message={formError} className="mb-4" />

              <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="sm:col-span-2">
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

              <p className="text-xs text-gray-600 dark:text-gray-400 mt-6 mb-2 font-bold">
                ผู้ประสานงาน — ใช้จ่าหน้าหนังสือราชการ ควรกรอกให้ครบก่อนรับรอง
              </p>
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
                    อีเมล
                  </label>
                  <Input type="email" maxLength={255} {...field('email')} />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setShowForm(false)}>
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title="ลบสถานประกอบการออกจากทำเนียบ"
        message={`ลบ ${deleteTarget?.name_th ?? ''} ออกจากระบบถาวร · ลบได้เฉพาะรายการที่ยังไม่มีใบแจ้งความจำนง ประกาศงาน เอกสารราชการ หรือข้อมูลอื่นผูกอยู่ ถ้ามีระบบจะปฏิเสธและบอกว่าติดอะไร`}
        confirmLabel="ยืนยัน ลบ"
        destructive
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default CompanyDirectory;
