import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import ReasonModal from '../../components/ui/ReasonModal';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorCode, getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import RequestQueue, { type QueueKind } from './RequestQueue';

/**
 * E0 · หน้าแรกของเจ้าหน้าที่ — แบบ B “งานของฉันนำ” (เจ้าของเลือก 2026-10-07)
 *
 * บนสุดคืองานที่รอมือเจ้าหน้าที่ 4 กอง · กลางคือรายการเดียวของกองที่เลือก · ท้ายคือท่อย่อของทั้งรุ่น
 * ของที่ถอดจากแบบเดิม (เจ้าของเคาะ): การ์ดฤดูกาลใบใหญ่ (เหลือบรรทัดกำหนดที่หัวหน้า) · กอง “ค้างที่คณบดี”
 * (ย้ายไปช่อง “รอคณบดี” ของท่อย่อ) · แถบปฏิทิน 4 ช่วง (เมนูปฏิทินสหกิจยังอยู่ และแถบเตือนยังอยู่)
 *
 * ⛔ **ตัวเลขทุกตัวมาจากเซิร์ฟเวอร์** — `GET /api/staff/home` (งานที่รอ · กำหนด · ภาคอื่น) และ
 *    `GET /api/staff/pipeline` (ท่อย่อ) · หน้าจอห้ามนับเอง คำนวณไม่ได้ = “ไม่ทราบ”
 * ⛔ **หน้าจอไม่ตัดสินฤดูกาลเอง และไม่เทียบวันเอง** — อ่าน `season` กับ `days_left` ที่เซิร์ฟเวอร์ส่งมา
 *    (เบราว์เซอร์ไม่รู้ “วันนี้” ของฐานข้อมูล)
 *
 * รายการคิวและแผงตรวจทั้งสามแบบอยู่ใน `RequestQueue` ซึ่งโหลดแถวของตัวเอง
 */

type Season =
  | 'overdue'
  | 'request'
  | 'acceptance'
  | 'supervision'
  | 'evaluation'
  | 'idle';

/** งานของเจ้าหน้าที่ 4 กอง (เซิร์ฟเวอร์ยังส่งกอง `dean` มาด้วย — หน้านี้ไม่แสดง ดูท่อย่อแทน) */
type TileKind = 'request' | 'acceptance' | 'dispatch' | 'appointment';

interface Tile {
  count: number;
  overdue: number;
  note: string | null;
  /** รอนานสุดกี่วัน (คำร้อง · แบบตอบรับ) — null = ไม่ทราบ */
  oldest_days: number | null;
  /** วันที่ใกล้สุดของกอง (วันเริ่มงาน · วันนัดนิเทศ) */
  next_date: string | null;
}

interface StaffHomePayload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean } | null;
  season: Season;
  /** ภาคอื่นที่ยังมีเรื่องค้าง — ภาคที่ไม่มีอะไรค้างไม่ถูกส่งมา */
  other_semesters: {
    semester_id: number;
    label: string;
    closed: boolean;
    open_forms: number;
    on_placement: number;
    evaluations_missing: number;
  }[];
  season_detail: {
    deadline: string | null;
    days_left: number | null;
  };
  /** คำร้องที่รับแล้วแต่ไม่มีหนังสือเข้าคิวคณบดี (การสร้างหนังสือล้มหลังรับ) — ต้องกดสร้างอีกครั้ง */
  missing_cover_letters: {
    form_id: number;
    student_code: string;
    student_name: string | null;
    company_name: string;
    document_no: string | null;
  }[];
  tiles: Record<TileKind, Tile>;
  /** ผลรวมของ 4 กอง — เซิร์ฟเวอร์บวกให้ */
  work_total: number;
  calendar_warnings: { activity_key: string | null; label: string }[];
}

interface PipelineStage {
  key: string;
  label: string;
  short: string;
  count: number;
  holders: { student: number; staff: number; company: number; dean: number; clear: number };
}

