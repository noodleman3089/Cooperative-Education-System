import { query } from '../config/database';
import { AuditAction, writeAudit } from './audit';

/**
 * Normalise a year to the Buddhist era before comparing.
 *
 * The two sides of the graduation check disagreed on era: `coop_semesters.
 * academic_year` is seeded as 2026 (Gregorian) while the onboarding form offers
 * 2564-2572 (Buddhist). `enrollment_year + 4 <= academic_year` was therefore
 * `2569 <= 2026` — always false, so nobody was ever deactivated. Worse, the day
 * someone set academic_year in the Buddhist era, any student who had entered a
 * Gregorian year would be deactivated immediately.
 *
 * Anything below 2400 is treated as Gregorian (Buddhist era = Gregorian + 543).
 */
function toBuddhistYear(year: number): number {
  return year < 2400 ? year + 543 : year;
}

export async function runAutoDeactivation(): Promise<void> {
  console.log('[DeactivationScheduler] Running automatic deactivation check...');
  try {
    // 1. Deactivate students who graduated: enrollment_year + 4 <= current_academic_year
    const activeSemesterRes = await query(
      'SELECT academic_year FROM coop_semesters WHERE is_active = true LIMIT 1'
    );
    
    if ((activeSemesterRes.rowCount ?? 0) > 0) {
      const currentAcademicYear = activeSemesterRes.rows[0].academic_year;
      const academicYearBE = toBuddhistYear(currentAcademicYear);

      // Both sides are converted to the Buddhist era inside the query so a mix of
      // eras across student records still compares correctly.
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
