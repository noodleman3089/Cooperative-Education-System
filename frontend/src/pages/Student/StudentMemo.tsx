import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Select, Textarea } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import type { IntentForm, MemoType, StudentMemo } from '../../types/api';

/**
 * บันทึกข้อความของนักศึกษา — คำร้องกรณียกเว้นที่เสนอถึงคณบดี
 *
 * แทนกระดาษในคู่มือ PDF หน้า 45 · หน้าจอนี้มีหน้าที่เดียวคือ **เหลือให้กรอกช่องเดียว**
 * ระบบเติมชื่อ รหัส สาขา เบอร์โทร วันที่ และถ้อยคำราชการให้ทั้งหมดตอนพิมพ์
 *
 * ⛔ **หัวข้อเป็นสิ่งที่นักศึกษาเลือกเอง** (เจ้าของเคาะ 2026-09-01) ระบบเลือกไว้ให้
 * ล่วงหน้าเฉพาะกรณีที่ *รู้จริง* คือการส่งช้า ซึ่งดูจากธง `submitted_late` บนใบความจำนง
 * อีกสามกรณีเกิดนอกระบบ (บริษัทกำหนดวันเริ่ม · ย้ายที่ · ถูกส่งตัวกลับ) ระบบไม่มีทางรู้
 * จึงไม่เดา — เดาผิดแล้วนักศึกษากดผ่านไปเลย จะได้เอกสารผิดเรื่องส่งถึงคณบดี
 */

const REASON_MIN_LENGTH = 20;

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
  const lateIntent = useMemo(() => intents.find((i) => i.submitted_late), [intents]);

  /**
   * หัวข้อที่แสดงอยู่จริง = สิ่งที่นักศึกษาเลือก ถ้ายังไม่ได้เลือกจึงใช้ค่าที่ระบบเดาให้
   *
   * คิดตอน render ไม่ใช่ยัดลง state ผ่าน effect — ผลลัพธ์ที่ผู้ใช้เห็นเหมือนกันเป๊ะ
   * แต่ไม่ต้องมี render รอบสองและไม่ชน react-hooks/set-state-in-effect
   */
  const effectiveType = memoType || (lateIntent ? 'late_submission' : '');
  const selected = types.find((t) => t.key === effectiveType) ?? null;
  const remaining = REASON_MIN_LENGTH - reason.trim().length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const created = (await api.post('/memos', {
        memo_type: effectiveType,
        reason: reason.trim(),
        intent_form_id: latestIntent?.form_id ?? null,
      })) as { message: string };
      setSuccess(created.message);
      setReason('');
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อความได้'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton variant="table" />;

  return (
    <div className="page-enter space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white">
          <FileText className="h-5 w-5 text-brand-blue dark:text-blue-400" />
          บันทึกข้อความถึงคณบดี
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          ใช้เมื่อมีเหตุจำเป็นนอกเหนือจากขั้นตอนปกติ เลือกหัวข้อและเขียนเหตุผล
          ระบบจะพิมพ์เป็นบันทึกข้อความตามรูปแบบราชการให้
          <span className="font-semibold"> นำไปลงลายมือชื่อแล้วเสนอตามขั้นตอนของสาขาวิชา</span>
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

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <label
            htmlFor="memo-type"
            className="block text-sm font-medium text-gray-800 dark:text-gray-300"
          >
            หัวข้อของบันทึก <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <Select
            id="memo-type"
            className="mt-2"
            required
            value={effectiveType}
            onChange={(e) => setMemoType(e.target.value)}
          >
            <option value="">— เลือกหัวข้อที่ตรงกับเรื่องที่จะยื่น —</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          {selected && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{selected.hint}</p>
          )}
        </div>

        {selected && (
          <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span className="text-gray-600 dark:text-gray-400">เรื่องที่จะพิมพ์ลงเอกสาร: </span>
            <span className="font-semibold">{selected.subject}</span>
          </div>
        )}

        <div>
          <label
            htmlFor="memo-reason"
            className="block text-sm font-medium text-gray-800 dark:text-gray-300"
          >
            เหตุผล <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            เขียนด้วยคำของตัวเอง ข้อความนี้คือส่วนที่คณบดีอ่านจริง
            ส่วนที่เหลือของเอกสารระบบเติมให้ทั้งหมด
          </p>
          <Textarea
            id="memo-reason"
            className="mt-2"
            rows={6}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น สถานประกอบการกำหนดเงื่อนไขการเข้าร่วมสหกิจศึกษาไม่น้อยกว่า 6 เดือน จึงจำเป็นต้องเริ่มปฏิบัติงานก่อนวันที่คณะกำหนด"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {remaining > 0 ? `พิมพ์อีกอย่างน้อย ${remaining} ตัวอักษร` : 'ความยาวเพียงพอแล้ว'}
          </p>
        </div>

        {latestIntent && (
          <p className="text-xs text-gray-600 dark:text-gray-400">
            บันทึกฉบับนี้จะอ้างถึงใบแจ้งความจำนงเลขที่ {latestIntent.form_id}
            {latestIntent.company_name_th ? ` (${latestIntent.company_name_th})` : ''}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!effectiveType || remaining > 0 || submitting}
            loading={submitting}
            loadingLabel="กำลังบันทึก..."
          >
            บันทึกและเตรียมพิมพ์
          </Button>
        </div>
      </form>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-5 dark:border-gray-800">
          <h3 className="font-bold text-gray-800 dark:text-white">บันทึกข้อความที่ยื่นไว้แล้ว</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            แก้ไขไม่ได้เพราะเป็นหลักฐานที่เดินอยู่บนกระดาษ — ถ้าเขียนผิดให้ยื่นฉบับใหม่
          </p>
        </div>

        {memos.length === 0 ? (
          <p className="p-5 text-sm text-gray-600 dark:text-gray-400">ยังไม่มีบันทึกข้อความ</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {memos.map((memo) => {
              const label = types.find((t) => t.key === memo.memo_type)?.label ?? memo.memo_type;
              return (
                <li
                  key={memo.memo_id}
                  className="flex flex-wrap items-start justify-between gap-3 p-5"
                  data-testid="memo-row"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100">{label}</p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                      ยื่นเมื่อ {formatThaiDate(String(memo.created_at).slice(0, 10))}
                    </p>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{memo.reason}</p>
                  </div>
                  <a
                    href={`${API_BASE_URL}/memos/${memo.memo_id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="memo-print"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-brand-blue dark:border-gray-700 dark:text-blue-400"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    พิมพ์บันทึกข้อความ
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default StudentMemoScreen;
