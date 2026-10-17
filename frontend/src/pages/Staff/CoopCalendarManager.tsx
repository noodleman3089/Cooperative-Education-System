import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Trash2, Save, ChevronDown, Sparkles, ChevronUp, RotateCcw } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate, formatThaiRange } from '../../utils/thaiDate';
import { semesterLabel } from '../../utils/semesterLabel';
import SpecialRoundsCard from './SpecialRoundsCard';
import type {
  CalendarDateKind,
  CalendarStatus,
  CoopCalendarActivity,
  CoopCalendarResponse,
  CoopCalendarSemester,
} from '../../types/api';

/**
 * ปฏิทินสหกิจศึกษาของเจ้าหน้าที่ (E5 · CoopCalendar.dc.html)
 *
 * รายการกิจกรรมมาจากเซิร์ฟเวอร์ทั้งหมด (backend/src/utils/coopCalendar.ts)
 * คุณกรอกได้แค่ "วันที่" ตามชนิดที่กระดาษกำหนด · เพิ่มกิจกรรมของคณะเองได้ที่ท้ายตาราง
 *
 * Fail-open โดยตั้งใจ:
 * กิจกรรมที่ยังไม่ตั้งช่วงเวลา = ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ (ไม่ล็อก)
 */

const STATUS_TEXT: Record<CalendarStatus, string> = {
  not_configured: 'ยังไม่ได้ตั้ง',
  upcoming: 'ยังไม่ถึง',
  open: 'เปิดอยู่',
  // ⛔ ต้องบอกผลของมันด้วย ไม่ใช่แค่ “ผ่อนผัน” — เจ้าหน้าที่ต้องรู้ว่ายังรับอยู่ แต่ใบที่เข้ามา
  //    ถูกปั๊มว่าส่งช้า (ของเดิมก่อนรีเมคเขียนไว้ครบ และ E2E late-submission L8 คุมคำนี้)
  late: 'ผ่อนผัน (รับแต่นับเป็นส่งช้า)',
  closed: 'ปิดแล้ว',
};

/** ชื่อสั้นในกล่องเตือน "ช่วงที่ปิดไปแล้ว" — ชื่อเต็มของกิจกรรมยาวเกินจะอ่านเป็นรายการ */
const PAST_LABEL: Record<string, string> = {
  intent_submission: 'ส่งคำร้องขอหนังสือ (เอกสาร 1)',
  acceptance_form: 'ส่งแบบตอบรับ (เอกสาร 2)',
  accommodation_plan: 'กรอกใบสมัคร (สหกิจ 03) และที่พัก (สหกิจ 06)',
  report_outline: 'ส่งโครงร่าง (สหกิจ 11)',
  final_report: 'ส่งรายงานฉบับสมบูรณ์',
};

const KIND_LABEL: Record<string, string> = {
  range: 'ช่วง',
  deadline: 'เส้นตาย',
  single: 'วันเดียว',
  derived: 'ช่วง (สืบค่า)',
  relative: 'ข้อความ',
  external: 'ข้อความ',
};

interface DraftRow {
  start_date: string;
  end_date: string;
  late_end_date: string;
  detail_text: string;
  note: string;
}

const emptyDraft = (): DraftRow => ({
  start_date: '',
  end_date: '',
  late_end_date: '',
  detail_text: '',
  note: '',
});

const draftOf = (a: CoopCalendarActivity): DraftRow => ({
  start_date: a.start_date ?? '',
  end_date: a.end_date ?? '',
  late_end_date: a.late_end_date ?? '',
  detail_text: a.detail_text ?? '',
  note: a.note ?? '',
});

/**
 * บวก/ลบ วันจาก ISO Date string (YYYY-MM-DD) โดยใช้ UTC เพื่อป้องกัน timezone drift
 */
