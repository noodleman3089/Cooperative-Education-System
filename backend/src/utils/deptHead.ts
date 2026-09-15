import type { Request } from 'express';
import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { AuditAction, writeAudit } from './audit';

/**
 * หัวหน้าสาขาวิชามีคนเดียวต่อสาขา (SB-G2 · เจ้าของตัดสิน 2026-09-15)
 *
 * บังคับที่ระดับฐานข้อมูลไม่ได้ เพราะ role อยู่ที่ `user_roles` แต่สาขาอยู่ที่ `personnel`
 * จึงบังคับทุกทางที่ "จับคู่ role `dept_head` กับสาขา" แทน แบ่งเป็นสองแบบ:
 *
 * - **เจ้าหน้าที่เป็นคนตั้ง** (`PUT /users/:id` · นำเข้าผู้ใช้ · claim จากรายชื่อที่เจ้าหน้าที่เตรียม)
 *   → `replaceDeptHeadInMajor` ถอด role ของคนเก่าอัตโนมัติ · บัญชีและหน้าที่อาจารย์ของคนเก่ายังอยู่
 * - **ผู้ใช้ทำเอง** (ตั้งค่า/แก้โปรไฟล์บุคลากรแล้วเลือกสาขา) → `findOtherDeptHead` แล้วปฏิเสธ
 *   ⛔ ห้ามถอดอัตโนมัติในทางนี้ — ไม่งั้นหัวหน้าสาขาเปลี่ยนสาขาในโปรไฟล์ตัวเองแล้วปลดคนอื่นได้
 */

type Db = Pick<PoolClient, 'query'>;

export interface DeptHeadRef {
  user_id: number;
  full_name: string;
}

const NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), u.email)`;

/** หัวหน้าสาขาคนอื่นในสาขานี้ (ไม่นับตัวเอง) — ไม่มีคืน null */
export async function findOtherDeptHead(userId: number, majorId: number): Promise<DeptHeadRef | null> {
  const res = await query(
    `SELECT u.user_id, ${NAME} AS full_name
       FROM user_roles r
       JOIN personnel p ON p.personnel_id = r.user_id
       JOIN users u ON u.user_id = r.user_id
      WHERE r.role_name = 'dept_head' AND p.major_id = $1 AND r.user_id <> $2
      ORDER BY u.user_id LIMIT 1`,
    [majorId, userId]
  );
  return res.rows[0] ?? null;
}

/**
 * ถ้า `userId` ถือ `dept_head` และมีสาขาแล้ว ถอด `dept_head` ของคนอื่นในสาขาเดียวกันทิ้ง
 * คืนรายชื่อคนที่ถูกถอด (ปกติ 0 หรือ 1 คน — ฐานเก่าที่ซ้อนอยู่ก่อนอาจมากกว่า)
 *
 * ส่ง `client` มาเมื่อเรียกอยู่ในทรานแซกชันของผู้เรียก · ไม่ส่ง = เปิดทรานแซกชันของตัวเอง
 */
export async function replaceDeptHeadInMajor(userId: number, req: Request, client?: Db): Promise<DeptHeadRef[]> {
  if (client) return replaceWith(client, userId, req);

  const own = await pool.connect();
  try {
    await own.query('BEGIN');
    const replaced = await replaceWith(own, userId, req);
    await own.query('COMMIT');
    return replaced;
  } catch (err) {
    await own.query('ROLLBACK');
    throw err;
  } finally {
    own.release();
  }
}

async function replaceWith(db: Db, userId: number, req: Request): Promise<DeptHeadRef[]> {
  const me = await db.query(
    `SELECT p.major_id FROM personnel p
       JOIN user_roles r ON r.user_id = p.personnel_id AND r.role_name = 'dept_head'
      WHERE p.personnel_id = $1`,
    [userId]
  );
  const majorId: number | null = me.rows[0]?.major_id ?? null;
  if (majorId === null) return [];

  // ล็อกแถวบุคลากรทั้งสาขา — การตั้งหัวหน้าสาขาสองคนพร้อมกันจะเรียงคิวกัน คนหลังชนะ เหลือคนเดียว
  await db.query('SELECT personnel_id FROM personnel WHERE major_id = $1 FOR UPDATE', [majorId]);

  const others = await db.query(
    `SELECT u.user_id, ${NAME} AS full_name
       FROM user_roles r
       JOIN personnel p ON p.personnel_id = r.user_id
       JOIN users u ON u.user_id = r.user_id
      WHERE r.role_name = 'dept_head' AND p.major_id = $1 AND r.user_id <> $2`,
    [majorId, userId]
  );
  const replaced: DeptHeadRef[] = others.rows;
  if (replaced.length === 0) return [];

  await db.query(`DELETE FROM user_roles WHERE role_name = 'dept_head' AND user_id = ANY($1::int[])`, [
    replaced.map((r) => r.user_id),
  ]);

  for (const old of replaced) {
    await writeAudit(
      {
        action: AuditAction.USER_DEPT_HEAD_REPLACED,
        entityType: 'user',
        entityId: old.user_id,
        subjectId: old.user_id,
        detail: { major_id: majorId, replaced_user_id: old.user_id, new_dept_head_user_id: userId },
      },
      req,
      db
    );
  }
  return replaced;
}
