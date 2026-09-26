// api/local-activity.js — Single-activity detail endpoint.
// Used directly (by URL) from js/pages/{activity,run,bike,swim}/*.js and
// js/pages/activity/advanced-analysis.js — see LOCAL_GPX_MIGRATION_PLAN.md §6.

import { readActivitySummary, readGear, updateActivitySummary, deleteActivity } from './_local/store.js';

export default async function handler(req, res) {
    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ error: 'Activity id is required' });
        }

        try {
            const deleted = await deleteActivity(id);
            if (!deleted) {
                return res.status(404).json({ error: 'Activity not found' });
            }
            return res.status(200).json({ deleted: true });
        } catch (error) {
            console.error('Error in DELETE /api/local-activity:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PUT') {
        const { id, type } = req.body || {};
        if (!id || !type) {
            return res.status(400).json({ error: 'id and type are required' });
        }

        try {
            // type/sport_type are kept identical: the app's filtering logic reads either one
            // depending on the tab (see LOCAL_GPX_MIGRATION_PLAN.md), so both must agree.
            const updated = await updateActivitySummary(id, { type, sport_type: type });
            if (!updated) {
                return res.status(404).json({ error: 'Activity not found' });
            }
            return res.status(200).json({ activity: updated });
        } catch (error) {
            console.error('Error in PUT /api/local-activity:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET, PUT, DELETE');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Activity id is required' });
    }

    try {
        const summary = await readActivitySummary(id);
        if (!summary) {
            return res.status(404).json({ error: 'Activity not found' });
        }

        let gear = null;
        if (summary.gear_id) {
            const gearList = await readGear();
            gear = gearList.find(g => g.id === summary.gear_id) || null;
        }

        return res.status(200).json({ activity: { ...summary, gear } });
    } catch (error) {
        console.error('Error in /api/local-activity:', error);
        return res.status(500).json({ error: error.message });
    }
}
