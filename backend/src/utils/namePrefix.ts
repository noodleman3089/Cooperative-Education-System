/**
 * คำนำหน้าชื่อนักศึกษา (`students.name_prefix`) — ชุดค่าที่ยอมรับอยู่ที่นี่ที่เดียว
 *
 * พิมพ์ลงหนังสือขอความอนุเคราะห์ที่คณบดีลงนาม จึงรับเฉพาะคำที่ใช้ในหนังสือราชการ ไม่รับข้อความอิสระ
 * ⚠️ มีคู่แฝดที่ `frontend/src/utils/namePrefix.ts` (ตัวเลือกใน dropdown) — แก้ที่นี่ต้องแก้อีกที่ด้วย
 */
export const NAME_PREFIXES = ['นาย', 'นาง', 'นางสาว'] as const;

export const isNamePrefix = (value: unknown): value is (typeof NAME_PREFIXES)[number] =>
  typeof value === 'string' && (NAME_PREFIXES as readonly string[]).includes(value);

/** ไม่ส่งมา/ว่าง = "ไม่แตะ" (คงค่าเดิม) · ส่งมาแต่ไม่อยู่ในชุด = ผิด */
export function readNamePrefix(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  return isNamePrefix(raw) ? { ok: true, value: raw } : { ok: false };
}

export const NAME_PREFIX_ERROR = `คำนำหน้าชื่อต้องเป็น ${NAME_PREFIXES.join(' · ')}`;
