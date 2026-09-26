// api/local-gear.js — CRUD for the native gear registry (LOCAL_GPX_MIGRATION_PLAN.md §7).
// DELETE retires a gear (retired: true) instead of removing it, so distance history for past
// activities that reference it stays correct. DELETE with ?hard=true actually removes it from
// the registry (for gear added by mistake) and clears gear_id on any activity that referenced it.

import { readGear, writeGear, readIndex, writeIndex } from './_local/store.js';

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function handleBulkAssign(req, res) {
    const { gearId, dateFrom, dateTo } = req.body || {};
    if (!gearId) {
        return res.status(400).json({ error: 'gearId is required' });
    }

    const index = await readIndex();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;

    let updated = 0;
    const nextIndex = index.map(activity => {
        const activityDate = new Date(activity.start_date);
        const inRange = (!from || activityDate >= from) && (!to || activityDate <= to);
        if (!inRange) return activity;
        updated++;
        return { ...activity, gear_id: gearId };
    });

    await writeIndex(nextIndex);
    return res.status(200).json({ updated });
}

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const gear = await readGear();
            return res.status(200).json({ gear });
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            if (body.action === 'bulk-assign') {
                return handleBulkAssign(req, res);
            }

            const gearList = await readGear();
            const idBase = slugify(body.id || `${body.type || 'gear'}-${body.brand_name || ''}-${body.model_name || ''}`) || `gear-${Date.now()}`;
            let id = idBase;
            if (gearList.some(g => g.id === id)) id = `${idBase}-${Date.now().toString(36)}`;

            const newGear = {
                id,
                type: body.type || 'unknown',
                brand_name: body.brand_name || '',
                model_name: body.model_name || '',
                name: body.name || [body.brand_name, body.model_name].filter(Boolean).join(' ') || id,
                retired: false,
                purchase_date: body.purchase_date || null,
                initial_distance_km: Number(body.initial_distance_km) || 0,
                notes: body.notes || '',
                default_for_sport: Array.isArray(body.default_for_sport) ? body.default_for_sport : [],
            };

            await writeGear([...gearList, newGear]);
            return res.status(201).json({ gear: newGear });
        }

        if (req.method === 'PUT') {
            const body = req.body || {};
            if (!body.id) {
                return res.status(400).json({ error: 'id is required' });
            }

            const gearList = await readGear();
            const idx = gearList.findIndex(g => g.id === body.id);
            if (idx === -1) {
                return res.status(404).json({ error: 'Gear not found' });
            }

            const updated = { ...gearList[idx], ...body };
            const nextGear = [...gearList];
            nextGear[idx] = updated;
            await writeGear(nextGear);
            return res.status(200).json({ gear: updated });
        }

        if (req.method === 'DELETE') {
            const { id, hard } = req.query;
            if (!id) {
                return res.status(400).json({ error: 'id is required' });
            }

            const gearList = await readGear();
            const idx = gearList.findIndex(g => g.id === id);
            if (idx === -1) {
                return res.status(404).json({ error: 'Gear not found' });
            }

            if (hard === 'true') {
                const nextGear = gearList.filter(g => g.id !== id);
                await writeGear(nextGear);

                const index = await readIndex();
                const nextIndex = index.map(activity => (
                    activity.gear_id === id ? { ...activity, gear_id: null } : activity
                ));
                await writeIndex(nextIndex);

                return res.status(200).json({ deleted: true });
            }

            const updated = { ...gearList[idx], retired: true };
            const nextGear = [...gearList];
            nextGear[idx] = updated;
            await writeGear(nextGear);
            return res.status(200).json({ gear: updated });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        console.error('Error in /api/local-gear:', error);
        return res.status(500).json({ error: error.message });
    }
}
