// js/tabs/static-bike-analysis.js
// Static (indoor) bike tab. The GPX files for these sessions come from a device that only
// records time and heart rate (the GPS "track" is the device sitting still), so unlike the
// Run/Bike tabs this one is about duration and HR — plus the bike's gear hardness for the
// session, which no file contains and is therefore typed in here and stored by the server
// (see PUT /api/local-activity, `gear_hardness`).
import * as utils from './utils.js';
import { updateActivityGearHardness } from '../services/index.js';

const STATIC_BIKE_TYPE = 'StaticBike';

// Some sessions only have a few seconds of data (the device logged the start and then
// stopped). They still count as sessions, but a 15-second "workout" says nothing about time or
// heart rate, so it is kept out of those stats.
const MIN_USABLE_SECONDS = 60;

const COLOR_TIME = 'rgba(21, 101, 192, 0.75)';
const COLOR_HR = '#e53935';
const COLOR_HR_MAX = '#ff9800';
const COLOR_HARDNESS = '#6a1b9a';
const ZONE_COLORS = ['#90caf9', '#66bb6a', '#fdd835', '#fb8c00', '#e53935'];

let charts = {};
let state = { sessions: [] };

/** True for the activities this tab analyses. */
export function isStaticBikeActivity(activity) {
    return (activity.sport_type || activity.type) === STATIC_BIKE_TYPE;
}

const duration = a => a.elapsed_time || 0;
const isUsable = a => duration(a) >= MIN_USABLE_SECONDS;
const hasHr = a => isUsable(a) && Number.isFinite(a.average_heartrate);
const hardnessOf = a => (Number.isFinite(a.gear_hardness) ? a.gear_hardness : null);
const round1 = value => Math.round(value * 10) / 10;

// ------------------------
// MAIN ENTRY
// ------------------------

export function renderStaticBikeTab(allActivities, dateFilterFrom, dateFilterTo) {
    const sessions = utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo)
        .filter(isStaticBikeActivity)
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    state = { sessions };

    const content = document.getElementById('static-bike-content');
    const empty = document.getElementById('static-bike-empty');
    if (!content || !empty) return;

    content.classList.toggle('hidden', sessions.length === 0);
    empty.classList.toggle('hidden', sessions.length > 0);
    if (!sessions.length) {
        destroyCharts();
        return;
    }

    renderDataQualityNote(sessions);
    renderStats(sessions);
    renderSessionsTable(sessions);
}

// Everything that depends on the numbers (and so must refresh when a gear hardness is saved).
// The table is deliberately not part of this: re-rendering it would steal focus from the input
// being edited.
function renderStats(sessions) {
    renderSummaryCards(sessions);
    renderWeeklyChart(sessions);
    renderDurationChart(sessions);
    renderHeartRateChart(sessions);
    renderDurationHistogram(sessions);
    renderZoneChart(sessions);
    renderHardnessChart(sessions);
}

