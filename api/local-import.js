import { parseMultipart } from './_local/multipart.js';
import { ingestGpxFile } from './_local/gpxIngest.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
        return res.status(400).json({ error: 'Expected multipart/form-data with one or more .gpx files' });
    }

    const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    let files;
    try {
        ({ files } = parseMultipart(bodyBuffer, contentType));
    } catch (error) {
        return res.status(400).json({ error: `Impossibile leggere l'upload: ${error.message}` });
    }

    const gpxFiles = files.filter(f => /\.gpx$/i.test(f.filename));
    if (gpxFiles.length === 0) {
        return res.status(400).json({ error: 'Nessun file .gpx trovato nell\'upload' });
    }

    const result = { imported: [], duplicates: [], errors: [] };

    for (const file of gpxFiles) {
        try {
            const outcome = await ingestGpxFile(file.filename, file.data);
            if (outcome.status === 'duplicate') {
                result.duplicates.push({ file: file.filename, id: outcome.id, name: outcome.name });
            } else {
                result.imported.push({ file: file.filename, id: outcome.id, name: outcome.name });
            }
        } catch (error) {
            console.error(`[local-import] Failed to ingest ${file.filename}:`, error);
            result.errors.push({ file: file.filename, error: error.message });
        }
    }

    return res.status(200).json(result);
}
