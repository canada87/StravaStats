// api/_local/multipart.js — Minimal multipart/form-data parser.
// No external dependency: GPX uploads are small, few files per request, so a hand-rolled
// parser avoids pulling in busboy/formidable for a single use case.

/**
 * @param {Buffer} buffer Raw request body.
 * @param {string} contentType The request's Content-Type header (must carry the boundary).
 * @returns {{ fields: Record<string,string>, files: Array<{fieldName:string, filename:string, contentType:string, data:Buffer}> }}
 */
export function parseMultipart(buffer, contentType) {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;
    if (!boundary) {
        throw new Error('Missing multipart boundary in Content-Type header');
    }

    const marker = Buffer.from(`--${boundary}`);
    const positions = [];
    let idx = buffer.indexOf(marker);
    while (idx !== -1) {
        positions.push(idx);
        idx = buffer.indexOf(marker, idx + marker.length);
    }

    const fields = {};
    const files = [];

    // Parts live between consecutive boundary markers; the final marker is the closing
    // "--boundary--" and has no part after it, so we stop one short.
    for (let i = 0; i < positions.length - 1; i++) {
        const partStart = positions[i] + marker.length;
        const partEnd = positions[i + 1];
        let part = buffer.subarray(partStart, partEnd);

        if (part.subarray(0, 2).toString('latin1') === '\r\n') part = part.subarray(2);
        if (part.subarray(-2).toString('latin1') === '\r\n') part = part.subarray(0, -2);

        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headerText = part.subarray(0, headerEnd).toString('utf8');
        const body = part.subarray(headerEnd + 4);

        const headers = {};
        headerText.split('\r\n').forEach(line => {
            const sep = line.indexOf(':');
            if (sep === -1) return;
            headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
        });

        const disposition = headers['content-disposition'] || '';
        const nameMatch = /name="([^"]*)"/.exec(disposition);
        const filenameMatch = /filename="([^"]*)"/.exec(disposition);
        const fieldName = nameMatch ? nameMatch[1] : null;

        if (filenameMatch) {
            if (!filenameMatch[1]) continue; // empty file input, nothing selected
            files.push({
                fieldName,
                filename: filenameMatch[1],
                contentType: headers['content-type'] || 'application/octet-stream',
                data: Buffer.from(body),
            });
        } else if (fieldName) {
            fields[fieldName] = body.toString('utf8');
        }
    }

    return { fields, files };
}
