import React from 'react';

/** One grey box. The sweep is defined once in index.css. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-2xl shimmer-placeholder ${className}`.trim()} aria-hidden="true" />
);

import type { SkeletonVariant } from './skeletonFor';

export type { SkeletonVariant };

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
