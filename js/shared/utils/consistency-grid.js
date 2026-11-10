// js/shared/utils/consistency-grid.js
// Calendar "consistency grid" that can show several activity categories at once: each day is
// coloured by the category it was trained in and the colour gets stronger the longer the day's
// training lasted. The Run/Bike tabs use cal-heatmap (one colour scale per grid); this one is
// drawn by hand because cal-heatmap cannot give each category its own colour. Same layout as
// those grids: one block per month, a column per week, Monday on top.

export const CONSISTENCY_CATEGORIES = {
    Run: { label: 'Run', color: '#f97316' },
    Ride: { label: 'Bike', color: '#0d9488' },
    StaticBike: { label: 'Static Bike', color: '#2563eb' }
};

// Day totals (minutes) that move a cell to the next shade: ≤30', ≤45', ≤60', ≤90', ≤2h, >2h.
const LEVEL_THRESHOLDS_MIN = [30, 45, 60, 90, 120];
const LEVEL_ALPHAS = [0.25, 0.4, 0.55, 0.7, 0.85, 1];
const LEVEL_LABELS = ['≤30m', '≤45m', '≤1h', '≤1h30', '≤2h', '>2h'];
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Category key of an activity for the grid, or null when it is not one of the categories. */
export function getConsistencyCategory(activity) {
    const sportType = activity?.sport_type || activity?.type || '';
    if (sportType === 'StaticBike') return 'StaticBike';
    const type = activity?.type || '';
    if (type.includes('Run')) return 'Run';
    if (type.includes('Ride')) return 'Ride';
    return null;
}

const durationSeconds = a => a.moving_time || a.elapsed_time || 0;

function toYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function levelFor(minutes) {
    const index = LEVEL_THRESHOLDS_MIN.findIndex(limit => minutes <= limit);
    return index === -1 ? LEVEL_THRESHOLDS_MIN.length : index;
}

function formatMinutes(minutes) {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Per-day totals: { 'YYYY-MM-DD': { total: minutes, byCategory: { Run: minutes, ... } } } */
function aggregateByDay(activities, categories) {
    const days = {};
    for (const activity of activities || []) {
        const category = getConsistencyCategory(activity);
        if (!category || !categories.includes(category) || !activity.start_date_local) continue;
        const key = activity.start_date_local.substring(0, 10);
        const minutes = durationSeconds(activity) / 60;
        const day = days[key] || (days[key] = { total: 0, byCategory: {} });
        day.total += minutes;
        day.byCategory[category] = (day.byCategory[category] || 0) + minutes;
    }
    return days;
}

// A day with more than one category takes the colour of the one trained longest; its shade
// still reflects the whole day's duration, and the tooltip lists every category.
function dominantCategory(day) {
    return Object.entries(day.byCategory).sort((a, b) => b[1] - a[1])[0][0];
}

function renderLegend(categories) {
    const rows = categories.map(key => {
        const { label, color } = CONSISTENCY_CATEGORIES[key];
        const swatches = LEVEL_ALPHAS
            .map((alpha, i) => `<span class="cgrid-cell" style="background:${hexToRgba(color, alpha)}" title="${label} ${LEVEL_LABELS[i]}"></span>`)
            .join('');
        return `<div class="cgrid-legend-row"><span class="cgrid-legend-label">${label}</span>${swatches}</div>`;
    }).join('');
    return `
        <div class="cgrid-legend">
            ${rows}
            <div class="cgrid-legend-row cgrid-legend-scale">
                <span class="cgrid-legend-label"></span>
                <span>${LEVEL_LABELS[0]}</span><span class="cgrid-legend-arrow">→</span><span>${LEVEL_LABELS[LEVEL_LABELS.length - 1]}</span>
            </div>
        </div>`;
}

/**
 * Draws the grid inside `container`.
 * @param {HTMLElement} container
 * @param {Array} activities
 * @param {{ periodStart: Date, periodEnd: Date, truncated?: boolean, categories?: string[] }} options
 */
export function renderConsistencyGrid(container, activities, options) {
    if (!container) return;
    const categories = options.categories || Object.keys(CONSISTENCY_CATEGORIES);
    const periodStart = new Date(options.periodStart);
    const periodEnd = new Date(options.periodEnd);
    periodStart.setHours(0, 0, 0, 0);
    periodEnd.setHours(0, 0, 0, 0);

    const days = aggregateByDay(activities, categories);
    const todayKey = toYMD(new Date());
    const startKey = toYMD(periodStart);
    const endKey = toYMD(periodEnd);

    const months = [];
    const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    while (cursor <= periodEnd && months.length < 24) {
        months.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    const monthHtml = months.map(monthStart => {
        const year = monthStart.getFullYear();
        const month = monthStart.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const leading = (monthStart.getDay() + 6) % 7; // empty slots before the 1st (Monday first)
        const slots = [];
        for (let i = 0; i < leading; i++) slots.push(null);
        for (let d = 1; d <= daysInMonth; d++) slots.push(new Date(year, month, d));
        while (slots.length % 7) slots.push(null);

        const weeks = [];
        for (let i = 0; i < slots.length; i += 7) {
            const cells = slots.slice(i, i + 7).map(date => {
                if (!date) return '<span class="cgrid-cell cgrid-cell--blank"></span>';
                const key = toYMD(date);
                const outside = key < startKey || key > endKey;
                const day = days[key];
                const classes = ['cgrid-cell'];
                if (outside) classes.push('cgrid-cell--outside');
                if (key === todayKey) classes.push('cgrid-cell--today');
                let style = '';
                let title = key;
                if (day && !outside) {
                    const category = dominantCategory(day);
                    style = ` style="background:${hexToRgba(CONSISTENCY_CATEGORIES[category].color, LEVEL_ALPHAS[levelFor(day.total)])}"`;
                    const detail = Object.entries(day.byCategory)
                        .map(([cat, minutes]) => `${CONSISTENCY_CATEGORIES[cat].label} ${formatMinutes(minutes)}`)
                        .join(' · ');
                    title = `${key} — ${detail}`;
                }
                return `<span class="${classes.join(' ')}"${style} title="${title}"></span>`;
            }).join('');
            weeks.push(`<div class="cgrid-week">${cells}</div>`);
        }

        const label = monthStart.toLocaleString('en', { month: 'short' });
        return `<div class="cgrid-month"><div class="cgrid-month-label">${label}</div><div class="cgrid-weeks">${weeks.join('')}</div></div>`;
    }).join('');

    const weekdayColumn = `<div class="cgrid-weekdays"><div class="cgrid-month-label">&nbsp;</div>${WEEKDAY_LABELS.map(l => `<span>${l}</span>`).join('')}</div>`;
    const note = options.truncated
        ? '<p class="cgrid-note">Showing the last 12 months of the selected range.</p>'
        : '';

    container.innerHTML = `
        <div class="cgrid">
            <div class="cgrid-scroll"><div class="cgrid-body">${weekdayColumn}${monthHtml}</div></div>
            ${renderLegend(categories)}
            ${note}
        </div>`;
}
