import { readIndex } from './_local/store.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const activities = await readIndex();
        return res.status(200).json({ activities });
    } catch (error) {
        console.error('Error in /api/local-activities:', error);
        return res.status(500).json({ error: error.message });
    }
}
