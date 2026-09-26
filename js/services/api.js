// js/services/api.js — Local GPX-based data provider.
// The app has no server-side account/OAuth of any kind: all data comes from GPX files the user
// imports (see /api/local-import) and is served back by the /api/local-* endpoints backed by
// api/_local/store.js. See LOCAL_GPX_MIGRATION_PLAN.md for the on-disk layout.

// Kept as 'strava_gears' (not renamed) because js/app/main.js, js/tabs/gear.js,
// js/tabs/run-analysis.js and js/pages/gear/gear-analysis.js read this exact localStorage key
// directly rather than through getCachedGears().
const GEAR_CACHE_KEY = 'strava_gears';
const GEAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function handleResponse(response) {
    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const result = await response.json();
            throw new Error(result.error || `API call failed (${response.status})`);
        }
        throw new Error(`API call failed (${response.status} ${response.statusText})`);
    }
    return response.json();
}

export async function fetchAllActivities() {
    const response = await fetch('/api/local-activities');
    const result = await handleResponse(response);
    return result.activities;
}

export async function fetchAthleteData() {
    const response = await fetch('/api/local-athlete');
    const result = await handleResponse(response);
    return result.athlete;
}

export async function fetchTrainingZones() {
    // No HR-zone computation happens locally; core.js falls back to userProfile.max_hr
    // when this is null (see js/shared/preprocessing/core.js).
    return null;
}

export async function fetchAllGears() {
    const response = await fetch('/api/local-gear');
    const result = await handleResponse(response);
    return result.gear;
}

export async function importGpxFiles(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('file', file, file.name);
    }
    const response = await fetch('/api/local-import', { method: 'POST', body: formData });
    return handleResponse(response);
}

export async function updateActivityType(activityId, type) {
    const response = await fetch('/api/local-activity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activityId, type }),
    });
    const result = await handleResponse(response);
    return result.activity;
}

export async function createGear(gearData) {
    const response = await fetch('/api/local-gear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gearData),
    });
    const result = await handleResponse(response);
    return result.gear;
}

export async function updateGear(gearData) {
    const response = await fetch('/api/local-gear', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gearData),
    });
    const result = await handleResponse(response);
    return result.gear;
}

export async function retireGear(gearId) {
    const response = await fetch(`/api/local-gear?id=${encodeURIComponent(gearId)}`, { method: 'DELETE' });
    const result = await handleResponse(response);
    return result.gear;
}

export async function deleteGearPermanently(gearId) {
    const response = await fetch(`/api/local-gear?id=${encodeURIComponent(gearId)}&hard=true`, { method: 'DELETE' });
    return handleResponse(response);
}

export async function bulkAssignGear(gearId, dateFrom, dateTo) {
    const response = await fetch('/api/local-gear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk-assign', gearId, dateFrom, dateTo }),
    });
    return handleResponse(response);
}

export function getCachedGears() {
    const cached = localStorage.getItem(GEAR_CACHE_KEY);
    const timestamp = Number(localStorage.getItem(`${GEAR_CACHE_KEY}_timestamp`) || 0);
    if (!cached || !timestamp || Date.now() - timestamp > GEAR_CACHE_TTL_MS) return null;
    try {
        return JSON.parse(cached);
    } catch (_e) {
        return null;
    }
}

export function setCachedGears(gearsList) {
    try {
        localStorage.setItem(GEAR_CACHE_KEY, JSON.stringify(gearsList));
        localStorage.setItem(`${GEAR_CACHE_KEY}_timestamp`, Date.now().toString());
    } catch (_e) {
        // Storage full/unavailable: the gear tab will simply re-fetch on next load.
    }
}
