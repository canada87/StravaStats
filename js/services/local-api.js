// js/services/local-api.js — Data provider backed by locally-imported GPX files
// (LOCAL_GPX_MIGRATION_PLAN.md §8.1). Same function names as js/services/api.js so api.js can
// delegate to this module when running in local mode; no token/OAuth involved.

async function handleLocalResponse(response) {
    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const result = await response.json();
            throw new Error(result.error || `Local API call failed (${response.status})`);
        }
        throw new Error(`Local API call failed (${response.status} ${response.statusText})`);
    }
    return response.json();
}

export async function fetchAllActivities() {
    const response = await fetch('/api/local-activities');
    const result = await handleLocalResponse(response);
    return result.activities;
}

export async function fetchAthleteData() {
    const response = await fetch('/api/local-athlete');
    const result = await handleLocalResponse(response);
    return result.athlete;
}

export async function fetchTrainingZones() {
    // No Strava-computed HR zones in local mode; core.js already tolerates an empty/null value
    // and falls back to userProfile.max_hr (see js/shared/preprocessing/core.js).
    return null;
}

export async function fetchAllGears() {
    const response = await fetch('/api/local-gear');
    const result = await handleLocalResponse(response);
    return result.gear;
}

export async function importGpxFiles(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('file', file, file.name);
    }
    const response = await fetch('/api/local-import', {
        method: 'POST',
        body: formData,
    });
    return handleLocalResponse(response);
}
