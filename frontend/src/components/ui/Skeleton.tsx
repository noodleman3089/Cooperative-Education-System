import React from 'react';

/** One grey box. The sweep is defined once in index.css. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-2xl shimmer-placeholder ${className}`.trim()} aria-hidden="true" />
);

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
  mentor_followup: 'table',
  dispatch_letters: 'table',
  companies: 'table',
  announcements: 'table',
  calendar: 'table',
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

/**
 * A placeholder for a whole screen, in the screen's own shape.
 *
 * The point of a skeleton is that nothing moves when the real content arrives.
 * These did the opposite: not one of the sixteen drew the page heading every
 * screen starts with, so finishing a load pushed the entire page down, and four
 * dashboards drew a single h-48 block where the real screen has a heading, a
 * row of figures and a table. A box in the wrong place is worse than no box —
 * it promises a layout and then breaks the promise.
 *
 * Suspense uses this too, with the same variant the screen will use, so the
 * chunk-loading placeholder and the data-loading placeholder are the same
 * picture. Otherwise splitting the bundle means watching two different
 * skeletons in a row before the page appears.
 */
export const PageSkeleton: React.FC<{ variant?: SkeletonVariant }> = ({ variant = 'stats' }) => (
  <div className="space-y-6" data-testid="screen-loading">
    {/* The heading block every screen opens with: title, then subtitle. */}
    <div className="space-y-2">
      <Skeleton className="h-7 w-72 max-w-full rounded-lg" />
      <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
    </div>

    {variant === 'stats' && (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-80" />
      </>
    )}

    {variant === 'table' && <Skeleton className="h-96" />}

    {variant === 'cards' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )}

    {variant === 'form' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Skeleton className="lg:col-span-4 h-96" />
        <Skeleton className="lg:col-span-8 h-96" />
      </div>
    )}

    {variant === 'split' && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="md:col-span-2 h-80" />
        <Skeleton className="h-80" />
      </div>
    )}
  </div>
);

export default PageSkeleton;
