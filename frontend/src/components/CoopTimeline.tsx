import React from 'react';
import {
  CalendarDays,
  Clock,
  AlertTriangle,
  Lock,
  LockOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
} from 'lucide-react';
import { formatThaiDate, formatThaiRange } from '../utils/thaiDate';
import type { CalendarDateKind, CalendarStatus } from '../types/api';

/**
 * แถวข้อมูลในไทม์ไลน์สหกิจศึกษา
 */
export interface TimelineRow {
  key: string;
  title: string;
  date_kind: CalendarDateKind;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
  detail_text: string | null;
  note: string | null;
  status: CalendarStatus;
  locksSubmission: boolean;
  menu: string | null;
}

interface CoopTimelineProps {
  rows: TimelineRow[];
  today: string;
  onPick: (menu: string) => void;
}

/** ป้ายสถานะของการ์ด */
const STATUS_CONFIG: Record<
  CalendarStatus,
  { text: string; subText?: string; icon: typeof Lock; badgeCls: string; dotCls: string; cardBorder: string; title: string }
> = {
  open: {
    text: 'กำลังอยู่ในช่วงนี้',
    subText: 'เปิดให้ทำรายการ',
    icon: LockOpen,
    badgeCls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60',
    dotCls: 'bg-emerald-500 ring-4 ring-emerald-100 dark:ring-emerald-950/80 text-white',
    cardBorder: 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/20 dark:bg-emerald-950/10 shadow-xs shadow-emerald-500/5',
    title: 'ตอนนี้อยู่ในช่วง ระบบรับรายการตามปกติ',
  },
  late: {
    text: 'เลยกำหนดปกติ',
    subText: 'อยู่ในช่วงผ่อนผัน',
    icon: AlertTriangle,
    badgeCls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60',
    dotCls: 'bg-amber-500 ring-4 ring-amber-100 dark:ring-amber-950/80 text-white',
    cardBorder: 'border-amber-300 dark:border-amber-700/70 bg-amber-50/20 dark:bg-amber-950/10',
    title: 'เลยวันปิดปกติแล้ว ระบบยังรับอยู่แต่ต้องชี้แจงเหตุผลและจะถูกบันทึกว่าส่งช้า',
  },
  upcoming: {
    text: 'ยังไม่ถึงกำหนด',
    icon: Clock,
    badgeCls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60',
    dotCls: 'bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-950/80 text-white',
    cardBorder: 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
    title: 'ยังไม่ถึงวันเริ่ม ระบบจะยังไม่รับรายการ',
  },
  closed: {
    text: 'ผ่านไปแล้ว (ปิดรับแล้ว)',
    icon: CheckCircle2,
    badgeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
    dotCls: 'bg-gray-400 ring-4 ring-gray-100 dark:ring-gray-800 text-white',
    cardBorder: 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-85',
    title: 'หมดช่วงแล้ว ระบบไม่รับรายการใหม่',
  },
  not_configured: {
    text: 'ไม่มีกำหนดวันตายตัว',
    icon: Circle,
    badgeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
    dotCls: 'bg-gray-300 dark:bg-gray-600 ring-4 ring-gray-100 dark:ring-gray-800 text-gray-500',
    cardBorder: 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
    title: 'ยังไม่ได้กำหนดวัน',
  },
};

const KIND_LABEL: Record<CalendarDateKind, string> = {
  range: 'ช่วงเวลา',
  deadline: 'กำหนดส่งภายในวัน',
  single: 'กำหนดวันเดียว',
  relative: 'ตามเงื่อนไข',
  external: 'ตามปฏิทินมหาวิทยาลัย/สาขา',
};

function describeDates(kind: CalendarDateKind, line: TimelineRow): string {
  switch (kind) {
    case 'deadline':
      return line.end_date ? `ภายในวันที่ ${formatThaiDate(line.end_date)}` : '';
    case 'single':
      return line.start_date ? `${formatThaiDate(line.start_date)} (วันเดียว)` : '';
    case 'relative':
    case 'external':
      return line.detail_text ?? 'ตามกำหนดการ';
    default:
      return line.start_date && line.end_date
        ? formatThaiRange(line.start_date, line.end_date)
        : '';
  }
}

