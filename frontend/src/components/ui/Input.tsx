import React from 'react';

/**
 * ช่องกรอกข้อมูลของทั้งระบบ — `Input` · `Select` · `Textarea`
 *
 * ก่อนหน้านี้มีช่องกรอก 175 จุดที่เขียนคลาสเองทุกจุด รวมได้ **80 รูปแบบ** ทั้งที่
 * ส่วนใหญ่ต่างกันแค่ padding กับขนาดตัวอักษร ผลคือหน้าจอที่ควรเหมือนกันกลับไม่
 * เท่ากัน และการแก้เรื่องเดียว (เช่น contrast ของเส้นขอบในโหมดมืด) ต้องไล่แก้
 * ทีละจุดโดยไม่มีทางรู้ว่าครบหรือยัง — แบบเดียวกับที่ `ui/Button` เคยแก้ไป
 *
 * ตอนนี้แก้ที่นี่ที่เดียวมีผลทั้งระบบ
 *
 * ขนาด: `md` (ค่าเริ่มต้น) สำหรับฟอร์มปกติ · `sm` สำหรับช่องในตารางและตัวกรอง
 * `error` ทำให้เส้นขอบเป็นสีแดง สำหรับช่องที่ตรวจแล้วไม่ผ่าน
 *
 * ยัง `className` ต่อท้ายได้ตามปกติ — จุดที่ต้องการความกว้างหรือระยะห่างเฉพาะตัว
 * จึงไม่ต้องเลี่ยงไปเขียนช่องกรอกเองใหม่
 */

export type FieldSize = 'sm' | 'md';

/**
 * `rounded-xl` ให้เข้าชุดกับ `ui/Button` (xl) และการ์ด (`rounded-2xl`) — โปรเจคมี
 * ทั้ง lg และ xl ปนกันมาแต่ต้น (126 ต่อ 133 จุด) การยุบจึงต้องเลือกข้างหนึ่ง
 * และข้างที่ปุ่มใช้อยู่คือข้างที่ถูก เพราะช่องกรอกกับปุ่มยืนติดกันในฟอร์มเสมอ
 */
const BASE =
  'w-full rounded-xl border bg-white text-gray-900 transition-colors ' +
  'focus:outline-none dark:bg-gray-800 dark:text-white ' +
  'placeholder:text-gray-500 dark:placeholder:text-gray-400 ' +
  'disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900';

const SIZES: Record<FieldSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

/** เส้นขอบปกติกับตอน error — สีเดียวกันทั้งสามชนิดช่องกรอก */
const TONE = {
  normal:
    'border-gray-200 focus:border-brand-blue dark:border-gray-700 dark:focus:border-blue-400',
  error: 'border-red-400 focus:border-red-500 dark:border-red-500/70',
};

const fieldClass = (size: FieldSize, error: boolean, extra?: string) =>
  [BASE, SIZES[size], error ? TONE.error : TONE.normal, extra].filter(Boolean).join(' ');

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: FieldSize;
  error?: boolean;
};

export const Input: React.FC<InputProps> = ({ size = 'md', error = false, className, ...rest }) => (
  <input className={fieldClass(size, error, className)} {...rest} />
);

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: FieldSize;
  error?: boolean;
};

export const Select: React.FC<SelectProps> = ({
  size = 'md',
  error = false,
  className,
  children,
  ...rest
}) => (
  <select className={fieldClass(size, error, className)} {...rest}>
    {children}
  </select>
);

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  size?: FieldSize;
  error?: boolean;
};

export const Textarea: React.FC<TextareaProps> = ({
  size = 'md',
  error = false,
  className,
  ...rest
}) => <textarea className={fieldClass(size, error, className)} {...rest} />;

export default Input;
