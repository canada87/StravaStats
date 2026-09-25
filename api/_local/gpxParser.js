// api/_local/gpxParser.js — Parse a single-activity GPX file (Strava/Garmin/Wahoo export)
// into a flat array of raw track points. Tolerant of missing extensions (cadence/power/temp)
// per LOCAL_GPX_MIGRATION_PLAN.md §1/§4.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    removeNSPrefix: true, // <gpxtpx:hr> -> hr, <gpxtpx:TrackPointExtension> -> TrackPointExtension
});

function toArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * @param {string} xmlText
 * @returns {{ name: string|null, type: string|null, points: Array, metadataTime: number|null }}
 */
export function parseGpx(xmlText) {
    const doc = parser.parse(xmlText);
    const gpx = doc.gpx;
    if (!gpx) {
        throw new Error('GPX non valido: manca l\'elemento <gpx>');
    }

    const trk = toArray(gpx.trk)[0];
    if (!trk) {
        throw new Error('GPX non valido: manca l\'elemento <trk>');
    }

    const name = typeof trk.name === 'string' && trk.name.trim() ? trk.name.trim() : null;
    const type = typeof trk.type === 'string' && trk.type.trim() ? trk.type.trim() : null;

    const points = [];
    for (const seg of toArray(trk.trkseg)) {
        for (const pt of toArray(seg?.trkpt)) {
            const lat = Number(pt?.lat);
            const lon = Number(pt?.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const ele = pt.ele !== undefined && pt.ele !== null && pt.ele !== '' ? Number(pt.ele) : null;
            const time = pt.time ? new Date(pt.time).getTime() : null;

            let hr = null;
            let cad = null;
            let watts = null;
            let temp = null;

            const ext = pt.extensions?.TrackPointExtension ?? pt.extensions;
            if (ext) {
                if (ext.hr !== undefined) hr = Number(ext.hr);
                if (ext.cad !== undefined) cad = Number(ext.cad);
                if (ext.power !== undefined) watts = Number(ext.power);
                if (ext.atemp !== undefined) temp = Number(ext.atemp);
            }

            points.push({
                lat,
                lon,
                ele: Number.isFinite(ele) ? ele : null,
                time: Number.isFinite(time) ? time : null,
                hr: Number.isFinite(hr) ? hr : null,
                cad: Number.isFinite(cad) ? cad : null,
                watts: Number.isFinite(watts) ? watts : null,
                temp: Number.isFinite(temp) ? temp : null,
            });
        }
    }

    if (points.length === 0) {
        throw new Error('GPX senza punti traccia (<trkpt>) validi');
    }

    const metadataTime = gpx.metadata?.time ? new Date(gpx.metadata.time).getTime() : null;

    return { name, type, points, metadataTime };
}
