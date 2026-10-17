import React, { useEffect, useState } from 'react';
import { ChevronDown, FileText, Printer } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import { formatThaiDate } from '../../utils/thaiDate';
import type { IntentForm, MemoDetails, MemoType, StudentMemo } from '../../types/api';

/**
 * บันทึกข้อความของนักศึกษา — คำร้องกรณียกเว้นที่เสนอถึงคณบดี
 *
 * ยื่นในระบบ · คณบดีตัดสินในระบบ (เจ้าของยืนยัน 2026-10-18 ว่ากระดาษไม่บังคับ — ปุ่มพิมพ์เป็นแค่ทางเลือก)
 * แทนกระดาษในคู่มือ PDF หน้า 45 · ระบบเติมชื่อ รหัส สาขา เบอร์โทร วันที่ และถ้อยคำราชการให้ตอนพิมพ์
 *
 * ⛔ **หัวข้อเป็นสิ่งที่นักศึกษาเลือกเอง** (เจ้าของเคาะ 2026-09-01) ระบบเลือกไว้ให้
 * ล่วงหน้าเฉพาะกรณีที่ *รู้จริง* คือการส่งช้า ซึ่งดูจากธง `submitted_late` บนใบความจำนง
 * อีกสามกรณีเกิดนอกระบบ (บริษัทกำหนดวันเริ่ม · ย้ายที่ · ถูกส่งตัวกลับ) ระบบไม่มีทางรู้
 * จึงไม่เดา — เดาผิดแล้วนักศึกษากดผ่านไปเลย จะได้เอกสารผิดเรื่องส่งถึงคณบดี
 *
 * ช่องเฉพาะหัวข้อ (ดีไซน์ B) — คีย์ตรงกับ `parseMemoDetails` ฝั่ง backend ที่ตรวจซ้ำอีกชั้น
 */

const REASON_MIN_LENGTH = 20;

/** กิจกรรมที่เลือกขอผ่อนผันได้ = ที่เปิดรอบพิเศษได้ (`isRoundableActivity` ฝั่ง backend) */
const LATE_ACTIVITY_OPTIONS: { key: string; label: string }[] = [
  { key: 'intent_submission', label: 'ใบแจ้งความจำนง (เอกสาร 1)' },
  { key: 'acceptance_form', label: 'แบบตอบรับ (เอกสาร 2)' },
  { key: 'accommodation_plan', label: 'ข้อมูลที่พัก (สหกิจ 06)' },
  { key: 'report_outline', label: 'โครงร่างรายงาน (สหกิจ 11)' },
  { key: 'final_report', label: 'รายงานฉบับสมบูรณ์' },
];

const activityLabel = (key: string) => LATE_ACTIVITY_OPTIONS.find((o) => o.key === key)?.label ?? key;

/** หัวข้อที่อนุมัติแล้วเจ้าหน้าที่นำไปเปิดรอบพิเศษได้ — ตรงกับ `ROUND_MEMO_TYPES` ฝั่ง backend */
const ROUND_TYPES = ['early_departure', 'late_submission'];

