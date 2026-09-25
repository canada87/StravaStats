import { getValidAccessToken } from './_shared.js';
import { readActivityStreams } from './_local/store.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id, type } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Activity ID is required' });
    }

    // Local mode: see the matching comment in strava-activity.js.
    if (process.env.APP_MODE === 'local') {
        try {
            const streams = await readActivityStreams(id);
            if (!streams) {
                return res.status(404).json({ error: 'Activity not found' });
            }
            return res.status(200).json({ streams });
        } catch (error) {
            console.error('Error in /api/strava-streams (local mode):', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (!type) {
        return res.status(400).json({ error: 'Activity ID and stream types are required' });
    }

    try {
        const { accessToken, updatedTokens } = await getValidAccessToken(req);

        const url = `https://www.strava.com/api/v3/activities/${encodeURIComponent(id)}/streams?keys=${encodeURIComponent(type)}&key_by_type=true`;
        const stravaResponse = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!stravaResponse.ok) {
            const errData = await stravaResponse.json();
            return res.status(stravaResponse.status).json({ error: 'Failed to fetch streams from Strava', details: errData });
        }

        const streams = await stravaResponse.json();
        return res.status(200).json({ streams, tokens: updatedTokens });

    } catch (error) {
        console.error('Error in /api/strava-streams:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