// ------------------------
// HELPERS
// ------------------------

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDuration(sec) {
    if (!sec) return '–';
    if (sec < 60) return `${Math.round(sec)} s`;
    const totalMin = Math.round(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} min`;
}

function formatHr(value) {
    return Number.isFinite(value) ? `${Math.round(value)} bpm` : '–';
}

// Duration-weighted mean, so a 3-minute fragment doesn't count as much as a 40-minute ride.
function weightedAverageHr(sessions) {
    let sum = 0;
    let weight = 0;
    for (const a of sessions) {
        sum += a.average_heartrate * duration(a);
        weight += duration(a);
    }
    return weight > 0 ? sum / weight : null;
}

function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalDate(isoDateLike) {
    const [y, m, d] = String(isoDateLike).substring(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function mondayOf(date) {
    const monday = new Date(date);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function sessionDateLabel(a) {
    return a.start_date_local ? a.start_date_local.substring(0, 10) : '–';
}

function destroyCharts() {
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
}

function createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    if (charts[canvasId]) charts[canvasId].destroy();

    config.options = { ...(config.options || {}), responsive: true, maintainAspectRatio: true };
    charts[canvasId] = new Chart(canvas.getContext('2d'), config);
    return charts[canvasId];
}

// Charts with nothing to plot swap the canvas for a short explanation instead of an empty box.
function setChartAvailable(canvasId, available, message) {
    const canvas = document.getElementById(canvasId);
    const note = document.getElementById(`${canvasId}-empty`);
    if (canvas) canvas.classList.toggle('hidden', !available);
    if (note) {
        note.classList.toggle('hidden', available);
        if (message) note.textContent = message;
    }
    if (!available && charts[canvasId]) {
        charts[canvasId].destroy();
        delete charts[canvasId];
    }
    return available;
}

// ------------------------
// DATA QUALITY NOTE
// ------------------------

function renderDataQualityNote(sessions) {
    const el = document.getElementById('static-bike-data-note');
    if (!el) return;

    const unusable = sessions.filter(a => !isUsable(a)).length;
    if (!unusable) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    el.innerHTML = `
        <strong>${unusable} of ${sessions.length} sessions</strong> have less than
        ${MIN_USABLE_SECONDS} s of recorded data (the device logged little more than the start
        time), so they are counted as sessions but left out of the time and heart-rate stats.
    `;
}

// ------------------------
// SUMMARY CARDS
// ------------------------

function renderSummaryCards(sessions) {
    const el = document.getElementById('static-bike-summary-cards');
    if (!el) return;

    const usable = sessions.filter(isUsable);
    const totalTime = usable.reduce((s, a) => s + duration(a), 0);
    const longest = usable.reduce((m, a) => Math.max(m, duration(a)), 0);
    const withHr = usable.filter(hasHr);
    const avgHr = weightedAverageHr(withHr);
    const maxHr = withHr.reduce((m, a) => Math.max(m, a.max_heartrate || 0), 0);

    const card = (title, value, sub = '') => `
        <div class="card">
            <h3>${title}</h3>
            <p>${value}</p>
            ${sub ? `<small class="static-bike-card-sub">${sub}</small>` : ''}
        </div>`;

    el.innerHTML = [
        card('Sessions', sessions.length, `${usable.length} with time data`),
        card('Total Time', formatDuration(totalTime)),
        card('Avg Session', usable.length ? formatDuration(totalTime / usable.length) : '–'),
        card('Longest', formatDuration(longest)),
        card('Avg HR', formatHr(avgHr), `${withHr.length} sessions with HR`),
        card('Max HR', maxHr ? formatHr(maxHr) : '–'),
    ].join('');
}

// ------------------------
// CHARTS
// ------------------------

function renderWeeklyChart(sessions) {
    const canvasId = 'static-bike-weekly-chart';
    const weeks = new Map(); // monday key -> { minutes, count }
    for (const a of sessions) {
        if (!a.start_date_local) continue;
        const key = localDateKey(mondayOf(parseLocalDate(a.start_date_local)));
        const week = weeks.get(key) || { minutes: 0, count: 0 };
        week.count += 1;
        if (isUsable(a)) week.minutes += duration(a) / 60;
        weeks.set(key, week);
    }
    if (!setChartAvailable(canvasId, weeks.size > 0)) return;

    // Fill the weeks without any session so gaps in the routine are visible.
    const keys = [...weeks.keys()].sort();
    const labels = [];
    const minutes = [];
    const counts = [];
    for (let d = parseLocalDate(keys[0]); d <= parseLocalDate(keys[keys.length - 1]); d.setDate(d.getDate() + 7)) {
        const key = localDateKey(d);
        const week = weeks.get(key);
        labels.push(key);
        minutes.push(week ? round1(week.minutes) : 0);
        counts.push(week ? week.count : 0);
    }

    createChart(canvasId, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Minutes', data: minutes, backgroundColor: COLOR_TIME, yAxisID: 'y', order: 2 },
                {
                    type: 'line', label: 'Sessions', data: counts, borderColor: COLOR_HARDNESS,
                    backgroundColor: COLOR_HARDNESS, yAxisID: 'y1', tension: 0.2, order: 1,
                },
            ],
        },
        options: {
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
                y1: {
                    position: 'right', beginAtZero: true, grid: { drawOnChartArea: false },
                    ticks: { stepSize: 1, precision: 0 }, title: { display: true, text: 'Sessions' },
                },
            },
        },
    });
}

function renderDurationChart(sessions) {
    const canvasId = 'static-bike-duration-chart';
    const usable = sessions.filter(isUsable);
    if (!setChartAvailable(canvasId, usable.length > 0, 'No session has enough recorded time yet.')) return;

    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: usable.map(sessionDateLabel),
            datasets: [{
                label: 'Minutes',
                data: usable.map(a => round1(duration(a) / 60)),
                backgroundColor: COLOR_TIME,
            }],
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } },
        },
    });
}

function renderHeartRateChart(sessions) {
    const canvasId = 'static-bike-hr-chart';
    const withHr = sessions.filter(hasHr);
    if (!setChartAvailable(canvasId, withHr.length > 0, 'No session has heart-rate data yet.')) return;

    createChart(canvasId, {
        type: 'line',
        data: {
            labels: withHr.map(sessionDateLabel),
            datasets: [
                {
                    label: 'Avg HR', data: withHr.map(a => Math.round(a.average_heartrate)),
                    borderColor: COLOR_HR, backgroundColor: COLOR_HR, tension: 0.2,
                },
                {
                    label: 'Max HR', data: withHr.map(a => a.max_heartrate ?? null),
                    borderColor: COLOR_HR_MAX, backgroundColor: COLOR_HR_MAX, borderDash: [5, 4], tension: 0.2,
                },
            ],
        },
        options: { scales: { y: { title: { display: true, text: 'bpm' } } } },
    });
}

function renderDurationHistogram(sessions) {
    const canvasId = 'static-bike-duration-histogram';
    const usable = sessions.filter(isUsable);
    if (!setChartAvailable(canvasId, usable.length > 0, 'No session has enough recorded time yet.')) return;

    const binMinutes = 5;
    const maxMinutes = Math.max(...usable.map(a => duration(a) / 60));
    const bins = new Array(Math.floor(maxMinutes / binMinutes) + 1).fill(0);
    usable.forEach(a => { bins[Math.floor(duration(a) / 60 / binMinutes)] += 1; });

    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: bins.map((_, i) => `${i * binMinutes}-${(i + 1) * binMinutes}`),
            datasets: [{ label: '# sessions', data: bins, backgroundColor: COLOR_TIME }],
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Minutes' } },
                y: { beginAtZero: true, ticks: { precision: 0 } },
            },
        },
    });
}

// Time per HR zone, assigning each whole session to the zone of its average HR (the file only
// has a handful of HR samples per session, so a finer split would be false precision).
function renderZoneChart(sessions) {
    const canvasId = 'static-bike-zone-chart';
    const withHr = sessions.filter(hasHr);
    if (!setChartAvailable(canvasId, withHr.length > 0, 'No session has heart-rate data yet.')) return;

    const { zones, source } = utils.getHeartRateZones();
    const minutes = new Array(zones.length).fill(0);
    for (const a of withHr) {
        let zone = zones.findIndex(z => a.average_heartrate >= z.min && (z.max === -1 || a.average_heartrate < z.max));
        if (zone === -1) zone = 0;
        minutes[zone] += duration(a) / 60;
    }

    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: zones.map((z, i) => `Z${i + 1} (${z.min}${z.max === -1 ? '+' : `-${z.max}`})`),
            datasets: [{
                label: 'Minutes',
                data: minutes.map(round1),
                backgroundColor: zones.map((_, i) => ZONE_COLORS[i % ZONE_COLORS.length]),
            }],
        },
        options: {
            plugins: {
                legend: { display: false },
                subtitle: { display: true, text: `By session average HR · ${source}` },
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } },
        },
    });
}

function renderHardnessChart(sessions) {
    const canvasId = 'static-bike-hardness-chart';
    const withHardness = sessions.filter(a => isUsable(a) && hardnessOf(a) !== null);
    if (!setChartAvailable(canvasId, withHardness.length > 0,
        'Set the gear hardness of a session in the table below to compare time and heart rate across settings.')) return;

    const levels = new Map(); // hardness -> sessions
    for (const a of withHardness) {
        const level = hardnessOf(a);
        if (!levels.has(level)) levels.set(level, []);
        levels.get(level).push(a);
    }
    const sorted = [...levels.keys()].sort((a, b) => a - b);

    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: sorted.map(level => String(level)),
            datasets: [
                {
                    type: 'bar', label: 'Total minutes', yAxisID: 'y', backgroundColor: COLOR_TIME,
                    data: sorted.map(level => round1(levels.get(level).reduce((s, a) => s + duration(a), 0) / 60)),
                },
                {
                    type: 'line', label: 'Avg HR', yAxisID: 'y1', borderColor: COLOR_HR, backgroundColor: COLOR_HR,
                    spanGaps: true,
                    data: sorted.map(level => {
                        const avg = weightedAverageHr(levels.get(level).filter(hasHr));
                        return avg === null ? null : Math.round(avg);
                    }),
                },
            ],
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        afterBody: items => {
                            const n = levels.get(sorted[items[0].dataIndex]).length;
                            return `${n} session${n === 1 ? '' : 's'}`;
                        },
                    },
                },
            },
            scales: {
                x: { title: { display: true, text: 'Gear hardness' } },
                y: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'bpm' } },
            },
        },
    });
}

// ------------------------
// SESSIONS TABLE
// ------------------------

const TH_STYLE = 'padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);';

function renderSessionsTable(sessions) {
    const el = document.getElementById('static-bike-table');
    if (!el) return;

    const rows = [...sessions].reverse().map(a => {
        const name = escapeHTML(a.name || 'Untitled');
        const link = a.id
            ? `<a href="html/activity-router.html?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">${name}</a>`
            : name;
        const hardness = hardnessOf(a);
        const usable = isUsable(a);

        return `
            <tr${usable ? '' : ' class="static-bike-row-unusable" title="Not enough recorded data for time/heart-rate stats"'}>
                <td>${sessionDateLabel(a)}</td>
                <td>${link}</td>
                <td data-value="${duration(a)}">${formatDuration(duration(a))}</td>
                <td data-value="${a.average_heartrate ?? 0}">${formatHr(a.average_heartrate)}</td>
                <td data-value="${a.max_heartrate ?? 0}">${formatHr(a.max_heartrate)}</td>
                <td data-value="${hardness ?? -1}">
                    <input type="number" class="static-bike-hardness-input" min="0" max="100" step="1"
                        inputmode="numeric" placeholder="–" aria-label="Gear hardness for ${name}"
                        data-activity-id="${escapeHTML(a.id)}" value="${hardness ?? ''}">
                    <span class="static-bike-hardness-status" aria-live="polite"></span>
                </td>
            </tr>`;
    }).join('');

    el.innerHTML = `
        <table id="static-bike-all-table" class="static-bike-table">
            <thead>
                <tr>
                    <th data-sort="date" style="${TH_STYLE}">Date</th>
                    <th style="${TH_STYLE}">Activity</th>
                    <th data-sort="num" style="${TH_STYLE}">Duration</th>
                    <th data-sort="num" style="${TH_STYLE}">Avg HR</th>
                    <th data-sort="num" style="${TH_STYLE}">Max HR</th>
                    <th data-sort="num" style="${TH_STYLE}">Gear hardness</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;

    makeSortable(document.getElementById('static-bike-all-table'));
    bindHardnessEditing(el);
}

