import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Building2, Info, Mail, Pencil, PhoneCall, RefreshCw, Search, Users } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Input from '../../components/ui/Input';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDateTime } from '../../utils/thaiDate';

/**
 * ติดตามพี่เลี้ยง — เจ้าหน้าที่/หัวหน้าสาขา/อาจารย์ เห็นว่าพี่เลี้ยงคนไหนยังมีงานค้าง
 * แล้วกดเตือนทางอีเมลได้จากหน้านี้ (นักศึกษาไม่ต้องตามเอง)
 *
 * สัญญากับ backend: `GET /mentor-followup` · `POST /mentor-followup/:id/remind`
 * · `POST /mentor-followup/:id/send-link` · `PUT /mentor-followup/:id/email`
 * ปุ่มส่งลิงก์ใหม่และแก้อีเมลขึ้นเฉพาะเมื่อ `can_edit` (เซิร์ฟเวอร์ปฏิเสธ 403 อยู่แล้ว
 * ปุ่มที่ซ่อนไว้เป็นแค่ไม่ให้กดแล้วเจอ error)
 */

export interface MentorFollowupStudent {
  student_id: number;
  student_name: string;
}

export interface MentorFollowupRow {
  mentor_id: number;
  name: string;
  email: string;
  company_name: string | null;
  is_active: boolean;
  student_count: number;
  students: MentorFollowupStudent[];
  pending_total: number;
  pending_overdue: number;
  oldest_days_waiting: number | null;
  pending_by_kind: {
    weekly_log: number;
    monthly_log: number;
    daily_log: number;
    work_plan: number;
    report_outline: number;
    report_draft: number;
  };
  eval_missing_students: number;
  last_reminded_at: string | null;
  reminder_count: number;
  last_login_at: string | null;
  /** จำนวนครั้งที่ระบบเตือนอัตโนมัติในรอบปัจจุบัน (backend รุ่นเก่าอาจไม่ส่งมา) */
  auto_reminder_count?: number;
  /** ระบบเตือนอัตโนมัติครบสูงสุดแล้ว พี่เลี้ยงยังเงียบและยังมีงานค้าง */
  silent_after_max?: boolean;
}

export interface AutoRemindConfig {
  enabled: boolean;
  after_days: number;
  every_days: number;
  max: number;
}

export interface MentorFollowupResponse {
  can_edit: boolean;
  /** ไม่มี = backend รุ่นเก่า → ไม่แสดงแถบบอกสถานะเตือนอัตโนมัติ */
  auto_remind?: AutoRemindConfig;
  mentors: MentorFollowupRow[];
}

const KIND_LABELS: Array<[keyof MentorFollowupRow['pending_by_kind'], string]> = [
  ['weekly_log', 'บันทึกสัปดาห์'],
  ['monthly_log', 'บันทึกเดือน'],
  ['daily_log', 'บันทึกรายวัน'],
  ['work_plan', 'แผนปฏิบัติงาน'],
  ['report_outline', 'โครงร่าง'],
  ['report_draft', 'ร่างรายงาน'],
];

type Filter = 'all' | 'pending' | 'never_login' | 'silent';

const hasWork = (m: MentorFollowupRow) => m.pending_total > 0 || m.eval_missing_students > 0;

