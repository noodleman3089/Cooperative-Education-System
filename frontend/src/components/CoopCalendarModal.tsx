import React from 'react';
import { AlertTriangle, Lock, LockOpen } from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { formatThaiDate, formatThaiRange } from '../utils/thaiDate';
import type { CalendarStatus, CoopCalendarResponse } from '../types/api';

/**
 * ปฏิทินสหกิจศึกษาที่นักศึกษาเปิดดู
 *
 * เป็น **รายการเรียงตามเวลา ไม่ใช่ตารางเดือนแบบ grid** โดยตั้งใจ:
 * ข้อมูลจริงมีราวหกถึงสิบสองช่วงต่อภาคการศึกษา ช่วงละหลายสัปดาห์
 * ส่วนคำถามที่นักศึกษาถามคือ "ตอนนี้ช่วงอะไร แล้วอันถัดไปเมื่อไหร่"
 * ซึ่งรายการตอบตรงกว่า อ่านบนมือถือได้ และไม่ต้องมีตรรกะวางแท่งที่คร่อม
 * สัปดาห์/เดือนหรือทับกัน ซึ่งเป็นโค้ดหลายร้อยบรรทัดที่ยังไม่มีใครขอ
 *
 * ไม่ fetch เอง — StudentDashboard โหลดปฏิทินไว้แล้วตั้งแต่เปิดหน้า
 */

/** หนึ่งบรรทัดในปฏิทิน ไม่ว่ามาจากกิจกรรมตายตัวหรือรายการที่เจ้าหน้าที่เพิ่มเอง */
interface CalendarLine {
  key: string;
  title: string;
  start_date: string;
  end_date: string;
  late_end_date: string | null;
  note: string | null;
  status: CalendarStatus;
  /** true = กิจกรรมนี้ถูกปฏิทินคุมจริงที่เซิร์ฟเวอร์ ไม่ใช่แค่ข้อมูลประกอบ */
  locksSubmission: boolean;
}

const GROUPS: { status: CalendarStatus; heading: string; dot: string }[] = [
  { status: 'open', heading: 'กำลังอยู่ในช่วงนี้', dot: 'bg-emerald-500' },
  // ⛔ ต้องมีหมู่ 'late' ด้วย — ไม่งั้นแถวที่อยู่ในช่วงผ่อนผัน **หายไปจากปฏิทินทั้งแถว**
  //    (GROUPS.map กรองด้วย status แถวที่ไม่ตรงหมู่ไหนเลยจะไม่ถูกเรนเดอร์)
  { status: 'late', heading: 'เลยกำหนดปกติแล้ว — ยังส่งได้ในช่วงผ่อนผัน', dot: 'bg-amber-500' },
  { status: 'upcoming', heading: 'ที่กำลังจะถึง', dot: 'bg-blue-500' },
  { status: 'closed', heading: 'ผ่านไปแล้ว', dot: 'bg-gray-400 dark:bg-gray-600' },
];

/**
 * ป้ายท้ายแถว = **"ตอนนี้ทำรายการนี้ได้ไหม"** ไม่ใช่ "กิจกรรมนี้มีการล็อกอยู่ในระบบ"
 *
 * ของเดิมเป็นข้อความตายตัวว่า "🔒 ล็อกการทำรายการ" ติดทุกแถวที่ `locksSubmission`
 * โดยไม่ดู status เลย ตั้งใจให้อ่านว่า *"กิจกรรมนี้ถูกปฏิทินคุม"* แต่คนอ่านจริง
 * อ่านว่า *"ตอนนี้ล็อกอยู่"* → นักศึกษาที่อยู่ในช่วงเปิดพอดีเห็นรูกุญแจแล้วไม่กล้ากด
 * (เจ้าของเจอเองเมื่อ 4 ก.ย. 2569 ซึ่งเป็นวันแรกของช่วงที่เปิด)
 *
 * บทเรียน: ป้ายที่ไม่ผูกกับสถานะจะถูกอ่านเป็นสถานะเสมอ เพราะมันอยู่ข้างๆ วันที่
 */
