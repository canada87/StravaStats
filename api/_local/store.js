// api/_local/store.js — Disk persistence for local (GPX-based) mode.
// Layout (see LOCAL_GPX_MIGRATION_PLAN.md §5):
//   DATA_DIR/activities/index.json
//   DATA_DIR/activities/<id>/{raw.gpx,summary.json,streams.json}
//   DATA_DIR/gear.json
//   DATA_DIR/athlete.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function getDataDir() {
    return process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.resolve(process.cwd(), 'local-data');
}

function activitiesDir() {
    return path.join(getDataDir(), 'activities');
}

function activityDir(id) {
    return path.join(activitiesDir(), id);
}

function indexPath() {
    return path.join(activitiesDir(), 'index.json');
}

function gearPath() {
    return path.join(getDataDir(), 'gear.json');
}

function athletePath() {
    return path.join(getDataDir(), 'athlete.json');
}

async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
    if (!existsSync(filePath)) return fallback;
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        console.warn(`[local-store] Failed to parse ${filePath}, using fallback:`, error.message);
        return fallback;
    }
}

async function writeJsonFile(filePath, data) {
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, JSON.stringify(data, null, 2));
    return data;
}

// --- Activities -----------------------------------------------------------

export async function readIndex() {
    return readJsonFile(indexPath(), []);
}

export async function writeIndex(list) {
    const sorted = [...list].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    await writeJsonFile(indexPath(), sorted);
    return sorted;
}

export async function saveActivity(id, { rawGpx, summary, streams }) {
    const dir = activityDir(id);
    await ensureDir(dir);
    await writeFile(path.join(dir, 'raw.gpx'), rawGpx);
    await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    await writeFile(path.join(dir, 'streams.json'), JSON.stringify(streams, null, 2));
}

export async function readActivitySummary(id) {
    return readJsonFile(path.join(activityDir(id), 'summary.json'), null);
}

export async function readActivityStreams(id) {
    return readJsonFile(path.join(activityDir(id), 'streams.json'), null);
}

export async function updateActivitySummary(id, patch) {
    const current = await readActivitySummary(id);
    if (!current) return null;

    const updated = { ...current, ...patch };
    await writeJsonFile(path.join(activityDir(id), 'summary.json'), updated);

    const index = await readIndex();
    const nextIndex = index.map(item => (item.id === id ? { ...item, ...patch } : item));
    await writeIndex(nextIndex);

    return updated;
}

// --- Gear -------------------------------------------------------------------

export async function readGear() {
    return readJsonFile(gearPath(), []);
}

export async function writeGear(list) {
    return writeJsonFile(gearPath(), list);
}

// --- Athlete profile ---------------------------------------------------------

const DEFAULT_ATHLETE = {
    firstname: 'Atleta',
    lastname: 'Locale',
    max_hr: 190,
};

export async function readAthlete() {
    return readJsonFile(athletePath(), { ...DEFAULT_ATHLETE });
}

export async function writeAthlete(data) {
    return writeJsonFile(athletePath(), data);
}
