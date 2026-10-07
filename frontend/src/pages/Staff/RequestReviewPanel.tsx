import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorCode, getErrorMessage, getErrorStatus } from '../../utils/errors';
import { formatThaiDateTime } from '../../utils/thaiDate';
import type { RequestFormRow } from './RequestQueue';

/**
 * แผงรับคำร้อง (เอกสารหมายเลข 1) ของเจ้าหน้าที่ — แบบ A: เอกสารแสดงในแผง ข้อมูลเหลือเท่าที่ใช้ตัดสิน
 *
 * ⛔ **รับได้เฉพาะไฟล์ที่เห็น** — นักศึกษาเปลี่ยนไฟล์หรือยกเลิกคำร้องได้ระหว่างที่แผงเปิดอยู่ แผงจึงถาม
 *    `GET /intents/:id` ทุก 2 วินาที แล้วปิดปุ่มรับจนกว่าจะกดดูไฟล์ใหม่ · ด่านจริงอยู่ที่เซิร์ฟเวอร์:
 *    `officer-approve` เทียบ `request_form_path` ที่ส่งไปกับค่าในแถว ไม่ตรง = 409
 * ⛔ **การถามทุก 2 วินาทีแตะเฉพาะ `detail`** — ห้ามให้มันล้างเลขที่หนังสือหรือเหตุผลตีกลับที่พิมพ์ค้างไว้
 *    (เคยพลาดมาแล้วกับการโหลดคิวซ้ำ)
 * ⛔ ห้ามมีรหัสภายใน (SEC-xx) หรือคำอธิบายกลไกของระบบบนแผงนี้ — เจ้าหน้าที่ต้องการแค่ของที่ใช้ตัดสิน
 *    ผลของการกดรับบอกที่กล่องยืนยันที่เดียว
 */

interface OfficerReview {
  submission_no: number;
  last_return: { returned_at: string; by_name: string | null; reason: string } | null;
  late_memo: { memo_id: number; created_at: string } | null;
}

interface RequestDetail {
  form_id: number;
  year_level?: number | string | null;
  major_name_th?: string | null;
  company_name_th?: string;
  company_address?: string | null;
  company_district?: string | null;
  company_province?: string | null;
  company_postal_code?: string | null;
  company_contact_person?: string | null;
  company_contact_position?: string | null;
  request_form_path?: string | null;
  request_uploaded_at?: string | null;
  submitted_late?: boolean;
  late_reason?: string | null;
  officer_review?: OfficerReview;
}

const REJECT_PRESET_CHIPS = [
  'นักศึกษายังไม่ลงชื่อ',
  'ลายเซ็นอาจารย์ที่ปรึกษายังไม่ครบ',
  'ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ',
  'ช่องความเห็นระบุว่าไม่อนุญาต',
  'ชื่อ/ที่อยู่สถานประกอบการไม่ตรงกับหนังสือ',
  'ไฟล์ที่แนบไม่ใช่หน้า 1 ของแบบคำร้อง',
  'ไฟล์ที่แนบอ่านไม่ออก',
  'อื่น ๆ',
];

const POLL_MS = 2000;

const LABEL = 'text-[13px] font-bold text-gray-600 dark:text-gray-400';
const PILL = 'rounded-full border px-3 py-1 text-[13px] font-bold';

interface Props {
  /** แถวของใบในคิว — ชื่อผู้ลงนามมากับแถวนี้ (ผู้เรียกส่งแถวล่าสุดของคิวมาเมื่อโหลดซ้ำ) */
  row: RequestFormRow;
  onClose: () => void;
  /** รับ/ตีกลับ/สร้างหนังสือเสร็จ — ผู้เรียกปิดแผง แสดงข้อความ และโหลดคิวใหม่ */
  onDone: (message: string) => void;
  /** สภาพของใบเปลี่ยนแต่แผงยังเปิดอยู่ (รับแล้วหนังสือไม่ออก · มีไฟล์ใหม่) — ผู้เรียกโหลดคิวใหม่เฉย ๆ */
  onChanged: () => void;
}

