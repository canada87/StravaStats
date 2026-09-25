// api/_local/enrich.js — Derive the Strava-shaped "streams" object (and summary stats) from
// raw GPX track points. Distance/speed/grade are not present in a raw GPX and Strava normally
// computes them server-side with a proprietary algorithm — this is our (simpler, ~1-3% off)
// stand-in, per LOCAL_GPX_MIGRATION_PLAN.md §4.

const EARTH_RADIUS_M = 6371000;
const MOVING_SPEED_THRESHOLD_MS = 0.5; // m/s
const SMOOTHING_WINDOW = 7; // samples, centered

function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = v => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centeredMovingAverage(values, windowSize) {
    const half = Math.floor(windowSize / 2);
    const result = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
            sum += values[j];
            count++;
        }
        result[i] = count ? sum / count : 0;
    }
    return result;
}

/**
 * Builds the Strava-streams-shaped object that VirtualGPXReconstructor expects
 * (js/analysis/virtual-gpx.js) — optional streams (heartrate/cadence/watts/temperature) are
 * only included when at least one point in the GPX actually has that data.
 */
export function enrichPoints(points) {
    const n = points.length;
    const t0 = points[0].time ?? Date.now();

    const timeOffsets = points.map(p => (p.time != null ? (p.time - t0) / 1000 : 0));
    const distance = new Array(n).fill(0);
    const instSpeed = new Array(n).fill(0);
    const instGrade = new Array(n).fill(0);

    for (let i = 1; i < n; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const segMeters = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
        distance[i] = distance[i - 1] + segMeters;

        const dt = timeOffsets[i] - timeOffsets[i - 1];
        instSpeed[i] = dt > 0 ? segMeters / dt : 0;

        const currEle = curr.ele ?? prev.ele ?? 0;
        const prevEle = prev.ele ?? curr.ele ?? 0;
        instGrade[i] = segMeters > 0 ? ((currEle - prevEle) / segMeters) * 100 : 0;
    }

    const velocitySmooth = centeredMovingAverage(instSpeed, SMOOTHING_WINDOW);
    const gradeSmooth = centeredMovingAverage(instGrade, SMOOTHING_WINDOW);
    const moving = velocitySmooth.map(v => v >= MOVING_SPEED_THRESHOLD_MS);

    const hasHr = points.some(p => Number.isFinite(p.hr));
    const hasCad = points.some(p => Number.isFinite(p.cad));
    const hasWatts = points.some(p => Number.isFinite(p.watts));
    const hasTemp = points.some(p => Number.isFinite(p.temp));

    const streams = {
        latlng: { data: points.map(p => [p.lat, p.lon]) },
        time: { data: timeOffsets },
        distance: { data: distance },
        altitude: { data: points.map(p => p.ele ?? 0) },
        velocity_smooth: { data: velocitySmooth },
        grade_smooth: { data: gradeSmooth },
        moving: { data: moving },
    };

    if (hasHr) streams.heartrate = { data: points.map(p => (Number.isFinite(p.hr) ? p.hr : null)) };
    if (hasCad) streams.cadence = { data: points.map(p => (Number.isFinite(p.cad) ? p.cad : null)) };
    if (hasWatts) streams.watts = { data: points.map(p => (Number.isFinite(p.watts) ? p.watts : null)) };
    if (hasTemp) streams.temperature = { data: points.map(p => (Number.isFinite(p.temp) ? p.temp : null)) };

    return streams;
}

/**
 * Aggregates streams into the summary fields Strava normally returns for an activity list item
 * (distance, moving_time, average_heartrate, ...). See core.js in js/shared/preprocessing for
 * how these are consumed downstream (TSS/CTL/ATL/injury-risk all read these exact field names).
 */
export function summarizeStreams(streams) {
    const distanceData = streams.distance.data;
    const n = distanceData.length;
    const totalDistance = distanceData[n - 1] || 0;
    const elapsedTime = streams.time.data[n - 1] || 0;

    let movingTime = 0;
    for (let i = 1; i < n; i++) {
        const dt = streams.time.data[i] - streams.time.data[i - 1];
        if (streams.moving.data[i]) movingTime += dt;
    }

    let elevationGain = 0;
    const altitudes = streams.altitude.data;
    for (let i = 1; i < altitudes.length; i++) {
        const diff = altitudes[i] - altitudes[i - 1];
        if (diff > 0) elevationGain += diff;
    }

    const hrSamples = (streams.heartrate?.data ?? []).filter(v => Number.isFinite(v));
    const averageHeartrate = hrSamples.length
        ? Math.round((hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length) * 10) / 10
        : null;
    const maxHeartrate = hrSamples.length ? Math.max(...hrSamples) : null;

    const speeds = streams.velocity_smooth.data;
    const averageSpeed = movingTime > 0 ? totalDistance / movingTime : 0;
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;

    return {
        distance: Math.round(totalDistance * 10) / 10,
        moving_time: Math.round(movingTime),
        elapsed_time: Math.round(elapsedTime),
        total_elevation_gain: Math.round(elevationGain * 10) / 10,
        average_heartrate: averageHeartrate,
        max_heartrate: maxHeartrate,
        average_speed: Math.round(averageSpeed * 1000) / 1000,
        max_speed: Math.round(maxSpeed * 1000) / 1000,
        start_latlng: streams.latlng.data[0] ?? null,
    };
}
