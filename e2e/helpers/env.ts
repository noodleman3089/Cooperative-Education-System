/**
 * Where the suite points. These were spelled out as literals in 47 places
 * across the specs, so moving the ports — or pointing the suite at a staging
 * deployment — meant a find-and-replace that was easy to get half right.
 */
export const API_URL = process.env.E2E_API_URL || 'http://localhost:5000/api';
export const APP_URL = process.env.E2E_APP_URL || 'http://localhost:5173';

/** The backend origin, for the handful of routes that sit outside /api. */
export const SERVER_URL = API_URL.replace(/\/api$/, '');
