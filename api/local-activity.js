// api/local-activity.js — Single-activity detail endpoint.
// Used directly (by URL) from js/pages/{activity,run,bike}/*.js and
// js/pages/activity/advanced-analysis.js — see LOCAL_GPX_MIGRATION_PLAN.md §6.

import { readActivitySummary, readActivityStreams, readActivityRawGpx, readGear, updateActivitySummary, deleteActivity } from './_local/store.js';
import { summarizeForSport, STATIC_BIKE_TYPE } from './_local/enrich.js';

// Highest value accepted for the static bike's gear hardness. The scale depends on the bike
// (a resistance knob, a gear number...) and isn't recorded in the GPX, so this only guards
// against typos rather than encoding a specific bike.
const MAX_GEAR_HARDNESS = 100;

// Summary fields that depend on the sport (see summarizeForSport): re-derived from the stored
// streams whenever an activity moves into or out of StaticBike, so a mis-classified Withings
// session gets the same numbers as one imported correctly.
const SPORT_DEPENDENT_FIELDS = [
    'distance', 'moving_time', 'elapsed_time', 'total_elevation_gain',
    'average_heartrate', 'max_heartrate', 'average_speed', 'max_speed',
];

// Returns { value } on success or { error } for an invalid input. null / '' clear the value.
function parseGearHardness(raw) {
    if (raw === null || raw === '') return { value: null };
    const value = Number(raw);
    if (typeof raw === 'boolean' || !Number.isFinite(value) || value < 0 || value > MAX_GEAR_HARDNESS) {
        return { error: `gear_hardness must be a number between 0 and ${MAX_GEAR_HARDNESS}, or null to clear it` };
    }
    return { value };
}

async function buildTypePatch(id, type) {
    // type/sport_type are kept identical: the app's filtering logic reads either one
    // depending on the tab (see LOCAL_GPX_MIGRATION_PLAN.md), so both must agree.
    const patch = { type, sport_type: type };

    const current = await readActivitySummary(id);
    const wasStatic = (current?.sport_type || current?.type) === STATIC_BIKE_TYPE;
    if (current && wasStatic !== (type === STATIC_BIKE_TYPE)) {
        const streams = await readActivityStreams(id);
        if (streams) {
            const stats = summarizeForSport(streams, type);
            for (const field of SPORT_DEPENDENT_FIELDS) patch[field] = stats[field];
        }
    }
    return patch;
}

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
        const hasHardness = Object.prototype.hasOwnProperty.call(req.body || {}, 'gear_hardness');
        if (!id || (!type && !hasHardness)) {
            return res.status(400).json({ error: 'id and at least one of type, gear_hardness are required' });
        }

        try {
            const patch = {};
            if (type) Object.assign(patch, await buildTypePatch(id, type));
            if (hasHardness) {
                const parsed = parseGearHardness(req.body.gear_hardness);
                if (parsed.error) {
                    return res.status(400).json({ error: parsed.error });
                }
                patch.gear_hardness = parsed.value;
            }

            const updated = await updateActivitySummary(id, patch);
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

    const { id, format } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Activity id is required' });
    }

    if (format === 'gpx') {
        try {
            const gpx = await readActivityRawGpx(id);
            if (gpx === null) {
                return res.status(404).json({ error: 'GPX file not found' });
            }
            res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
            return res.status(200).send(gpx);
        } catch (error) {
            console.error('Error in GET /api/local-activity?format=gpx:', error);
            return res.status(500).json({ error: error.message });
        }
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
