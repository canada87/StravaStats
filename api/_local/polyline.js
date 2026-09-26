// api/_local/polyline.js — Google encoded polyline algorithm (same format Strava uses for
// activity.map.summary_polyline). js/tabs/maps.js and every standalone activity detail page
// (js/pages/{run,bike,swim,activity}/*.js) decode this client-side to draw the route/heatmap —
// see decodePolyline() in those files, which this is the exact inverse of.

function encodeSignedNumber(num) {
    let sgn_num = num << 1;
    if (num < 0) sgn_num = ~sgn_num;
    return encodeNumber(sgn_num);
}

function encodeNumber(num) {
    let output = '';
    while (num >= 0x20) {
        output += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
        num >>= 5;
    }
    output += String.fromCharCode(num + 63);
    return output;
}

/**
 * @param {Array<[number, number]>} points [lat, lon] pairs, e.g. streams.latlng.data.
 * @returns {string}
 */
export function encodePolyline(points) {
    let output = '';
    let prevLat = 0;
    let prevLng = 0;

    for (const point of points) {
        const lat = Math.round(point[0] * 1e5);
        const lng = Math.round(point[1] * 1e5);
        output += encodeSignedNumber(lat - prevLat);
        output += encodeSignedNumber(lng - prevLng);
        prevLat = lat;
        prevLng = lng;
    }

    return output;
}
