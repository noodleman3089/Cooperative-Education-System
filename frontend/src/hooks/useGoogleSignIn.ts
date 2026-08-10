import { useEffect, useRef } from 'react';

/**
 * Renders the Google Identity Services button into `containerId`.
 *
 * The script tag is shared across every login page, so it is only injected
 * once and later mounts wait for the already-loaded library instead. The
 * callback is held in a ref because GIS captures it at `initialize()` time —
 * passing the callback straight through would freeze the first render's
 * closure and leave the handler looking at stale state.
 */
const GIS_SCRIPT_ID = 'google-gis-script';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export const useGoogleSignIn = (
  containerId: string,
  onCredential: (credential: string) => void
) => {
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    const initialize = () => {
      const google = (window as any).google;
      const container = document.getElementById(containerId);
      if (!google || !container) return;

      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
        callback: (response: { credential: string }) => callbackRef.current(response.credential),
      });
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'rectangular',
      });
    };

    const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Already injected by an earlier mount; give it a beat to finish parsing.
      const timer = setTimeout(initialize, 100);
      return () => clearTimeout(timer);
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.id = GIS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.onload = initialize;
    document.head.appendChild(script);
  }, [containerId]);
};