interface PipelinePayload {
  cohort_total: number;
  stages: PipelineStage[];
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

/** ปลายทางของปุ่ม — คีย์ query ที่ `Dashboard.tsx` อ่าน (`menu` หายไป = หน้าแรก) */
type Dest = Record<string, string>;

/** การ์ดงาน 4 ใบ · `queue` = กองที่รายการกลางหน้าแสดง (null = มีเมนูของตัวเอง) */
const JOBS: { kind: TileKind; label: string; queue: QueueKind | null; emptyNote: string }[] = [
  {
    kind: 'request',
    label: 'คำร้องรอรับ',
    queue: 'request',
    emptyNote: 'ยังไม่มีนักศึกษาอัปโหลดคำร้องที่ลงนามแล้วเข้ามา',
  },
  {
    kind: 'acceptance',
    label: 'แบบตอบรับรอตรวจ',
    queue: 'acceptance',
    emptyNote: 'ยังไม่มีแบบตอบรับ (เอกสารหมายเลข 2) ส่งเข้ามา',
  },
  {
    kind: 'dispatch',
    label: 'หนังสือส่งตัวรอออก',
    queue: 'dispatch',
    emptyNote: 'ยังไม่มีนักศึกษาที่สถานประกอบการตอบรับแล้ว',
  },
  {
    kind: 'appointment',
    label: 'ร่างนัดนิเทศรอส่ง',
    queue: null,
    emptyNote: 'ยังไม่มีร่างนัดนิเทศรอส่ง',
  },
];

const isQueueKind = (v: string | null): v is QueueKind =>
  v === 'request' || v === 'acceptance' || v === 'dispatch';

/**
 * ถ้อยคำของช่วงปฏิทิน — ⛔ ที่นี่แปล `season` เป็นคำเท่านั้น **ไม่ได้ตัดสินว่าอยู่ช่วงไหน**
 * (การตัดสินอยู่ที่ `controllers/staffHome.ts` ที่เดียว)
 */
const SEASON_COPY: Record<Season, { phase: string; deadlineLabel: string }> = {
  overdue: { phase: 'มีงานเลยกำหนด', deadlineLabel: 'กำหนด' },
  request: { phase: 'ช่วงรับคำร้องและออกหนังสือ', deadlineLabel: 'ปิดรับ' },
  acceptance: { phase: 'ช่วงรับแบบตอบรับและออกหนังสือส่งตัว', deadlineLabel: 'ปิดรับ' },
  supervision: { phase: 'ช่วงระหว่างปฏิบัติงานและนิเทศ', deadlineLabel: 'สิ้นสุดการปฏิบัติงาน' },
  evaluation: { phase: 'ช่วงประเมินและปิดภาค', deadlineLabel: 'ปิดภาค' },
  idle: { phase: 'ยังไม่ถึงช่วงของงานถัดไปตามปฏิทิน', deadlineLabel: 'กำหนด' },
};

/**
 * บรรทัดล่างของการ์ดงาน — จำนวนวัน/วันที่มาจากเซิร์ฟเวอร์ ที่นี่แค่เลือกคำ
 * `urgent` = มีของเลยกำหนดในกองนี้ (ตัวแดง)
 */
function jobLine(kind: TileKind, tile: Tile, emptyNote: string): { text: string; urgent: boolean } {
  if (tile.count === 0) return { text: emptyNote, urgent: false };
  const urgent = tile.overdue > 0;
  switch (kind) {
    case 'request':
    case 'acceptance': {
      const oldest =
        tile.oldest_days == null
          ? 'ไม่ทราบว่ารอนานสุดกี่วัน'
          : tile.oldest_days === 0
            ? 'เข้ามาวันนี้'
            : `รอนานสุด ${tile.oldest_days} วัน`;
      return { text: urgent ? `${oldest} · เลยกำหนด ${tile.overdue}` : oldest, urgent };
    }
    case 'dispatch': {
      const next = tile.next_date ? `เริ่มงาน ${formatThaiDate(tile.next_date)}` : 'ยังไม่มีวันเริ่มงาน';
      return { text: urgent ? `${next} · ถึงวันเริ่มงานแล้ว ${tile.overdue}` : next, urgent };
    }
    default: {
      const next = tile.next_date ? `นัดใกล้สุด ${formatThaiDate(tile.next_date)}` : 'ยังไม่ได้ระบุวันนัด';
      return { text: urgent ? `${next} · เลยวันนัดแล้ว ${tile.overdue}` : next, urgent };
    }
  }
}

/** สีของช่องในท่อย่อ: น้ำเงินเข้ม = รอเจ้าหน้าที่ · ม่วง = รอคณบดี · ส้ม = รอบริษัท · เทา = รอนักศึกษา/ไม่มีงานค้าง */
function cellTone(stage: PipelineStage): string {
  if (stage.count === 0) return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  switch (stage.key) {
    case 'await_officer_request':
    case 'await_officer_accept':
      return 'bg-brand-blue text-white';
    case 'await_dean':
      return 'bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200';
    case 'await_company':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200';
    case 'accepted_prep':
      return stage.holders.staff > 0
        ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
        : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100';
    default:
      return 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100';
  }
}

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/** `วันอังคารที่ 7 ต.ค. 2569` จากวันที่ของเซิร์ฟเวอร์ — หาวันในสัปดาห์จากสตริงล้วน ไม่อ่านนาฬิกาเบราว์เซอร์ */
function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `วัน${THAI_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}ที่ ${formatThaiDate(iso)}`;
}

