// api/_local/activityCommon.js — Helpers shared by gpxIngest.js and tcxIngest.js: naming,
// timezone conversion and content-hash dedup are identical regardless of the source file format.

import { createHash } from 'node:crypto';
import { encodePolyline } from './polyline.js';

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// GPX/TCX timestamps are always UTC; the athlete's actual timezone isn't recorded anywhere in
// the file. Europe/Rome is a pragmatic default for this app's single user — open item if this
// ever needs to support athletes in other timezones (see LOCAL_GPX_MIGRATION_PLAN.md §12).
export const ASSUMED_TIMEZONE = 'Europe/Rome';

export function toLocalParts(utcDate, timeZone = ASSUMED_TIMEZONE) {
    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return dtf.formatToParts(utcDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
}

export function toLocalIsoString(utcDate) {
    const p = toLocalParts(utcDate);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function generateActivityName(sportType, localDate) {
    const labels = { Run: 'Corsa', TrailRun: 'Corsa in sentiero', Ride: 'Uscita in bici', StaticBike: 'Bici statica', MountainBikeRide: 'Uscita in MTB', Hike: 'Escursione', Walk: 'Camminata' };
    const label = labels[sportType] || 'Attività';
    const p = toLocalParts(localDate);
    return `${label} - ${p.day} ${MONTHS_IT[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

export function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function computeContentHash(startDateIso, pointCount, totalDistanceMeters) {
    return createHash('sha1')
        .update(`${startDateIso}|${pointCount}|${Math.round(totalDistanceMeters)}`)
        .digest('hex')
        .slice(0, 12);
}

// Only validated against running GPX files so far (see LOCAL_GPX_MIGRATION_PLAN.md §12) — the
// bike thresholds below are a reasonable first guess, not yet exercised with real data.
export function classifySportTypeFallback(averageSpeedMs) {
    const kmh = averageSpeedMs * 3.6;
    if (kmh >= 15) return 'Ride';
    return 'Run';
}

// Every consumer (js/tabs/maps.js, and the route map on each standalone activity detail page)
// reads the route back out of this encoded polyline, not the raw lat/lng stream. A GPS-less
// session (indoor-trainer TCX) has no valid [lat, lon] pairs at all, so this returns '' rather
// than encoding garbage points.
export function encodeSummaryPolyline(latlngData) {
    const valid = latlngData.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    return valid.length ? encodePolyline(valid) : '';
}
