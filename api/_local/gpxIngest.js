// api/_local/gpxIngest.js — Orchestrates parse -> enrich -> id/dedup -> persist for one
// uploaded .gpx file. See LOCAL_GPX_MIGRATION_PLAN.md §4.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseGpx } from './gpxParser.js';
import { enrichPoints, summarizeStreams, summarizeForSport, maxDisplacementMeters, STATIC_BIKE_TYPE } from './enrich.js';
import { encodePolyline } from './polyline.js';
import { readIndex, writeIndex, saveActivity, readGear } from './store.js';

const GPX_TYPE_TO_SPORT = {
    running: 'Run',
    run: 'Run',
    trail_running: 'TrailRun',
    cycling: 'Ride',
    biking: 'Ride',
    ride: 'Ride',
    mountain_biking: 'MountainBikeRide',
    hiking: 'Hike',
    hike: 'Hike',
    walking: 'Walk',
    walk: 'Walk',
};

const GENERIC_NAME_PATTERN = /^(run|ride|cycling|walk|hike|activity|workout)$/i;

// Withings devices export indoor/static-bike sessions as GPX with no <type> at all (the GPS
// "track" is just the device sitting still): the only tell is the track name
// ("Withings activity 2026-10-02 21:26") and the file name ("activity_02102026_2126.gpx").
const STATIC_BIKE_NAME_PATTERN = /^withings activity\b/i;
const STATIC_BIKE_FILE_PATTERN = /^activity_\d{8}_\d{4}\./i;
// Withings uses the same "Withings activity" name for outdoor activities too (runs, walks), and
// those do carry GPS and heart rate. A static-bike session never leaves the spot, so the name
// only counts when the track stays within this distance of its start.
const STATIC_BIKE_MAX_DISPLACEMENT_M = 200;

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// GPX timestamps are always UTC; the athlete's actual timezone isn't recorded anywhere in the
// file. Europe/Rome is a pragmatic default for this app's single user — open item if this ever
// needs to support athletes in other timezones (see LOCAL_GPX_MIGRATION_PLAN.md §12).
const ASSUMED_TIMEZONE = 'Europe/Rome';

function toLocalParts(utcDate, timeZone = ASSUMED_TIMEZONE) {
    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return dtf.formatToParts(utcDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
}

function toLocalIsoString(utcDate) {
    const p = toLocalParts(utcDate);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function classifySportType(gpxType, gpxName, filename, isStationary) {
    if (gpxType) {
        const known = GPX_TYPE_TO_SPORT[String(gpxType).trim().toLowerCase()];
        if (known) return known;
    }
    // An explicit, recognised <type> always wins; the Withings heuristic only applies to files
    // that don't say what they are.
    if (!gpxType && isStationary && (STATIC_BIKE_NAME_PATTERN.test(gpxName || '') || STATIC_BIKE_FILE_PATTERN.test(path.basename(filename || '')))) {
        return STATIC_BIKE_TYPE;
    }
    return null;
}

// Only validated against running GPX files so far (see LOCAL_GPX_MIGRATION_PLAN.md §12) — the
// bike threshold below are a reasonable first guess, not yet exercised with real data.
function classifySportTypeFallback(averageSpeedMs) {
    const kmh = averageSpeedMs * 3.6;
    if (kmh >= 15) return 'Ride';
    return 'Run';
}

function generateActivityName(sportType, localDate) {
    const labels = { Run: 'Corsa', TrailRun: 'Corsa in sentiero', Ride: 'Uscita in bici', StaticBike: 'Bici statica', MountainBikeRide: 'Uscita in MTB', Hike: 'Escursione', Walk: 'Camminata' };
    const label = labels[sportType] || 'Attività';
    const p = toLocalParts(localDate);
    return `${label} - ${p.day} ${MONTHS_IT[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function computeContentHash(startDateIso, pointCount, totalDistanceMeters) {
    return createHash('sha1')
        .update(`${startDateIso}|${pointCount}|${Math.round(totalDistanceMeters)}`)
        .digest('hex')
        .slice(0, 12);
}

/**
 * @param {string} filename Original uploaded filename (used for the readable id).
 * @param {Buffer|string} data Raw GPX file contents.
 * @returns {Promise<{status: 'imported'|'duplicate', id: string, name?: string}>}
 */
export async function ingestGpxFile(filename, data) {
    const xmlText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const { name: gpxName, type: gpxType, points, metadataTime } = parseGpx(xmlText);

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

    const isStationary = maxDisplacementMeters(streams) <= STATIC_BIKE_MAX_DISPLACEMENT_M;
    const sportType = classifySportType(gpxType, gpxName, filename, isStationary) || classifySportTypeFallback(stats.average_speed);
    const sessionStats = summarizeForSport(streams, sportType);

    const baseId = slugify(path.basename(filename, path.extname(filename))) || 'activity';
    let id = baseId;
    if (index.some(a => a.id === id)) id = `${baseId}-${contentHash}`;

    const isGenericName = !gpxName || GENERIC_NAME_PATTERN.test(gpxName) || STATIC_BIKE_NAME_PATTERN.test(gpxName);
    const finalName = isGenericName ? generateActivityName(sportType, startDate) : gpxName;

    const gearList = await readGear();
    const candidates = gearList.filter(g => !g.retired && Array.isArray(g.default_for_sport) && g.default_for_sport.includes(sportType));
    const gearId = candidates.length === 1 ? candidates[0].id : null;

    // Every consumer (js/tabs/maps.js, and the route map on each standalone activity detail
    // page) reads the route back out of this encoded polyline, not the raw lat/lng stream.
    const summaryPolyline = encodePolyline(streams.latlng.data);

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
