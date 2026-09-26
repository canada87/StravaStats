// api/_local/gpxIngest.js — Orchestrates parse -> enrich -> id/dedup -> persist for one
// uploaded .gpx file. See LOCAL_GPX_MIGRATION_PLAN.md §4.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseGpx } from './gpxParser.js';
import { enrichPoints, summarizeStreams } from './enrich.js';
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
    swimming: 'Swim',
    swim: 'Swim',
    hiking: 'Hike',
    hike: 'Hike',
    walking: 'Walk',
    walk: 'Walk',
};

const GENERIC_NAME_PATTERN = /^(run|ride|cycling|swim|walk|hike|activity|workout)$/i;

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

function classifySportType(gpxType) {
    if (!gpxType) return null;
    return GPX_TYPE_TO_SPORT[String(gpxType).trim().toLowerCase()] || null;
}

// Only validated against running GPX files so far (see LOCAL_GPX_MIGRATION_PLAN.md §12) — the
// bike/swim thresholds below are a reasonable first guess, not yet exercised with real data.
function classifySportTypeFallback(averageSpeedMs) {
    const kmh = averageSpeedMs * 3.6;
    if (kmh >= 15) return 'Ride';
    return 'Run';
}

function generateActivityName(sportType, localDate) {
    const labels = { Run: 'Corsa', TrailRun: 'Corsa in sentiero', Ride: 'Uscita in bici', MountainBikeRide: 'Uscita in MTB', Swim: 'Nuotata', Hike: 'Escursione', Walk: 'Camminata' };
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

    const sportType = classifySportType(gpxType) || classifySportTypeFallback(stats.average_speed);

    const baseId = slugify(path.basename(filename, path.extname(filename))) || 'activity';
    let id = baseId;
    if (index.some(a => a.id === id)) id = `${baseId}-${contentHash}`;

    const isGenericName = !gpxName || GENERIC_NAME_PATTERN.test(gpxName);
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
        distance: stats.distance,
        moving_time: stats.moving_time,
        elapsed_time: stats.elapsed_time,
        total_elevation_gain: stats.total_elevation_gain,
        average_heartrate: stats.average_heartrate,
        max_heartrate: stats.max_heartrate,
        average_speed: stats.average_speed,
        max_speed: stats.max_speed,
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

    await saveActivity(id, { rawGpx: xmlText, summary, streams });
    await writeIndex([...index, summary]);

    return { status: 'imported', id, name: finalName };
}
