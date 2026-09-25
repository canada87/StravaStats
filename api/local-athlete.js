import { readAthlete, writeAthlete } from './_local/store.js';

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const athlete = await readAthlete();
            return res.status(200).json({ athlete });
        }

        if (req.method === 'PUT') {
            const current = await readAthlete();
            const updated = { ...current, ...(req.body || {}) };
            await writeAthlete(updated);
            return res.status(200).json({ athlete: updated });
        }

        res.setHeader('Allow', 'GET, PUT');
        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        console.error('Error in /api/local-athlete:', error);
        return res.status(500).json({ error: error.message });
    }
}
