// js/services/mode.js — Which data provider the app is running against.
// Local mode (APP_MODE=local, see LOCAL_GPX_MIGRATION_PLAN.md) reads GPX-derived data from the
// new /api/local-* endpoints instead of Strava; demo mode (js/demo/index.js) is a separate,
// orthogonal concept (sample data while still "connected" to Strava conceptually).

let currentMode = 'strava';

export async function loadAppMode() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        currentMode = data.mode === 'local' ? 'local' : 'strava';
    } catch (_e) {
        currentMode = 'strava';
    }
    return currentMode;
}

export function isLocalMode() {
    return currentMode === 'local';
}
