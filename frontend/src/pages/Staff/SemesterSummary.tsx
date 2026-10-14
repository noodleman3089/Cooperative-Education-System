import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import ReasonModal from '../../components/ui/ReasonModal';
import { getErrorCode, getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';

/**
 * สรุปภาคเรียน — ตัวเลขของภาคที่เลือก เทียบกับภาคก่อนหน้า + เวลาที่ใช้ในแต่ละขั้น + แยกตามสาขา + สถานประกอบการ + ทะเบียนหนังสือ (เฟส 2 R2-2)
 *
 * ⛔ ทุกตัวเลขมาจาก `GET /api/staff/semester-summary` (คำนวณสดจากข้อมูลจริง) — หน้านี้แค่แสดงและส่งออก CSV
 * ⛔ ไม่มีค่าที่ "รู้ไม่ได้" ถูกแต่งเป็น 0 — ไม่มีให้เทียบ/ไม่มีเวลา = "—" · เวลาในแต่ละขั้นบอกจำนวนใบที่รู้เวลา (n) เสมอ
 * ⛔ "ผลประเมินครบ" ไม่ใช่ "ผ่าน" — อาจารย์เป็นผู้ตัดเกรด
 */

interface Metric {
  key: string;
  label: string;
  hint: string | null;
  unit: string;
  current: number | null;
  previous: number | null;
}

interface Duration {
  key: string;
  label: string;
  current_median_days: number | null;
  current_n: number;
  previous_median_days: number | null;
  previous_n: number;
}

interface MajorSummary {
  major_name_th: string | null;
  cohort: number;
  submitted: number;
  placed: number;
}

interface CompanySummary {
  company_name: string;
  placed: number;
}

interface GeneratedDocument {
  doc_id: number;
  /** คำร้องเจ้าของหนังสือขอความอนุเคราะห์ฉบับนี้ — ใช้เปิดช่องแก้เลขที่หนังสือ (หนังสือส่งตัวไม่มี) */
  form_id?: number | null;
  document_number?: string | null;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: string;
  dean_signature_date: string | null;
  student_code: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name_th: string;
}

interface Payload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean; closed: boolean } | null;
  previous: { semester_id: number; label: string } | null;
  semesters: { semester_id: number; label: string; is_active: boolean; closed: boolean }[];
  metrics: Metric[];
  durations: Duration[];
  by_major: MajorSummary[];
  by_company: CompanySummary[];
}

const fmt = (v: number | null, unit = ''): string => (v === null ? '—' : `${v.toLocaleString('th-TH')}${unit === '%' ? '%' : ''}`);

const fmtDays = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('th-TH')} วัน`);

/** ส่วนต่าง · ไม่มีสองฝั่ง = null (ไม่แต่งเป็น 0) */
const delta = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null ? null : cur - prev);

const deltaText = (d: number | null, unit: string): string => {
  if (d === null) return '—';
  if (d === 0) return 'เท่าเดิม';
  const suffix = unit === '%' ? ' จุด' : '';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('th-TH')}${suffix}`;
};

/** CSV ตาม RFC 4180 — ครอบด้วย " และซ้ำ " ทุกเซลล์ รวมหัวตาราง (ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยถูก) */
const csvCell = (v: string | number | null): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

function docTypeLabel(type: string): string {
  if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
  if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
  return type;
}

