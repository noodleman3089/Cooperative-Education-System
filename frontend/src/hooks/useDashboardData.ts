import { useEffect, useRef } from 'react';

/** Kept at the value the five hand-written copies had all settled on. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Loads a dashboard once, then keeps it fresh: every ten seconds, whenever the
 * tab regains focus, and whenever something in the app dispatches
 * `intent-updated`. The reload is passed `true` so the screen can refresh
 * without flipping back to its loading skeleton.
 *
 * This was written out by hand in five dashboards, identically apart from the
 * name of the load function, which meant a fix in one was a fix in one. It also
 * kept polling while the tab was hidden — a backgrounded dashboard hit the API
 * every ten seconds all day for a screen nobody was looking at. The
 * `document.hidden` check lives here now, so all five got it at once.
 */
export function useDashboardData(
  load: (isBackground?: boolean) => void | Promise<unknown>,
  deps: unknown[] = []
): void {
  // Held in a ref so a caller redefining `load` every render — which all of
  // them do — does not tear down and restart the interval on every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();

    const refresh = () => {
      if (document.hidden) return;
      loadRef.current(true);
    };

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('intent-updated', refresh);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('intent-updated', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