const CoopTimeline: React.FC<CoopTimelineProps> = ({ rows, today, onPick }) => {
  if (rows.length === 0) return null;

  // หา index ที่ "วันนี้" ควรจะอยู่ (ก่อนแถวแรกที่ยังไม่หมดช่วง หรือระหว่างแถว)
  let todayInsertIndex = rows.findIndex((r) => {
    const compareDate = r.end_date ?? r.start_date;
    return compareDate && compareDate >= today;
  });
  if (todayInsertIndex === -1) {
    const lastDatedIndex = rows.findLastIndex((r) => r.end_date || r.start_date);
    todayInsertIndex = lastDatedIndex !== -1 ? lastDatedIndex + 1 : 0;
  }

  return (
    <div className="relative py-2">
      {/* เส้นแกนแนวตั้ง (Timeline spine track) */}
      <div
        className="absolute top-4 bottom-4 left-4 sm:left-5 w-0.5 bg-gray-200 dark:bg-gray-700 -translate-x-1/2"
        aria-hidden="true"
      />

      <ul className="space-y-6 list-none p-0 m-0">
        {rows.map((row, index) => {
          const config = STATUS_CONFIG[row.status];
          const StatusIcon = config.icon;
          const dateString = describeDates(row.date_kind, row);
          const isActionable = Boolean(row.menu);
          const showTodayHere = index === todayInsertIndex;

          const CardContent = (
            <div className="flex flex-col gap-2.5">
              {/* Header: ป้ายสถานะ & ชนิดวันที่ */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* รายการที่ล็อกระบบจะมีป้ายสถานะพร้อม title */}
                  {row.locksSubmission && (
                    <span
                      title={config.title}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.badgeCls}`}
                    >
                      <StatusIcon className="w-3.5 h-3.5" />
                      <span>{config.text}</span>
                      {config.subText && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{config.subText}</span>
                        </>
                      )}
                    </span>
                  )}

                  {row.late_end_date && (row.status === 'open' || row.status === 'late') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50">
                      <Clock className="w-3 h-3" />
                      ผ่อนผันถึง {formatThaiDate(row.late_end_date)}
                    </span>
                  )}
                </div>

                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                  {KIND_LABEL[row.date_kind]}
                </span>
              </div>

              {/* Title / รายการ */}
              <h4 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 leading-snug">
                {row.title}
              </h4>

              {/* วันที่และช่วงเวลา */}
              {dateString && (
                <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <CalendarDays className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0" />
                  <span>{dateString}</span>
                </div>
              )}

              {/* หมายเหตุเพิ่มเติม (ถ้ามี) */}
              {row.note && (
                <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-100 dark:border-gray-700/60 text-xs text-gray-600 dark:text-gray-300">
                  {row.note}
                </div>
              )}

              {/* Action Link ถ้าเป็นกิจกรรมที่ไปทำได้ */}
              {isActionable && (
                <div className="pt-2 mt-1 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300 flex items-center gap-1 transition-colors">
                    กดเพื่อไปทำรายการนี้
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">
                    คลิกเพื่อเปิดหน้าเมนู
                  </span>
                </div>
              )}
            </div>
          );

          return (
            <React.Fragment key={row.key}>
              {/* หมุดระบุ "วันนี้" ระหว่างขั้นตอน */}
              {showTodayHere && (
                <li className="relative flex items-center gap-3 pl-10 sm:pl-12 py-1 my-1 list-none">
                  <div className="absolute left-4 sm:left-5 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-bold shadow-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    วันนี้: {formatThaiDate(today)}
                  </div>
                </li>
              )}

              {/* แถวรายการและตัวการ์ด */}
              <li className="relative flex items-start pl-10 sm:pl-12 group list-none">
                {/* Node บนเส้นแกนเวลา */}
                <div
                  className={`absolute left-4 sm:left-5 top-4 -translate-x-1/2 flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white dark:border-gray-900 ${config.dotCls} shadow-xs z-10 transition-transform group-hover:scale-110`}
                  title={`สถานะ: ${config.text}`}
                >
                  <StatusIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>

                {/* การ์ดกิจกรรม: ถ้ากดได้ให้เป็นปุ่ม button ถ้ากดไม่ได้ให้เป็น div */}
                {isActionable ? (
                  <button
                    type="button"
                    onClick={() => onPick(row.menu!)}
                    aria-label={`${row.title} ${dateString} — กดเพื่อไปทำรายการนี้`}
                    className={`w-full rounded-2xl border p-4 sm:p-5 text-left transition-all cursor-pointer hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${config.cardBorder}`}
                  >
                    {CardContent}
                  </button>
                ) : (
                  <div
                    className={`w-full rounded-2xl border p-4 sm:p-5 text-left ${config.cardBorder}`}
                  >
                    {CardContent}
                  </div>
                )}
              </li>
            </React.Fragment>
          );
        })}

        {/* ถ้า "วันนี้" อยู่หลังแถวสุดท้าย */}
        {todayInsertIndex >= rows.length && (
          <li className="relative flex items-center gap-3 pl-10 sm:pl-12 py-1 my-1 list-none">
            <div className="absolute left-4 sm:left-5 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-bold shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              วันนี้: {formatThaiDate(today)}
            </div>
          </li>
        )}
      </ul>
    </div>
  );
};

export default CoopTimeline;
