import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** บอกว่า "ไม่มีอะไรที่นี่" ในภาษาที่ตรงกับสิ่งที่ผู้ใช้กำลังหา */
  title: string;
  /**
   * บอกว่าทำไมถึงว่าง และต้องทำอะไรต่อ
   *
   * ⛔ "ไม่พบข้อมูล" เฉยๆ ไม่พอ — จอว่างเพราะ *ยังไม่มีใครสร้าง* กับว่างเพราะ
   * *ตัวกรองซ่อนไว้หมด* คือคนละเรื่องกันสำหรับผู้ใช้ แต่หน้าตาเหมือนกันเป๊ะ
   * ผู้เรียกต้องแยกสองกรณีนี้ให้ผู้ใช้เสมอ
   */
  description?: string;
  /** ปุ่มทางออก เช่น "ล้างตัวกรอง" หรือ "เพิ่มรายการแรก" */
  action?: React.ReactNode;
}

/**
 * จอว่างที่บอกเหตุผล
 *
 * เขียนแยกออกมาเพราะ 17 ตารางในแอปนี้จัดการกรณี "ไม่มีแถว" กันเองคนละแบบ
 * บางที่เป็นข้อความเทาบรรทัดเดียว บางที่ไม่มีอะไรเลย — ตารางที่หายไปทั้งอันโดยไม่มี
 * คำอธิบายคือหน้าเสียในสายตาผู้ใช้ ไม่ใช่ "ไม่มีข้อมูล"
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
    {Icon && (
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
    )}
    <p className="text-sm font-bold text-gray-900 dark:text-white">{title}</p>
    {description && (
      <p className="mt-1.5 max-w-md text-xs text-gray-600 dark:text-gray-400">{description}</p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export default EmptyState;
