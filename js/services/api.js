// js/services/api.js — Local GPX-based data provider.
// The app has no server-side account/OAuth of any kind: all data comes from GPX files the user
// imports (see /api/local-import) and is served back by the /api/local-* endpoints backed by
// api/_local/store.js. See LOCAL_GPX_MIGRATION_PLAN.md for the on-disk layout.

import { clearCachedActivities } from './activity-cache.js';

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

// Any call that changes activities on the server must drop the local activity cache: the
// dashboard serves it for up to an hour, and mutations often happen on other pages (activity
// detail, gear) that never touch main.js's in-memory copy. Called even if the request fails,
// since a partially-applied import/bulk edit may still have changed data on disk.
async function invalidateActivityCache() {
    try {
        await clearCachedActivities();
    } catch (error) {
        console.warn('Failed to invalidate activity cache:', error);
    }
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
    let response;
    try {
        response = await fetch('/api/local-import', { method: 'POST', body: formData });
    } finally {
        await invalidateActivityCache();
    }
    return handleResponse(response);
}

export async function updateActivityType(activityId, type) {
    let response;
    try {
        response = await fetch('/api/local-activity', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activityId, type }),
        });
    } finally {
        await invalidateActivityCache();
    }
    const result = await handleResponse(response);
    return result.activity;
}

// Static-bike gear hardness for a session. The device never records it, so it lives on the
// server (summary.json); pass null to clear it. Resolves to the updated activity.
export async function updateActivityGearHardness(activityId, gearHardness) {
    let response;
    try {
        response = await fetch('/api/local-activity', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activityId, gear_hardness: gearHardness }),
        });
    } finally {
        await invalidateActivityCache();
    }
    const result = await handleResponse(response);
    return result.activity;
}

export async function deleteActivity(activityId) {
    let response;
    try {
        response = await fetch(`/api/local-activity?id=${encodeURIComponent(activityId)}`, { method: 'DELETE' });
    } finally {
        await invalidateActivityCache();
    }
    return handleResponse(response);
}

// Bulk delete in one request. Resolves to { deleted: [ids], notFound: [ids] }.
export async function deleteActivities(activityIds) {
    let response;
    try {
        response = await fetch('/api/local-activities', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: activityIds }),
        });
    } finally {
        await invalidateActivityCache();
    }
    return handleResponse(response);
}

// The original imported GPX file, as text.
export async function fetchActivityGpx(activityId) {
    const response = await fetch(`/api/local-activity?id=${encodeURIComponent(activityId)}&format=gpx`);
    if (!response.ok) {
        // handleResponse only throws on !ok; reuse it for the error message extraction.
        await handleResponse(response);
    }
    return response.text();
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
    let response;
    try {
        response = await fetch(`/api/local-gear?id=${encodeURIComponent(gearId)}&hard=true`, { method: 'DELETE' });
    } finally {
        await invalidateActivityCache(); // clears gear_id on activities that used it
    }
    return handleResponse(response);
}

export async function bulkAssignGear(gearId, dateFrom, dateTo) {
    let response;
    try {
        response = await fetch('/api/local-gear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'bulk-assign', gearId, dateFrom, dateTo }),
        });
    } finally {
        await invalidateActivityCache();
    }
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
