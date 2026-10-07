import { query } from '../config/database';
import { sendDeanSignQueueEmail } from './email';

/** คณบดีไม่ได้เปิดคิวลงนามเกินกี่นาทีถึงนับว่า "ไม่อยู่" (เจ้าของเคาะ: 15 นาที — ยังรอยืนยัน) */
export const SIGN_QUEUE_AWAY_MINUTES = 15;

/**
 * แจ้งคณบดีทางอีเมลว่ามีหนังสือเข้าคิวลงนาม — เรียกหลัง COMMIT ที่สร้างแถวหนังสือใหม่ (ไม่รอ)
 *
 * เป้าหมายของเจ้าของ: คณบดีเปิดคิวอยู่ไม่ต้องรบกวน · ไม่อยู่ให้ส่งอีเมล · รับคำร้อง 30 ใบรวดต้องได้ฉบับเดียว
 * สำหรับบัญชี role dean แต่ละใบ **จองสิทธิ์ส่งด้วย UPDATE คำสั่งเดียว** (ซ้อนกันก็ไม่ส่งซ้ำ) ส่งเมื่อครบสองข้อ:
 *   1. ไม่ได้เปิดคิวภายใน `SIGN_QUEUE_AWAY_MINUTES` นาที (`sign_queue_seen_at` ว่างหรือเก่ากว่านั้น)
 *   2. ยังไม่เคยเตือน หรือเตือนครั้งล่าสุดเกิด **ก่อน** ที่คณบดีเปิดคิวครั้งล่าสุด (เตือนไปแล้วและยังไม่กลับมา = ไม่ส่งซ้ำ)
 * ⛔ ไม่มี cooldown เป็นชั่วโมง ไม่มีตารางจดการเตือน ไม่มีตัวตั้งเวลา — สองคอลัมน์บน `personnel` (migration 053) พอ
 * ส่งไม่สำเร็จ = ล้าง `sign_queue_notified_at` กลับเป็น NULL รอบถัดไปลองใหม่ได้
 */
export async function notifyDeansOfPendingLetter(): Promise<void> {
  const pending = await query(`SELECT COUNT(*)::int AS n FROM official_documents WHERE status = 'pending_sign'`);
  const pendingCount = (pending.rows[0]?.n as number | undefined) ?? 0;
  if (pendingCount === 0) return;

  const deans = await query(
    `SELECT DISTINCT p.personnel_id
       FROM personnel p
       JOIN user_roles ur ON ur.user_id = p.personnel_id AND ur.role_name = 'dean'
       JOIN users u ON u.user_id = p.personnel_id AND u.is_active = TRUE AND u.email IS NOT NULL
      ORDER BY p.personnel_id`
  );

  const queueUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`;
  for (const { personnel_id } of deans.rows as { personnel_id: number }[]) {
    const claim = await query(
      `UPDATE personnel p SET sign_queue_notified_at = NOW()
         FROM users u
        WHERE u.user_id = p.personnel_id AND p.personnel_id = $1
          AND (p.sign_queue_seen_at IS NULL OR p.sign_queue_seen_at < NOW() - make_interval(mins => $2))
          AND (p.sign_queue_notified_at IS NULL
               OR (p.sign_queue_seen_at IS NOT NULL AND p.sign_queue_notified_at < p.sign_queue_seen_at))
       RETURNING u.email`,
      [personnel_id, SIGN_QUEUE_AWAY_MINUTES]
    );
    if ((claim.rowCount ?? 0) === 0) continue;

    const sent = await sendDeanSignQueueEmail((claim.rows[0].email as string).trim(), pendingCount, queueUrl);
    // ส่งไม่ออก = ปล่อยสิทธิ์คืน (NULL = ยังไม่เคยเตือน) ครั้งหน้าลองใหม่ได้
    if (!sent) await query('UPDATE personnel SET sign_queue_notified_at = NULL WHERE personnel_id = $1', [personnel_id]);
  }
}
