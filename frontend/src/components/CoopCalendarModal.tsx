import React from 'react';
import { CalendarDays } from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import CoopTimeline, { type TimelineRow } from './CoopTimeline';
import { actionMenuFor, goToMenu } from '../utils/calendarMenus';
import { formatThaiDate } from '../utils/thaiDate';
import type { CoopCalendarResponse } from '../types/api';

/**
 * ปฏิทินสหกิจศึกษาที่นักศึกษาเปิดดู (แบบไทม์ไลน์แนวตั้งพร้อมการ์ดรายละเอียด)
 *
 * แสดงเป็นไทม์ไลน์แนวตั้ง มีแกนเวลาเชื่อมโยงแต่ละขั้นตอน
 * แสดงชื่อรายการเต็มไม่ตัดทับ พร้อมการ์ดแสดงช่วงเวลาและสถานะ
 * หากรายการไหนมีเมนูที่นักศึกษาทำได้ สามารถคลิกที่การ์ดเพื่อไปยังหน้านั้นได้ทันที
 */
const CoopCalendarModal: React.FC<{ data: CoopCalendarResponse; onClose: () => void }> = ({
  data,
  onClose,
}) => {
  const lines: TimelineRow[] = [
    // กิจกรรมที่เจ้าหน้าที่ยังไม่ตั้งจะไม่โผล่ — ยังไม่มีอะไรให้บอก
    ...data.activities
      .filter((a) => a.end_date || a.detail_text)
      .map((a) => ({
        key: `a-${a.activity_key}`,
        title: a.label,
        date_kind: a.date_kind,
        start_date: a.start_date,
        end_date: a.end_date,
        late_end_date: a.late_end_date,
        detail_text: a.detail_text,
        note: a.note,
        status: a.status,
        locksSubmission: a.locks,
        menu: actionMenuFor(a.activity_key),
      })),
    ...data.custom_events.map((c) => ({
      key: `c-${c.event_id}`,
      title: c.title,
      date_kind: c.date_kind,
      start_date: c.start_date,
      end_date: c.end_date,
      late_end_date: c.late_end_date,
      detail_text: c.detail_text,
      note: c.note,
      status: c.status,
      locksSubmission: false,
      // รายการที่เจ้าหน้าที่พิมพ์เองไม่ผูกกับหน้าจอไหน จึงกดไม่ได้
      menu: null,
    })),
  ].sort((a, b) =>
    (a.start_date ?? a.end_date ?? '9999').localeCompare(b.start_date ?? b.end_date ?? '9999')
  );

  /** กดแล้วปิดปฏิทินก่อนค่อยพาไป — ไม่งั้นกล่องจะค้างทับหน้าที่เพิ่งเปิด */
  const pick = (menu: string) => {
    onClose();
    goToMenu(menu);
  };

  return (
    <Modal onClose={onClose} size="3xl" title="ปฏิทินสหกิจศึกษา">
      <ModalBody className="space-y-4 max-h-[72vh] overflow-y-auto px-1 sm:px-2 py-2">
        {data.semester && (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              ภาคเรียนที่ {data.semester.semester}/{data.semester.academic_year}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
              <span>วันนี้: {formatThaiDate(data.today)}</span>
            </div>
          </div>
        )}

        {lines.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-6 text-center text-sm text-gray-600 dark:text-gray-400">
            เจ้าหน้าที่งานสหกิจศึกษายังไม่ได้กำหนดปฏิทินของภาคการศึกษานี้
            ระหว่างนี้ยังทำรายการได้ตามปกติ
          </div>
        ) : (
          <CoopTimeline rows={lines} today={data.today} onPick={pick} />
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
