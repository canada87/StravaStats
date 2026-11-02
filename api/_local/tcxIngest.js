// api/_local/tcxIngest.js — Orchestrates parse -> enrich -> id/dedup -> persist for one
// uploaded .tcx file. Mirrors gpxIngest.js; kept separate because TCX classification doesn't
// need the GPX-only Withings name/filename heuristics (see LOCAL_GPX_MIGRATION_PLAN.md §4).
//
// Motivating case: a phone that never gets a GPS fix indoors records the static-bike session as
// .tcx instead of .gpx, with every <Trackpoint> missing <Position> entirely (not 0/0 — simply
// absent). enrich.js treats points with no lat/lon as "no GPS fix", so such a file is always
// stationary by construction.

import path from 'node:path';
import { parseTcx } from './tcxParser.js';
import { enrichPoints, summarizeStreams, summarizeForSport, maxDisplacementMeters, STATIC_BIKE_TYPE } from './enrich.js';
import { readIndex, writeIndex, saveActivity, readGear } from './store.js';
import {
    toLocalIsoString, generateActivityName, slugify, computeContentHash, classifySportTypeFallback,
    encodeSummaryPolyline,
} from './activityCommon.js';

const TCX_SPORT_TO_TYPE = {
    biking: 'Ride',
    running: 'Run',
};

function classifySportType(tcxSport, hasGpsFix) {
    const normalized = String(tcxSport || '').trim().toLowerCase();
    // An indoor-trainer recording (no GPS fix at all) on a bike is a static-bike session; the
    // same device sitting still on a run (treadmill) isn't something this app models yet, so it
    // stays a plain Run.
    if (normalized === 'biking' && !hasGpsFix) return STATIC_BIKE_TYPE;
    return TCX_SPORT_TO_TYPE[normalized] || null;
}

/**
 * @param {string} filename Original uploaded filename (used for the readable id).
 * @param {Buffer|string} data Raw TCX file contents.
 * @returns {Promise<{status: 'imported'|'duplicate', id: string, name?: string}>}
 */
export async function ingestTcxFile(filename, data) {
    const xmlText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const { type: tcxSport, points, metadataTime } = parseTcx(xmlText);

    const streams = enrichPoints(points);
    const stats = summarizeStreams(streams);

    const startTimeMs = points[0].time ?? metadataTime ?? Date.now();
    const startDate = new Date(startTimeMs);
    const startDateIso = startDate.toISOString();
    const contentHash = computeContentHash(startDateIso, points.length, stats.distance);

    const index = await readIndex();
    const existing = index.find(a => a.content_hash === contentHash);
    if (existing) {
        return { status: 'duplicate', id: existing.id, name: existing.name };
    }

    const hasGpsFix = maxDisplacementMeters(streams) > 0 || streams.latlng.data.some(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    const sportType = classifySportType(tcxSport, hasGpsFix) || classifySportTypeFallback(stats.average_speed);
    const sessionStats = summarizeForSport(streams, sportType);

    const baseId = slugify(path.basename(filename, path.extname(filename))) || 'activity';
    let id = baseId;
    if (index.some(a => a.id === id)) id = `${baseId}-${contentHash}`;

    const finalName = generateActivityName(sportType, startDate); // TCX carries no activity name

    const gearList = await readGear();
    const candidates = gearList.filter(g => !g.retired && Array.isArray(g.default_for_sport) && g.default_for_sport.includes(sportType));
    const gearId = candidates.length === 1 ? candidates[0].id : null;

    const summaryPolyline = encodeSummaryPolyline(streams.latlng.data);

    const summary = {
        id,
        content_hash: contentHash,
        name: finalName,
        type: sportType,
        sport_type: sportType,
        start_date: startDateIso,
        start_date_local: toLocalIsoString(startDate),
        start_latlng: stats.start_latlng,
        distance: sessionStats.distance,
        moving_time: sessionStats.moving_time,
        elapsed_time: sessionStats.elapsed_time,
        total_elevation_gain: sessionStats.total_elevation_gain,
        average_heartrate: sessionStats.average_heartrate,
        max_heartrate: sessionStats.max_heartrate,
        average_speed: sessionStats.average_speed,
        max_speed: sessionStats.max_speed,
        gear_id: gearId,
        kudos_count: 0,
        achievement_count: 0,
        pr_count: 0,
        comment_count: 0,
        athlete_count: 1,
        suffer_score: null,
        calories: null,
        device_name: null,
        map: { summary_polyline: summaryPolyline },
        source_file: filename,
    };

    // Set by hand from the UI (PUT /api/local-activity): the device never records it.
    if (sportType === STATIC_BIKE_TYPE) summary.gear_hardness = null;

    await saveActivity(id, { rawGpx: xmlText, summary, streams });
    await writeIndex([...index, summary]);

    return { status: 'imported', id, name: finalName };
}
