// api/_local/tcxParser.js — Parse a single-activity Garmin Training Center XML (.tcx) file into
// the same flat array of raw track points that gpxParser.js produces. Indoor-trainer TCX exports
// (e.g. a phone that never got a GPS fix) omit <Position> entirely on every trackpoint, so lat/lon
// come back null rather than 0 — enrich.js treats that as "no GPS fix" throughout.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    removeNSPrefix: true, // <ns3:TPX> -> TPX, <ns3:Watts> -> Watts
});

function toArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function toFiniteOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} xmlText
 * @returns {{ name: null, type: string|null, points: Array, metadataTime: number|null }}
 */
export function parseTcx(xmlText) {
    const doc = parser.parse(xmlText);
    const tcd = doc.TrainingCenterDatabase;
    if (!tcd) {
        throw new Error('TCX non valido: manca l\'elemento <TrainingCenterDatabase>');
    }

    const activity = toArray(tcd.Activities?.Activity)[0];
    if (!activity) {
        throw new Error('TCX non valido: manca l\'elemento <Activity>');
    }

    const type = typeof activity.Sport === 'string' && activity.Sport.trim() ? activity.Sport.trim() : null;
    const activityStartTime = activity.Id ? new Date(activity.Id).getTime() : null;

    const points = [];
    for (const lap of toArray(activity.Lap)) {
        for (const track of toArray(lap?.Track)) {
            for (const tp of toArray(track?.Trackpoint)) {
                const time = tp.Time ? new Date(tp.Time).getTime() : null;
                // TCX makes <Position> (and therefore lat/lon) optional per-trackpoint — that's
                // exactly the indoor-trainer case this parser exists for.
                const lat = toFiniteOrNull(tp.Position?.LatitudeDegrees);
                const lon = toFiniteOrNull(tp.Position?.LongitudeDegrees);
                const ele = toFiniteOrNull(tp.AltitudeMeters);
                const hr = toFiniteOrNull(tp.HeartRateBpm?.Value ?? tp.HeartRateBpm);
                const cad = toFiniteOrNull(tp.Cadence);

                let watts = null;
                let temp = null;
                const tpx = tp.Extensions?.TPX ?? tp.Extensions;
                if (tpx) {
                    if (watts === null) watts = toFiniteOrNull(tpx.Watts);
                    if (temp === null) temp = toFiniteOrNull(tpx.Temperature ?? tpx.atemp);
                }

                if (time === null && lat === null && hr === null) continue;

                points.push({ lat, lon, ele, time: Number.isFinite(time) ? time : null, hr, cad, watts, temp });
            }
        }
    }

    if (points.length === 0) {
        throw new Error('TCX senza punti traccia (<Trackpoint>) validi');
    }

    return { name: null, type, points, metadataTime: Number.isFinite(activityStartTime) ? activityStartTime : null };
}
