import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { withDb, dbRow, dbValue } from '../helpers/db';
import { runAutoDeactivation } from '../../backend/src/utils/deactivationScheduler';

/**
 * SEC-12 — ลบข้อมูลอ่อนไหว (เลขบัตรประชาชน · เชื้อชาติ · ศาสนา) อัตโนมัติ ๙๐ วัน
 * หลังพี่เลี้ยงส่งประเมินครบทั้งสหกิจ 15 และ 16
 *
 * ⛔ **ไม่มีปุ่มให้ใครกด** — เจ้าของเคาะ 2026-09-03 ว่าพึ่งคนกดเป็นจุดอ่อนของนโยบาย
 * ลบข้อมูล (ไม่มีใครกด = ข้อมูลค้างตลอดไป) จึงผูกเข้ากับ `DeactivationScheduler`
 * ที่มีอยู่แล้วแทน ดู `.system_memory/design_stage3_forms.md` ❓ ข้อ 2
 *
 * เรียก `runAutoDeactivation()` ตรงๆ (แบบเดียวกับที่ `env-guard.spec.ts` เรียก
 * `checkEnvironment` ตรงๆ) เพราะยังไม่มี endpoint ให้ยิงผ่าน HTTP — งานนี้เป็นงาน
 * เบื้องหลังล้วน ไม่ใช่ผู้ใช้กด
 */

// ⚠️ ห้าม hardcode id ตัวเลข — SERIAL เดินไปเรื่อยๆ ข้ามรอบ db:setup แม้จะเสถียร
// สำหรับ session เดียวก็ตาม (เหตุผลเดียวกับที่ late-submission.spec.ts เตือนเรื่อง company_id)
let STUDENT_ID: number;

/** ปั๊มคะแนนประเมินตัวอย่าง ให้ครบหรือไม่ครบตามที่เทสต์ต้องการ */
async function seedEvaluations(
  forms: { form_code: 'sahatkit_15' | 'sahatkit_16'; daysAgo: number }[]
): Promise<void> {
  await withDb(async (db) => {
    await db.query('DELETE FROM final_evaluations WHERE student_id = $1', [STUDENT_ID]);
    for (const f of forms) {
      await db.query(
        `INSERT INTO final_evaluations
           (student_id, evaluator_role, form_code, scores_detail, total_score, submitted_at)
         VALUES ($1, 'mentor', $2, '{}'::jsonb, 80, NOW() - ($3 || ' days')::interval)`,
        [STUDENT_ID, f.form_code, f.daysAgo]
      );
    }
  });
}

/** ยัดข้อมูลอ่อนไหวจำลองลงแถวนักศึกษา — เนื้อหาเป็นอะไรก็ได้ การลบไม่สนใจว่าถอดรหัสได้ไหม */
async function seedSensitiveData(): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `UPDATE students
          SET national_id_ciphertext = 'x', national_id_iv = 'x', national_id_tag = 'x',
              national_id_issued_district = 'เขตดุสิต', national_id_expiry_date = '2030-01-01',
              ethnicity_ciphertext = 'x', ethnicity_iv = 'x', ethnicity_tag = 'x',
              religion_ciphertext = 'x', religion_iv = 'x', religion_tag = 'x',
              sensitive_data_consented_at = NOW()
        WHERE student_id = $1`,
      [STUDENT_ID]
    );
  });
}

interface SensitiveRow {
  national_id_ciphertext: string | null;
  ethnicity_ciphertext: string | null;
  religion_ciphertext: string | null;
  sensitive_data_consented_at: string | null;
}

const readSensitiveRow = () =>
  dbRow<SensitiveRow>(
    `SELECT national_id_ciphertext, ethnicity_ciphertext, religion_ciphertext,
            sensitive_data_consented_at
       FROM students WHERE student_id = $1`,
    [STUDENT_ID]
  );

