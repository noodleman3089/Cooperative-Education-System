import { query } from '../config/database';
import { AuditAction, writeAudit } from './audit';
import { runAcceptanceAutoClose } from './acceptanceAutoClose';

export async function runAutoDeactivation(): Promise<void> {
  console.log('[DeactivationScheduler] Running automatic deactivation check...');
  try {
    // 1. Deactivate students who graduated: enrollment_year + 4 <= current_academic_year
    const activeSemesterRes = await query(
      'SELECT academic_year FROM coop_semesters WHERE is_active = true LIMIT 1'
    );
    
    if ((activeSemesterRes.rowCount ?? 0) > 0) {
      // `academic_year` เป็น พ.ศ. เสมอ (CHECK ที่ฐาน · migration 047 · BUG-01) — ปี `enrollment_year`
      // ของนักศึกษายังแปลงในคำสั่งข้างล่างเพราะเป็นคนละคอลัมน์ที่ไม่มี CHECK
      const academicYearBE = activeSemesterRes.rows[0].academic_year;

      const deactivatedStudents = await query(
        `UPDATE users
         SET is_active = false
         WHERE user_id IN (
           SELECT student_id
           FROM students
           WHERE enrollment_year IS NOT NULL
             AND (CASE WHEN enrollment_year < 2400 THEN enrollment_year + 543 ELSE enrollment_year END) + 4 <= $1
         )
         AND is_active = true
         RETURNING user_id, email`,
        [academicYearBE]
      );
      
      if ((deactivatedStudents.rowCount ?? 0) > 0) {
        console.log(`[DeactivationScheduler] Deactivated ${deactivatedStudents.rowCount} graduated student accounts:`);
        for (const u of deactivatedStudents.rows) {
          console.log(` - Student: ${u.email} (ID: ${u.user_id})`);
          await writeAudit({
            action: AuditAction.USER_AUTO_DEACTIVATED,
            entityType: 'user',
            entityId: u.user_id,
            subjectId: u.user_id,
            detail: { reason: 'graduated', academic_year_be: academicYearBE },
          });
        }
      } else {
        console.log('[DeactivationScheduler] No graduated student accounts to deactivate.');
      }
    } else {
      console.log('[DeactivationScheduler] No active coop semester found, skipping student deactivation.');
    }

    // 2. Deactivate personnel/teachers who retired: age >= 60 on October 1st of the fiscal year
    const deactivatedPersonnel = await query(
      `WITH date_ref AS (
         SELECT 
           CASE 
             WHEN CURRENT_DATE >= MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::int, 10, 1) 
             THEN MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::int, 10, 1)
             ELSE MAKE_DATE((EXTRACT(YEAR FROM CURRENT_DATE) - 1)::int, 10, 1)
           END AS last_oct_1st
       )
       UPDATE users
       SET is_active = false
       WHERE user_id IN (
         SELECT p.personnel_id
         FROM personnel p, date_ref
         WHERE p.birth_date IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(date_ref.last_oct_1st, p.birth_date)) >= 60
       )
       AND is_active = true
       RETURNING user_id, email`,
      []
    );

    if ((deactivatedPersonnel.rowCount ?? 0) > 0) {
      console.log(`[DeactivationScheduler] Deactivated ${deactivatedPersonnel.rowCount} retired teacher accounts:`);
      for (const u of deactivatedPersonnel.rows) {
        console.log(` - Personnel: ${u.email} (ID: ${u.user_id})`);
        await writeAudit({
          action: AuditAction.USER_AUTO_DEACTIVATED,
          entityType: 'user',
          entityId: u.user_id,
          subjectId: u.user_id,
          detail: { reason: 'retirement_age' },
        });
      }
    } else {
      console.log('[DeactivationScheduler] No retired teacher accounts to deactivate.');
    }

    // 3. SEC-12: purge sensitive PDPA data (national ID, ethnicity, religion) once
    //    the coop cycle is genuinely done being used — both mentor evaluations
    //    (สหกิจ 15 + 16) submitted, plus a grace period so a grade dispute or a
    //    reprinted document still has something to work from.
    //
    // ⛔ Automatic, not a button anyone clicks — the owner tried "wait for the
    //    advisor or supervisor to close it" first, then reconsidered on their own:
    //    a retention promise that depends on someone remembering to press a
    //    button is not a retention promise. This mirrors sections 1-2 above,
    //    which already deactivate accounts by date without a click.
    //    See `.system_memory/design_stage3_forms.md` ❓ item 2 for the full trail.
    const RETENTION_GRACE_DAYS = 90;
    const purgedStudents = await query(
      `WITH ready AS (
         SELECT student_id, MAX(submitted_at) AS last_eval_at
           FROM final_evaluations
          WHERE evaluator_role = 'mentor' AND form_code IN ('sahatkit_15', 'sahatkit_16')
          GROUP BY student_id
         HAVING COUNT(DISTINCT form_code) = 2
       )
       UPDATE students s
          SET national_id_ciphertext = NULL, national_id_iv = NULL, national_id_tag = NULL,
              national_id_issued_district = NULL, national_id_expiry_date = NULL,
              ethnicity_ciphertext = NULL, ethnicity_iv = NULL, ethnicity_tag = NULL,
              religion_ciphertext = NULL, religion_iv = NULL, religion_tag = NULL,
              sensitive_data_consented_at = NULL
         FROM ready r
        WHERE s.student_id = r.student_id
          AND r.last_eval_at + ($1 || ' days')::interval <= NOW()
          AND (s.national_id_ciphertext IS NOT NULL
               OR s.ethnicity_ciphertext IS NOT NULL
               OR s.religion_ciphertext IS NOT NULL)
        RETURNING s.student_id`,
      [RETENTION_GRACE_DAYS]
    );

    if ((purgedStudents.rowCount ?? 0) > 0) {
      console.log(
        `[DeactivationScheduler] Purged sensitive data for ${purgedStudents.rowCount} student(s) (SEC-12).`
      );
      for (const row of purgedStudents.rows as { student_id: number }[]) {
        await writeAudit({
          action: AuditAction.STUDENT_SENSITIVE_DATA_PURGED,
          entityType: 'student',
          entityId: row.student_id,
          subjectId: row.student_id,
          detail: { reason: 'retention_policy', grace_days: RETENTION_GRACE_DAYS },
        });
      }
    } else {
      console.log('[DeactivationScheduler] No sensitive data ready for retention purge.');
    }

    // 4. ปิดใบคำร้องที่พ้นปฏิทิน `acceptance_form` โดยยังไม่มีแบบตอบรับ — กติกาทั้งหมดอยู่ที่ `acceptanceAutoClose.ts`
    const autoClosed = await runAcceptanceAutoClose();
    console.log(`[DeactivationScheduler] Auto-closed ${autoClosed} intent form(s) past the acceptance calendar.`);

    console.log('[DeactivationScheduler] Automatic deactivation check complete.');
  } catch (error) {
    console.error('[DeactivationScheduler] Error running automatic deactivation:', error);
  }
}

export function initDeactivationScheduler(): void {
  // Run on startup
  setTimeout(() => {
    runAutoDeactivation().catch(err => {
      console.error('[DeactivationScheduler] Startup run failed:', err);
    });
  }, 5000); // Wait 5 seconds after startup to let DB connect cleanly

  // Set interval to check every 24 hours
  const dailyMillis = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runAutoDeactivation().catch(err => {
      console.error('[DeactivationScheduler] Daily run failed:', err);
    });
  }, dailyMillis);
  
  console.log('[DeactivationScheduler] Initialized (running every 24 hours).');
}
