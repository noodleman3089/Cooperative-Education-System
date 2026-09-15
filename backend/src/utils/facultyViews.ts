import { query } from '../config/database';

/**
 * ฝ่ายที่ตัวสลับบนหน้าจอแสดงให้ผู้ใช้คนนี้ (SB-F8)
 *
 * ขอบเขตแยก "อาจารย์ที่ปรึกษา" กับ "อาจารย์นิเทศ" เป็นผู้ใช้คนละกลุ่ม แต่ทั้งสองคือ role `advisor`
 * ตัวเดียวกันใน `user_roles` — หน้าที่ผูกอยู่ที่นักศึกษาแต่ละคน (`students.advisor_id` / `supervisor_id`)
 * ซึ่งหัวหน้าสาขาเป็นคนจัดสรร อาจารย์คนเดียวจึงเป็นที่ปรึกษาของ A และนิเทศของ B พร้อมกันได้
 * ฝ่าย `supervisor` เลยคำนวณจากการจัดสรร ไม่ได้เก็บเป็น role
 *
 * ⛔ ค่านี้ใช้เลือกหน้าจอเท่านั้น — ห้ามเอาไปใส่ JWT หรือใช้ใน `authorizeRoles`
 *    สิทธิ์จริงคือการตรวจต่อหัวนักศึกษาใน `utils/access.ts`
 */
export async function resolveViews(userId: number, roles: string[]): Promise<string[]> {
  if (!roles.includes('advisor')) return [...roles];

  const res = await query(
    `SELECT EXISTS (SELECT 1 FROM students WHERE advisor_id = $1)    AS is_advisor,
            EXISTS (SELECT 1 FROM students WHERE supervisor_id = $1) AS is_supervisor`,
    [userId]
  );
  const { is_advisor, is_supervisor } = res.rows[0];

  const views: string[] = [];
  for (const role of roles) {
    if (role !== 'advisor') {
      views.push(role);
      continue;
    }
    // อาจารย์ที่ยังไม่ได้รับการจัดสรรเลยต้องมีฝ่ายให้ลง — ไม่งั้นเข้าระบบมาแล้วไม่มีหน้าจอ
    if (is_advisor || !is_supervisor) views.push('advisor');
    if (is_supervisor) views.push('supervisor');
  }
  return views;
}
