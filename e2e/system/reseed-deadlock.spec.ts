import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { dbValue, withDb } from '../helpers/db';
import { reseedDatabase } from '../../backend/src/db/setup';

/**
 * การล้างฐานก่อนทุกเคส (`reseedDatabase` → TRUNCATE ทุกตารางในคำสั่งเดียว) ต้องทนต่อคำสั่งของเคสก่อนหน้า
 * ที่ยังวิ่งอยู่ใน backend — งานที่ทำหลังตอบ response ไปแล้ว เช่น `writeAudit` และคิวรีของอีเมลแจ้งเตือน
 *
 * พบ 2026-10-13 จาก log ของ Postgres สองครั้งในสี่รอบเต็ม: คำสั่งนั้นถือล็อกตารางหนึ่งแล้วรออีกตาราง
 * ขณะที่ TRUNCATE ถือกลับด้าน → `deadlock detected` (40P01) → TRUNCATE ถูกยกเลิก → เคสถัดไปแดงทั้งที่ไม่เกี่ยว
 * (`INSERT INTO audit_log` ชนที่ `faculty-supervision-appointments` A4 · `SELECT … FROM intent_forms` ชนที่ `officer-review` R6)
 */
test.describe('ล้างฐานก่อนเทสต์ — ทนต่อคำสั่งที่ยังค้างของเคสก่อนหน้า', () => {
  test('D1: คำสั่งอื่นถือล็อกสวนทางกับ TRUNCATE จนเกิด deadlock — การล้างฐานต้องลองใหม่จนผ่าน ไม่โยน error ใส่เคสถัดไป', async () => {
    await seedTestData();

    // ลำดับตารางชุดเดียวกับที่ `reseedDatabase` ส่งให้ TRUNCATE (Postgres ล็อกตามลำดับในคำสั่ง)
    const tables = await withDb((db) =>
      db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`
      )
    );
    const first = tables.rows[0].tablename;
    const last = tables.rows[tables.rows.length - 1].tablename;

    await withDb(async (other) => {
      await other.query('BEGIN');
      try {
        // "คำสั่งที่ยังค้าง" ถือตารางสุดท้ายไว้ก่อน
        await other.query(`LOCK TABLE "${last}" IN ACCESS SHARE MODE`);

        // TRUNCATE ล็อกตารางต้น ๆ ได้ แล้วไปติดรอที่ตารางสุดท้าย
        const reseed = reseedDatabase();
        reseed.catch(() => undefined); // ผลจริงถูก await ข้างล่าง — กัน unhandled rejection ระหว่างรอ

        // รอจน TRUNCATE ติดรอล็อกจริง (ต้องเร็วกว่า deadlock_timeout 1 วินาทีของ Postgres)
        let waiting = 0;
        for (let i = 0; i < 40 && waiting === 0; i++) {
          waiting =
            (await dbValue<number>(
              `SELECT count(*)::int FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'TRUNCATE%'`
            )) ?? 0;
          if (waiting === 0) await new Promise((r) => setTimeout(r, 20));
        }
        expect(waiting, 'TRUNCATE ต้องกำลังรอล็อกก่อนจะสร้างวงล็อก').toBe(1);

        // แล้วขอตารางแรกที่ TRUNCATE ถืออยู่ = วงล็อกครบ Postgres ต้องยกเลิกฝั่งใดฝั่งหนึ่งด้วย 40P01
        // · ส่วนใหญ่ TRUNCATE ถูกยกเลิก (รอมาก่อน ตัวจับเวลาครบก่อน) = ทางที่เทสต์นี้ต้องการพิสูจน์
        // · บางครั้งฝั่งนี้ถูกยกเลิกแทน (เช่น TRUNCATE ติดรอ autovacuum อยู่ก่อนแล้วเพิ่งเริ่มรอใหม่)
        //   ซึ่งของจริงก็เกิดได้เหมือนกัน — ทั้งสองทาง การล้างฐานต้องจบโดยไม่โยน error
        try {
          await other.query(`SELECT 1 FROM "${first}" LIMIT 0`);
          await other.query('COMMIT');
        } catch (err) {
          if ((err as { code?: string }).code !== '40P01') throw err;
          await other.query('ROLLBACK');
        }

        // ⛔ ต้องไม่โยน `deadlock detected` — ลองใหม่แล้วผ่านเมื่ออีกฝั่งจบ
        await reseed;
      } catch (err) {
        await other.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    });

    // ฐานต้องกลับมาอยู่ในสภาพ seed ปกติ ไม่ใช่ถูกล้างค้างไว้ครึ่งทาง
    expect(await dbValue<number>('SELECT count(*)::int FROM users')).toBeGreaterThan(0);
    expect(await dbValue<number>('SELECT count(*)::int FROM intent_forms')).toBe(0);
  });
});