const GATE_BADGE: Record<
  CalendarStatus,
  { text: string; icon: typeof Lock; className: string; title: string } | null
> = {
  open: {
    text: 'เปิดให้ทำรายการ',
    icon: LockOpen,
    className:
      'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    title: 'ตอนนี้อยู่ในช่วง ระบบรับรายการตามปกติ',
  },
  late: {
    text: 'ผ่อนผัน — ส่งได้แต่นับว่าส่งช้า',
    icon: AlertTriangle,
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
    title: 'เลยวันปิดปกติแล้ว ระบบยังรับอยู่แต่ต้องชี้แจงเหตุผลและจะถูกบันทึกว่าส่งช้า',
  },
  upcoming: {
    text: 'ยังไม่เปิด',
    icon: Lock,
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    title: 'ยังไม่ถึงวันเริ่ม ระบบจะยังไม่รับรายการ',
  },
  closed: {
    text: 'ปิดรับแล้ว',
    icon: Lock,
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    title: 'หมดช่วงแล้ว ระบบไม่รับรายการใหม่',
  },
  // ยังไม่ตั้งช่วง = ยังไม่มีกฎ = ไม่ล็อก (fail-open) ไม่ควรมีป้ายอะไรเลย
  not_configured: null,
};

const CoopCalendarModal: React.FC<{ data: CoopCalendarResponse; onClose: () => void }> = ({
  data,
  onClose,
}) => {
  const lines: CalendarLine[] = [
    // กิจกรรมที่เจ้าหน้าที่ยังไม่ตั้งช่วงจะไม่โผล่ — ยังไม่มีวันให้บอก
    ...data.activities
      .filter((a) => a.start_date && a.end_date)
      .map((a) => ({
        key: `a-${a.activity_key}`,
        title: a.label,
        start_date: a.start_date as string,
        end_date: a.end_date as string,
        late_end_date: a.late_end_date,
        note: a.note,
        status: a.status,
        locksSubmission: true,
      })),
    ...data.custom_events.map((c) => ({
      key: `c-${c.event_id}`,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date,
      late_end_date: c.late_end_date,
      note: c.note,
      status: c.status,
      locksSubmission: false,
    })),
  ].sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <Modal onClose={onClose} size="lg" title="ปฏิทินสหกิจศึกษา">
      <ModalBody className="space-y-5">
        {data.semester && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            ภาคเรียนที่ {data.semester.semester}/{data.semester.academic_year}
          </p>
        )}

        {lines.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            เจ้าหน้าที่งานสหกิจศึกษายังไม่ได้กำหนดปฏิทินของภาคการศึกษานี้
            ระหว่างนี้ยังทำรายการได้ตามปกติ
          </p>
        ) : (
          GROUPS.map(({ status, heading, dot }) => {
            const group = lines.filter((l) => l.status === status);
            if (group.length === 0) return null;
            return (
              <section key={status}>
                <h4 className="mb-2 text-sm font-bold text-gray-800 dark:text-gray-200">
                  {heading}
                </h4>
                <ul className="space-y-2">
                  {group.map((line) => {
                    // รายการอิสระที่เจ้าหน้าที่พิมพ์เองไม่ล็อกอะไร จึงไม่ควรมีป้ายสถานะ
                    const badge = line.locksSubmission ? GATE_BADGE[line.status] : null;
                    const BadgeIcon = badge?.icon;
                    return (
                      <li
                        key={line.key}
                        className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-800 dark:text-gray-100">
                            {line.title}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {formatThaiRange(line.start_date, line.end_date)}
                            {line.status === 'late' && line.late_end_date && (
                              <> · ผ่อนผันถึง {formatThaiDate(line.late_end_date)}</>
                            )}
                          </p>
                          {line.note && (
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                              {line.note}
                            </p>
                          )}
                        </div>
                        {badge && BadgeIcon && (
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}
                            title={badge.title}
                          >
                            <BadgeIcon className="h-3 w-3" />
                            {badge.text}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </ModalBody>

      <ModalFooter>
        <Button size="sm" onClick={onClose}>
          ปิดหน้าต่าง
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CoopCalendarModal;