function addDays(isoDate: string, days: number): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return '';
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return '';
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const CoopCalendarManager: React.FC = () => {
  const [semesters, setSemesters] = useState<CoopCalendarSemester[]>([]);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [data, setData] = useState<CoopCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  /** ร่างของแต่ละกิจกรรม เก็บแยกตาม activity_key */
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  /** สำหรับ Smart Schedule Wizard */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStartDate, setWizardStartDate] = useState('');
  const [wizardEndDate, setWizardEndDate] = useState('');

  /** ฟอร์มเพิ่มรายการอิสระ */
  const [customTitle, setCustomTitle] = useState('');
  const [customDraft, setCustomDraft] = useState<DraftRow>(emptyDraft());
  const [addingCustom, setAddingCustom] = useState(false);

  /** ช่วงที่ปิดไปแล้วที่รอยืนยันก่อนบันทึก — `run` คือการบันทึกที่ค้างอยู่ */
  const [pastConfirm, setPastConfirm] = useState<{ labels: string[]; run: () => Promise<void> } | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<
    { event_id: number; label: string; isCustom: boolean } | null
  >(null);

  // โหลดรายชื่อภาคไม่สำเร็จ ≠ ยังไม่มีภาค — ห้ามขึ้นข้อความชวนไปเปิดภาคเรียนคู่กับแถบ error
  const [semestersFailed, setSemestersFailed] = useState(false);

  // แถบคำตอบอยู่หัวหน้า แต่ปุ่มที่กดอยู่ลึกลงไปได้ถึงท้ายหน้า (หน้านี้สูงกว่าสองจอ) — เลื่อนไปหาแถบทุกครั้งที่มีข้อความใหม่
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || success) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, success]);

  const loadSemesters = useCallback(async () => {
    try {
      const master = await api.get('/master-data');
      const list = (master?.semesters ?? []) as CoopCalendarSemester[];
      setSemesters(list);
      setSemestersFailed(false);
      const active = list.find((s) => s.is_active);
      if (active) setSemesterId(active.semester_id);
    } catch (err) {
      setSemestersFailed(true);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อภาคการศึกษาได้'));
    }
  }, []);

  const loadCalendar = useCallback(async (id: number | null, isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = (await api.get(
        id ? `/calendar?semester_id=${id}` : '/calendar'
      )) as CoopCalendarResponse;
      setData(res);
      setDrafts(Object.fromEntries(res.activities.map((a) => [a.activity_key, draftOf(a)])));
      const startAct = res.activities.find((a) => a.activity_key === 'coop_start');
      const endAct = res.activities.find((a) => a.activity_key === 'coop_end');
      if (startAct?.start_date) setWizardStartDate(startAct.start_date);
      if (endAct?.end_date) setWizardEndDate(endAct.end_date);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดปฏิทินสหกิจศึกษาได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSemesters();
  }, [loadSemesters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendar(semesterId);
  }, [semesterId, loadCalendar]);

  const unconfigured = useMemo(
    () => (data?.activities ?? []).filter((a) => a.status === 'not_configured'),
    [data]
  );

  /** กิจกรรมที่ตั้งช่วงเวลาไว้จริงในฐาน (มีแถวแล้ว) — ที่ล้างทั้งภาคจะลบ */
  const configuredCount = (data?.activities ?? []).filter((a) => !a.derived && a.event_id).length;

  const setDraft = (key: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyDraft()), ...patch } }));

  /**
   * ด่านกันตั้งช่วงที่ปิดไปแล้ว — ขั้นที่ล็อกจริง ปิดก่อนวันนี้ และค่าที่จะบันทึกต่างจากที่ตั้งไว้ → ถามก่อน
   * (ตัวช่วยคำนวณนับย้อนหลังจากวันเริ่มฝึก วันเริ่มใกล้/ผ่านแล้วจะได้ช่วงอดีตทั้งชุด · บันทึกแล้วนักศึกษายื่นไม่ได้ทันที)
   * ⛔ ฝั่งหน้าจอเท่านั้น — เซิร์ฟเวอร์ยังรับช่วงอดีตได้ เพราะการปิดขั้นก่อนกำหนดโดยตั้งใจและเทสต์ปฏิทินต้องตั้งช่วงที่ปิดแล้ว
   * "วันนี้" มาจากฐานข้อมูล (`data.today`) ไม่ใช่นาฬิกาเบราว์เซอร์
   */
  const closesBeforeToday = (activity: CoopCalendarActivity): boolean => {
    const today = data?.today;
    if (!today || !activity.locks || activity.derived) return false;
    const draft = drafts[activity.activity_key];
    if (!draft) return false;
    const closesOn = draft.late_end_date || draft.end_date;
    if (!closesOn || closesOn >= today) return false;
    const unchanged =
      draft.start_date === (activity.start_date ?? '') &&
      draft.end_date === (activity.end_date ?? '') &&
      draft.late_end_date === (activity.late_end_date ?? '');
    return !unchanged;
  };

  const guardPast = (activities: CoopCalendarActivity[], run: () => Promise<void>) => {
    const past = activities.filter(closesBeforeToday);
    if (past.length === 0) {
      void run();
      return;
    }
    setPastConfirm({ labels: past.map((a) => PAST_LABEL[a.activity_key] ?? a.label), run });
  };

  const handleSaveActivity = (activity: CoopCalendarActivity) =>
    guardPast([activity], () => doSaveActivity(activity));

  const doSaveActivity = async (activity: CoopCalendarActivity) => {
    const draft = drafts[activity.activity_key] ?? emptyDraft();
    setSavingKey(activity.activity_key);
    setError('');
    setSuccess('');
    try {
      const body = {
        semester_id: semesterId,
        activity_key: activity.activity_key,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        late_end_date: draft.late_end_date || null,
        detail_text: draft.detail_text || null,
        note: draft.note || null,
      };
      if (activity.event_id) {
        await api.put(`/calendar/${activity.event_id}`, body);
      } else {
        await api.post('/calendar', body);
      }
      setSuccess(`บันทึกช่วงเวลาของ "${activity.label}" เรียบร้อยแล้ว`);
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกกำหนดการได้'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveAll = () => {
    if (!data?.activities) return;
    guardPast(
      data.activities.filter((a) => {
        const d = drafts[a.activity_key];
        return !a.derived && !!d && !!(d.start_date || d.end_date || d.note);
      }),
      doSaveAll
    );
  };

  const doSaveAll = async () => {
    if (!data?.activities) return;
    setSavingAll(true);
    setError('');
    setSuccess('');
    let savedCount = 0;
    try {
      for (const activity of data.activities) {
        if (activity.derived) continue;
        const draft = drafts[activity.activity_key];
        if (!draft) continue;
        // หากมีการกรอกข้อมูลวัน
        if (draft.start_date || draft.end_date || draft.note) {
          const body = {
            semester_id: semesterId,
            activity_key: activity.activity_key,
            start_date: draft.start_date || null,
            end_date: draft.end_date || null,
            late_end_date: draft.late_end_date || null,
            detail_text: draft.detail_text || null,
            note: draft.note || null,
          };
          if (activity.event_id) {
            await api.put(`/calendar/${activity.event_id}`, body);
          } else {
            await api.post('/calendar', body);
          }
          savedCount++;
        }
      }
      setSuccess(`บันทึกกำหนดการทั้งหมดเรียบร้อยแล้ว (${savedCount} กิจกรรม)`);
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูลบางรายการ'));
    } finally {
      setSavingAll(false);
    }
  };

  /** คำนวณวันสิ้นสุดการฝึกงาน 16 สัปดาห์ (109 วัน ตามปฏิทินจริง 2569) */
  const handleCalculateEndDate = () => {
    if (!wizardStartDate) return;
    setWizardEndDate(addDays(wizardStartDate, 109));
  };

  /** คำนวณและนำวันที่ของทุกกิจกรรมไปใส่ใน draft ของตาราง */
  const handleApplySmartSchedule = () => {
    if (!wizardStartDate) {
      setError('กรุณาระบุวันเริ่มปฏิบัติงานก่อนคำนวณกำหนดการ');
      return;
    }
    const calculatedEnd = wizardEndDate || addDays(wizardStartDate, 109);
    if (!wizardEndDate) {
      setWizardEndDate(calculatedEnd);
    }

    // คำนวณนอก updater ของ setDrafts เพื่อเอาค่าที่ได้ไปตรวจช่วงที่ปิดไปแล้วต่อด้านล่าง
    const computed = (() => {
      const next = { ...drafts };

      // 1. intent_submission (ขอหนังสือทาบทาม - ช่วง)
      // อิงปฏิทินจริง 1/2569: 9 มี.ค. - 29 พ.ค. 69 เทียบกับวันเริ่ม 6 ก.ค. 69 (-119 วัน ถึง -38 วัน)
      next.intent_submission = {
        ...(next.intent_submission ?? emptyDraft()),
        start_date: addDays(wizardStartDate, -119),
        end_date: addDays(wizardStartDate, -38),
        late_end_date: addDays(wizardStartDate, -24), // ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา
      };

      // 2. acceptance_form (ส่งแบบตอบรับ - เส้นตาย)
      // อิงปฏิทินจริง 1/2569: ภายใน 5 มิ.ย. 69 เทียบกับ 6 ก.ค. 69 (-31 วัน)
      // เส้นตาย: start_date ต้องว่าง
      next.acceptance_form = {
        ...(next.acceptance_form ?? emptyDraft()),
        start_date: '',
        end_date: addDays(wizardStartDate, -31),
        late_end_date: addDays(wizardStartDate, -17), // ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา
      };

      // 3. accommodation_plan (ส่งข้อมูลที่พัก สหกิจ 06 - ช่วง)
      // อิงปฏิทินจริง 1/2569: 8 - 19 มิ.ย. 69 เทียบกับ 6 ก.ค. 69 (-28 วัน ถึง -17 วัน)
      next.accommodation_plan = {
        ...(next.accommodation_plan ?? emptyDraft()),
        start_date: addDays(wizardStartDate, -28),
        end_date: addDays(wizardStartDate, -17),
        late_end_date: addDays(wizardStartDate, -7), // ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา
      };

      // 4. coop_start (วันเริ่มปฏิบัติงาน - วันเดียว)
      next.coop_start = {
        ...(next.coop_start ?? emptyDraft()),
        start_date: wizardStartDate,
        end_date: wizardStartDate,
        late_end_date: '',
      };

      // 5. weekly_log: derived (คำนวณอัตโนมัติจาก coop_start ถึง coop_end ไม่ต้องกรอก)

      // 6. report_outline (ส่งโครงร่าง สหกิจ 11 - ช่วง)
      // สาขากำหนดเอง: ประมาณสัปดาห์ที่ 3 ถึง 5 ของการฝึกงาน (ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา)
      next.report_outline = {
        ...(next.report_outline ?? emptyDraft()),
        start_date: addDays(wizardStartDate, 21),
        end_date: addDays(wizardStartDate, 35),
        late_end_date: addDays(wizardStartDate, 42),
      };

      // 7. coop_end (วันสิ้นสุดการปฏิบัติงาน - วันเดียว)
      next.coop_end = {
        ...(next.coop_end ?? emptyDraft()),
        start_date: calculatedEnd,
        end_date: calculatedEnd,
        late_end_date: addDays(calculatedEnd, 7), // ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา
      };

      // 8. final_report (ส่งรายงานฉบับสมบูรณ์ - ช่วง)
      // สาขากำหนดเอง: 1 สัปดาห์ก่อนสิ้นสุด ถึง 1 สัปดาห์หลังสิ้นสุด (ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา)
      next.final_report = {
        ...(next.final_report ?? emptyDraft()),
        start_date: addDays(calculatedEnd, -7),
        end_date: addDays(calculatedEnd, 7),
        late_end_date: addDays(calculatedEnd, 14),
      };

      // 9. coop_exam (วันสอบสหกิจศึกษา - วันเดียว)
      // สาขากำหนดเอง: หลังสิ้นสุดการฝึกงาน 2 สัปดาห์ (ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา)
      next.coop_exam = {
        ...(next.coop_exam ?? emptyDraft()),
        start_date: addDays(calculatedEnd, 14),
        end_date: addDays(calculatedEnd, 14),
        late_end_date: '',
      };

      return next;
    })();
    setDrafts(computed);

    // ตัวช่วยนับย้อนหลังจากวันเริ่ม (ช่วงยื่นคำร้องปิด -38 วัน · ผ่อนผัน -24) — วันเริ่มที่ใกล้/ผ่านมาแล้ว
    // ทำให้ช่วงยื่นคำร้องปิดไปก่อนวันนี้ และนักศึกษาทั้งรุ่นยื่นไม่ได้ทันทีที่บันทึก · เตือนก่อนบันทึก ไม่ห้าม
    // (วันนี้มาจากฐานข้อมูลผ่าน `data.today` ไม่ใช่นาฬิกาเบราว์เซอร์)
    const today = data?.today ?? '';
    const windows: Array<[string, string]> = [
      ['intent_submission', 'ส่งคำร้องขอหนังสือ (เอกสาร 1)'],
      ['acceptance_form', 'ส่งแบบตอบรับ (เอกสาร 2)'],
      ['accommodation_plan', 'กรอกใบสมัคร (สหกิจ 03) และที่พัก (สหกิจ 06)'],
      ['report_outline', 'ส่งโครงร่าง (สหกิจ 11)'],
      ['final_report', 'ส่งรายงานฉบับสมบูรณ์'],
    ];
    const alreadyClosed = windows
      .filter(([key]) => {
        const row = computed[key];
        const closesOn = row?.late_end_date || row?.end_date;
        return !!today && !!closesOn && closesOn < today;
      })
      .map(([, label]) => label);

    if (alreadyClosed.length > 0) {
      setSuccess('');
      setError(
        `คำนวณลงร่างแล้ว แต่ช่วงต่อไปนี้ปิดไปก่อนวันนี้แล้ว: ${alreadyClosed.join(' · ')} — ` +
          'ถ้าบันทึก นักศึกษาจะยื่น/ส่งรายการเหล่านี้ไม่ได้ทันที · ตรวจวันเริ่มปฏิบัติงานอีกครั้ง หรือแก้วันที่ในตารางเองก่อนกด "บันทึกทั้งหน้า" · ' +
          'ถ้าตั้งใจให้ปิดจริงและต้องการเปิดให้เฉพาะบางคน ใช้การ์ด "รอบพิเศษ" ด้านล่างของหน้านี้'
      );
    } else {
      setSuccess('คำนวณและกรอกวันที่ลงร่างในตารางเรียบร้อยแล้ว — กรุณาตรวจสอบวันที่และกด "บันทึกทั้งหน้า"');
      setError('');
    }
  };

  /** คืนค่าร่างในตารางกลับเป็นค่าปัจจุบันของระบบ */
  const handleResetDrafts = () => {
    if (!data?.activities) return;
    setDrafts(Object.fromEntries(data.activities.map((a) => [a.activity_key, draftOf(a)])));
    setSuccess('คืนค่าร่างในตารางกลับเป็นค่าปัจจุบันของระบบแล้ว');
    setError('');
  };

  const handleClearAll = async () => {
    if (!semesterId) return;
    setClearingAll(true);
    setError('');
    setSuccess('');
    try {
      const res = (await api.delete(`/calendar/activities?semester_id=${semesterId}`)) as { message?: string };
      setSuccess(res?.message ?? 'ล้างช่วงเวลาทั้งหมดแล้ว');
      // ช่องของตัวช่วยคำนวณจำค่าเดิมไว้ (loadCalendar เติมเฉพาะเมื่อมีวัน ไม่เคลียร์) — ไม่ล้างตามจะคำนวณจากวันเริ่มเก่าที่ล้างไปแล้ว
      setWizardStartDate('');
      setWizardEndDate('');
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถล้างช่วงเวลาทั้งหมดได้'));
    } finally {
      setClearingAll(false);
      setClearAllOpen(false);
    }
  };

  const handleAddCustom = async () => {
    if (!customTitle.trim()) return;
    setAddingCustom(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/calendar', {
        semester_id: semesterId,
        activity_key: null,
        title: customTitle,
        date_kind: 'range' as CalendarDateKind,
        start_date: customDraft.start_date || null,
        end_date: customDraft.end_date || null,
        detail_text: customDraft.detail_text || null,
        note: customDraft.note || null,
      });
      setSuccess('เพิ่มกำหนดการเรียบร้อยแล้ว');
      setCustomTitle('');
      setCustomDraft(emptyDraft());
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเพิ่มกำหนดการได้'));
    } finally {
      setAddingCustom(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/calendar/${target.event_id}`);
      setSuccess(
        target.isCustom
          ? `ลบกำหนดการ "${target.label}" เรียบร้อยแล้ว`
          : `ล้างช่วงเวลาของ "${target.label}" แล้ว — กิจกรรมนี้กลับไปเป็นไม่ล็อก`
      );
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถลบกำหนดการได้'));
    }
  };

  if (loading) return <PageSkeleton variant="table" />;

  return (
    <div className="max-w-[1360px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching CoopCalendar.dc.html */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ปฏิทินสหกิจศึกษา
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            รายการกิจกรรมกำหนดไว้ตามปฏิทินสหกิจของคณะ — คุณกรอกได้แค่ <em className="italic font-semibold">วันที่</em> ตามชนิดที่กระดาษกำหนด · เพิ่มกิจกรรมของคณะเองได้ที่ท้ายตาราง
          </p>
        </div>
        {/* flex-wrap + min-w-0: จอ 360px ปุ่มบันทึกเคยล้นขอบขวาจนทั้งหน้าเลื่อนแนวนอน */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0 sm:shrink-0">
          <div className="relative min-w-0 max-w-full">
            <select
              id="calendar-semester"
              aria-label="เลือกภาคการศึกษา"
              value={semesterId ?? ''}
              onChange={(e) => setSemesterId(e.target.value ? Number(e.target.value) : null)}
              className="appearance-none max-w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-xl px-3.5 py-2.5 pr-8 text-sm font-bold shadow-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-blue"
            >
              {semesters.length === 0 && (
                <option value="" className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                  {semestersFailed ? '— โหลดรายชื่อภาคไม่สำเร็จ —' : '— ยังไม่มีภาคการศึกษา —'}
                </option>
              )}
              {semesters.map((s) => (
                <option
                  key={s.semester_id}
                  value={s.semester_id}
                  className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  {semesterLabel(s.semester, s.academic_year)} {s.is_active ? '(กำลังใช้งาน)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={savingAll}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow active:scale-95 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingAll ? 'กำลังบันทึก...' : 'บันทึกทั้งหน้า'}
          </button>
        </div>
      </div>

      <div ref={alertRef} className="space-y-4 empty:hidden">
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />
      </div>

      {/* data ยังไม่มี = โหลดไม่สำเร็จ (มีแถบ error แล้ว) — ข้อความนี้ขึ้นเฉพาะเมื่อโหลดได้และไม่มีภาคที่เปิดจริง */}
      {data && !data.semester && (
        <AlertBanner
          variant="info"
          message="ยังไม่มีภาคการศึกษาที่เปิดใช้งาน จึงยังกำหนดปฏิทินไม่ได้ กรุณาเปิดใช้งานภาคการศึกษาก่อน"
        />
      )}

      {/* 2. Fail-Open Warning Card matching CoopCalendar.dc.html (แสดงเฉพาะเมื่อยังมีกิจกรรมที่ยังไม่ได้ตั้งค่า) */}
      {unconfigured.length > 0 && (
        <div className="border border-amber-300 dark:border-amber-800 bg-[#FFFBEB] dark:bg-amber-950/30 rounded-2xl p-4 sm:p-5 text-amber-900 dark:text-amber-200 shadow-sm space-y-2">
          <div className="text-sm font-bold text-amber-900 dark:text-amber-300">
            ช่องที่เว้นว่าง = ระบบยังไม่ล็อกขั้นตอนนั้น
          </div>
          <div className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-300/90">
            ขั้นที่ยังไม่ได้ตั้งวัน นักศึกษาทำรายการได้ตลอด — ระบบไม่ปิดเอง เพื่อไม่ให้นักศึกษาทั้งรุ่นถูกกันออกเพราะปฏิทินยังกรอกไม่ครบ หน้านี้และหน้าแรกจึงบอกเสมอว่าอันไหนยังว่าง<br />
            “วันนี้” ที่ใช้ตัดสินเป็นเวลาไทยของระบบ ไม่ใช่นาฬิกาของเครื่องคุณ
          </div>

          {/* Text required by e2e test coop-calendar.spec.ts */}
          <div className="pt-2 border-t border-amber-200/80 dark:border-amber-800/80 text-xs font-semibold text-amber-900 dark:text-amber-200">
            {/* แยกสองกลุ่ม: หน้าแรกนับเฉพาะขั้นที่ล็อกจริง จึงขึ้นเลขน้อยกว่าบรรทัดนี้ — เดิมผู้ใช้ตามปุ่มมาแล้วเจอจำนวนไม่ตรง */}
            ⚠️ ยังไม่ได้ตั้งช่วงเวลา {unconfigured.length} กิจกรรม (ขั้นที่ล็อกจริง{' '}
            {unconfigured.filter((a) => a.locks).length} · หมุดบอกเวลา {unconfigured.filter((a) => !a.locks).length}):{' '}
            {unconfigured.map((a) => a.label).join(' · ')}
            <br />
            ระหว่างที่ยังไม่ตั้ง ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ (ไม่ล็อก)
          </div>
        </div>
      )}

      {/* 2.5 Smart Schedule Wizard (ตัวช่วยคำนวณอัตโนมัติจากวันเปิด-ปิดภาคเรียน) */}
      <div className="border border-blue-200 dark:border-blue-800/80 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/60 rounded-xl text-blue-600 dark:text-blue-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                ตัวช่วยคำนวณกำหนดการอัตโนมัติ (Smart Schedule Wizard)
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                  ทางลัดตั้งค่าด่วน
                </span>
              </h2>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                ระบุเพียงวันเริ่มและวันสิ้นสุดการฝึกงาน (16 สัปดาห์) ระบบจะช่วยคำนวณช่วงเวลาส่งเอกสารและกิจกรรมทั้งหมดลงในตารางให้ทันที
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(!wizardOpen)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded-lg transition-colors shrink-0 self-start sm:self-center"
          >
            {wizardOpen ? (
              <>
                <span>ซ่อนตัวช่วย</span>
                <ChevronUp className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>เปิดตัวช่วยคำนวณ</span>
                <ChevronDown className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {wizardOpen && (
          <div className="pt-3 border-t border-blue-200/60 dark:border-blue-800/50 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* วันเริ่มปฏิบัติงาน */}
              <div className="space-y-1.5 bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
                <label
                  htmlFor="wizard-start-date"
                  className="block text-xs font-bold text-gray-900 dark:text-gray-100"
                >
                  วันเริ่มปฏิบัติงานสหกิจศึกษา (coop_start)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    id="wizard-start-date"
                    value={wizardStartDate}
                    onChange={(e) => setWizardStartDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  ปกติเป็นวันจันทร์สัปดาห์แรกของการฝึกงาน
                </p>
              </div>

              {/* วันสิ้นสุดการปฏิบัติงาน */}
              <div className="space-y-1.5 bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="wizard-end-date"
                    className="block text-xs font-bold text-gray-900 dark:text-gray-100"
                  >
                    วันสิ้นสุดการปฏิบัติงาน (coop_end)
                  </label>
                  <button
                    type="button"
                    onClick={handleCalculateEndDate}
                    disabled={!wizardStartDate}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    +16 สัปดาห์ (109 วัน)
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    id="wizard-end-date"
                    value={wizardEndDate}
                    onChange={(e) => setWizardEndDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  ปกติเป็นวันศุกร์สัปดาห์ที่ 16 (ห่างจากวันเริ่ม 109 วัน)
                </p>
              </div>
            </div>

            {/* ปุ่ม Actions และหมายเหตุ */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="text-[11px] text-gray-600 dark:text-gray-400 space-y-0.5">
                <div>
                  💡 ค่าที่คำนวณได้จะใส่เป็น <span className="font-semibold text-gray-900 dark:text-gray-200">ร่างในตาราง</span> ให้ตรวจสอบก่อนกด &quot;บันทึกทั้งหน้า&quot;
                </div>
                <div className="text-gray-500 dark:text-gray-500">
                  (สำหรับกิจกรรมที่สาขาวิชากำหนดเอง เช่น โครงร่างและรายงานฉบับสมบูรณ์ เป็นการประมาณการเบื้องต้น: ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา)
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleResetDrafts}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl transition-colors shadow-xs cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  คืนค่าเดิม
                </button>
                <button
                  type="button"
                  onClick={handleApplySmartSchedule}
                  disabled={!wizardStartDate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs hover:shadow active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  คำนวณและกรอกลงตาราง
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Main Activities Table Card matching CoopCalendar.dc.html */}
      <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        {/* ล้างทั้งภาคทีเดียว — ตั้งค่าผิดทั้งชุด (เช่นจากตัวช่วยคำนวณ) ไม่ต้องกดล้างทีละแถว */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            ตั้งช่วงเวลาไว้แล้ว <span className="font-bold text-gray-900 dark:text-gray-100">{configuredCount}</span> กิจกรรม
          </p>
          <button
            type="button"
            data-testid="calendar-clear-all"
            disabled={configuredCount === 0 || clearingAll || !semesterId}
            onClick={() => setClearAllOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ล้างช่วงเวลาทั้งหมด
          </button>
        </div>
        {/* Table Header */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-3 px-5 py-3.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300">
          {/* กิจกรรม 4 · ผ่อนผัน 2 (เดิม 5 · 1): ช่องวันผ่อนผันเคยกว้าง 77px อ่านวันที่ที่กรอกไม่ออก */}
          <div className="lg:col-span-4">กิจกรรม</div>
          <div className="lg:col-span-1">ชนิดวันที่</div>
          <div className="lg:col-span-2">วันเริ่ม</div>
          <div className="lg:col-span-2">วันสิ้นสุด</div>
          <div className="lg:col-span-2">ผ่อนผันถึง</div>
          <div className="lg:col-span-1 text-center">สถานะวันนี้</div>
        </div>

        {/* List Items (uses <ul> and <li> to satisfy both table look & Playwright locator('li')) */}
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60 m-0 p-0 list-none">
          {data?.activities.map((activity) => {
            const draft = drafts[activity.activity_key] ?? emptyDraft();
            const isSaving = savingKey === activity.activity_key;
            const isUnconfiguredAndLocks = activity.status === 'not_configured' && activity.locks;

            return (
              <li
                key={activity.activity_key}
                data-testid={`calendar-row-${activity.activity_key}`}
                className={`p-4 lg:px-5 lg:py-4 flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:gap-3 lg:items-center transition-colors ${
                  isUnconfiguredAndLocks
                    ? 'bg-amber-50/40 dark:bg-amber-950/20'
                    : 'hover:bg-gray-50/60 dark:hover:bg-gray-700/30'
                }`}
              >
                {/* 1. กิจกรรม (col-span-4) */}
                <div className="lg:col-span-4 space-y-1">
                  <span className="text-[14px] font-bold text-gray-900 dark:text-white leading-snug block">
                    {activity.label}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activity.locks ? (
                      <span className="tag inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#FEE2E2] text-[#B91C1C] dark:bg-red-950/60 dark:text-red-300">
                        ล็อกจริง
                      </span>
                    ) : (
                      <span className="tag inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#F3F4F6] text-[#4B5563] dark:bg-gray-700 dark:text-gray-300">
                        หมุดบอกเวลา
                      </span>
                    )}

                    {activity.paper_row && (
                      <span className="hint text-[12px] text-gray-500 dark:text-gray-400">
                        {activity.paper_row}
                      </span>
                    )}
                    {activity.hint && (
                      <span className="hint text-[12px] text-gray-500 dark:text-gray-400">
                        · {activity.hint}
                      </span>
                    )}
                  </div>

                  {isUnconfiguredAndLocks && (
                    <div className="text-[12px] font-semibold text-[#92400E] dark:text-amber-400">
                      ยังไม่ได้ตั้ง — ตอนนี้นักศึกษาส่งได้ตลอด
                    </div>
                  )}

                  {/* Note Input (Preserves #note-<key> for tests/staff notes) */}
                  {!activity.derived && (
                    <div className="pt-1">
                      <input
                        type="text"
                        id={`note-${activity.activity_key}`}
                        value={draft.note}
                        onChange={(e) => setDraft(activity.activity_key, { note: e.target.value })}
                        placeholder="หมายเหตุ (ถ้ามี) เช่น ส่งที่ห้องงานสหกิจศึกษา..."
                        className="w-full max-w-sm pointer-coarse:min-h-11 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* 2. ชนิดวันที่ (col-span-1) */}
                <div className="lg:col-span-1 text-[13px] text-gray-600 dark:text-gray-300 font-medium">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">ชนิด: </span>
                  {activity.derived ? 'ช่วง (สืบค่า)' : KIND_LABEL[activity.date_kind] || activity.date_kind}
                </div>

                {/* 3. วันเริ่ม (col-span-2) */}
                <div className="lg:col-span-2">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">วันเริ่ม: </span>
                  {activity.date_kind === 'deadline' ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">— ไม่ต้องกรอก</span>
                  ) : activity.derived ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-300">
                      {activity.start_date || 'คำนวณอัตโนมัติ'}
                    </span>
                  ) : (
                    <input
                      type="date"
                      id={`start-${activity.activity_key}`}
                      data-testid={`calendar-start-${activity.activity_key}`}
                      value={draft.start_date}
                      onChange={(e) => setDraft(activity.activity_key, { start_date: e.target.value })}
                      className="inp w-full max-w-[135px] pointer-coarse:min-h-11 px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>

                {/* 4. วันสิ้นสุด (col-span-2) */}
                <div className="lg:col-span-2">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">วันสิ้นสุด: </span>
                  {activity.date_kind === 'single' ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">= วันเริ่ม</span>
                  ) : activity.derived ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-300">
                      {activity.end_date || 'คำนวณอัตโนมัติ'}
                    </span>
                  ) : (
                    <input
                      type="date"
                      id={`end-${activity.activity_key}`}
                      data-testid={`calendar-end-${activity.activity_key}`}
                      value={draft.end_date}
                      onChange={(e) => setDraft(activity.activity_key, { end_date: e.target.value })}
                      className={`inp w-full max-w-[135px] pointer-coarse:min-h-11 px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border rounded-lg focus:ring-1 focus:ring-blue-500 ${
                        isUnconfiguredAndLocks
                          ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/30'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                  )}
                </div>

                {/* 5. ผ่อนผันถึง (col-span-2) */}
                <div className="lg:col-span-2">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">ผ่อนผัน: </span>
                  {activity.derived ? (
                    <span className="hint text-[11px] text-gray-500 dark:text-gray-400">
                      ผ่อนผันที่แถว “วันสิ้นสุด”
                    </span>
                  ) : !activity.allow_late ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">—</span>
                  ) : (
                    <input
                      type="date"
                      id={`late-${activity.activity_key}`}
                      data-testid={`calendar-late-${activity.activity_key}`}
                      value={draft.late_end_date}
                      onChange={(e) => setDraft(activity.activity_key, { late_end_date: e.target.value })}
                      className="inp w-full max-w-[135px] pointer-coarse:min-h-11 px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>

                {/* 6. สถานะวันนี้ & บันทึก (col-span-1) */}
                <div className="lg:col-span-1 flex flex-row lg:flex-col items-center lg:items-end justify-between gap-1.5">
                  {activity.status === 'not_configured' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#FFFBEB] text-[#B45309] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 whitespace-nowrap">
                      ยังไม่ได้ตั้ง
                    </span>
                  ) : activity.status === 'open' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap">
                      เปิดอยู่
                    </span>
                  ) : activity.status === 'upcoming' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                      ยังไม่ถึง
                    </span>
                  ) : activity.status === 'late' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 text-center">
                      {STATUS_TEXT.late}
                    </span>
                  ) : !activity.locks ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 whitespace-nowrap">
                      ไม่ล็อกอยู่แล้ว
                    </span>
                  ) : (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 whitespace-nowrap">
                      {STATUS_TEXT[activity.status] || activity.status}
                    </span>
                  )}

                  {!activity.derived && (
                    // ปุ่มรายแถวเป็นปุ่มรอง — ปุ่มหลักของหน้าคือ "บันทึกทั้งหน้า" ตัวเดียว (เดิมน้ำเงินทึบ 10 ปุ่มแข่งกัน)
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleSaveActivity(activity)}
                      disabled={isSaving}
                      data-testid="calendar-save"
                      icon={<Save className="w-3.5 h-3.5" />}
                    >
                      {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                    </Button>
                  )}
                  {/* ล้างช่วงที่ตั้งไว้ = ลบแถวกำหนดการ ขั้นนี้กลับไปเป็น "ยังไม่ได้ตั้ง" — เดิมตั้งแล้วถอนไม่ได้ (บันทึกค่าว่างถูกปฏิเสธ) */}
                  {!activity.derived && activity.event_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`calendar-clear-${activity.activity_key}`}
                      onClick={() =>
                        setPendingDelete({ event_id: activity.event_id!, label: activity.label, isCustom: false })
                      }
                    >
                      ล้างช่วงเวลา
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 4. Bottom Grid (2 Columns) matching CoopCalendar.dc.html */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Left: รายการอิสระของคณะ */}
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              กำหนดการแจ้งนักศึกษา (รายการอิสระของคณะ)
            </h3>
            <p className="hint text-[12px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
              ใช้ <strong className="font-bold">แจ้งวันสำคัญให้นักศึกษาเห็นในปฏิทิน</strong> เช่น ปฐมนิเทศ ลงทะเบียน ประกาศผล —
              เป็นแถวบนกระดาษที่ระบบไม่ได้อ้างอิง{' '}
              <strong className="font-bold">แสดงอย่างเดียว ไม่ล็อกและไม่ปลดล็อกการทำรายการใด</strong>
              {' '}· ถ้าต้องการให้นักศึกษาบางคนส่งงานนอกช่วงได้ ใช้การ์ด &ldquo;รอบพิเศษ&rdquo; ด้านล่าง
            </p>
          </div>

          <div className="space-y-2">
            {(data?.custom_events ?? []).length === 0 ? (
              <div className="text-xs text-gray-600 dark:text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                ยังไม่มีกำหนดการแจ้งนักศึกษาในภาคการศึกษานี้
              </div>
            ) : (
              data?.custom_events.map((evt) => (
                <div
                  key={evt.event_id}
                  className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/40"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {evt.title}
                    </div>
                    <div className="hint text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {evt.start_date && evt.start_date === evt.end_date
                        ? `วันเดียว · ${formatThaiDate(evt.start_date)}`
                        : evt.start_date && evt.end_date
                        ? formatThaiRange(evt.start_date, evt.end_date)
                        : evt.detail_text || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        event_id: evt.event_id,
                        label: evt.title,
                        isCustom: true,
                      })
                    }
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded-lg transition-colors"
                    title="ลบรายการ"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Form to add custom event */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50/40 dark:bg-gray-800/20 space-y-3">
            <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
              เพิ่มกำหนดการแจ้งนักศึกษา
            </div>
            <div className="space-y-2">
              <input
                id="custom-title"
                type="text"
                placeholder="ชื่อกำหนดการ เช่น ปฐมนิเทศนักศึกษาสหกิจศึกษา..."
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="custom-start" className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                    วันเริ่ม
                  </label>
                  <input
                    id="custom-start"
                    type="date"
                    value={customDraft.start_date}
                    onChange={(e) => setCustomDraft({ ...customDraft, start_date: e.target.value })}
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="custom-end" className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                    วันสิ้นสุด
                  </label>
                  <input
                    id="custom-end"
                    type="date"
                    value={customDraft.end_date}
                    onChange={(e) => setCustomDraft({ ...customDraft, end_date: e.target.value })}
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddCustom}
              disabled={addingCustom || !customTitle.trim()}
              data-testid="calendar-custom-add"
              className="btn inline-flex items-center gap-1.5 pointer-coarse:min-h-11 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {addingCustom ? 'กำลังเพิ่ม...' : 'เพิ่มกำหนดการ'}
            </button>
          </div>
        </div>

        {/* Right: ข้อควรรู้ของหน้านี้ — เหตุผลเชิงเทคนิคอยู่ที่ backend/src/utils/coopCalendar.ts:
            กิจกรรมที่ล็อกจริงต้องมีโค้ดฝั่งเซิร์ฟเวอร์เรียกใช้ จึงไม่เปิดให้เพิ่มจากหน้าจอ */}
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            ข้อควรรู้ของหน้านี้
          </h3>
          <div className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300 space-y-3">
            <p>
              <strong className="font-bold text-gray-900 dark:text-white">กำหนดการแจ้งนักศึกษาที่เพิ่มเองเป็นหมุดบอกเวลาเท่านั้น</strong> — นักศึกษาเห็นในปฏิทิน แต่ไม่ล็อกขั้นตอนใด ขั้นที่ล็อกจริงมีเฉพาะแถวที่ติดป้าย “ล็อกจริง” ในตารางด้านบน · อยากให้นักศึกษาบางคนส่งงานนอกช่วงได้ ให้ใช้การ์ด “รอบพิเศษ” ไม่ใช่การ์ดนี้
            </p>
            <p>
              <strong className="font-bold text-gray-900 dark:text-white">แถวชนิด “เส้นตาย” กรอกเฉพาะวันสิ้นสุด</strong> — “ภายในวันที่ 10” ไม่เท่ากับ “เฉพาะวันที่ 10” หน้าจอจึงปิดช่องวันเริ่มของแถวชนิดนี้ไว้
            </p>
          </div>
        </div>
      </div>

      {data?.semester && (
        <SpecialRoundsCard
          semesterId={semesterId}
          activities={data.activities}
          rounds={data.special_rounds ?? []}
          onChanged={() => loadCalendar(semesterId, true)}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      <ConfirmDialog
        open={!!pastConfirm}
        title="ช่วงเหล่านี้ปิดไปก่อนวันนี้แล้ว"
        message={
          <>
            <ul className="list-disc space-y-0.5 pl-5">
              {pastConfirm?.labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2">
              ถ้าบันทึก <strong>นักศึกษาจะยื่น/ส่งรายการเหล่านี้ไม่ได้ทันที</strong> — ตรวจวันที่อีกครั้ง
              หรือถ้าตั้งใจปิดจริงแล้วต้องการเปิดเฉพาะบางคน ใช้การ์ด &ldquo;รอบพิเศษ&rdquo; ด้านล่างของหน้านี้
            </p>
          </>
        }
        confirmLabel="บันทึกทั้งที่ปิดแล้ว"
        cancelLabel="กลับไปแก้วันที่"
        confirmTestId="calendar-past-confirm"
        destructive
        onConfirm={() => {
          const run = pastConfirm?.run;
          setPastConfirm(null);
          if (run) void run();
        }}
        onCancel={() => setPastConfirm(null)}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title="ยืนยันการล้างช่วงเวลาทั้งหมด"
        message={
          <>
            <p>
              ล้างช่วงเวลาของ <strong>{configuredCount} กิจกรรม</strong> ในภาคนี้ทั้งหมด — ทุกขั้นกลับเป็น &ldquo;ยังไม่ได้ตั้ง&rdquo;
              นักศึกษาทำรายการได้ทุกขั้นทันทีจนกว่าจะตั้งช่วงเวลาใหม่
            </p>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              ไม่แตะ: รอบพิเศษ และกำหนดการแจ้งนักศึกษา (รายการอิสระของคณะ) · ค่าที่ล้างไปถูกบันทึกไว้ในประวัติการใช้งานระบบ
            </p>
          </>
        }
        confirmLabel="ล้างช่วงเวลาทั้งหมด"
        confirmTestId="calendar-clear-all-confirm"
        destructive
        busy={clearingAll}
        onConfirm={() => void handleClearAll()}
        onCancel={() => setClearAllOpen(false)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        level={1}
        title={pendingDelete?.isCustom === false ? 'ยืนยันการล้างช่วงเวลา' : 'ยืนยันการลบกำหนดการ'}
        message={
          pendingDelete?.isCustom === false
            ? `ล้างช่วงเวลาของ "${pendingDelete.label}" — ขั้นนี้กลับไปเป็นยังไม่ได้ตั้ง นักศึกษาทำรายการได้ตลอดจนกว่าจะตั้งใหม่`
            : `ลบกำหนดการ "${pendingDelete?.label}"`
        }
        confirmLabel={pendingDelete?.isCustom === false ? 'ล้างช่วงเวลา' : 'ลบกำหนดการ'}
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default CoopCalendarManager;
