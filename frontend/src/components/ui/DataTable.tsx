import React from 'react';

/**
 * นิยามคอลัมน์หนึ่งช่อง
 *
 * `cell` รับทั้งแถวไม่ใช่แค่ค่าในช่อง เพราะตารางในระบบนี้แทบทุกช่องอ่านจากหลายฟิลด์
 * (ชื่อไทยกับชื่ออังกฤษในช่องเดียว · อำเภอกับจังหวัดในช่องเดียว) การบังคับให้เป็น
 * `keyof T` จะทำให้ครึ่งหนึ่งของตารางที่มีอยู่ย้ายมาใช้ไม่ได้
 */
export interface Column<T> {
  /** ใช้เป็น React key ของช่อง — ไม่ต้องตรงกับชื่อฟิลด์ */
  key: string;
  header: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  cell: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => React.Key;
  /**
   * ความกว้างขั้นต่ำเป็น px ก่อนจะปล่อยให้เลื่อนแนวนอน
   *
   * ⛔ ส่งเป็นตัวเลขแล้วให้ที่นี่แปลงเป็น inline style — **ห้ามประกอบเป็น
   * `min-w-[${n}px]`** เพราะ Tailwind v4 อ่านคลาสจากซอร์สตอน build
   * คลาสที่ประกอบขึ้นตอนรันจะไม่มี CSS อยู่จริง
   */
  minWidth?: number;
  /** สิ่งที่แสดงเมื่อ `rows` ว่าง — ใช้ `EmptyState` และต้องบอกเหตุผลว่าทำไมถึงว่าง */
  empty: React.ReactNode;
  /** แถบบางๆ ด้านบนตอนกำลังโหลดซ้ำเบื้องหลัง — ข้อมูลเดิมยังอยู่บนจอ */
  refreshing?: boolean;
  /** ลง `data-testid` ที่ตัว `<table>` เพื่อให้ E2E จับได้ */
  testId?: string;
  /** คลาสเพิ่มเติมของแถว เช่นเน้นแถวที่ต้องรีบจัดการ */
  rowClassName?: (row: T) => string;
  /** ฟังก์ชันคืน data-testid สำหรับแต่ละแถว <tr> */
  rowTestId?: (row: T) => string;
}

const ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * ตารางกลางของระบบ
 *
 * ก่อนมีไฟล์นี้ แอปมี `<table>` เขียนมือ 17 ก้อนใน 9 ไฟล์ ซึ่งคัดลอกกันมาแล้วเพี้ยน
 * ทีละนิด — ระยะขอบ ขนาดตัวอักษร สีหัวตาราง และ **คู่ `dark:`** ไม่ตรงกัน
 * ที่อันตรายจริงคือข้อสุดท้าย เพราะสีพื้นที่ลืมคู่มืดเคยให้ contrast 1.21:1
 * คือมองไม่เห็นเลยในโหมดมืด (กฎในโซน frontend เตือนเรื่องนี้ไว้)
 *
 * ตัวนี้จึงเก็บเฉพาะ *เปลือก* ของตาราง — โครง เส้น สี ระยะ และการเลื่อนแนวนอน
 * ส่วนเนื้อในแต่ละช่องยังเป็นของหน้าจอนั้นเต็มที่ผ่าน `cell`
 * ย้ายตารางเดิมมาใช้จึงเป็นการจัดระเบียบ ไม่ใช่การออกแบบใหม่
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  minWidth = 900,
  empty,
  refreshing = false,
  testId,
  rowClassName,
  rowTestId,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <div className="relative">
      {/* แถบบางๆ บอกว่ากำลังดึงข้อมูลใหม่ โดยไม่ยึดพื้นที่และไม่ทำให้อะไรขยับ
          ใช้ `shimmer-placeholder` ตัวเดียวกับ Skeleton — มันมีทั้งไล่สีที่วิ่งจริง
          และคู่โหมดมืดอยู่แล้วใน index.css จึงไม่ต้องนิยามสีใหม่ให้หลุดจากธีม */}
      {refreshing && (
        <div
          className="shimmer-placeholder absolute inset-x-0 top-0 h-0.5 rounded-full"
          role="status"
          aria-label="กำลังปรับข้อมูลให้เป็นปัจจุบัน"
        />
      )}

      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-left text-xs"
          style={{ minWidth: `${minWidth}px` }}
          data-testid={testId}
        >
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              {columns.map(col => (
                <th key={col.key} className={`p-4 font-bold ${ALIGN[col.align ?? 'left']}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.map(row => (
              <tr
                key={rowKey(row)}
                data-testid={rowTestId?.(row)}
                className={`align-top hover:bg-gray-50/40 dark:hover:bg-gray-800/20 ${
                  rowClassName?.(row) ?? ''
                }`.trim()}
              >
                {columns.map(col => (
                  <td key={col.key} className={`p-4 ${ALIGN[col.align ?? 'left']}`}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
