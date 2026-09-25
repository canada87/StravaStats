import { getValidAccessToken, validateEnv } from './_shared.js';
import { readActivitySummary, readGear } from './_local/store.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Activity ID is required' });
    }

    // Local mode: run/bike/swim/activity pages all call this endpoint directly (bypassing
    // js/services/api.js), so it doubles as the local-mode activity-detail endpoint instead of
    // requiring every page to special-case the data source. See LOCAL_GPX_MIGRATION_PLAN.md §6.
    if (process.env.APP_MODE === 'local') {
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
            console.error('Error in /api/strava-activity (local mode):', error);
            return res.status(500).json({ error: error.message });
        }
    }

    try {
        validateEnv();
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }

    try {
        const { accessToken, updatedTokens } = await getValidAccessToken(req);

        const stravaResponse = await fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(id)}?include_all_efforts=true`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!stravaResponse.ok) {
            const errData = await stravaResponse.json();
            return res.status(stravaResponse.status).json({ error: 'Failed to fetch activity from Strava', details: errData });
        }

        const activity = await stravaResponse.json();
        return res.status(200).json({ activity, tokens: updatedTokens });

    } catch (error) {
        console.error('Error in /api/strava-activity:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
