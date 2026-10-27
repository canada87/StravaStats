/**
 * STATIC-BIKE.JS - Static (indoor) bike session details page
 * Entry point: query parameter ?id={activityId}
 *
 * The GPX of a static-bike session has no distance/elevation/speed worth showing (the GPS is
 * the device sitting still), so unlike run.html/bike.html this page is only about time and
 * heart rate — plus the bike's gear hardness, which no file contains and is saved by the
 * server (gear_hardness on the activity).
 */

import { getHeartRateZones } from '../../shared/utils/index.js';
import { renderSportEditor, attachSportEditor } from '../../shared/utils/sport-editor.js';
import { attachDeleteActivityButton } from '../../shared/utils/activity-delete.js';
import { updateActivityGearHardness } from '../../services/index.js';

const activityId = new URLSearchParams(window.location.search).get('id');

// Same meaning as in the Static Bike tab (js/tabs/static-bike-analysis.js).
const MAX_SAMPLE_GAP_SECONDS = 120;
const SMOOTHING_WINDOW_SECONDS = 30;
const MAX_GEAR_HARDNESS = 100;
const ZONE_COLORS = ['#90caf9', '#66bb6a', '#fdd835', '#fb8c00', '#e53935'];

let charts = {};

// =====================================================
// HELPERS
// =====================================================

