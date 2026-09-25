// api/local-activity.js — Single-activity detail endpoint.
// Used directly (by URL) from js/pages/{activity,run,bike,swim}/*.js and
// js/pages/activity/advanced-analysis.js — see LOCAL_GPX_MIGRATION_PLAN.md §6.

import { readActivitySummary, readGear } from './_local/store.js';

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
