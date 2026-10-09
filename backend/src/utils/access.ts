import { query } from '../config/database';

/**
 * Shared authorization helpers.
 *
 * SEC-06: the codebase repeated this shape in five places —
 *
 *   const res = await query('SELECT major_id FROM personnel WHERE personnel_id = $1', [userId]);
 *   if (res.rowCount > 0) { majorId = res.rows[0].major_id; }
 *   ...
 *   if (majorId !== null) queryStr += ' AND s.major_id = $n';
 *
 * — which fails *open*: an advisor or department head whose `personnel` row is
 * missing (never onboarded, deleted, mid-migration) simply had no filter applied
 * and saw every student in the university, including phone numbers, home
 * addresses and parent contact details. These helpers make the missing-profile
 * case an explicit denial instead.
 */

/** Roles that see the whole institution and are therefore not major-scoped. */
export const INSTITUTION_WIDE_ROLES = ['staff', 'dean'];

/** Roles whose visibility is limited to their own major. */
export const MAJOR_SCOPED_ROLES = ['advisor', 'dept_head'];

export interface MajorScope {
  /** null means "no major restriction" (staff/dean). */
  majorId: number | null;
  /** True when the caller is limited to `majorId`. */
  isScoped: boolean;
}

export class AccessDeniedError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = 'AccessDeniedError';
    this.status = status;
  }
}

/**
 * Resolve which major a personnel user is allowed to act within.
 *
 * @throws AccessDeniedError when a major-scoped role has no personnel profile —
 *         we cannot determine their scope, so we must not grant an unscoped view.
 */
export async function resolveMajorScope(
  userId: number,
  roles: string[]
): Promise<MajorScope> {
  if (roles.some((r) => INSTITUTION_WIDE_ROLES.includes(r))) {
    return { majorId: null, isScoped: false };
  }

  if (!roles.some((r) => MAJOR_SCOPED_ROLES.includes(r))) {
    throw new AccessDeniedError('Forbidden. You do not have access to this resource.');
  }

  const personnelRes = await query('SELECT major_id FROM personnel WHERE personnel_id = $1', [userId]);
  if ((personnelRes.rowCount ?? 0) === 0 || personnelRes.rows[0].major_id === null) {
    throw new AccessDeniedError(
      'ไม่พบข้อมูลสาขาวิชาที่ท่านสังกัด กรุณาติดต่อเจ้าหน้าที่เพื่อตั้งค่าโปรไฟล์บุคลากรก่อนใช้งาน'
    );
  }

  return { majorId: personnelRes.rows[0].major_id, isScoped: true };
}

/**
 * Assert that a major-scoped caller may act on a specific student.
 * Staff and deans pass through; everyone else must match the student's major.
 */
export async function assertCanAccessStudent(
  userId: number,
  roles: string[],
  studentId: number
): Promise<void> {
  const scope = await resolveMajorScope(userId, roles);
  if (!scope.isScoped) return;

  const studentRes = await query('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
  if ((studentRes.rowCount ?? 0) === 0) {
    throw new AccessDeniedError('Student profile not found.', 404);
  }

  if (studentRes.rows[0].major_id !== scope.majorId) {
    throw new AccessDeniedError('Forbidden. This student is outside your major.');
  }
}

/**
 * Assert that an advisor is the student's assigned advisor or supervisor.
 * Staff, deans and department heads (within their major) are allowed through so
 * the co-op office can still administer records.
 */
export async function assertCanReviewStudentWork(
  userId: number,
  roles: string[],
  studentId: number
): Promise<void> {
  if (roles.some((r) => INSTITUTION_WIDE_ROLES.includes(r))) return;

  if (roles.includes('dept_head')) {
    await assertCanAccessStudent(userId, roles, studentId);
    return;
  }

  if (roles.includes('advisor')) {
    const res = await query(
      'SELECT 1 FROM students WHERE student_id = $1 AND (advisor_id = $2 OR supervisor_id = $2) LIMIT 1',
      [studentId, userId]
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new AccessDeniedError('Forbidden. You are not the assigned advisor or supervisor for this student.');
    }
    return;
  }

  throw new AccessDeniedError('Forbidden. You do not have access to this student\'s records.');
}

/**
 * Assert that an advisor holds one *specific* duty for this student (SB-F9).
 *
 * `assertCanReviewStudentWork` accepts either column, which is right for reading but
 * wrong for writing: the forms split the work. สหกิจ 14 and the final-report
 * check belong to the อาจารย์ที่ปรึกษา (`advisor_id`); สหกิจ 11 · 12 · 13 and the travel
 * request belong to the อาจารย์นิเทศ (`supervisor_id`). With the loose check, an
 * advisor who was not the supervisor could draft visits for the same student and
 * use up the two-visit limit the real supervisor needed.
 *
 * Staff/dean and a department head within the student's major pass through, as in
 * `assertCanReviewStudentWork` — the routes that allow them are unchanged.
 */
export async function assertAssignedDuty(
  userId: number,
  roles: string[],
  studentId: number,
  duty: 'advisor' | 'supervisor'
): Promise<void> {
  if (roles.some((r) => INSTITUTION_WIDE_ROLES.includes(r))) return;

  if (roles.includes('dept_head')) {
    await assertCanAccessStudent(userId, roles, studentId);
    return;
  }

  if (roles.includes('advisor')) {
    const column = duty === 'advisor' ? 'advisor_id' : 'supervisor_id';
    const res = await query(`SELECT 1 FROM students WHERE student_id = $1 AND ${column} = $2 LIMIT 1`, [
      studentId,
      userId,
    ]);
    if ((res.rowCount ?? 0) === 0) {
      throw new AccessDeniedError(
        duty === 'advisor'
          ? 'งานนี้เป็นของอาจารย์ที่ปรึกษาของนักศึกษาคนนี้เท่านั้น'
          : 'งานนี้เป็นของอาจารย์นิเทศของนักศึกษาคนนี้เท่านั้น'
      );
    }
    return;
  }

  throw new AccessDeniedError('Forbidden. You do not have access to this student\'s records.');
}

/**
 * Assert that a mentor is *this student's* assigned mentor.
 *
 * SEC-06 again, on the co-op side this time. `PATCH /students/:id/work-plan/approve`
 * and `/reject` shipped with no ownership check at all: any account holding the
 * `mentor` role could put someone else's student id in the URL and sign — or bounce
 * — a work plan for a student at a different company entirely. The screens never
 * offered that, which is exactly why it went unnoticed; the URL did.
 *
 * The tie is `intent_forms.mentor_id` on an accepted placement, the same row every
 * other mentor endpoint checks (`weeklyLog.certifyLog`, `monthlyLog.certifyLog`,
 * `finalReport.mentorReview`). Those three already inline this query; new callers
 * should use this helper so there is one definition to get right.
 *
 * ⛔ Deliberately not "if a mentor row exists, filter by it" — a mentor with no
 *    accepted placement gets a denial, never an unfiltered pass.
 */
export async function assertMentorOwnsStudent(userId: number, studentId: number): Promise<void> {
  const res = await query(
    `SELECT 1 FROM intent_forms
      WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted' LIMIT 1`,
    [studentId, userId]
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new AccessDeniedError('นักศึกษาคนนี้ไม่ได้อยู่ในการดูแลของท่าน');
  }
}

/** Map an AccessDeniedError onto a response; rethrows anything else. */
export function sendAccessError(res: { status: (c: number) => { json: (b: unknown) => void } }, error: unknown): boolean {
  if (error instanceof AccessDeniedError) {
    res.status(error.status).json({ message: error.message });
    return true;
  }
  return false;
}