export const SemesterSummary: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // '' = ค่าเริ่มต้นของเซิร์ฟเวอร์ (ภาคที่เปิดอยู่ / ภาคล่าสุด)
  const [semesterId, setSemesterId] = useState('');

  // ตารางสถานประกอบการ: แสดง 10 แห่งแรกพร้อมปุ่ม ดูทั้งหมด
  const [showAllCompanies, setShowAllCompanies] = useState(false);

  // ทะเบียนหนังสือราชการ (ย้ายมาจากหน้าแรก)
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [docSuccess, setDocSuccess] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<GeneratedDocument | null>(null);
  const [newDocumentNo, setNewDocumentNo] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [recallingDoc, setRecallingDoc] = useState<GeneratedDocument | null>(null);

  const load = useCallback(async (sem: string) => {
    try {
      setLoading(true);
      setError(null);
      setData(await api.get(`/staff/semester-summary${sem ? `?semester_id=${sem}` : ''}`));
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดสรุปภาคเรียนได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      setDocError(null);
      const docs = await api.get('/documents');
      setDocuments(docs || []);
    } catch (err) {
      // โหลดพัง ≠ ไม่มีหนังสือ — ขึ้นข้อความ ไม่ปล่อยให้ตารางว่างบอกว่า "ยังไม่มีการออกหนังสือ"
      setDocError(getErrorMessage(err, 'ไม่สามารถโหลดทะเบียนหนังสือได้'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(semesterId);
    loadDocuments();
  }, [load, loadDocuments, semesterId]);

  const openEditDocumentNo = (doc: GeneratedDocument) => {
    setEditingDoc(doc);
    setNewDocumentNo(doc.document_number || '');
    setDuplicateWarning(null);
    setEditError(null);
  };

  const saveDocumentNo = async (allowDuplicate: boolean) => {
    if (!editingDoc?.form_id) return;
    const no = newDocumentNo.trim();
    setEditBusy(true);
    setEditError(null);
    try {
      const res = (await api.patch(`/intents/${editingDoc.form_id}/document-no`, {
        document_no: no,
        ...(allowDuplicate ? { allow_duplicate_no: true } : {}),
      })) as { message?: string };
      setDocSuccess(res.message || `แก้เลขที่หนังสือเป็น ${no} แล้ว`);
      setEditingDoc(null);
      await loadDocuments();
    } catch (err) {
      if (getErrorCode(err) === 'duplicate_document_no') {
        setDuplicateWarning(getErrorMessage(err));
      } else {
        setDuplicateWarning(null);
        setEditError(getErrorMessage(err, 'ไม่สามารถแก้เลขที่หนังสือได้'));
        await loadDocuments();
      }
    } finally {
      setEditBusy(false);
    }
  };

  const recallLetter = async (reason: string) => {
    if (!recallingDoc?.form_id) return;
    try {
      if (recallingDoc.type === 'send_letter') {
        await api.post(`/intents/${recallingDoc.form_id}/dispatch-letter/recall`, { reason });
      } else {
        await api.post(`/intents/${recallingDoc.form_id}/cover-letter/recall`, { reason });
      }
    } catch (err) {
      await loadDocuments();
      throw err;
    }
    const targetQueueName = recallingDoc.type === 'send_letter' ? 'หนังสือส่งตัวรอออก' : 'คำร้องรอรับ';
    setDocSuccess(
      `ดึง${docTypeLabel(recallingDoc.type)}ของ ${recallingDoc.student_code} กลับแล้ว · ใบกลับไปรอในคิว "${targetQueueName}"`
    );
    setRecallingDoc(null);
    await loadDocuments();
  };

  if (loading && !data) return <PageSkeleton variant="table" />;

  if (!data) {
    return (
      <div className="space-y-4 page-enter">
        <AlertBanner variant="error" message={error || 'ไม่สามารถโหลดสรุปภาคเรียนได้'} />
      </div>
    );
  }

  const { semester, previous } = data;

  const exportCsv = () => {
    if (!semester) return;
    const head = ['ตัวชี้วัด', semester.label, previous?.label ?? 'ภาคก่อน', 'เปลี่ยนแปลง'].map(csvCell).join(',');
    const rows = data.metrics.map((m) =>
      [m.label, m.current, m.previous, delta(m.current, m.previous)].map(csvCell).join(',')
    );
    const durHead = ['เวลาที่ใช้ในแต่ละขั้น (มัธยฐาน วัน)', semester.label, 'จำนวนใบที่รู้เวลา', previous?.label ?? 'ภาคก่อน', 'จำนวนใบที่รู้เวลา']
      .map(csvCell)
      .join(',');
    const durs = data.durations.map((d) =>
      [d.label, d.current_median_days, d.current_n, d.previous_median_days, d.previous_n].map(csvCell).join(',')
    );
    const csv = '\uFEFF' + [head, ...rows, '', durHead, ...durs].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `สรุปภาคเรียน-${semester.semester_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleCompanies = showAllCompanies ? (data.by_company || []) : (data.by_company || []).slice(0, 10);

  return (
    <div className="space-y-5 page-enter" data-testid="semester-summary">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">สรุปภาคเรียน</h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
            ตัวเลขของภาคที่เลือกเทียบกับภาคก่อนหน้า และเวลาที่ใช้ในแต่ละขั้น — คำนวณสดจากข้อมูลจริง ภาคที่ปิดแล้วก็อ่านย้อนหลังได้
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="เลือกภาคเรียน"
            value={semesterId || String(semester?.semester_id ?? '')}
            onChange={(e) => setSemesterId(e.target.value)}
            data-testid="summary-semester"
            className="!w-auto"
          >
            {data.semesters.map((s) => (
              <option key={s.semester_id} value={s.semester_id}>
                {s.label}
                {s.is_active ? ' (เปิดอยู่)' : s.closed ? ' (ปิดแล้ว)' : ''}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!semester} data-testid="summary-export">
            ส่งออก CSV
          </Button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />

      {!semester ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          ยังไม่มีภาคเรียนในระบบ — สร้างที่เมนู “ภาคเรียน”
        </p>
      ) : (
        <>
          {/* 1. ตัวชี้วัดรวมทั้งรุ่น (รวม not_filed ยังไม่ยื่นคำร้อง) */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full border-collapse text-left text-sm" data-testid="summary-metrics">
              <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <tr>
                  <th className="p-3 font-semibold">ตัวชี้วัด</th>
                  <th className="p-3 text-right font-semibold">{semester.label}</th>
                  <th className="p-3 text-right font-semibold">{previous ? previous.label : 'ภาคก่อน'}</th>
                  <th className="p-3 text-right font-semibold">เปลี่ยนแปลง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.metrics.map((m) => (
                  <tr key={m.key} data-testid={`summary-metric-${m.key}`}>
                    <td className="p-3">
                      <span className="block font-semibold text-gray-900 dark:text-white">{m.label}</span>
                      {m.hint && <span className="block text-xs text-gray-600 dark:text-gray-400">{m.hint}</span>}
                    </td>
                    <td className="p-3 text-right text-base font-extrabold tabular-nums text-gray-900 dark:text-white" data-testid={`summary-current-${m.key}`}>
                      {fmt(m.current, m.unit)}
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300" data-testid={`summary-previous-${m.key}`}>
                      {previous ? fmt(m.previous, m.unit) : '—'}
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {previous ? deltaText(delta(m.current, m.previous), m.unit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!previous && (
              <p className="border-t border-gray-100 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                ภาคนี้เป็นภาคแรกในระบบ — ไม่มีภาคก่อนให้เทียบ
              </p>
            )}
          </section>

          {/* 2. แยกตามสาขา */}
          <section data-testid="summary-by-major" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">แยกตามสาขา</h2>
            </div>
            {(!data.by_major || data.by_major.length === 0) ? (
              <p className="p-4 text-xs text-gray-600 dark:text-gray-400">ยังไม่มีข้อมูลนักศึกษาแยกตามสาขาในภาคเรียนนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    <tr>
                      <th className="p-3 font-semibold">สาขา</th>
                      <th className="p-3 text-right font-semibold">ในรุ่น</th>
                      <th className="p-3 text-right font-semibold">ยื่นแล้ว</th>
                      <th className="p-3 text-right font-semibold">ได้ที่ฝึก</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.by_major.map((m, idx) => (
                      <tr key={m.major_name_th ?? `unreg-${idx}`} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
                        <td className="p-3 font-medium text-gray-900 dark:text-white">
                          {m.major_name_th || 'ยังไม่ลงทะเบียน'}
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-900 dark:text-white">
                          {m.cohort.toLocaleString('th-TH')}
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                          {m.submitted.toLocaleString('th-TH')}
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                          {m.placed.toLocaleString('th-TH')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3. สถานประกอบการที่รับนักศึกษา */}
          <section data-testid="summary-by-company" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">สถานประกอบการที่รับนักศึกษา</h2>
            </div>
            {(!data.by_company || data.by_company.length === 0) ? (
              <p className="p-4 text-xs text-gray-600 dark:text-gray-400">ยังไม่มีสถานประกอบการที่รับนักศึกษาในภาคเรียนนี้</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      <tr>
                        <th className="p-3 font-semibold">สถานประกอบการ</th>
                        <th className="p-3 text-right font-semibold">รับแล้ว (คน)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {visibleCompanies.map((c, idx) => (
                        <tr key={`${c.company_name}-${idx}`} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
                          <td className="p-3 font-medium text-gray-900 dark:text-white">
                            {c.company_name}
                          </td>
                          <td className="p-3 text-right tabular-nums text-gray-900 dark:text-white">
                            {c.placed.toLocaleString('th-TH')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.by_company.length > 10 && (
                  <div className="border-t border-gray-100 p-3 text-center dark:border-gray-700">
                    <button
                      type="button"
                      onClick={() => setShowAllCompanies(!showAllCompanies)}
                      className="text-xs font-bold text-brand-blue hover:underline dark:text-blue-400"
                    >
                      {showAllCompanies ? 'ย่อเหลือ 10 แห่ง' : `ดูทั้งหมด (${data.by_company.length} แห่ง)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* 4. เวลาที่ใช้ในแต่ละขั้น (existing) */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="p-4 pb-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">เวลาที่ใช้ในแต่ละขั้น</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                มัธยฐานของใบที่ระบบรู้เวลาทั้งต้นและปลายขั้น · “n” คือจำนวนใบที่นับได้ — ใบเก่าที่เกิดก่อนระบบเริ่มเก็บเวลาจะไม่ถูกนับ ไม่ได้ถูกเดาเป็น 0
              </p>
            </div>
            <table className="w-full border-collapse text-left text-sm" data-testid="summary-durations">
              <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <tr>
                  <th className="p-3 font-semibold">ขั้น</th>
                  <th className="p-3 text-right font-semibold">{semester.label}</th>
                  <th className="p-3 text-right font-semibold">{previous ? previous.label : 'ภาคก่อน'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.durations.map((d) => (
                  <tr key={d.key} data-testid={`summary-duration-${d.key}`}>
                    <td className="p-3 text-gray-900 dark:text-white">{d.label}</td>
                    <td className="p-3 text-right tabular-nums text-gray-900 dark:text-white" data-testid={`summary-duration-current-${d.key}`}>
                      <span className="font-bold">{fmtDays(d.current_median_days)}</span>
                      <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">(n={d.current_n})</span>
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {previous ? (
                        <>
                          {fmtDays(d.previous_median_days)}
                          <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">(n={d.previous_n})</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* 5. ใครค้างนานที่สุด (หนึ่งบรรทัดพร้อมลิงก์) */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">ใครค้างนานที่สุด</h2>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  ดูรายชื่อนักศึกษาและระยะเวลาที่ค้างในแต่ละขั้นตอนได้ที่หน้านักศึกษาตอนนี้
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/dashboard?menu=pipeline')}
                // py-3 -my-3 = พื้นที่กดสูง 44px โดยข้อความอยู่ที่เดิม
                className="shrink-0 py-3 -my-3 text-xs font-bold text-brand-blue hover:underline dark:text-blue-400"
              >
                เปิดหน้า นักศึกษาตอนนี้
              </button>
            </div>
          </section>

          {/* 6. ทะเบียนหนังสือที่ออก (ย้ายมาจากหน้าแรก พร้อมปุ่มแก้เลขที่หนังสือ) */}
          <section
            data-testid="summary-letter-register"
            className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">
                ทะเบียนหนังสือที่ออก
              </h2>
              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                หนังสือขอความอนุเคราะห์และหนังสือส่งตัวนักศึกษา พร้อมสถานะและวันที่คณบดีลงนาม
              </p>
            </div>

            {/* แถบคำตอบอยู่ติดตาราง — ปุ่มที่กดอยู่ท้ายหน้า แถบที่หัวหน้าจะมองไม่เห็น */}
            {(docSuccess || docError) && (
              <div className="space-y-2 p-4 pb-0">
                <AlertBanner variant="success" message={docSuccess} />
                <AlertBanner variant="error" message={docError} />
              </div>
            )}

            {docError ? null : documents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
                      <th className="p-4 font-semibold">รหัสอ้างอิงเอกสาร</th>
                      <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                      <th className="p-4 font-semibold">ประเภทหนังสือ</th>
                      <th className="p-4 font-semibold">นักศึกษา</th>
                      <th className="p-4 font-semibold">บริษัทปลายทาง</th>
                      <th className="p-4 text-center font-semibold">สถานะลายเซ็นคณบดี</th>
                      <th className="p-4 text-right font-semibold">ลิงก์อ่านไฟล์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {documents.map((doc) => (
                      <tr key={doc.doc_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-4 font-bold text-gray-800 dark:text-gray-300">
                          #DOC-{doc.doc_id}
                        </td>
                        <td className="p-4 text-gray-700 dark:text-gray-300">
                          <span className="block">{doc.document_number || '-'}</span>
                          {/* แก้ได้จนกว่าคณบดีจะลงนาม — ลงนามแล้วปุ่มหายไปเอง (เซิร์ฟเวอร์ปฏิเสธด้วย) */}
                          {doc.type === 'cover_letter' && doc.status === 'pending_sign' && doc.form_id && (
                            <button
                              type="button"
                              data-testid={`edit-document-no-${doc.doc_id}`}
                              onClick={() => openEditDocumentNo(doc)}
                              className="-mb-2 py-2 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
                            >
                              แก้เลขที่หนังสือ
                            </button>
                          )}
                          {/* ดึงกลับเมื่อบริษัท/นักศึกษาแจ้งเปลี่ยนข้อมูลหลังรับคำร้อง */}
                          {(doc.type === 'cover_letter' || doc.type === 'send_letter') && doc.status === 'pending_sign' && doc.form_id && (
                            <button
                              type="button"
                              data-testid={`recall-letter-${doc.doc_id}`}
                              onClick={() => setRecallingDoc(doc)}
                              className={`-mb-2 py-2 text-xs font-semibold text-red-700 hover:underline dark:text-red-400 ${doc.type === 'cover_letter' ? 'ml-3' : ''}`}
                            >
                              ดึงหนังสือกลับ
                            </button>
                          )}
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">
                          {docTypeLabel(doc.type)}
                        </td>
                        <td className="p-4">
                          <span className="block font-medium text-gray-800 dark:text-gray-200">
                            {[doc.first_name, doc.last_name].filter(Boolean).join(' ') || '-'}
                          </span>
                          <span className="block text-xs text-gray-600 dark:text-gray-400">
                            รหัส: {doc.student_code}
                          </span>
                        </td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">{doc.company_name_th}</td>
                        <td className="p-4 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                doc.status === 'signed'
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400'
                                  : 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400'
                              }`}
                            >
                              {doc.status === 'signed' ? 'คณบดีลงนามแล้ว' : 'รอคณบดีลงนาม'}
                            </span>
                            {doc.status === 'signed' && doc.dean_signature_date && (
                              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                                ลงนามเมื่อ {formatThaiDate(doc.dean_signature_date.slice(0, 10))}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {doc.generated_file_path ? (
                            <a
                              href={`${API_BASE_URL}/files/documents/${doc.doc_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-gray-200 px-2.5 py-1 transition-all hover:border-brand-blue hover:text-brand-blue dark:border-gray-800 dark:hover:text-blue-400"
                            >
                              เปิดไฟล์ PDF
                            </a>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400">ไม่มีไฟล์</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-center text-xs text-gray-600 dark:text-gray-400">
                ยังไม่มีการออกหนังสือราชการบันทึกในระบบ
              </p>
            )}
          </section>
        </>
      )}

      {/* ══ ดึงหนังสือที่ยังไม่ลงนามกลับ — เหตุผลบังคับ ══ */}
      {recallingDoc && (
        <ReasonModal
          title="ดึงหนังสือกลับ"
          testIdPrefix="recall-letter"
          submitLabel="ดึงหนังสือกลับ"
          intro={
            <>
              กำลังดึง{docTypeLabel(recallingDoc.type)}ของ{' '}
              <strong>
                {[recallingDoc.first_name, recallingDoc.last_name].filter(Boolean).join(' ') || recallingDoc.student_code}
              </strong>{' '}
              ({recallingDoc.student_code}) · {recallingDoc.company_name_th} · เลขที่{' '}
              {recallingDoc.document_number || `#DOC-${recallingDoc.doc_id}`}
              <br />
              {recallingDoc.type === 'send_letter'
                ? 'หนังสือฉบับนี้จะถูกลบออกจากคิวคณบดี และใบกลับเข้าคิว “หนังสือส่งตัวรอออก” — ออกใหม่ด้วยเลขเดิมหรือเปลี่ยนวันที่ได้จากที่นั่น'
                : 'หนังสือฉบับนี้จะถูกลบออกจากคิวคณบดี และคำร้องกลับไปรอรับในคิว “คำร้องรอรับ” — รับใหม่ด้วยเลขเดิมหรือตีกลับนักศึกษาได้จากที่นั่น'}
            </>
          }
          hint={
            recallingDoc.type === 'send_letter'
              ? 'เหตุผลนี้เจ้าหน้าที่เห็นเท่านั้น (ในกล่องออกหนังสือส่งตัว) — นักศึกษาไม่เห็น'
              : 'เหตุผลนี้เจ้าหน้าที่เห็นเท่านั้น (ในแผงรับคำร้อง) — นักศึกษาไม่เห็น'
          }
          onSubmit={recallLetter}
          onClose={() => setRecallingDoc(null)}
        />
      )}

      {/* ══ แก้เลขที่หนังสือออก — ได้จนกว่าคณบดีจะลงนาม ══ */}
      {editingDoc && (
        <Modal onClose={() => setEditingDoc(null)} size="md" title="แก้เลขที่หนังสือออก" closeOnBackdrop={false}>
          <ModalBody>
            <div className="space-y-3">
              <AlertBanner variant="error" message={editError} />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                หนังสือขอความอนุเคราะห์ของ{' '}
                <strong>
                  {[editingDoc.first_name, editingDoc.last_name].filter(Boolean).join(' ') || editingDoc.student_code}
                </strong>{' '}
                ({editingDoc.student_code}) · {editingDoc.company_name_th}
              </p>
              <div>
                <label htmlFor="edit-document-no" className="mb-1 block text-sm font-bold text-gray-900 dark:text-gray-100">
                  เลขที่หนังสือออก
                </label>
                <Input
                  id="edit-document-no"
                  data-testid="edit-document-no-input"
                  value={newDocumentNo}
                  maxLength={100}
                  onChange={(e) => {
                    setNewDocumentNo(e.target.value);
                    setDuplicateWarning(null);
                  }}
                />
                <p className="mt-1 text-[13px] text-gray-600 dark:text-gray-400">
                  เลขเดิม {editingDoc.document_number || '-'} · ระบบจะสร้างไฟล์หนังสือฉบับรอลงนามใหม่ด้วยเลขนี้
                </p>
              </div>
              {duplicateWarning && (
                <div
                  data-testid="edit-document-no-duplicate"
                  className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  {duplicateWarning} — ต้องการใช้เลขนี้ซ้ำหรือไม่
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setEditingDoc(null)}>
              ยกเลิก
            </Button>
            <Button
              loading={editBusy}
              disabled={!newDocumentNo.trim() || newDocumentNo.trim() === (editingDoc.document_number || '')}
              data-testid="edit-document-no-save"
              onClick={() => saveDocumentNo(duplicateWarning !== null)}
            >
              {duplicateWarning ? 'ใช้เลขนี้ซ้ำ' : 'บันทึกเลขใหม่'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default SemesterSummary;
