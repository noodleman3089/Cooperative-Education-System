/**
 * The shapes screens actually have. Four covers everything in the app:
 *
 *  stats  — heading, a row of figures, then a table (most dashboards)
 *  table  — heading then a table (dean's signing queue, staff sub-tabs)
 *  cards  — heading then a grid of cards (student dashboard)
 *  form   — heading then a two-column form (both profile screens)
 *  split  — heading then a wide panel beside a narrow one (dean's signature pad)
 */
export type SkeletonVariant = 'stats' | 'table' | 'cards' | 'form' | 'split';

const VARIANT_BY_MENU: Record<string, SkeletonVariant> = {
  profile: 'form',
  // The signature screen is a wide drawing pad beside a narrow preview card.
  // Mapping it to 'form' drew those two the other way round, so finishing the
  // load swapped the columns over — the exact thing these shapes exist to stop.
  signature: 'split',
  accommodation_plan: 'form',
  weekly_log: 'form',
  job_application: 'form',
  supervision_record: 'form',
  supervision: 'cards',
  report_outline: 'table',
  report_outlines: 'table',
  memos: 'table',
  final_report: 'table',
  // Both evaluation screens — the mentor's and the advisor's — open on a grid of
  // student cards. They were mapped to 'table', so the layout changed shape as
  // the data landed. Neither screen contains a table at all.
  final_evaluation: 'cards',
  // หน้าผลประเมินของนักศึกษาเป็นรายการคะแนนทีละข้อ = รูปทรงเดียวกับตาราง
  evaluation_result: 'table',
  final_progress: 'table',
  pipeline: 'stats',
  mentor_followup: 'table',
  dispatch_letters: 'table',
  companies: 'table',
  announcements: 'table',
  calendar: 'table',
  semesters: 'table',
  semester_summary: 'table',
  appointments: 'table',
  users: 'table',
  import: 'table',
  students: 'stats',
  approval: 'stats',
  assignment: 'stats',
};

/**
 * The shape of a given screen, asked in two places: by Suspense before the
 * chunk arrives, and by the screen itself while it fetches. Both must get the
 * same answer or the user watches the layout change twice.
 *
 * It has to be a lookup rather than a constant per file because four of the
 * screens serve several menu entries — StaffDashboard alone renders five, and
 * a table of users looks nothing like the pipeline overview.
 */
export const skeletonFor = (role: string, menu: string): SkeletonVariant => {
  // A student's home is a card grid; every other role's home is figures over a
  // table. A student's `jobs` menu is the request form (เอกสารหมายเลข 1).
  if (menu === 'dashboard') return role === 'student' ? 'cards' : 'stats';
  if (menu === 'jobs') return role === 'student' ? 'form' : 'table';
  return VARIANT_BY_MENU[menu] ?? 'stats';
};