test.describe('SEC-12: ลบข้อมูลอ่อนไหวอัตโนมัติหลังประเมินครบ + 90 วัน', () => {
  test.beforeEach(async () => {
    await seedTestData();
    STUDENT_ID = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student2@test.com'"
    ))!;
    await seedSensitiveData();
  });

  test('R1: ประเมินครบทั้งสองใบมาแล้ว 91 วัน → ลบทุกคอลัมน์ และลง audit_log', async () => {
    await seedEvaluations([
      { form_code: 'sahatkit_15', daysAgo: 100 },
      { form_code: 'sahatkit_16', daysAgo: 91 }, // ตัวหลังสุดคือตัวที่นับ — ยังพ้น 90 วัน
    ]);

    await runAutoDeactivation();

    const row = await readSensitiveRow();
    expect(row?.national_id_ciphertext).toBeNull();
    expect(row?.ethnicity_ciphertext).toBeNull();
    expect(row?.religion_ciphertext).toBeNull();
    expect(row?.sensitive_data_consented_at).toBeNull();

    const auditEmail = await dbValue<string>(
      `SELECT actor_email FROM audit_log
        WHERE action = 'student.sensitive_data_purged' AND entity_id = $1
        ORDER BY audit_id DESC LIMIT 1`,
      [String(STUDENT_ID)]
    );
    // ไม่มี HTTP request context — ถูกระบุว่าเป็น 'system' ไม่ใช่ผู้ใช้คนไหน
    expect(auditEmail).toBe('system');
  });

  test('R2: ประเมินครบแล้ว แต่ยังไม่ถึง 90 วัน → ยังไม่ลบ', async () => {
    await seedEvaluations([
      { form_code: 'sahatkit_15', daysAgo: 100 },
      { form_code: 'sahatkit_16', daysAgo: 10 }, // ตัวหลังสุด — ยังไม่พ้น 90 วัน
    ]);

    await runAutoDeactivation();

    const row = await readSensitiveRow();
    expect(row?.national_id_ciphertext).not.toBeNull();
    expect(row?.ethnicity_ciphertext).not.toBeNull();
    expect(row?.religion_ciphertext).not.toBeNull();
  });

  test('R3: ส่งมาแค่ใบเดียว (สหกิจ 15 อย่างเดียว) ต่อให้เก่าแค่ไหนก็ไม่ลบ', async () => {
    await seedEvaluations([{ form_code: 'sahatkit_15', daysAgo: 365 }]);

    await runAutoDeactivation();

    const row = await readSensitiveRow();
    expect(row?.national_id_ciphertext).not.toBeNull();
  });

  test('R4: ยังไม่มีการประเมินเลย → ไม่มีอะไรให้ลบ ไม่ error', async () => {
    await withDb(async (db) => {
      await db.query('DELETE FROM final_evaluations WHERE student_id = $1', [STUDENT_ID]);
    });

    await expect(runAutoDeactivation()).resolves.not.toThrow();

    const row = await readSensitiveRow();
    expect(row?.national_id_ciphertext).not.toBeNull();
  });

  test('R5: ไม่มีข้อมูลอ่อนไหวอยู่แล้ว (คอลัมน์เป็น NULL อยู่ก่อน) → ไม่ลง audit_log ซ้ำ', async () => {
    await withDb(async (db) => {
      await db.query(
        `UPDATE students SET national_id_ciphertext = NULL, ethnicity_ciphertext = NULL,
                              religion_ciphertext = NULL WHERE student_id = $1`,
        [STUDENT_ID]
      );
    });
    await seedEvaluations([
      { form_code: 'sahatkit_15', daysAgo: 200 },
      { form_code: 'sahatkit_16', daysAgo: 200 },
    ]);

    const before = await dbValue<string>(
      `SELECT COUNT(*) FROM audit_log WHERE action = 'student.sensitive_data_purged' AND entity_id = $1`,
      [String(STUDENT_ID)]
    );

    await runAutoDeactivation();

    const after = await dbValue<string>(
      `SELECT COUNT(*) FROM audit_log WHERE action = 'student.sensitive_data_purged' AND entity_id = $1`,
      [String(STUDENT_ID)]
    );
    expect(after).toBe(before);
  });

  test('R6: รันซ้ำสองครั้งติดกัน → ไม่ล้ม และไม่ลง audit_log ซ้ำสำหรับแถวที่ลบไปแล้ว', async () => {
    await seedEvaluations([
      { form_code: 'sahatkit_15', daysAgo: 200 },
      { form_code: 'sahatkit_16', daysAgo: 200 },
    ]);

    await runAutoDeactivation();
    await runAutoDeactivation(); // ครั้งที่สองไม่ควรเจออะไรให้ลบอีก (คอลัมน์เป็น NULL แล้ว)

    const count = await dbValue<string>(
      `SELECT COUNT(*) FROM audit_log WHERE action = 'student.sensitive_data_purged' AND entity_id = $1`,
      [String(STUDENT_ID)]
    );
    expect(count).toBe('1');
  });
});