const MentorFollowup: React.FC = () => {
  const [mentors, setMentors] = useState<MentorFollowupRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [autoRemind, setAutoRemind] = useState<AutoRemindConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const [remindTarget, setRemindTarget] = useState<MentorFollowupRow | null>(null);
  const [linkTarget, setLinkTarget] = useState<MentorFollowupRow | null>(null);
  const [editTarget, setEditTarget] = useState<MentorFollowupRow | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);

  // silent = โหลดซ้ำหลังกดปุ่ม: ไม่โยนหน้ากลับเป็น skeleton และไม่ล้างแถบข้อความที่เพิ่งขึ้น
  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setLoadError(null);
      const res = (await api.get('/mentor-followup')) as MentorFollowupResponse;
      setMentors(res.mentors ?? []);
      setCanEdit(!!res.can_edit);
      setAutoRemind(res.auto_remind ?? null);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลการติดตามพี่เลี้ยงได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // แถบ error/success อยู่หัวหน้า แต่ปุ่มที่กดอยู่ลึกลงไป — ต้องเลื่อนไปหาเสมอ
  useEffect(() => {
    if (actionError || success) {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [actionError, success]);

  const summary = useMemo(
    () => ({
      total: mentors.length,
      pending: mentors.filter((m) => m.pending_total > 0).length,
      overdue: mentors.filter((m) => m.pending_overdue > 0).length,
      silent: mentors.filter((m) => m.silent_after_max).length,
    }),
    [mentors]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mentors.filter((m) => {
      if (filter === 'pending' && !hasWork(m)) return false;
      if (filter === 'never_login' && m.last_login_at) return false;
      if (filter === 'silent' && !m.silent_after_max) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.company_name ?? '').toLowerCase().includes(q) ||
        m.students.some((s) => s.student_name.toLowerCase().includes(q))
      );
    });
  }, [mentors, search, filter]);

  const handleRemind = async () => {
    const target = remindTarget;
    if (!target) return;
    try {
      setBusy(true);
      setActionError(null);
      setSuccess(null);
      await api.post(`/mentor-followup/${target.mentor_id}/remind`);
      setRemindTarget(null);
      setSuccess(`ส่งอีเมลเตือนถึง ${target.name} (${target.email}) แล้ว`);
      await load(true);
    } catch (err) {
      setRemindTarget(null);
      setActionError(getErrorMessage(err, `ส่งอีเมลเตือนถึง ${target.name} ไม่สำเร็จ`));
    } finally {
      setBusy(false);
    }
  };

  const handleSendLink = async () => {
    const target = linkTarget;
    if (!target) return;
    try {
      setBusy(true);
      setActionError(null);
      setSuccess(null);
      await api.post(`/mentor-followup/${target.mentor_id}/send-link`);
      setLinkTarget(null);
      setSuccess(`ส่งลิงก์เข้าระบบใหม่ถึง ${target.name} (${target.email}) แล้ว`);
      await load(true);
    } catch (err) {
      setLinkTarget(null);
      setActionError(getErrorMessage(err, `ส่งลิงก์เข้าระบบถึง ${target.name} ไม่สำเร็จ`));
    } finally {
      setBusy(false);
    }
  };

  const openEditEmail = (m: MentorFollowupRow) => {
    setEditTarget(m);
    setEmailDraft(m.email);
    setModalError(null);
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = editTarget;
    if (!target) return;
    const next = emailDraft.trim();
    if (!next || !/^\S+@\S+\.\S+$/.test(next)) {
      setModalError('กรุณากรอกอีเมลให้ถูกรูปแบบ เช่น name@company.com');
      return;
    }
    if (next.toLowerCase() === target.email.toLowerCase()) {
      setModalError('อีเมลตรงกับที่ระบบมีอยู่แล้ว');
      return;
    }
    try {
      setBusy(true);
      setModalError(null);
      setActionError(null);
      setSuccess(null);
      await api.put(`/mentor-followup/${target.mentor_id}/email`, { email: next });
      setEditTarget(null);
      setSuccess(
        `เปลี่ยนอีเมลของ ${target.name} เป็น ${next} แล้ว — ระบบยังไม่ได้ส่งลิงก์เข้าระบบให้ที่อยู่ใหม่ กด “ส่งลิงก์เข้าระบบใหม่” เมื่อพร้อม`
      );
      await load(true);
    } catch (err) {
      // error ของ modal อยู่ใน modal ไม่ใช่แถบหลังกล่อง
      setModalError(getErrorMessage(err, 'บันทึกอีเมลไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const chip = (testid: string, label: string, value: number, tone: string) => (
    <div className={`flex-1 min-w-[96px] rounded-xl border px-4 py-3 ${tone}`}>
      <div data-testid={testid} className="text-2xl font-extrabold leading-tight">
        {value}
      </div>
      <div className="text-xs font-semibold">{label}</div>
    </div>
  );

  const filterBtn = (id: Filter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`min-h-11 sm:min-h-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        filter === id
          ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-500'
          : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  if (loading) return <PageSkeleton variant={skeletonFor('staff', 'mentor_followup')} />;

  return (
    <div className="max-w-[1200px] mx-auto space-y-4 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">ติดตามพี่เลี้ยง</h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            ดูว่าพี่เลี้ยงคนไหนยังมีงานของนักศึกษารอตรวจ แล้วกดเตือนทางอีเมลได้จากที่นี่ — นักศึกษาไม่ต้องตามเอง
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          title="ดึงข้อมูลใหม่"
          aria-label="ดึงข้อมูลใหม่"
          className="shrink-0 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-2 inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {autoRemind && (
        <div
          data-testid="mf-auto-banner"
          data-enabled={autoRemind.enabled ? 'true' : 'false'}
          className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-blue-900 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-200"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">
            {autoRemind.enabled
              ? `ระบบเตือนพี่เลี้ยงอัตโนมัติเปิดอยู่ — เตือนเมื่อมีงานค้างเกิน ${autoRemind.after_days} วัน ซ้ำทุก ${autoRemind.every_days} วัน สูงสุด ${autoRemind.max} ครั้ง แล้วแจ้งเจ้าหน้าที่ทุกสัปดาห์`
              : 'ระบบเตือนอัตโนมัติยังปิดอยู่ — ต้องกดเตือนเอง'}
          </span>
        </div>
      )}

      <div ref={bannerRef} className="space-y-3 scroll-mt-4">
        <AlertBanner variant="error" message={actionError} />
        <AlertBanner variant="success" message={success} />
      </div>

      {loadError && (
        <AlertBanner
          variant="error"
          message={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button size="sm" variant="secondary" onClick={() => load()}>
                ลองใหม่
              </Button>
            </div>
          }
        />
      )}

      {!loadError && mentors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-600 dark:text-gray-400">
          ยังไม่มีพี่เลี้ยงในความดูแลของท่าน
        </div>
      ) : mentors.length > 0 ? (
        <>
          <div className="flex gap-3 flex-wrap">
            {chip(
              'mf-summary-total',
              'พี่เลี้ยงทั้งหมด',
              summary.total,
              'bg-white border-gray-200 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-white'
            )}
            {chip(
              'mf-summary-pending',
              'มีงานค้าง',
              summary.pending,
              'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-400'
            )}
            {chip(
              'mf-summary-overdue',
              'ค้างเกินกำหนด',
              summary.overdue,
              'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800/50 dark:text-red-400'
            )}
            {chip(
              'mf-summary-silent',
              'เตือนครบแล้วยังเงียบ',
              summary.silent,
              'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-400'
            )}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex-grow min-w-[220px] relative flex items-center">
              <Search className="w-4 h-4 absolute left-3.5 text-gray-500 dark:text-gray-400 pointer-events-none" />
              <Input
                size="sm"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อพี่เลี้ยง สถานประกอบการ หรือชื่อนักศึกษา"
                aria-label="ค้นหาพี่เลี้ยง"
                className="pl-10 min-h-11 sm:min-h-0"
              />
            </div>
            {filterBtn('all', 'ทั้งหมด')}
            {filterBtn('pending', 'มีงานค้าง')}
            {filterBtn('never_login', 'ไม่เคยเปิดลิงก์')}
            {filterBtn('silent', 'เงียบหลังเตือนครบ')}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center text-sm text-gray-600 dark:text-gray-400">
              ไม่พบพี่เลี้ยงตรงตามเงื่อนไขที่เลือก
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((m) => {
                const work = hasWork(m);
                const studentNames = m.students.map((s) => s.student_name).join(', ');
                return (
                  <li
                    key={m.mentor_id}
                    data-testid={`mf-row-${m.mentor_id}`}
                    className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-5 shadow-xs lg:flex lg:items-start lg:justify-between lg:gap-6"
                  >
                    <div className="min-w-0 flex-1 space-y-2.5">
                      {/* ชื่อ + บริษัท + อีเมล */}
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-gray-900 dark:text-white">{m.name}</span>
                          {!m.is_active && (
                            <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
                              บัญชียังไม่เปิดใช้
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-words">{m.company_name || '—'}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span data-testid={`mf-email-${m.mentor_id}`} className="min-w-0 break-all">
                            {m.email}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              data-testid={`mf-edit-email-${m.mentor_id}`}
                              onClick={() => openEditEmail(m)}
                              className="inline-flex min-h-11 sm:min-h-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-blue hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              แก้อีเมล
                            </button>
                          )}
                        </div>
                      </div>

                      {/* นักศึกษา */}
                      <div className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span title={studentNames} className="min-w-0 break-words">
                          นักศึกษา {m.student_count} คน
                          {studentNames ? ` · ${studentNames}` : ''}
                        </span>
                      </div>

                      {/* งานค้าง */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {KIND_LABELS.filter(([k]) => m.pending_by_kind[k] > 0).map(([k, label]) => (
                          <span
                            key={k}
                            className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-400"
                          >
                            {label} {m.pending_by_kind[k]}
                          </span>
                        ))}
                        {m.eval_missing_students > 0 && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-400">
                            ค้างประเมิน สหกิจ 15/16 {m.eval_missing_students} คน
                          </span>
                        )}
                        {m.pending_overdue > 0 && (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-400">
                            เกินกำหนด {m.pending_overdue} รายการ
                          </span>
                        )}
                        {!work && (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-400">
                            ไม่มีงานค้าง
                          </span>
                        )}
                        {m.pending_total > 0 && m.oldest_days_waiting !== null && (
                          <span
                            className={`text-[11px] font-semibold ${
                              m.pending_overdue > 0
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            ค้างนานสุด {m.oldest_days_waiting} วัน
                          </span>
                        )}
                      </div>

                      {/* ประวัติการเตือน + การเข้าระบบ */}
                      <div className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                        <div data-testid={`mf-remind-count-${m.mentor_id}`}>
                          {m.reminder_count > 0 && m.last_reminded_at
                            ? `เตือนแล้ว ${m.reminder_count} ครั้ง · ล่าสุด ${formatThaiDateTime(m.last_reminded_at)}`
                            : 'ยังไม่เคยเตือน'}
                          {autoRemind && (m.auto_reminder_count ?? 0) > 0 && (
                            <span data-testid={`mf-auto-count-${m.mentor_id}`}>
                              {' '}
                              (อัตโนมัติ {m.auto_reminder_count}/{autoRemind.max})
                            </span>
                          )}
                        </div>
                        {m.silent_after_max && (
                          <div
                            data-testid={`mf-silent-${m.mentor_id}`}
                            className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-300"
                          >
                            <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 break-words">
                              เตือนอัตโนมัติครบแล้ว ยังเงียบ — ควรโทรตามหรือตรวจอีเมล
                            </span>
                          </div>
                        )}
                        <div>
                          {m.last_login_at
                            ? `เปิดลิงก์ล่าสุด ${formatThaiDateTime(m.last_login_at)}`
                            : 'ยังไม่เคยเปิดลิงก์เข้าระบบ'}
                        </div>
                      </div>
                    </div>

                    {/* ปุ่ม */}
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:mt-0 lg:w-56 lg:shrink-0 lg:flex-col">
                      <Button
                        size="sm"
                        data-testid={`mf-remind-${m.mentor_id}`}
                        icon={<BellRing className="h-4 w-4" />}
                        disabled={!work}
                        title={
                          work
                            ? undefined
                            : 'ไม่มีงานค้างให้เตือน — พี่เลี้ยงตรวจงานและประเมินครบแล้ว'
                        }
                        onClick={() => setRemindTarget(m)}
                        className="min-h-11 w-full sm:w-auto lg:w-full sm:min-h-0"
                      >
                        เตือนพี่เลี้ยง
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid={`mf-sendlink-${m.mentor_id}`}
                          icon={<Mail className="h-4 w-4" />}
                          onClick={() => setLinkTarget(m)}
                          className="min-h-11 w-full sm:w-auto lg:w-full sm:min-h-0"
                        >
                          ส่งลิงก์เข้าระบบใหม่
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={remindTarget !== null}
        title="ยืนยันการเตือนพี่เลี้ยง"
        message={
          remindTarget
            ? `ระบบจะส่งอีเมลสรุปงานค้างพร้อมลิงก์เข้าระบบถึง ${remindTarget.name} (${remindTarget.email}) ทันที และจะเตือนคนเดิมซ้ำไม่ได้อีกภายใน 24 ชั่วโมง`
            : ''
        }
        confirmLabel="ยืนยัน ส่งอีเมลเตือน"
        confirmTestId="mf-remind-confirm"
        busy={busy}
        onConfirm={handleRemind}
        onCancel={() => setRemindTarget(null)}
      />

      <ConfirmDialog
        open={linkTarget !== null}
        title="ยืนยันการส่งลิงก์เข้าระบบใหม่"
        message={
          linkTarget
            ? `ระบบจะส่งอีเมลลิงก์เข้าระบบใหม่ถึง ${linkTarget.name} (${linkTarget.email}) ทันที ลิงก์ที่เคยส่งไปก่อนหน้านี้จะใช้ไม่ได้อีก`
            : ''
        }
        confirmLabel="ยืนยัน ส่งลิงก์"
        confirmTestId="mf-sendlink-confirm"
        busy={busy}
        onConfirm={handleSendLink}
        onCancel={() => setLinkTarget(null)}
      />

      {editTarget && (
        <Modal
          title={`แก้อีเมลของ ${editTarget.name}`}
          size="md"
          onClose={() => {
            if (!busy) setEditTarget(null);
          }}
          closeOnBackdrop={false}
        >
          <form onSubmit={handleSaveEmail} noValidate className="flex min-h-0 flex-1 flex-col">
            <ModalBody className="space-y-4">
              <AlertBanner
                variant="warning"
                message="ลิงก์เข้าระบบที่เคยส่งไปยังอีเมลเดิมจะใช้ไม่ได้อีกหลังเปลี่ยน และระบบจะไม่ส่งลิงก์ใหม่ให้เอง — เมื่อบันทึกแล้วให้กด “ส่งลิงก์เข้าระบบใหม่” ที่แถวของพี่เลี้ยงคนนี้"
              />
              <div className="space-y-1.5">
                <label
                  htmlFor="mf-email-input"
                  className="text-xs font-semibold text-gray-700 dark:text-gray-300"
                >
                  อีเมลใหม่ของพี่เลี้ยง
                </label>
                <Input
                  id="mf-email-input"
                  data-testid="mf-email-input"
                  type="email"
                  autoComplete="off"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  error={!!modalError}
                  disabled={busy}
                />
              </div>
              <AlertBanner variant="error" message={modalError} />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setEditTarget(null)}
                className="min-h-11 sm:min-h-0"
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                size="sm"
                data-testid="mf-email-save"
                loading={busy}
                className="min-h-11 sm:min-h-0"
              >
                บันทึกอีเมล
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default MentorFollowup;