const STATUS_CHIP: Record<'pending' | 'approved' | 'rejected', { text: string; tone: string }> = {
  pending: { text: 'รอคณบดีพิจารณา', tone: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  approved: {
    text: 'คณบดีอนุมัติแล้ว',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  rejected: { text: 'คณบดีไม่อนุมัติ', tone: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300' },
};

const CARD = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const OPTION_BASE = 'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors';
const OPTION_OFF =
  'border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const OPTION_ON =
  'border-brand-blue bg-blue-50 font-semibold text-brand-navy dark:border-blue-400 dark:bg-blue-950/30 dark:text-blue-200';

/** รายละเอียดเฉพาะหัวข้อของบันทึกที่ยื่นแล้ว — แสดงเป็นแถว ป้าย : ค่า */
function detailRows(memo: StudentMemo): { label: string; value: string }[] {
  const d = memo.details ?? {};
  const rows: { label: string; value: string }[] = [];
  if (d.start_date) rows.push({ label: 'ขอเริ่มปฏิบัติงานวันที่', value: formatThaiDate(d.start_date) });
  if (d.activities?.length) rows.push({ label: 'เอกสารที่ขอผ่อนผัน', value: d.activities.map(activityLabel).join(' · ') });
  if (d.expected_date) rows.push({ label: 'คาดว่าจะส่งได้', value: formatThaiDate(d.expected_date) });
  if (d.new_company) rows.push({ label: 'สถานที่ที่จะย้ายไป', value: d.new_company });
  if (d.end_date) rows.push({ label: 'สิ้นสุดการปฏิบัติงาน', value: formatThaiDate(d.end_date) });
  return rows;
}

const StudentMemoScreen: React.FC = () => {
  const [types, setTypes] = useState<MemoType[]>([]);
  const [memos, setMemos] = useState<StudentMemo[]>([]);
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [memoType, setMemoType] = useState('');
  const [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [activities, setActivities] = useState<string[]>([]);
  const [newCompany, setNewCompany] = useState('');
  const [endDate, setEndDate] = useState('');
  /** แถวที่กางดูรายละเอียดอยู่ในรายการ "ที่ยื่นแล้ว" */
  const [openMemoId, setOpenMemoId] = useState<number | null>(null);
  /** เพิ่มค่าเพื่อสั่งโหลดใหม่ — ตัวโหลดอยู่ใน effect ตัวเดียว ไม่มี callback ลอยข้างนอก */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [typeRes, mine, myIntents] = await Promise.all([
          api.get('/memos/types'),
          api.get('/memos/me'),
          api.get('/intents/me'),
        ]);
        if (cancelled) return;
        setTypes((typeRes as { types: MemoType[] }).types);
        setMemos(mine as StudentMemo[]);
        setIntents((myIntents ?? []) as IntentForm[]);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลบันทึกข้อความได้'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /** ใบความจำนงที่บันทึกฉบับนี้จะอ้างถึง — ใบล่าสุดของนักศึกษา ถ้ามี */
  const latestIntent = intents[0] ?? null;
  const lateIntent = intents.find((i) => i.submitted_late);

  /**
   * หัวข้อที่แสดงอยู่จริง = สิ่งที่นักศึกษาเลือก ถ้ายังไม่ได้เลือกจึงใช้ค่าที่ระบบเดาให้
   *
   * คิดตอน render ไม่ใช่ยัดลง state ผ่าน effect — ผลลัพธ์ที่ผู้ใช้เห็นเหมือนกันเป๊ะ
   * แต่ไม่ต้องมี render รอบสองและไม่ชน react-hooks/set-state-in-effect
   */
  const effectiveType = memoType || (lateIntent ? 'late_submission' : '');
  const selected = types.find((t) => t.key === effectiveType) ?? null;
  const remaining = REASON_MIN_LENGTH - reason.trim().length;

  /** ช่องเฉพาะหัวข้อที่จะส่งไป — เฉพาะของหัวข้อที่เลือกอยู่ (ค่าของหัวข้ออื่นที่เคยกรอกไม่ติดไปด้วย) */
  const buildDetails = (): MemoDetails => {
    if (effectiveType === 'early_departure') return { start_date: startDate };
    if (effectiveType === 'late_submission') return { activities, expected_date: expectedDate };
    if (effectiveType === 'change_company') return newCompany.trim() ? { new_company: newCompany.trim() } : {};
    if (effectiveType === 'terminated') return endDate ? { end_date: endDate } : {};
    return {};
  };

  const detailsComplete =
    effectiveType === 'early_departure'
      ? !!startDate
      : effectiveType === 'late_submission'
        ? activities.length > 0 && !!expectedDate
        : true;

  // เอกสารทางการถึงคณบดี ไม่มีทางแก้หรือถอนในระบบ — ตรวจก่อนบันทึก (เจ้าของตัดสิน 2026-09-21)
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setConfirmOpen(true);
  };

  const submitMemo = async () => {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const created = (await api.post('/memos', {
        memo_type: effectiveType,
        reason: reason.trim(),
        details: buildDetails(),
        intent_form_id: latestIntent?.form_id ?? null,
      })) as { message: string };
      setSuccess(created.message);
      setReason('');
      setStartDate('');
      setExpectedDate('');
      setActivities([]);
      setNewCompany('');
      setEndDate('');
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถยื่นบันทึกข้อความได้'));
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const toggleActivity = (key: string) =>
    setActivities((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  if (loading) return <PageSkeleton variant="table" />;

  const labelClass = 'block text-sm font-medium text-gray-800 dark:text-gray-300';
  const helpClass = 'mt-1 text-xs text-gray-600 dark:text-gray-400';
  const required = <span className="text-red-600 dark:text-red-400">*</span>;

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-gray-900 dark:text-white">
          <FileText className="h-6 w-6 text-brand-blue dark:text-blue-400" />
          บันทึกข้อความถึงคณบดี
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          ใช้เมื่อมีเหตุจำเป็นนอกเหนือจากขั้นตอนปกติ ยื่นในระบบ คณบดีตัดสินในระบบ
          และเราจะแจ้งเตือนคุณเมื่อมีผล — แผงด้านขวาบอกว่าถ้าอนุมัติแล้วจะเกิดอะไรขึ้นต่อ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {lateIntent && (
        <AlertBanner
          variant="warning"
          message='ใบแจ้งความจำนงของคุณถูกบันทึกว่า "ยื่นล่าช้า" ระบบจึงเลือกหัวข้อการส่งล่าช้าไว้ให้ก่อน — เปลี่ยนเป็นหัวข้ออื่นได้ถ้าไม่ตรงกับเรื่องที่จะยื่น'
        />
      )}

      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <div className="w-full min-w-0 flex-1 space-y-6">
          <form onSubmit={handleSubmit} className={`${CARD} space-y-5 p-5`}>
            <fieldset>
              <legend className={labelClass}>
                เรื่องที่จะยื่น {required}
              </legend>
              <div className="mt-2 space-y-2" role="radiogroup" id="memo-type">
                {types.map((t) => (
                  <label
                    key={t.key}
                    data-testid={`memo-type-option-${t.key}`}
                    className={`${OPTION_BASE} ${effectiveType === t.key ? OPTION_ON : OPTION_OFF}`}
                  >
                    <input
                      type="radio"
                      name="memo-type"
                      value={t.key}
                      checked={effectiveType === t.key}
                      onChange={() => setMemoType(t.key)}
                      className="h-4 w-4 accent-brand-blue"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              {selected && <p className={helpClass}>{selected.hint}</p>}
            </fieldset>

            {effectiveType === 'early_departure' && (
              <div>
                <label htmlFor="memo-start-date" className={labelClass}>
                  วันที่ขอเริ่มปฏิบัติงาน {required}
                </label>
                <Input
                  id="memo-start-date"
                  type="date"
                  className="mt-2 max-w-xs"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <p className={helpClass}>วันที่สถานประกอบการกำหนดให้เริ่มงาน</p>
              </div>
            )}

            {effectiveType === 'late_submission' && (
              <>
                <fieldset>
                  <legend className={labelClass}>
                    เอกสารที่ขอผ่อนผัน {required}
                  </legend>
                  <p className={helpClass}>
                    เลือกได้หลายอย่าง — เจ้าหน้าที่จะเปิดรอบพิเศษเฉพาะที่เลือกและคณบดีอนุมัติ
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {LATE_ACTIVITY_OPTIONS.map((o) => (
                      <label
                        key={o.key}
                        data-testid={`memo-activity-${o.key}`}
                        className={`${OPTION_BASE} ${activities.includes(o.key) ? OPTION_ON : OPTION_OFF}`}
                      >
                        <input
                          type="checkbox"
                          checked={activities.includes(o.key)}
                          onChange={() => toggleActivity(o.key)}
                          className="h-4 w-4 accent-brand-blue"
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor="memo-expected-date" className={labelClass}>
                    วันที่คาดว่าจะส่งได้ {required}
                  </label>
                  <Input
                    id="memo-expected-date"
                    type="date"
                    className="mt-2 max-w-xs"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>
              </>
            )}

            {effectiveType === 'change_company' && (
              <div>
                <label htmlFor="memo-new-company" className={labelClass}>
                  สถานที่ที่จะย้ายไป <span className="font-normal text-gray-600 dark:text-gray-400">(ถ้ามีแล้ว)</span>
                </label>
                <Input
                  id="memo-new-company"
                  className="mt-2"
                  maxLength={200}
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="ชื่อบริษัท/หน่วยงานใหม่"
                />
              </div>
            )}

            {effectiveType === 'terminated' && (
              <div>
                <label htmlFor="memo-end-date" className={labelClass}>
                  วันที่สิ้นสุดการปฏิบัติงาน <span className="font-normal text-gray-600 dark:text-gray-400">(ถ้าทราบ)</span>
                </label>
                <Input
                  id="memo-end-date"
                  type="date"
                  className="mt-2 max-w-xs"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            )}

            <div>
              <label htmlFor="memo-reason" className={labelClass}>
                เหตุผล {required}
              </label>
              <p className={helpClass}>
                เขียนด้วยคำของตัวเอง ข้อความนี้คือส่วนที่คณบดีอ่านจริง
              </p>
              <Textarea
                id="memo-reason"
                className="mt-2"
                rows={6}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={selected?.placeholder ?? 'เลือกเรื่องที่จะยื่นก่อน แล้วเขียนเหตุผลที่นี่'}
              />
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {remaining > 0 ? `พิมพ์อีกอย่างน้อย ${remaining} ตัวอักษร` : 'ความยาวเพียงพอแล้ว'}
              </p>
            </div>

            {latestIntent && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                บันทึกฉบับนี้จะอ้างถึงใบแจ้งความจำนงเลขที่ {latestIntent.form_id}
                {latestIntent.company_name_th ? ` (${latestIntent.company_name_th})` : ''}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-gray-600 dark:text-gray-400">ยื่นแล้วแก้หรือถอนไม่ได้</span>
              <Button
                type="submit"
                disabled={!effectiveType || !detailsComplete || remaining > 0 || submitting}
                loading={submitting}
                loadingLabel="กำลังยื่น..."
                data-testid="memo-submit"
              >
                ยื่นถึงคณบดี
              </Button>
            </div>
          </form>

          <section className={CARD}>
            <div className="border-b border-gray-200 p-5 dark:border-gray-800">
              <h3 className="font-bold text-gray-800 dark:text-white">
                เรื่องที่ยื่นไว้แล้ว <span className="text-sm font-normal text-gray-600 dark:text-gray-400">({memos.length})</span>
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                แก้ไขไม่ได้ — ถ้าเขียนผิดให้ยื่นฉบับใหม่ · กดที่แถวเพื่อดูเหตุผลและรายละเอียด
              </p>
            </div>

            {memos.length === 0 ? (
              <p className="p-5 text-sm text-gray-600 dark:text-gray-400">ยังไม่มีบันทึกข้อความ</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {memos.map((memo) => {
                  const typeInfo = types.find((t) => t.key === memo.memo_type);
                  const label = typeInfo?.label ?? memo.memo_type;
                  const status = memo.status ?? 'pending';
                  const chip = STATUS_CHIP[status];
                  const isOpen = openMemoId === memo.memo_id;
                  const rows = detailRows(memo);
                  return (
                    <li key={memo.memo_id} data-testid="memo-row">
                      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenMemoId(isOpen ? null : memo.memo_id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
                          data-testid="memo-row-toggle"
                        >
                          <ChevronDown
                            className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${isOpen ? 'rotate-180' : ''}`}
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-gray-800 dark:text-gray-100">{label}</span>
                            <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                              ยื่นเมื่อ {formatThaiDate(String(memo.created_at).slice(0, 10))}
                            </span>
                          </span>
                        </button>
                        <div className="flex flex-col items-end gap-1.5">
                          {/* คำตัดสินของคณบดีในระบบ — ลายเซ็นบนกระดาษ (ถ้ามี) ไม่เกี่ยวกับสถานะนี้ */}
                          <span
                            data-testid="memo-decision"
                            data-status={status}
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.tone}`}
                          >
                            {chip.text}
                          </span>
                          <a
                            href={`${API_BASE_URL}/memos/${memo.memo_id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="memo-print"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue underline dark:text-blue-400"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            พิมพ์ (ถ้าต้องใช้)
                          </a>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-5 py-4 text-sm dark:border-gray-800 dark:bg-gray-800/40">
                          <div>
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">เหตุผลที่คุณเขียน</p>
                            <p className="mt-1 whitespace-pre-line text-gray-800 dark:text-gray-200">{memo.reason}</p>
                          </div>
                          {rows.length > 0 && (
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                              {rows.map((r) => (
                                <React.Fragment key={r.label}>
                                  <dt className="text-gray-600 dark:text-gray-400">{r.label}</dt>
                                  <dd className="font-medium text-gray-800 dark:text-gray-200">{r.value}</dd>
                                </React.Fragment>
                              ))}
                            </dl>
                          )}
                          {status === 'rejected' && memo.decision_note && (
                            <p className="text-xs text-red-700 dark:text-red-300">
                              <span className="font-semibold">เหตุผลของคณบดี:</span> {memo.decision_note}
                            </p>
                          )}
                          {status === 'approved' && (
                            <p className="text-xs text-gray-700 dark:text-gray-300">
                              {ROUND_TYPES.includes(memo.memo_type)
                                ? 'รอเจ้าหน้าที่เปิด “รอบพิเศษ” ให้ — เมื่อเปิดแล้วจะส่งเอกสารได้ที่เมนูของขั้นตอนนั้น'
                                : typeInfo?.outcome}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900/60 dark:bg-blue-950/30">
            <h2 className="text-sm font-bold text-brand-navy dark:text-blue-200">ขั้นตอนของเรื่องนี้</h2>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-bold text-white">1</span>
                <span>
                  <span className="block font-semibold text-gray-900 dark:text-gray-100">คุณยื่นในระบบ</span>
                  <span className="block text-xs text-gray-700 dark:text-gray-300">เสร็จในขั้นนี้ ไม่ต้องพิมพ์กระดาษ</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-white text-xs font-bold text-brand-navy dark:border-blue-700 dark:bg-gray-900 dark:text-blue-200">2</span>
                <span>
                  <span className="block font-semibold text-gray-900 dark:text-gray-100">คณบดีอ่านและตัดสิน</span>
                  <span className="block text-xs text-gray-700 dark:text-gray-300">
                    แจ้งเตือนคุณเมื่อมีผล ถ้าไม่อนุมัติจะเห็นเหตุผล
                  </span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-white text-xs font-bold text-brand-navy dark:border-blue-700 dark:bg-gray-900 dark:text-blue-200">3</span>
                <span>
                  <span className="block font-semibold text-gray-900 dark:text-gray-100">ถ้าอนุมัติ</span>
                  <span className="block text-xs text-gray-700 dark:text-gray-300" data-testid="memo-outcome">
                    {selected?.outcome ?? 'ขั้นต่อไปขึ้นอยู่กับเรื่องที่คุณเลือก'}
                  </span>
                </span>
              </li>
            </ol>
          </div>
          <div className={`${CARD} p-4`}>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">ต้องใช้กระดาษไหม</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-700 dark:text-gray-300">
              ถ้าสาขาของคุณต้องการบันทึกข้อความที่ลงนามจริง พิมพ์ได้จากรายการที่ยื่นแล้ว —
              เป็นทางเลือก ไม่กระทบการพิจารณาในระบบ
            </p>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการยื่นถึงคณบดี"
        confirmLabel="ยื่นถึงคณบดี"
        cancelLabel="กลับไปแก้"
        confirmTestId="memo-confirm"
        cancelTestId="memo-confirm-cancel"
        busy={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submitMemo}
        message={
          <ConfirmSummary
            lead="ยื่นแล้วคณบดีจะเห็นเรื่องนี้ในระบบทันที และอาจารย์ที่เกี่ยวข้องก็เห็นด้วย"
            rows={[
              { label: 'เรื่อง', value: selected?.label ?? '' },
              ...(effectiveType === 'early_departure' && startDate
                ? [{ label: 'ขอเริ่มวันที่', value: formatThaiDate(startDate) }]
                : []),
              ...(effectiveType === 'late_submission'
                ? [
                    { label: 'เอกสาร', value: activities.map(activityLabel).join(' · ') },
                    ...(expectedDate ? [{ label: 'คาดว่าจะส่งได้', value: formatThaiDate(expectedDate) }] : []),
                  ]
                : []),
              ...(effectiveType === 'change_company' && newCompany.trim()
                ? [{ label: 'ย้ายไปที่', value: newCompany.trim() }]
                : []),
              ...(effectiveType === 'terminated' && endDate
                ? [{ label: 'สิ้นสุดวันที่', value: formatThaiDate(endDate) }]
                : []),
              { label: 'เหตุผล', value: <span className="whitespace-pre-line font-normal">{reason.trim()}</span> },
              ...(latestIntent
                ? [{ label: 'อ้างถึงใบความจำนง', value: `เลขที่ ${latestIntent.form_id}${latestIntent.company_name_th ? ` · ${latestIntent.company_name_th}` : ''}` }]
                : []),
            ]}
            lockNote="ยื่นแล้วแก้หรือถอนในระบบไม่ได้"
          />
        }
      />
    </div>
  );
};

export default StudentMemoScreen;
