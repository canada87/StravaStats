import { readIndex, deleteActivities } from './_local/store.js';

export default async function handler(req, res) {
    // Bulk delete: body is { ids: [...] }. Single deletes still go through DELETE /api/local-activity.
    if (req.method === 'DELETE') {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string' && id)) {
            return res.status(400).json({ error: 'ids must be a non-empty array of activity ids' });
        }

        try {
            const result = await deleteActivities(ids);
            return res.status(200).json(result);
        } catch (error) {
            console.error('Error in DELETE /api/local-activities:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET, DELETE');
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
