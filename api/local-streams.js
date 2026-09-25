import { readActivityStreams } from './_local/store.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Activity id is required' });
    }

    try {
        const streams = await readActivityStreams(id);
        if (!streams) {
            return res.status(404).json({ error: 'Activity not found' });
        }
        return res.status(200).json({ streams });
    } catch (error) {
        console.error('Error in /api/local-streams:', error);
        return res.status(500).json({ error: error.message });
    }
}