function bindHardnessEditing(container) {
    // The container survives re-renders, so bind once (state.sessions is looked up at event time).
    if (container.dataset.bound === 'true') return;
    container.dataset.bound = 'true';

    container.addEventListener('change', async event => {
        const input = event.target.closest?.('.static-bike-hardness-input');
        if (!input) return;

        const activity = state.sessions.find(a => a.id === input.dataset.activityId);
        if (!activity) return;

        const status = input.parentElement.querySelector('.static-bike-hardness-status');
        const previous = hardnessOf(activity);
        const next = input.value.trim() === '' ? null : Number(input.value);

        input.disabled = true;
        status.textContent = '…';
        status.className = 'static-bike-hardness-status';
        try {
            await updateActivityGearHardness(activity.id, next);
            // The same object lives in main.js's activity list, so the change is visible to the
            // other tabs and to later re-renders without refetching.
            activity.gear_hardness = next;
            input.parentElement.dataset.value = next ?? -1;
            status.textContent = '✓';
            status.classList.add('is-saved');
            renderStats(state.sessions);
        } catch (error) {
            input.value = previous ?? '';
            status.textContent = error.message;
            status.classList.add('is-error');
        } finally {
            input.disabled = false;
        }
    });
}

function makeSortable(table) {
    if (!table) return;
    const headers = table.querySelectorAll('thead th[data-sort]');
    headers.forEach(th => {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
            headers.forEach(h => { h.dataset.dir = ''; h.classList.remove('sort-asc', 'sort-desc'); });
            th.dataset.dir = dir;
            th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');

            const col = Array.from(th.parentElement.children).indexOf(th);
            const valueOf = row => {
                const cell = row.children[col];
                return th.dataset.sort === 'date'
                    ? new Date(cell.textContent.trim()).getTime() || 0
                    : parseFloat(cell.dataset.value ?? cell.textContent) || 0;
            };
            rows.sort((a, b) => (dir === 'asc' ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)));
            rows.forEach(r => tbody.appendChild(r));
        });
    });
}