export const StaffHome: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueParam = searchParams.get('queue');
  const [home, setHome] = useState<StaffHomePayload | null>(null);
  const [pipeline, setPipeline] = useState<PipelinePayload | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reissuingForm, setReissuingForm] = useState<number | null>(null);
  // แก้เลขที่หนังสือ (ได้จนกว่าคณบดีจะลงนาม) — เก็บทั้งแถวไว้ให้กล่องบอกได้ว่ากำลังแก้ของใคร
  const [editingDoc, setEditingDoc] = useState<GeneratedDocument | null>(null);
  const [newDocumentNo, setNewDocumentNo] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // ดึงหนังสือที่ยังไม่ลงนามกลับ — ใบถอยไปรอรับคำร้องใหม่ · เก็บทั้งแถวไว้ให้กล่องบอกได้ว่ากำลังดึงของใคร
  const [recallingDoc, setRecallingDoc] = useState<GeneratedDocument | null>(null);

  const loadHome = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const data = await api.get('/staff/home');
      setHome(data);
    } catch (err) {
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถโหลดคิวงานวันนี้ได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  /**
   * ประวัติหนังสือราชการเป็นแผงของตัวเองที่อยู่ท้ายหน้ามาแต่เดิม ไม่ใช่ส่วนหนึ่งของ
   * สรุปด้านบน — จึงโหลดแยกและล้มแยกได้โดยไม่ทำให้คิวงานหายไปทั้งหน้า
   */
  const loadDocuments = useCallback(async () => {
    try {
      const docs = await api.get('/documents');
      setDocuments(docs || []);
    } catch {
      setDocuments([]);
    }
  }, []);

  /** ท่อย่อท้ายหน้า — ภาคที่เปิดอยู่ ทุกสาขา (ค่าเริ่มต้นของเส้นนี้) · ล้มแยกจากงานที่รอด้านบน */
  const loadPipeline = useCallback(async () => {
    try {
      setPipeline((await api.get('/staff/pipeline')) as PipelinePayload);
      setPipelineError(null);
    } catch (err) {
      setPipelineError(getErrorMessage(err, 'ไม่สามารถโหลดภาพรวมนักศึกษาทั้งรุ่นได้'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHome();
    loadDocuments();
    loadPipeline();
  }, [loadHome, loadDocuments, loadPipeline]);

  const go = (dest: Dest) => {
    const next = new URLSearchParams();
    Object.entries(dest).forEach(([k, v]) => next.set(k, v));
    navigate({ pathname: '/dashboard', search: next.toString() });
  };

  /** รับคำร้องแล้วแต่หนังสือไม่ออก — สั่งสร้างอีกครั้ง (เซิร์ฟเวอร์ปฏิเสธถ้ามีหนังสืออยู่แล้ว) */
  const reissueCoverLetter = async (formId: number, studentCode: string) => {
    setReissuingForm(formId);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/intents/${formId}/cover-letter/reissue`);
      setSuccess(`สร้างหนังสือขอความอนุเคราะห์ของ ${studentCode} แล้ว · รอคณบดีลงนาม`);
    } catch (err) {
      setError(getErrorMessage(err, 'สร้างหนังสือไม่สำเร็จ'));
    } finally {
      setReissuingForm(null);
      await Promise.all([loadHome(true), loadDocuments()]);
    }
  };

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
      setSuccess(res.message || `แก้เลขที่หนังสือเป็น ${no} แล้ว`);
      setEditingDoc(null);
      await loadDocuments();
    } catch (err) {
      if (getErrorCode(err) === 'duplicate_document_no') {
        setDuplicateWarning(getErrorMessage(err));
      } else {
        setDuplicateWarning(null);
        setEditError(getErrorMessage(err, 'ไม่สามารถแก้เลขที่หนังสือได้'));
        // คณบดีลงนามไปแล้วระหว่างที่กล่องเปิดอยู่ = แถวในตารางต้องเปลี่ยนตาม
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
      // คณบดีลงนามไปแล้วระหว่างที่กล่องเปิดอยู่ = แถวในตารางต้องเปลี่ยนตาม (ข้อความ error ยังขึ้นในกล่อง)
      await loadDocuments();
      throw err;
    }
    const targetQueueName = recallingDoc.type === 'send_letter' ? 'หนังสือส่งตัวรอออก' : 'คำร้องรอรับ';
    setSuccess(
      `ดึง${docTypeLabel(recallingDoc.type)}ของ ${recallingDoc.student_code} กลับแล้ว · ใบกลับไปรอในคิว "${targetQueueName}"`
    );
    setRecallingDoc(null);
    await Promise.all([loadHome(true), loadDocuments(), loadPipeline()]);
  };

  if (loading) return <PageSkeleton variant="stats" />;

  if (!home) {
    return (
      <div className="space-y-4 page-enter">
        <AlertBanner
          variant="error"
          message={error || 'ไม่สามารถโหลดคิวงานวันนี้ได้ กรุณาลองใหม่อีกครั้ง'}
        />
      </div>
    );
  }

  const { season, season_detail: detail, tiles, calendar_warnings: warnings } = home;

  // กองที่รายการกลางหน้าแสดง: ตาม `?queue=` · ไม่ระบุ = กองแรกที่มีงาน (ไม่มีเลย = คำร้อง)
  const activeQueue: QueueKind = isQueueKind(queueParam)
    ? queueParam
    : (JOBS.find((j) => j.queue !== null && tiles[j.kind].count > 0)?.queue ?? 'request');

  // `activity_key` เป็น null = ประโยคเต็มจากเซิร์ฟเวอร์ (ยังไม่เปิดภาคเรียน) แสดงทีละบรรทัด
  // มีค่า = เป็น "ชื่อกิจกรรม" เปล่า ๆ ต้องต่อท้ายเองว่ายังไม่ได้ตั้งช่วงเวลา และผลคืออะไร
  // ตั้งแต่ 2 กิจกรรมขึ้นไปรวมเป็นบรรทัดเดียว ไม่ให้ประโยคท้ายซ้ำทุกบรรทัด
  const unsetLabels = warnings.filter((w) => w.activity_key !== null).map((w) => w.label);
  const warningLines = [
    ...warnings.filter((w) => w.activity_key === null).map((w) => w.label),
    ...(unsetLabels.length === 1
      ? [`${unsetLabels[0]} ยังไม่ได้ตั้งช่วงเวลา — ระบบจึงยังไม่ล็อกใครในขั้นนั้น`]
      : unsetLabels.length > 1
        ? [`ยังไม่ได้ตั้งช่วงเวลา: ${unsetLabels.join(' · ')} — ระบบจึงยังไม่ล็อกใครในขั้นเหล่านี้`]
        : []),
  ];

  return (
    <div className="space-y-4 page-enter">
      {/* ── หัวเรื่อง: งานที่รอคุณ ── */}
      <div className="min-w-0">
        <span className="block text-[13px] font-semibold text-brand-blue dark:text-blue-400">
          {home.semester ? home.semester.label : 'ยังไม่ได้เปิดภาคเรียน'} · {weekdayDate(home.today)}
        </span>
        <h1 className="text-[26px] font-extrabold leading-tight text-gray-900 dark:text-white">
          {home.work_total > 0 ? `งานที่รอคุณ ${home.work_total} เรื่อง` : 'ตอนนี้ไม่มีงานรอคุณ'}
        </h1>
        {/*
          ช่วงของปฏิทินและกำหนดปิดรับ — ย่อมาจากการ์ดฤดูกาลใบใหญ่เดิม (เจ้าของเคาะ 2026-10-07)
          ⛔ `season` และ `days_left` มาจากเซิร์ฟเวอร์ หน้าจอไม่ตัดสินฤดูกาลและไม่เทียบวันเอง
        */}
        <p
          data-testid="staff-home-season"
          data-season={season}
          className="mt-0.5 text-[13px] text-gray-600 dark:text-gray-400"
        >
          {SEASON_COPY[season].phase}
          {detail.deadline &&
            ` · ${SEASON_COPY[season].deadlineLabel} ${formatThaiDate(detail.deadline)}${
              detail.days_left !== null ? ` · ${daysLeftText(detail.days_left)}` : ''
            }`}
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/*
        ── รับคำร้องแล้วแต่ไม่มีหนังสือเข้าคิวคณบดี ──
        ใบแบบนี้ไม่อยู่ในคิวไหนเลย (ไม่ใช่คิวเจ้าหน้าที่แล้ว และคณบดีไม่มีอะไรให้ลงนาม) — ไม่ขึ้นตรงนี้คือค้างถาวร
        อยู่บนสุดของหน้าเสมอ และไม่มีทางซ่อน
      */}
      {home.missing_cover_letters.length > 0 && (
        <section data-testid="staff-home-missing-letters" className="space-y-2">
          {home.missing_cover_letters.map((m) => (
            <div
              key={m.form_id}
              data-testid={`staff-home-missing-letter-${m.form_id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40"
            >
              <div className="min-w-0 flex-[1_1_280px]">
                <p className="text-[15px] font-bold text-red-900 dark:text-red-200">
                  รับคำร้องแล้ว แต่ยังไม่มีหนังสือเข้าคิวคณบดี
                </p>
                <p className="text-sm text-red-900 dark:text-red-200">
                  {[m.student_name, m.student_code].filter(Boolean).join(' · ')} · {m.company_name}
                  {m.document_no ? ` · เลขที่ ${m.document_no}` : ''}
                </p>
              </div>
              <Button
                variant="danger"
                className="min-h-11 bg-red-700 hover:bg-red-800"
                loading={reissuingForm === m.form_id}
                disabled={reissuingForm !== null}
                data-testid={`staff-home-reissue-${m.form_id}`}
                onClick={() => reissueCoverLetter(m.form_id, m.student_code)}
              >
                สร้างหนังสืออีกครั้ง
              </Button>
            </div>
          ))}
        </section>
      )}

      {/*
        ── แถบเตือนปฏิทิน ──
        ⛔ ด่านปฏิทิน fail-open **โดยตั้งใจ** (ตรงข้ามกับ SEC-06 ซึ่งเป็นเรื่องสิทธิ์
           และต้อง fail closed) · แต่ fail-open ต้องไม่เงียบ หน้าจอเจ้าหน้าที่คือที่เดียว
           ที่บอกได้ว่าขั้นไหนยังไม่ล็อกใคร
        ⛔ ห้ามเขียนว่า “ผิดพลาด” หรือ “ระบบไม่พร้อม” — นี่คือพฤติกรรมที่ตั้งใจ
      */}
      {warnings.length > 0 && (
        <div
          data-testid="staff-home-calendar-warning"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ul className="space-y-1 min-w-0">
              {warningLines.map((line) => (
                <li key={line} className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                  {line}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => go({ menu: 'calendar' })}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-200 dark:hover:bg-gray-700"
            >
              ไปตั้งช่วงเวลา
            </button>
          </div>
        </div>
      )}

      {/*
        ── การ์ดงาน 4 ใบ ──
        ⛔ ใบที่นับได้ 0 ยังต้องแสดง พร้อมบอกว่าทำไมถึงว่าง — ซ่อนแล้วคนใช้จะไม่รู้ว่ากองนั้นมีอยู่
        สามใบแรกเลือกรายการด้านล่าง (`?queue=`) · ร่างนัดนิเทศพาไปเมนูของมันเอง
      */}
      <div className="flex flex-wrap gap-3.5">
        {JOBS.map(({ kind, label, queue, emptyNote }) => {
          const tile = tiles[kind];
          const selected = queue !== null && queue === activeQueue;
          const line = jobLine(kind, tile, emptyNote);
          return (
            <button
              key={kind}
              type="button"
              data-testid={`staff-home-tile-${kind}`}
              aria-pressed={queue !== null ? selected : undefined}
              onClick={() => go(queue !== null ? { queue } : { menu: 'appointments' })}
              className={`flex min-h-11 min-w-0 flex-[1_1_220px] flex-col gap-1 rounded-2xl border-2 p-4 text-left ${
                selected
                  ? 'border-brand-blue bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40'
                  : 'border-gray-200 bg-white hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-600'
              }`}
            >
              <span
                className={`text-sm font-bold ${
                  selected ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {label}
              </span>
              <span
                data-testid={`staff-home-tile-${kind}-count`}
                className={`text-[34px] font-extrabold leading-tight tabular-nums ${
                  selected
                    ? 'text-blue-900 dark:text-blue-200'
                    : tile.count === 0
                      ? 'text-gray-600 dark:text-gray-400'
                      : 'text-gray-900 dark:text-white'
                }`}
              >
                {tile.count}
              </span>
              <span
                className={`text-[13px] ${
                  line.urgent
                    ? 'font-bold text-red-700 dark:text-red-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {line.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── รายการเดียวของการ์ดที่เลือก (แผงตรวจทั้งสามแบบอยู่ในนี้) ── */}
      <RequestQueue
        queue={activeQueue}
        onDataChanged={() => {
          void loadHome(true);
          // รับคำร้อง/ออกหนังสือส่งตัว = มีหนังสือใบใหม่ในตารางด้านล่าง และนักศึกษาย้ายช่องในท่อ
          void loadDocuments();
          void loadPipeline();
        }}
      />

      {/*
        ── ภาคอื่นที่ยังมีเรื่องค้าง ──
        ภาคเก่าที่ยังมีใบรอผล/นักศึกษากำลังฝึก/ผลประเมินไม่ครบ ต้องไม่หายไปพอเปิดภาคใหม่
        (ปิดภาคไม่ใช่การเคลียร์ของ) — ตัวเลขทั้งหมดมาจากเซิร์ฟเวอร์
      */}
      {home.other_semesters.length > 0 && (
        <section
          data-testid="staff-home-other-semesters"
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">ภาคก่อนที่ยังมีเรื่องค้าง</h2>
          <p className="mb-2 mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            ภาคที่หยุดรับหรือปิดไปแล้วแต่ยังมีนักศึกษาที่ต้องตาม — ยังไม่ถูกย้ายหรือเปลี่ยนสถานะ
          </p>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {home.other_semesters.map((s) => (
              <li
                key={s.semester_id}
                data-testid={`staff-home-other-semester-${s.semester_id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <span className="block text-[13px] font-bold text-gray-900 dark:text-white">
                    {s.label}
                    {s.closed && <span className="ml-2 text-xs font-semibold text-gray-600 dark:text-gray-400">(ปิดภาคแล้ว)</span>}
                  </span>
                  <span className="block text-xs text-gray-700 dark:text-gray-300">
                    ใบรอผล {s.open_forms} · กำลังฝึก {s.on_placement} · ผลประเมินยังไม่ครบ {s.evaluations_missing}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`staff-home-other-semester-go-${s.semester_id}`}
                  onClick={() => go({ menu: 'pipeline', semester_id: String(s.semester_id) })}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  ดูนักศึกษาภาคนี้
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        ── ท่อย่อ 14 ช่อง: นักศึกษาทั้งรุ่นอยู่ขั้นไหน ──
        ตัวเลขและชื่อช่องมาจาก `GET /api/staff/pipeline` (ที่เดียวกับเมนู "นักศึกษาตอนนี้") หน้าจอไม่นับเอง
        โหลดแยกและล้มแยก — ท่อโหลดไม่ได้ต้องไม่ทำให้งานที่รอด้านบนหายไปทั้งหน้า
      */}
      <section
        data-testid="staff-home-pipeline"
        className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-[18px] shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
            {pipeline && pipeline.stages.length > 0
              ? `นักศึกษาทั้งรุ่น ${pipeline.cohort_total} คน อยู่ขั้นไหน`
              : 'นักศึกษาทั้งรุ่นอยู่ขั้นไหน'}
          </h2>
          <button
            type="button"
            data-testid="staff-home-pipeline-open"
            onClick={() => go({ menu: 'pipeline' })}
            className="-my-2 py-2 text-[13px] font-bold text-brand-blue hover:underline dark:text-blue-400"
          >
            เปิดหน้านักศึกษาตอนนี้
          </button>
        </div>
        {pipelineError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{pipelineError}</p>
        ) : !pipeline ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">กำลังโหลด...</p>
        ) : pipeline.stages.length === 0 || pipeline.cohort_total === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            ยังไม่มีนักศึกษาในรุ่นของภาคเรียนนี้
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {pipeline.stages.map((stage) => (
                <div
                  key={stage.key}
                  data-testid={`staff-home-pipeline-${stage.key}`}
                  title={stage.label}
                  className={`flex min-w-0 flex-[1_1_84px] flex-col items-center gap-0.5 rounded-[10px] px-1.5 py-2 text-center ${cellTone(stage)}`}
                >
                  <b className="text-lg font-extrabold tabular-nums">{stage.count}</b>
                  <span className="text-[11.5px] leading-snug">
                    {stage.short}
                    {stage.key === 'accepted_prep' && stage.holders.staff > 0 && ` (รอคุณ ${stage.holders.staff})`}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-gray-600 dark:text-gray-400">
              ช่องสีน้ำเงินเข้มคือขั้นที่รอคุณ · สีม่วงรอคณบดี · สีส้มรอบริษัท · สีเทารอนักศึกษาหรือไม่มีงานค้าง
            </p>
          </>
        )}
      </section>

      {/* ── ประวัติหนังสือราชการ & สถานะการลงนามของคณบดี ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            ประวัติหนังสือราชการ &amp; สถานะการลงนามของคณบดี
          </span>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            หนังสือขอความอนุเคราะห์และหนังสือส่งตัวนักศึกษา พร้อมสถานะและวันที่คณบดีลงนาม
          </p>
        </div>

        {documents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">รหัสอ้างอิงเอกสาร</th>
                  <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                  <th className="p-4 font-semibold">ประเภทหนังสือ</th>
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">บริษัทปลายทาง</th>
                  <th className="p-4 font-semibold text-center">สถานะลายเซ็นคณบดี</th>
                  <th className="p-4 font-semibold text-right">ลิงก์อ่านไฟล์</th>
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
                      {/* ดึงกลับเมื่อบริษัท/นักศึกษาแจ้งเปลี่ยนข้อมูลหลังรับคำร้อง — แถวเดียวกัน เงื่อนไขเดียวกับปุ่มแก้เลข */}
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
                          className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-xs ${
                            doc.status === 'signed'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
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
                          className="px-2.5 py-1 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
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
          <div className="text-center py-12 text-gray-600 dark:text-gray-400 text-sm">
            ยังไม่มีการออกหนังสือราชการบันทึกในระบบ — ใบแรกจะเกิดตอนคุณกดรับคำร้องแล้วออกเลขที่หนังสือ
          </div>
        )}
      </div>

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

/** `days_left` คิดมาจากเซิร์ฟเวอร์แล้ว ที่นี่แค่เลือกคำ — ติดลบได้แปลว่าเลยมาแล้ว */
function daysLeftText(days: number): string {
  if (days > 0) return `เหลืออีก ${days} วัน`;
  if (days === 0) return 'วันนี้วันสุดท้าย';
  return `เลยกำหนดมาแล้ว ${Math.abs(days)} วัน`;
}

function docTypeLabel(type: string): string {
  if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
  if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
  return type;
}

export default StaffHome;