async function fetchFromApi(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API Error ${response.status}: ${await response.text()}`);
    }
    return response.json();
}

function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '-';
    const seconds = Math.round(totalSeconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function formatClock(date) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function zoneIndex(zones, hr) {
    const index = zones.findIndex(z => hr >= z.min && (z.max === -1 || hr < z.max));
    return index === -1 ? 0 : index;
}

function createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    config.options = { ...(config.options || {}), responsive: true, maintainAspectRatio: true, animation: false };
    charts[canvasId] = new Chart(canvas.getContext('2d'), config);
}

/** [{ t (s), hr }] for the samples that carry a heart rate. */
function heartRatePoints(streams) {
    const time = streams?.time?.data ?? [];
    const hr = streams?.heartrate?.data ?? [];
    const points = [];
    for (let i = 0; i < hr.length; i++) {
        if (Number.isFinite(hr[i]) && Number.isFinite(time[i])) points.push({ t: time[i], hr: hr[i] });
    }
    return points;
}

// Mean of the samples within +-window/2 seconds of each point (the samples are 1-3 s apart but
// irregular, so a fixed number of samples would smooth by a varying amount of time).
function smoothByTime(points, windowSeconds) {
    const half = windowSeconds / 2;
    const result = [];
    let lo = 0;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        while (hi < points.length && points[hi].t <= points[i].t + half) sum += points[hi++].hr;
        while (points[lo].t < points[i].t - half) sum -= points[lo++].hr;
        result.push(sum / (hi - lo));
    }
    return result;
}

// Trapezoid between consecutive samples, ignoring dropouts, as the Static Bike tab does.
function averageHr(points) {
    let weighted = 0;
    let covered = 0;
    for (let i = 1; i < points.length; i++) {
        const dt = points[i].t - points[i - 1].t;
        if (dt <= 0 || dt > MAX_SAMPLE_GAP_SECONDS) continue;
        weighted += ((points[i].hr + points[i - 1].hr) / 2) * dt;
        covered += dt;
    }
    return covered > 0 ? weighted / covered : null;
}

// =====================================================
// RENDERING
// =====================================================

function renderHero(activity) {
    const name = activity.name || 'Static Bike Session';
    document.getElementById('activity-page-title').textContent = name;
    document.title = `${name} | Static Bike`;

    const start = new Date(activity.start_date_local || activity.start_date);
    document.getElementById('activity-hero-date').textContent =
        `${start.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${formatClock(start)}`;

    const typeEl = document.getElementById('activity-hero-type');
    typeEl.textContent = activity.sport_type || activity.type || 'StaticBike';
    typeEl.insertAdjacentHTML('afterend', renderSportEditor(activity.type || activity.sport_type || 'StaticBike'));
    attachSportEditor(typeEl.parentElement, activity.id);
}

function renderSession(activity) {
    const container = document.getElementById('activity-info');
    const hardness = Number.isFinite(activity.gear_hardness) ? activity.gear_hardness : '';

    container.innerHTML = `
        <h3>Session setup</h3>
        <form id="gear-hardness-form" class="gear-hardness-form">
            <label for="gear-hardness-input"><b>Gear hardness</b></label>
            <input type="number" id="gear-hardness-input" min="0" max="${MAX_GEAR_HARDNESS}" step="1"
                inputmode="numeric" placeholder="not set" value="${hardness}">
            <button type="submit" id="gear-hardness-save">Save</button>
            <span id="gear-hardness-status" class="gear-hardness-status" role="status" aria-live="polite"></span>
        </form>
        <p class="gear-hardness-hint">The bike's resistance/gear setting for this session. The GPX doesn't record it,
            so it is saved on the server with the activity. Leave it empty to clear it.</p>
    `;

    document.getElementById('gear-hardness-form').addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('gear-hardness-input');
        const button = document.getElementById('gear-hardness-save');
        const status = document.getElementById('gear-hardness-status');
        const value = input.value.trim() === '' ? null : Number(input.value);

        button.disabled = true;
        status.className = 'gear-hardness-status';
        status.textContent = 'Saving…';
        try {
            await updateActivityGearHardness(activity.id, value);
            status.classList.add('is-saved');
            status.textContent = value === null ? 'Cleared' : 'Saved ✓';
        } catch (error) {
            status.classList.add('is-error');
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
}

function renderStats(activity, points) {
    const container = document.getElementById('activity-stats');
    const duration = activity.elapsed_time || (points.length ? points[points.length - 1].t - points[0].t : 0);
    const avg = Number.isFinite(activity.average_heartrate) ? activity.average_heartrate : averageHr(points);
    const max = Number.isFinite(activity.max_heartrate) ? activity.max_heartrate : null;

    // Cardiac drift hint: average HR of the first vs the second half of the session.
    let halves = null;
    if (points.length > 1 && duration > 0) {
        const middle = points[0].t + (points[points.length - 1].t - points[0].t) / 2;
        const first = averageHr(points.filter(p => p.t <= middle));
        const second = averageHr(points.filter(p => p.t >= middle));
        if (first !== null && second !== null) halves = `${Math.round(first)} → ${Math.round(second)} bpm`;
    }

    const fields = [
        ['Duration', formatDuration(duration)],
        ['HR Avg', avg !== null ? `${Math.round(avg)} bpm` : null],
        ['HR Max', max !== null ? `${Math.round(max)} bpm` : null],
        ['Avg HR 1st → 2nd half', halves],
        ['HR samples', points.length ? points.length.toLocaleString() : null],
    ].filter(([, value]) => value);

    container.innerHTML = `
        <h3>Stats</h3>
        <ul>${fields.map(([label, value]) => `<li><b>${label}:</b> ${value}</li>`).join('')}</ul>
    `;
}

function renderHeartRateChart(points) {
    const empty = document.getElementById('hr-time-empty');
    const canvas = document.getElementById('hr-time-chart');
    const hasData = points.length > 1;
    empty.classList.toggle('hidden', hasData);
    canvas.parentElement.classList.toggle('hidden', !hasData);
    if (!hasData) return;

    const t0 = points[0].t;
    const smooth = smoothByTime(points, SMOOTHING_WINDOW_SECONDS);

    // The first seconds are often the sensor settling (50-ish bpm) and would squash the real
    // range into the top of the chart, so the axis starts just under the 2nd percentile; the
    // few lower samples still show, entering from the bottom edge.
    const sorted = points.map(p => p.hr).sort((a, b) => a - b);
    const axisMin = Math.floor((sorted[Math.floor(sorted.length * 0.02)] - 5) / 5) * 5;

    createChart('hr-time-chart', {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Heart rate',
                    data: points.map(p => ({ x: (p.t - t0) / 60, y: p.hr })),
                    borderColor: 'rgba(229, 57, 53, 0.35)',
                    borderWidth: 1,
                    pointRadius: 0,
                },
                {
                    label: `${SMOOTHING_WINDOW_SECONDS} s average`,
                    data: points.map((p, i) => ({ x: (p.t - t0) / 60, y: round1(smooth[i]) })),
                    borderColor: '#e53935',
                    borderWidth: 2.5,
                    pointRadius: 0,
                },
            ],
        },
        options: {
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Minutes' },
                    ticks: { callback: value => Math.round(value * 10) / 10 },
                },
                y: { min: axisMin, title: { display: true, text: 'bpm' } },
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => `${items[0].parsed.x.toFixed(1)} min`,
                        label: item => `${item.dataset.label}: ${Math.round(item.parsed.y)} bpm`,
                    },
                },
            },
        },
    });
}

function renderZonesChart(points) {
    const section = document.getElementById('hr-zones-section');
    const { zones, source } = getHeartRateZones();
    const seconds = new Array(zones.length).fill(0);
    for (let i = 1; i < points.length; i++) {
        const dt = points[i].t - points[i - 1].t;
        if (dt <= 0 || dt > MAX_SAMPLE_GAP_SECONDS) continue;
        seconds[zoneIndex(zones, (points[i].hr + points[i - 1].hr) / 2)] += dt;
    }

    const total = seconds.reduce((a, b) => a + b, 0);
    section.classList.toggle('hidden', total === 0);
    if (total === 0) return;

    createChart('hr-zones-chart', {
        type: 'bar',
        data: {
            labels: zones.map((z, i) => `Z${i + 1} (${z.min}${z.max === -1 ? '+' : `-${z.max}`})`),
            datasets: [{
                label: 'Minutes',
                data: seconds.map(s => round1(s / 60)),
                backgroundColor: zones.map((_, i) => ZONE_COLORS[i % ZONE_COLORS.length]),
            }],
        },
        options: {
            plugins: {
                legend: { display: false },
                subtitle: { display: true, text: source },
                tooltip: {
                    callbacks: {
                        afterLabel: item => `${Math.round((seconds[item.dataIndex] / total) * 100)}% of the session`,
                    },
                },
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } },
        },
    });
}

// =====================================================
// MAIN
// =====================================================

async function main() {
    if (!activityId) {
        document.getElementById('activity-info').innerHTML = '<p>Error: No Activity ID provided.</p>';
        return;
    }

    try {
        const [{ activity }, { streams }] = await Promise.all([
            fetchFromApi(`/api/local-activity?id=${encodeURIComponent(activityId)}`),
            fetchFromApi(`/api/local-streams?id=${encodeURIComponent(activityId)}`),
        ]);
        const points = heartRatePoints(streams);

        attachDeleteActivityButton(document.getElementById('delete-activity-btn'), activity.id);
        renderHero(activity);
        renderSession(activity);
        renderStats(activity, points);
        renderHeartRateChart(points);
        renderZonesChart(points);
    } catch (error) {
        console.error('Failed to load static bike page:', error);
        document.getElementById('activity-info').innerHTML = `<p><strong>Error loading activity:</strong> ${error.message}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', main);
