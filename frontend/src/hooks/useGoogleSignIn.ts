import { useEffect, useRef, useState } from 'react';
// ชนิดของ window.google ประกาศไว้ที่ types/googleMaps.ts

export type GoogleSignInStatus = 'loading' | 'ready' | 'failed';

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
): GoogleSignInStatus => {
  const [status, setStatus] = useState<GoogleSignInStatus>('loading');
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      const timer = setTimeout(() => {
        setStatus('failed');
      }, 0);
      return () => clearTimeout(timer);
    }

    let failTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!window.google?.accounts) {
        setStatus('failed');
      }
    }, 8000);

    const initialize = () => {
      const google = window.google;
      const container = document.getElementById(containerId);
      if (!google?.accounts || !container) return false;

      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => callbackRef.current(response.credential),
      });
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'rectangular',
      });
      setStatus('ready');
      if (failTimer) {
        clearTimeout(failTimer);
        failTimer = null;
      }
      return true;
    };

    const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    if (existing) {
      // Already injected by an earlier mount; give it a beat to finish parsing.
      if (window.google?.accounts) {
        readyTimer = setTimeout(initialize, 0);
      } else {
        const handleLoad = () => {
          initialize();
        };
        const handleError = () => {
          setStatus('failed');
        };
        existing.addEventListener('load', handleLoad);
        existing.addEventListener('error', handleError);
        readyTimer = setTimeout(initialize, 100);
        return () => {
          if (failTimer) clearTimeout(failTimer);
          if (readyTimer) clearTimeout(readyTimer);
          existing.removeEventListener('load', handleLoad);
          existing.removeEventListener('error', handleError);
        };
      }
      return () => {
        if (failTimer) clearTimeout(failTimer);
        if (readyTimer) clearTimeout(readyTimer);
      };
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.id = GIS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      initialize();
    };
    script.onerror = () => {
      setStatus('failed');
    };
    document.head.appendChild(script);

    return () => {
      if (failTimer) clearTimeout(failTimer);
      script.onload = null;
      script.onerror = null;
    };
  }, [containerId]);

  return status;
};
