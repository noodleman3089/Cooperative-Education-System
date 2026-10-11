import React from 'react';
import { Lock } from 'lucide-react';

export interface ConfirmSummaryRow {
  label: string;
  value: React.ReactNode;
}

interface ConfirmSummaryProps {
  /** หนึ่งบรรทัด: กดแล้วเกิดอะไร / ไปถึงมือใคร */
  lead?: React.ReactNode;
  /** กลุ่มค่าที่กำลังจะส่งจริง — ใส่หัวกลุ่มเมื่อมีหลายเรื่องในกล่องเดียว */
  groups?: { title?: string; rows: ConfirmSummaryRow[] }[];
  /** ทางลัดเมื่อมีกลุ่มเดียว */
  rows?: ConfirmSummaryRow[];
  /** รายการสิ่งที่จะเกิดขึ้น (เฉพาะระดับ 3) */
  effects?: string[];
  /** แถบเหลือง: อะไรแก้ไม่ได้ และถ้าผิดต้องทำอย่างไร */
  lockNote?: React.ReactNode;
}

/**
 * เนื้อในของ `ConfirmDialog` สำหรับการส่งที่แก้เองไม่ได้ฝั่งนักศึกษา (เจ้าของตัดสิน 2026-09-21)
 *
 * ⛔ แสดง **ค่าที่กำลังจะส่งจริง** ไม่ใช่ "แน่ใจไหม" ลอย ๆ — กล่องที่ไม่มีข้อมูลคนกดผ่านโดยไม่อ่าน
 * กล่องที่มีรหัสนักศึกษาของตัวเองอยู่ตรงหน้า คนเห็นตัวเลขผิดก่อนกด
 */
const ConfirmSummary: React.FC<ConfirmSummaryProps> = ({ lead, groups, rows, effects, lockNote }) => {
  const allGroups = groups ?? (rows ? [{ rows }] : []);
  return (
    <div className="space-y-3" data-testid="confirm-summary">
      {lead && <p>{lead}</p>}
      {allGroups.length > 0 && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-800">
          {allGroups.map((g, gi) => (
            <div key={gi} className="space-y-1">
              {g.title && <p className="text-[11px] text-gray-500 dark:text-gray-400">{g.title}</p>}
              {g.rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-3">
                  <span className="shrink-0 text-gray-600 dark:text-gray-400">{r.label}</span>
                  <span className="break-words text-right font-semibold text-gray-900 dark:text-white">
                    {r.value === '' || r.value === null || r.value === undefined ? '—' : r.value}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {effects && effects.length > 0 && (
        <div data-testid="confirm-effects" className="space-y-1 text-xs">
          <p className="font-bold text-gray-700 dark:text-gray-300">สิ่งที่จะเกิดขึ้น</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
            {effects.map((effect, idx) => (
              <li key={idx} className="leading-relaxed">
                {effect}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lockNote && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{lockNote}</span>
        </div>
      )}
    </div>
  );
};

export default ConfirmSummary;