export const RequestReviewPanel: React.FC<Props> = ({ row, onClose, onDone, onChanged }) => {
  const formId = row.form_id;
  const studentName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ';

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  /** ไฟล์ที่กำลังแสดงให้เจ้าหน้าที่ดู — ค่านี้คือสิ่งที่ส่งไปกับการกดรับ */
  const [shownPath, setShownPath] = useState<string | null>(row.request_form_path ?? null);
  const firstLoad = useRef(true);
  const [withdrawn, setWithdrawn] = useState(false);
  /** รับคำร้องสำเร็จแต่หนังสือไม่ออก — แผงค้างไว้ให้กดสร้างอีกครั้ง */
  const [letterFailed, setLetterFailed] = useState<{ documentNo: string; reason: string } | null>(null);

  const [documentNo, setDocumentNo] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  /** เซิร์ฟเวอร์เตือนว่าเลขซ้ำกับใบอื่น — ถามยืนยันก่อนส่งซ้ำพร้อมธงยอมรับ */
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const settled = withdrawn || letterFailed !== null;

  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    const tick = async (first = false) => {
      // แท็บถูกซ่อน = ไม่มีใครดูอยู่ ไม่ต้องถาม · ยกเว้นรอบแรก ซึ่งต้องมีข้อมูลให้แผงเสมอ
      if (!first && document.hidden) return;
      try {
        const data = (await api.get(`/intents/${formId}`)) as RequestDetail;
        if (cancelled) return;
        setDetail(data);
        // รอบแรก: แถวจากคิวอาจเก่ากว่านี้ไม่กี่วินาที เจ้าหน้าที่ยังไม่ได้ดูอะไร จึงเริ่มที่ไฟล์ล่าสุดเลย
        if (firstLoad.current) {
          firstLoad.current = false;
          setShownPath(data.request_form_path ?? null);
        }
      } catch (err) {
        if (cancelled) return;
        // 404 = นักศึกษายกเลิก (ใบถูกลบ) · อย่างอื่น (เน็ตสะดุด) รอรอบถัดไป — ด่านจริงอยู่ที่เซิร์ฟเวอร์ตอนกดรับ
        if (getErrorStatus(err) === 404) setWithdrawn(true);
      }
    };
    void tick(true);
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [formId, settled]);

  const latestPath = detail?.request_form_path ?? shownPath;
  const fileChanged = !settled && !!latestPath && latestPath !== shownPath;
  const submittedLate = detail?.submitted_late ?? row.submitted_late ?? false;
  const lateReason = detail?.late_reason ?? row.late_reason ?? null;
  const review = detail?.officer_review;

  const address = detail
    ? [detail.company_address, detail.company_district, detail.company_province, detail.company_postal_code]
        .filter(Boolean)
        .join(' ')
    : '';

  const approve = async (allowDuplicate: boolean) => {
    const no = documentNo.trim();
    setBusy(true);
    setError(null);
    try {
      const res = (await api.patch(`/intents/${formId}/officer-approve`, {
        document_no: no,
        request_form_path: shownPath,
        ...(allowDuplicate ? { allow_duplicate_no: true } : {}),
      })) as { cover_letter_issued?: boolean; cover_letter_error?: string | null };
      setConfirming(false);
      setDuplicateWarning(null);
      if (res.cover_letter_issued === false) {
        setLetterFailed({ documentNo: no, reason: res.cover_letter_error || 'ระบบสร้างไฟล์หนังสือไม่สำเร็จ' });
        onChanged();
      } else {
        onDone(`รับคำร้องของ ${row.student_code || ''} แล้ว เลขที่หนังสือ ${no}`);
      }
    } catch (err) {
      setConfirming(false);
      if (getErrorCode(err) === 'duplicate_document_no') {
        setDuplicateWarning(getErrorMessage(err));
      } else {
        setDuplicateWarning(null);
        setError(getErrorMessage(err, 'ไม่สามารถรับคำร้องได้'));
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/intents/${formId}/officer-reject`, { reason: rejectReason.trim() });
      onDone(`ตีกลับคำร้องของ ${row.student_code || ''} แล้ว`);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถตีกลับคำร้องได้'));
    } finally {
      setBusy(false);
    }
  };

  const reissue = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/intents/${formId}/cover-letter/reissue`);
      onDone(`สร้างหนังสือขอความอนุเคราะห์ของ ${row.student_code || ''} แล้ว · รอคณบดีลงนาม`);
    } catch (err) {
      setError(getErrorMessage(err, 'สร้างหนังสือไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const addPreset = (chip: string) => {
    if (chip === 'อื่น ๆ') return;
    setRejectReason((prev) => {
      const clean = prev.trim();
      if (!clean) return chip;
      return clean.includes(chip) ? clean : `${clean}\n${chip}`;
    });
  };

  const fileUrl = shownPath ? `${API_BASE_URL}/files/${shownPath}` : null;
  const isPdf = !!shownPath && shownPath.toLowerCase().endsWith('.pdf');

  return (
    <>
      <Modal onClose={onClose} size="7xl" closeOnBackdrop={false}>
        {/* ── หัวแผง ── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <span className="block text-[13px] font-semibold text-brand-blue dark:text-blue-400">
              เอกสารหมายเลข 1 · คำร้องที่ {formId}
            </span>
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white">
              {studentName} · {row.student_code || '-'}
            </h3>
            <span className="block text-[13px] text-gray-600 dark:text-gray-400">
              {[
                detail?.major_name_th || row.major_name_th,
                detail?.year_level ? `ชั้นปีที่ ${detail.year_level}` : null,
                detail?.request_uploaded_at ? `อัปโหลดเมื่อ ${formatThaiDateTime(detail.request_uploaded_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submittedLate ? (
              <span className={`${PILL} border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`}>
                ส่งช่วงผ่อนผัน
              </span>
            ) : (
              <span className={`${PILL} border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300`}>
                ในกำหนด
              </span>
            )}
            {review && review.submission_no > 1 && (
              <span
                data-testid="request-submission-no"
                className={`${PILL} border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200`}
              >
                ส่งครั้งที่ {review.submission_no}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดแผง"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ── แถบสถานะพิเศษ: ยกเลิกแล้ว · มีไฟล์ใหม่ · รับแล้วหนังสือไม่ออก ── */}
          {(error || withdrawn || fileChanged || letterFailed) && (
            <div className="space-y-3 px-5 py-4">
              <AlertBanner variant="error" message={error} />

              {withdrawn && (
                <div
                  data-testid="request-withdrawn-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-300 bg-gray-100 px-4 py-3 dark:border-gray-600 dark:bg-gray-800"
                >
                  <div className="min-w-0 flex-[1_1_280px]">
                    <p className="text-[15px] font-bold text-gray-900 dark:text-gray-100">
                      {studentName} ยกเลิกคำร้องนี้แล้ว
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      คำร้องถูกลบออกจากคิว ไม่ต้องทำอะไรต่อ
                    </p>
                  </div>
                  <Button variant="secondary" className="min-h-11" onClick={onClose}>
                    ปิดแผง
                  </Button>
                </div>
              )}

              {fileChanged && (
                <div
                  data-testid="request-file-changed-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40"
                >
                  <div className="min-w-0 flex-[1_1_280px]">
                    <p className="text-[15px] font-bold text-amber-900 dark:text-amber-200">
                      นักศึกษาส่งไฟล์ใหม่
                      {detail?.request_uploaded_at ? `เมื่อ ${formatThaiDateTime(detail.request_uploaded_at)}` : ''}
                    </p>
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      ไฟล์ที่คุณเปิดดูอยู่เป็นไฟล์เก่า ระบบยังไม่ให้รับจนกว่าจะดูไฟล์ใหม่
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="show-new-request-file"
                    onClick={() => {
                      setShownPath(latestPath);
                      // ชื่อผู้ลงนามมากับแถวของคิว — นักศึกษาอาจระบุชื่อใหม่พร้อมไฟล์ใหม่
                      onChanged();
                    }}
                    className="min-h-11 rounded-xl bg-amber-800 px-4 text-sm font-bold text-white hover:bg-amber-900 dark:bg-amber-700 dark:hover:bg-amber-600"
                  >
                    แสดงไฟล์ใหม่
                  </button>
                </div>
              )}

              {letterFailed && (
                <div
                  data-testid="cover-letter-failed-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40"
                >
                  <div className="min-w-0 flex-[1_1_280px]">
                    <p className="text-[15px] font-bold text-red-900 dark:text-red-200">
                      รับคำร้องแล้ว แต่ยังไม่มีหนังสือเข้าคิวคณบดี
                    </p>
                    <p className="text-sm text-red-900 dark:text-red-200">
                      เลขที่ {letterFailed.documentNo} ถูกบันทึกแล้ว ระบบสร้างไฟล์หนังสือไม่สำเร็จ — {letterFailed.reason}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    className="min-h-11 bg-red-700 hover:bg-red-800"
                    loading={busy}
                    data-testid="cover-letter-reissue"
                    onClick={reissue}
                  >
                    สร้างหนังสืออีกครั้ง
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-start">
            {/* ══ ซ้าย: กระดาษที่นักศึกษาส่งมา — แสดงในแผงทันที ══ */}
            <div
              className={`min-w-0 bg-gray-200 p-4 dark:bg-gray-800 ${
                expanded ? 'basis-full' : 'flex-[999_1_560px]'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">
                  กระดาษที่นักศึกษาส่งมา
                </span>
                {fileUrl && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      aria-pressed={expanded}
                      className="min-h-11 rounded-xl border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      {expanded ? 'ย่อ' : 'ขยาย'}
                    </button>
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="open-uploaded-request-form"
                      className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      เปิดเต็มจอ
                    </a>
                  </div>
                )}
              </div>
              <div
                className={`overflow-auto rounded-lg bg-white shadow dark:bg-gray-950 ${
                  expanded ? 'h-[80vh]' : 'h-[62vh] min-h-[420px]'
                }`}
              >
                {!fileUrl ? (
                  <p className="p-6 text-center text-sm text-gray-700 dark:text-gray-300">
                    {withdrawn ? 'คำร้องนี้ถูกยกเลิกแล้ว' : 'ยังไม่มีไฟล์ในระบบ'}
                  </p>
                ) : isPdf ? (
                  // `#toolbar=0&navpanes=0` ซ่อนแถบของตัวอ่าน PDF ซึ่งโชว์ชื่อไฟล์ดิบในเครื่องแม่ข่าย — ขยาย/เต็มจอใช้ปุ่มของแผงแทน
                  <iframe
                    key={fileUrl}
                    src={`${fileUrl}#toolbar=0&navpanes=0&view=FitH`}
                    title="กระดาษที่นักศึกษาส่งมา"
                    data-testid="uploaded-request-form-view"
                    className="h-full w-full border-0"
                  />
                ) : (
                  <img
                    key={fileUrl}
                    src={fileUrl}
                    alt="แบบคำร้องขอหนังสือขอความอนุเคราะห์ที่นักศึกษาส่งมา"
                    data-testid="uploaded-request-form-view"
                    className="mx-auto block h-auto w-full"
                  />
                )}
              </div>
            </div>

            {/* ══ ขวา: ของที่ใช้ตัดสิน ══ */}
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-[18px] p-5">
              {(submittedLate || review?.last_return) && (
                <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-800">
                  {submittedLate && (
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>เหตุผลที่ส่งช้า (นักศึกษาเขียน)</span>
                      <p data-testid="request-late-reason" className="whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">
                        {lateReason || 'ไม่ได้ระบุ'}
                      </p>
                      {review && (
                        <p data-testid="request-late-memo" className="text-[13px] text-gray-600 dark:text-gray-400">
                          บันทึกข้อความชี้แจง:{' '}
                          {review.late_memo ? (
                            <>
                              <b className="text-green-800 dark:text-green-400">
                                ยื่นแล้ว {formatThaiDateTime(review.late_memo.created_at)}
                              </b>{' '}
                              ·{' '}
                              <a
                                href={`${API_BASE_URL}/memos/${review.late_memo.memo_id}/pdf`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-brand-blue hover:underline dark:text-blue-400"
                              >
                                เปิดดู
                              </a>
                            </>
                          ) : (
                            <b className="text-gray-900 dark:text-gray-100">ยังไม่ได้ยื่น</b>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {review?.last_return && (
                    <div data-testid="request-last-return" className="flex flex-col gap-1">
                      <span className={LABEL}>
                        ตีกลับครั้งก่อน · {formatThaiDateTime(review.last_return.returned_at)}
                        {review.last_return.by_name ? ` โดย ${review.last_return.by_name}` : ''}
                      </span>
                      <p className="whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">
                        {review.last_return.reason}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>สถานประกอบการที่ขอหนังสือถึง</span>
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  {detail?.company_name_th || row.company_name_th || '-'}
                </span>
                {address && <span className="text-sm text-gray-700 dark:text-gray-300">{address}</span>}
                {detail && (
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    ถึง {detail.company_contact_person || 'ผู้จัดการฝ่ายบุคคล'}
                    {detail.company_contact_position ? ` · ${detail.company_contact_position}` : ''}
                  </span>
                )}
                {!withdrawn && (
                  <a
                    href={`${API_BASE_URL}/intents/${formId}/cover-letter/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="preview-cover-letter"
                    className="-my-2 py-2 text-[13px] font-semibold text-brand-blue hover:underline dark:text-blue-400"
                  >
                    ดูตัวอย่างหนังสือที่จะออกให้
                  </a>
                )}
              </div>

              {/* ชื่อไม่ตรงกับที่ระบบรู้ = นักศึกษาระบุเอง (ผู้รักษาการแทน · ที่ปรึกษาเพิ่งเปลี่ยน) — ให้เทียบกับกระดาษ */}
              <div
                data-testid="officer-signers"
                className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 dark:border-gray-800"
              >
                <span className={LABEL}>ผู้ลงนามบนกระดาษ</span>
                {(
                  [
                    ['อาจารย์ที่ปรึกษา', row.advisor_signer_name, row.system_advisor_name],
                    ['หัวหน้าสาขาวิชา', row.dept_head_signer_name, row.system_dept_head_name],
                  ] as const
                ).map(([role, onPaper, inSystem]) => (
                  <React.Fragment key={role}>
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {role} <b>{onPaper || '—'}</b>
                    </span>
                    {onPaper && onPaper !== inSystem && (
                      <span
                        data-testid="signer-typed-by-student"
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        นักศึกษาระบุชื่อ{role}เอง{inSystem ? ` · ระบบบันทึกว่า ${inSystem}` : ''}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </div>

              {!letterFailed &&
                (rejecting ? (
                  /* ══ ตีกลับให้แก้ (เหตุผลบังคับ) ══ */
                  <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                    <div>
                      <h4 className="text-sm font-bold text-red-900 dark:text-red-300">ตีกลับให้แก้ไข</h4>
                      <p className="mt-0.5 text-[13px] text-red-800 dark:text-red-300">
                        นักศึกษาเห็นเหตุผลนี้บนหน้าจอและในอีเมล — บอกให้ชัดว่าต้องแก้อะไร
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {REJECT_PRESET_CHIPS.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => addPreset(chip)}
                          className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:border-red-400 hover:bg-red-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-red-500 dark:hover:bg-gray-700"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      rows={4}
                      value={rejectReason}
                      data-testid="officer-reject-reason"
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="ระบุเหตุผลที่ตีกลับ เช่น ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ"
                      className="w-full text-sm"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" className="min-h-11" onClick={() => setRejecting(false)}>
                        ย้อนกลับ
                      </Button>
                      <Button
                        variant="danger"
                        className="min-h-11"
                        disabled={!rejectReason.trim() || withdrawn}
                        loading={busy}
                        data-testid="officer-reject-submit"
                        onClick={reject}
                      >
                        ยืนยันตีกลับ
                      </Button>
                    </div>
                    <p className="text-[13px] text-gray-700 dark:text-gray-300">
                      ตีกลับแล้วไฟล์นี้ถูกลบ นักศึกษาอัปโหลดกระดาษชุดใหม่ได้ทันที
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 dark:border-gray-800">
                      <label htmlFor="officer-document-no" className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        เลขที่หนังสือออก
                      </label>
                      <Input
                        id="officer-document-no"
                        value={documentNo}
                        data-testid="officer-document-no"
                        placeholder="เช่น อว 0651.11/ว 218"
                        disabled={withdrawn}
                        maxLength={100}
                        onChange={(e) => setDocumentNo(e.target.value)}
                        className="h-[46px] text-[15px]"
                      />
                      <span className="text-[13px] text-gray-600 dark:text-gray-400">
                        แก้เลขได้จนกว่าคณบดีจะลงนาม
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap justify-between gap-2.5">
                      <button
                        type="button"
                        disabled={withdrawn}
                        onClick={() => setRejecting(true)}
                        className="min-h-[46px] rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        ตีกลับให้แก้ไข
                      </button>
                      <Button
                        disabled={!documentNo.trim() || !shownPath || fileChanged || withdrawn}
                        data-testid="officer-approve-open"
                        onClick={() => setConfirming(true)}
                        className="min-h-[46px] flex-[1_1_160px] font-bold"
                      >
                        รับคำร้อง
                      </Button>
                    </div>
                  </>
                ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* ผลของการกดรับบอกที่นี่ที่เดียว */}
      <ConfirmDialog
        open={confirming}
        title="ยืนยันการรับคำร้องและออกเลขหนังสือ"
        message={
          <div className="space-y-3 text-left">
            <p>
              คุณกำลังจะรับคำร้องของ <strong>{studentName}</strong> ({row.student_code || '-'})
            </p>
            <div className="space-y-1 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[13px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
              <p className="mb-1 font-bold">กดยืนยันแล้ว:</p>
              <p>
                ① รับคำร้อง และบันทึกเลขที่หนังสือ <strong>{documentNo.trim()}</strong>
              </p>
              <p>
                ② <strong>รับรองสถานประกอบการ {row.company_name_th}</strong> เข้าทำเนียบ (นักศึกษาคนอื่นจะเห็นและเลือกได้)
              </p>
              <p>③ สร้างหนังสือขอความอนุเคราะห์ (ยังไม่ลงนาม) ส่งเข้าคิวคณบดี</p>
            </div>
            <p className="text-[13px] font-medium text-amber-800 dark:text-amber-400">
              ข้อ ① และ ② ย้อนกลับเองไม่ได้ · เลขที่หนังสือแก้ได้จนกว่าคณบดีจะลงนาม · ถ้าสร้างหนังสือไม่สำเร็จ ระบบจะแจ้งและให้กดสร้างอีกครั้ง
            </p>
          </div>
        }
        confirmLabel="ออกเลขและรับคำร้อง"
        busy={busy}
        onConfirm={() => approve(false)}
        onCancel={() => setConfirming(false)}
      />

      {/* เลขซ้ำ = เตือน ไม่บล็อก — ยังไม่รู้ว่าหนังสือฉบับเดียวครอบนักศึกษาหลายคนได้หรือไม่ */}
      <ConfirmDialog
        open={duplicateWarning !== null}
        title="เลขที่หนังสือนี้ถูกใช้แล้ว"
        message={
          <div className="space-y-2 text-left">
            <p>{duplicateWarning}</p>
            <p>ต้องการใช้เลขนี้กับคำร้องของ {studentName} ด้วยหรือไม่</p>
          </div>
        }
        confirmLabel="ใช้เลขนี้ซ้ำ"
        cancelLabel="กลับไปแก้เลข"
        confirmTestId="duplicate-no-confirm"
        busy={busy}
        onConfirm={() => approve(true)}
        onCancel={() => setDuplicateWarning(null)}
      />
    </>
  );
};

export default RequestReviewPanel;
