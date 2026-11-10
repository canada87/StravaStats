import * as utils from './utils.js';

let selectedRangeDays = 'alltime'; // 'alltime' | 'year:YYYY' | 'custom'
let customDateFromIso = null;
let customDateToIso = null;
const dashboardMemo = new Map();
let lastActivitiesRef = null;
let volumeUnit = 'km'; // unit for the volume chart: 'km', 'activities', or 'hours'
let dashboardRenderContext = {
    allActivities: [],
    dateFilterFrom: null,
    dateFilterTo: null
};

function toLocalYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value, endOfDay = false) {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function getSelectedYear() {
    const match = /^year:(\d{4})$/.exec(selectedRangeDays);
    return match ? Number(match[1]) : null;
}

function getAvailableYears(activities) {
    const years = new Set();
    (activities || []).forEach(activity => {
        const year = Number(String(activity?.start_date_local || '').slice(0, 4));
        if (Number.isFinite(year) && year > 0) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
}

function getEarliestActivityDate(activities, fallback) {
    let earliest = null;
    (activities || []).forEach(activity => {
        if (!activity?.start_date_local) return;
        const date = new Date(activity.start_date_local);
        if (!isNaN(date) && (!earliest || date < earliest)) earliest = date;
    });
    const start = new Date(earliest || fallback);
    start.setHours(0, 0, 0, 0);
    return start;
}

function getEffectiveDashboardWindow(dateFilterFrom, dateFilterTo) {
    const now = new Date();
    if (selectedRangeDays === 'custom' && customDateFromIso && customDateToIso) {
        const customStart = parseDateInput(customDateFromIso);
        const customEnd = parseDateInput(customDateToIso, true);
        if (customStart && customEnd) {
            return { startDate: customStart, endDate: customEnd };
        }
    }

    const year = getSelectedYear();
    let effectiveStart;
    let effectiveEnd = new Date(now);
    if (year) {
        effectiveStart = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
        if (endOfYear < effectiveEnd) effectiveEnd = endOfYear;
    } else {
        effectiveStart = getEarliestActivityDate(dashboardRenderContext.allActivities, now);
    }

    const minDate = parseDateInput(dateFilterFrom);
    const maxDate = parseDateInput(dateFilterTo, true);

    if (minDate && minDate > effectiveStart) {
        effectiveStart = minDate;
    }

    if (maxDate && maxDate < effectiveEnd) {
        effectiveEnd = maxDate;
    }

    if (effectiveStart > effectiveEnd) {
        effectiveStart = new Date(effectiveEnd);
        effectiveStart.setHours(0, 0, 0, 0);
    }

    return { startDate: effectiveStart, endDate: effectiveEnd };
}

/**
 * Period the selected window is compared against: the same span of the previous year when
 * a year is selected (so a partial current year is not compared to a full one), otherwise
 * the window of equal length immediately before it.
 */
function getPreviousWindow(startDate, endDate) {
    if (getSelectedYear()) {
        const previousStart = new Date(startDate);
        previousStart.setFullYear(previousStart.getFullYear() - 1);
        const previousEnd = new Date(endDate);
        previousEnd.setFullYear(previousEnd.getFullYear() - 1);
        return { previousStartDate: previousStart, previousEndDate: previousEnd };
    }
    const windowMs = Math.max(24 * 3600 * 1000, endDate.getTime() - startDate.getTime());
    return {
        previousStartDate: new Date(startDate.getTime() - windowMs),
        previousEndDate: new Date(startDate.getTime() - 1)
    };
}

// Sport buckets used by the dashboard widgets, with their display label and colour.
const SPORT_LABELS = { Run: 'Run', Ride: 'Ride', StaticBike: 'Static Bike', Gym: 'Gym' };
const VOLUME_SPORTS = ['Run', 'Ride', 'StaticBike', 'Gym'];
const VOLUME_SPORT_COLORS = {
    Run: '#ff7f50',
    Ride: '#20b2aa',
    StaticBike: '#2563eb',
    Gym: '#9370db',
    Other: '#95a5a6'
};

/** Sport bucket of an activity. StaticBike is checked first: it is neither a Run nor a Ride. */
function activitySportKey(activity) {
    if ((activity?.sport_type || activity?.type) === 'StaticBike') return 'StaticBike';
    return getSportKey(activity?.type || '');
}

function getSportKey(type = '') {
    if (type === 'StaticBike') return 'StaticBike';
    if (type.includes('Run')) return 'Run';
    if (type.includes('Ride')) return 'Ride';
    if (type.includes('WeightTraining') || type.includes('Workout')) return 'Gym';
    return 'Other';
}

function renderDashboardTopline(recentActivities) {
    const container = document.getElementById('dashboard-topline');
    if (!container) return;

    const totalDistanceKm = recentActivities.reduce((sum, a) => sum + ((a.distance || 0) / 1000), 0);
    const totalMovingTime = recentActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const longestActivity = recentActivities.reduce((max, activity) => {
        const distanceKm = (activity.distance || 0) / 1000;
        return distanceKm > max.distanceKm
            ? { distanceKm, type: getSportKey(activity.type || ''), rawType: activity.type || 'Activity' }
            : max;
    }, { distanceKm: 0, type: 'Other', rawType: 'Activity' });

    const sportCounts = recentActivities.reduce((acc, a) => {
        const key = activitySportKey(a);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const sportMixText = VOLUME_SPORTS
        .filter(key => sportCounts[key])
        .map(key => `${SPORT_LABELS[key]}: ${sportCounts[key]}`)
        .join(' · ') || 'No recent activities in this period';

    container.innerHTML = `
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Activities</p>
            <p class="dashboard-mini-value">${recentActivities.length}</p>
        </div>
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Volume</p>
            <p class="dashboard-mini-value">${totalDistanceKm.toFixed(1)} km</p>
            <p class="dashboard-mini-subvalue">${utils.formatTime(totalMovingTime)}</p>
        </div>
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Longest Session</p>
            <p class="dashboard-mini-value">${longestActivity.distanceKm.toFixed(1)} km</p>
            <p class="dashboard-mini-subvalue">${longestActivity.type}</p>
        </div>
        <div class="dashboard-mini-card dashboard-mini-card-wide">
            <p class="dashboard-mini-label">Sport Mix</p>
            <p class="dashboard-mini-value dashboard-mini-value-small">${sportMixText}</p>
        </div>
    `;
}

/**
 * Setup event listeners for the volume unit selector (only once)
 */
function setupVolumeUnitSelector() {
    const selector = document.querySelector('.volume-unit-selector');
    if (!selector || selector.dataset.listenerReady) return;
    selector.dataset.listenerReady = '1';

    const radios = selector.querySelectorAll('input[name="volume-unit"]');
    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            volumeUnit = e.target.value;
            const { volumeChart } = dashboardRenderContext;
            if (volumeChart) renderVolumeBarChart(volumeChart.activities, volumeChart.startDate, volumeChart.endDate);
        });
    });
}

export function renderDashboardTab(allActivities, dateFilterFrom, dateFilterTo) {
    dashboardRenderContext = { allActivities, dateFilterFrom, dateFilterTo };
    const container = document.getElementById('dashboard-tab');
    if (container && !document.getElementById('range-selector')) {
        const rangeDiv = document.createElement('div');
        rangeDiv.id = 'range-selector';
        rangeDiv.style = 'display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;';
        container.prepend(rangeDiv);
    }

    renderRangeSelector();
    renderDashboardContent(allActivities, dateFilterFrom, dateFilterTo);
}

function renderRangeSelector() {
    const container = document.getElementById('range-selector');
    if (!container) return;

    const fromDisplay = customDateFromIso ? utils.isoToDisplayDate(customDateFromIso) : '';
    const toDisplay = customDateToIso ? utils.isoToDisplayDate(customDateToIso) : '';

    const rangeOptions = [
        { label: 'All Time', type: 'alltime' },
        ...getAvailableYears(dashboardRenderContext.allActivities).map(year => ({ label: String(year), type: `year:${year}` }))
    ];

    container.innerHTML = rangeOptions.map(r => `
        <button
            class="range-btn ${r.type === selectedRangeDays ? 'active' : ''}"
            data-type="${r.type}">
            ${r.label}
        </button>
    `).join('') + `
        <input type="text" id="dashboard-date-from" placeholder="DD/MM/YYYY" value="${fromDisplay}">
        <input type="text" id="dashboard-date-to" placeholder="DD/MM/YYYY" value="${toDisplay}">
        <button id="dashboard-date-apply">Apply</button>
    `;

    container.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = () => {
            selectedRangeDays = btn.dataset.type;
            customDateFromIso = null;
            customDateToIso = null;
            const fromInput = document.getElementById('dashboard-date-from');
            const toInput = document.getElementById('dashboard-date-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            // Update active class immediately for snappy feedback
            container.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Defer heavy render to next frame
            requestAnimationFrame(() => {
                const ctx = dashboardRenderContext;
                renderDashboardContent(ctx.allActivities, ctx.dateFilterFrom, ctx.dateFilterTo);
            });
        };
    });

    const applyBtn = document.getElementById('dashboard-date-apply');
    if (applyBtn) {
        applyBtn.onclick = () => {
            const fromInput = document.getElementById('dashboard-date-from');
            const toInput = document.getElementById('dashboard-date-to');
            const fromIso = utils.parseDateInputToIso(fromInput ? fromInput.value : '');
            const toIso = utils.parseDateInputToIso(toInput ? toInput.value : '');
            if (!fromIso || !toIso) return;
            if (fromIso > toIso) return;
            customDateFromIso = fromIso;
            customDateToIso = toIso;
            selectedRangeDays = 'custom';
            container.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            requestAnimationFrame(() => {
                const ctx = dashboardRenderContext;
                renderDashboardContent(ctx.allActivities, ctx.dateFilterFrom, ctx.dateFilterTo);
            });
        };
    }
}


function renderDashboardContent(allActivities, dateFilterFrom, dateFilterTo) {
    dashboardRenderContext = { allActivities, dateFilterFrom, dateFilterTo };

    if (lastActivitiesRef !== allActivities) {
        dashboardMemo.clear();
        lastActivitiesRef = allActivities;
    }

    const { startDate, endDate } = getEffectiveDashboardWindow(dateFilterFrom, dateFilterTo);
    const memoKey = `${selectedRangeDays}|${startDate.getTime()}|${endDate.getTime()}|${dateFilterFrom || ''}|${dateFilterTo || ''}`;

    let cached = dashboardMemo.get(memoKey);
    if (!cached) {
        const filteredActivities = utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo);
        const runs = filteredActivities
            .filter(a => a.type && a.type.includes('Run'))
            .sort((a, b) => new Date(a.start_date_local || 0) - new Date(b.start_date_local || 0));

        const { previousStartDate, previousEndDate } = getPreviousWindow(startDate, endDate);

        const recentRuns = runs.filter(r => {
            const d = new Date(r.start_date_local);
            return d >= startDate && d <= endDate;
        });

        const previousRuns = runs.filter(r => {
            const d = new Date(r.start_date_local);
            return d >= previousStartDate && d <= previousEndDate;
        });

        const recentActivities = filteredActivities.filter(activity => {
            const d = new Date(activity.start_date_local);
            return d >= startDate && d <= endDate;
        });

        const previousActivities = filteredActivities.filter(activity => {
            const d = new Date(activity.start_date_local);
            return d >= previousStartDate && d <= previousEndDate;
        });

        cached = { filteredActivities, runs, recentRuns, previousRuns, recentActivities, previousActivities };
        dashboardMemo.set(memoKey, cached);
    }

    const { recentRuns, previousRuns, recentActivities, previousActivities } = cached;
    dashboardRenderContext.volumeChart = { activities: recentActivities, startDate, endDate };

    renderDashboardTopline(recentActivities);
    renderDashboardSummary(recentActivities, previousActivities, recentRuns, previousRuns);

    // Render heavy charts in next frame to avoid blocking UI
    requestAnimationFrame(() => {
        renderVolumeBarChart(recentActivities, startDate, endDate);
        setupVolumeUnitSelector();
        renderDashboardConsistencyGrid(allActivities, startDate, endDate);
        renderGoalsSectionAdvanced(allActivities);
    });
}

/**
 * Multi-sport consistency grid (Run, Bike, Static Bike). Follows the dashboard range like the
 * Run/Bike grids follow their filters: "All Time" shows the current year, a year or a custom
 * range shows that span (at most its last 12 months).
 */
function renderDashboardConsistencyGrid(allActivities, startDate, endDate) {
    const container = document.getElementById('dashboard-consistency-grid');
    if (!container) return;
    const isAllTime = selectedRangeDays === 'alltime';
    const year = getSelectedYear();
    const period = isAllTime
        ? utils.getConsistencyGridPeriod(null, null)
        : utils.getConsistencyGridPeriod(
            year ? `${year}-01-01` : toLocalYMD(startDate),
            year ? `${year}-12-31` : toLocalYMD(endDate)
        );
    utils.renderConsistencyGrid(container, allActivities, period);
}


let dashboardCharts = {};
function createDashboardChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error(`Canvas with id ${canvasId} not found.`);
        return;
    }
    if (dashboardCharts[canvasId]) {
        dashboardCharts[canvasId].destroy();
    }
    dashboardCharts[canvasId] = new Chart(canvas, config);
}



function renderDashboardSummary(currentActivities, previousActivities, currentRuns, previousRuns) {
    const container = document.getElementById('dashboard-summary');
    if (!container) return;
    if (!currentActivities.length) {
        container.innerHTML = "<p>Not enough data.</p>";
        return;
    }

    const safeDistanceKm = activity => (activity.distance || 0) / 1000;
    const safeHours = activity => (activity.moving_time || 0) / 3600;
    const sum = (arr, fn) => arr.reduce((acc, item) => acc + fn(item), 0);
    const avg = values => values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
    const numeric = values => values.filter(value => Number.isFinite(value));

    const calcChange = (current, previous) => {
        if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
        return ((current - previous) / previous) * 100;
    };

    const trendVisual = (metric, change) => {
        if (!Number.isFinite(change)) {
            return { icon: '•', color: '#888', label: 'N/A' };
        }

        // For metrics where less is better (HR, injury), invert the colors
        const lowerIsBetter = ['hr', 'injury'].includes(metric);
        const improved = lowerIsBetter ? change < 0 : change > 0;
        const icon = change === 0 ? '•' : (improved ? '▲' : '▼');
        const color = change === 0 ? '#888' : (improved ? '#27ae60' : '#e74c3c');
        return { icon, color, label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` };
    };

    const totalDistance = sum(currentActivities, safeDistanceKm);
    const totalTime = sum(currentActivities, safeHours);
    const totalElevation = sum(currentActivities, activity => activity.total_elevation_gain || 0);

    const prevDistance = sum(previousActivities, safeDistanceKm);
    const prevTime = sum(previousActivities, safeHours);
    const prevElevation = sum(previousActivities, activity => activity.total_elevation_gain || 0);

    const currentAvgHR = avg(numeric(currentActivities.map(activity => activity.average_heartrate)));
    const previousAvgHR = avg(numeric(previousActivities.map(activity => activity.average_heartrate)));

    const currentInjury = avg(numeric(currentActivities.map(activity => activity.injuryRisk)));
    const previousInjury = avg(numeric(previousActivities.map(activity => activity.injuryRisk)));

    const currentTotalTss = sum(currentActivities, activity => activity.tss ?? (activity.suffer_score ? activity.suffer_score * 1.05 : 0));
    const previousTotalTss = sum(previousActivities, activity => activity.tss ?? (activity.suffer_score ? activity.suffer_score * 1.05 : 0));

    const distChange = calcChange(totalDistance, prevDistance);
    const timeChange = calcChange(totalTime, prevTime);
    const elevChange = calcChange(totalElevation, prevElevation);
    const hrChange = calcChange(currentAvgHR, previousAvgHR);
    const injuryRiskChange = calcChange(currentInjury, previousInjury);
    const tssChange = calcChange(currentTotalTss, previousTotalTss);

    const distTrend = trendVisual('distance', distChange);
    const timeTrend = trendVisual('time', timeChange);
    const elevTrend = trendVisual('elevation', elevChange);
    const injuryTrend = trendVisual('injury', injuryRiskChange);
    const hrTrend = trendVisual('hr', hrChange);
    const tssTrend = trendVisual('load', tssChange);

    // No comparable previous period (e.g. All Time) → no trend line at all
    const trendLine = trend => trend.label === 'N/A'
        ? ''
        : `<small><span style="color:${trend.color};">${trend.icon} ${trend.label}</span></small>`;


    // --- Renderizado ---
    container.innerHTML = `
        <div class="card">
            <h3>Total Distance</h3>
            <p style="font-size:2rem;font-weight:bold;color:#0074D9;">${totalDistance.toFixed(1)} km</p>
            ${trendLine(distTrend)}
        </div>

        <div class="card">
            <h3>Total Moving Time</h3>
            <p style="font-size:2rem;font-weight:bold;color:#B10DC9;">${totalTime.toFixed(1)} h</p>
            ${trendLine(timeTrend)}
        </div>

        <div class="card">
            <h3>Total Elevation Gain</h3>
            <p style="font-size:2rem;font-weight:bold;color:#2ECC40;">${totalElevation.toFixed(0)} m</p>
            ${trendLine(elevTrend)}
        </div>

        <div class="card">
            <h3>Injury Risk Index</h3>
            <p style="font-size:2rem;font-weight:bold;color:#FF4136;">${Number.isFinite(currentInjury) ? currentInjury.toFixed(3) : '–'}</p>
            ${trendLine(injuryTrend)}
        </div>

        <div class="card">
            <h3>Average Heart Rate</h3>
            <p style="font-size:2rem;font-weight:bold;color:#FF4136;">${Number.isFinite(currentAvgHR) ? currentAvgHR.toFixed(0) : '–'} bpm</p>
            ${trendLine(hrTrend)}
        </div>
        
    `;


}

/**
 * Renders the stacked bar chart of training volume (km / activities / hours) per period
 */
function renderVolumeBarChart(activities, startDate, endDate) {
    const canvas = document.getElementById('volume-bar-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (window.volumeBarChart) window.volumeBarChart.destroy();

    const { labels, datasets, yAxisTitle } = getVolumeBarChartData(activities, startDate, endDate, volumeUnit);

    if (!labels.length || !datasets.length) {
        console.warn('No data to render');
        return;
    }

    window.volumeBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: { mode: 'index', intersect: false },
                legend: { display: true, position: 'top' }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: yAxisTitle },
                    ticks: { precision: volumeUnit === 'activities' ? 0 : undefined }
                }
            }
        }
    });
}

/**
 * Bar granularity picked from the span of the selected window, so any range
 * (a single month, a year, a custom range, all time) gets a readable number of bars.
 */
function getVolumeGranularity(startDate, endDate) {
    const spanDays = (endDate.getTime() - startDate.getTime()) / 86400000;
    if (spanDays <= 62) return 'daily';
    if (spanDays <= 210) return 'weekly';
    if (spanDays <= 800) return 'monthly';
    return 'quarterly';
}

/**
 * Helper function to get Kilometers/Activities/Hours data grouped by period
 */
function getVolumeBarChartData(activities, startDate, endDate, unit) {
    const granularity = getVolumeGranularity(startDate, endDate);
    if (granularity === 'quarterly') {
        return getVolumeBarChartDataQuarterly(activities, unit);
    }

    const isDaily = granularity === 'daily';
    const isWeekly = granularity === 'weekly';
    const isMonthly = granularity === 'monthly';

    const sports = VOLUME_SPORTS;
    const sportColors = VOLUME_SPORT_COLORS;

    let grouped = {};
    const minDate = new Date(startDate);
    const maxDate = new Date(endDate);
    let curr = new Date(minDate);
    if (isMonthly) curr.setDate(1); // step month by month from the 1st, never skipping short months

    // Crear todos los periodos del rango (incluso sin datos)
    let guard = 0;
    while (curr <= maxDate && guard++ < 2000) {
        let key;
        if (isDaily) {
            key = getPeriodKey(curr, 'daily');
            curr.setDate(curr.getDate() + 1);
        } else if (isWeekly) {
            key = getPeriodKey(curr, 'weekly');
            curr.setDate(curr.getDate() + 7);
        } else if (isMonthly) {
            key = getPeriodKey(curr, 'monthly');
            curr.setMonth(curr.getMonth() + 1);
        } else {
            key = getPeriodKey(curr, 'daily');
            curr.setDate(curr.getDate() + 1);
        }
        grouped[key] = {
            total: 0,
            Run: 0,
            Ride: 0,
            StaticBike: 0,
            Gym: 0,
            Other: 0
        };
    }

    // Agregar datos reales de actividades
    if (activities && activities.length > 0) {
        for (const a of activities) {
            if (!a.start_date_local) continue;
            const date = new Date(a.start_date_local);
            if (isNaN(date)) continue;

            if (!isDateWithinRange(date, minDate, maxDate)) continue;

            let key;
            if (isDaily) {
                key = getPeriodKey(date, 'daily');
            } else if (isWeekly) {
                key = getPeriodKey(date, 'weekly');
            } else if (isMonthly) {
                key = getPeriodKey(date, 'monthly');
            } else {
                key = getPeriodKey(date, 'daily');
            }

            if (grouped.hasOwnProperty(key)) {
                const sport = activitySportKey(a);

                let value = 0;
                if (unit === 'km') {
                    value = (a.distance || 0) / 1000;
                } else if (unit === 'activities') {
                    value = 1;
                } else if (unit === 'hours') {
                    value = (a.moving_time || 0) / 3600; // Convert seconds to hours
                }

                grouped[key].total += value;
                grouped[key][sport] = (grouped[key][sport] || 0) + value;
            }
        }
    }

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
        if (isMonthly) {
            const [ya, ma] = a.split('-').map(Number);
            const [yb, mb] = b.split('-').map(Number);
            return new Date(ya, ma - 1, 1) - new Date(yb, mb - 1, 1);
        }
        return parseLocalYMD(a) - parseLocalYMD(b);
    });

    const labels = sortedKeys.map(key => {
        if (isDaily) {
            const d = parseLocalYMD(key);
            return d.toLocaleDateString('default', { day: '2-digit', month: 'short' });
        }
        if (isWeekly) {
            const d = parseLocalYMD(key);
            return `Week ${getWeekNumber(d)}`;
        }
        if (isMonthly) {
            const [y, m] = key.split('-');
            return `${new Date(y, m - 1).toLocaleString('default', { month: 'short' })} ${y.slice(2)}`;
        }
        return key;
    });

    let formatFn = v => Math.round(v);
    if (unit === 'km' || unit === 'hours') {
        formatFn = v => +v.toFixed(1);
    }

    const datasets = sports
        .map(sport => ({
            label: SPORT_LABELS[sport],
            data: sortedKeys.map(k => formatFn(grouped[k][sport] || 0)),
            backgroundColor: sportColors[sport],
            borderColor: '#fff',
            borderWidth: 1,
            borderRadius: 3
        }))
        .filter(dataset => dataset.data.some(value => value > 0));

    let yAxisTitle = 'Kilometers';
    if (unit === 'activities') {
        yAxisTitle = 'Activities';
    } else if (unit === 'hours') {
        yAxisTitle = 'Hours';
    }

    return { labels, datasets, yAxisTitle };
}

/**
 * Get volume bar chart data with QUARTERLY aggregation for All Time range
 */
function getVolumeBarChartDataQuarterly(activities, unit) {
    const sports = VOLUME_SPORTS;
    const sportColors = VOLUME_SPORT_COLORS;

    const grouped = {};

    // Group by quarter: "2023-Q1", "2023-Q2", etc.
    if (activities && activities.length > 0) {
        for (const a of activities) {
            if (!a.start_date_local) continue;
            const date = new Date(a.start_date_local);
            if (isNaN(date)) continue;

            const year = date.getFullYear();
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            const key = `${year}-Q${quarter}`;

            if (!grouped[key]) {
                grouped[key] = {
                    total: 0,
                    Run: 0,
                    Ride: 0,
                    StaticBike: 0,
                    Gym: 0,
                    Other: 0
                };
            }

            const sport = activitySportKey(a);
            let value = 0;

            if (unit === 'km') {
                value = (a.distance || 0) / 1000;
            } else if (unit === 'activities') {
                value = 1;
            } else if (unit === 'hours') {
                value = (a.moving_time || 0) / 3600;
            }

            grouped[key].total += value;
            grouped[key][sport] = (grouped[key][sport] || 0) + value;
        }
    }

    const sortedKeys = Object.keys(grouped).sort();

    const labels = sortedKeys.map(key => {
        // Format: "2023 Q1", "2023 Q2", etc.
        const [year, quarter] = key.split('-');
        return `${year} ${quarter}`;
    });

    let formatFn = v => Math.round(v);
    if (unit === 'km' || unit === 'hours') {
        formatFn = v => +v.toFixed(1);
    }

    const datasets = sports
        .map(sport => ({
            label: SPORT_LABELS[sport],
            data: sortedKeys.map(k => formatFn(grouped[k][sport] || 0)),
            backgroundColor: sportColors[sport],
            borderColor: '#fff',
            borderWidth: 1,
            borderRadius: 3
        }))
        .filter(dataset => dataset.data.some(value => value > 0));

    let yAxisTitle = 'Kilometers';
    if (unit === 'activities') {
        yAxisTitle = 'Activities';
    } else if (unit === 'hours') {
        yAxisTitle = 'Hours';
    }

    return { labels, datasets, yAxisTitle };
}

/**
 * Obtiene el lunes de la semana para una fecha dada
 */
function getMondayOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = s→bado
    const diff = day === 0 ? -6 : 1 - day; // Si es domingo, ir al lunes anterior (retroceder 6)
    d.setDate(d.getDate() + diff);
    return d;
}

function parseLocalYMD(ymd) {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPeriodKey(date, mode) {
    if (mode === 'daily') return toLocalYMD(date);
    if (mode === 'weekly') return toLocalYMD(getMondayOfWeek(date));
    return getMonthKey(date);
}

function isDateWithinRange(date, minDate, maxDate) {
    const value = date.getTime();
    return value >= minDate.getTime() && value <= maxDate.getTime();
}

/**
 * Obtiene el n→mero de semana del a→o (ISO 8601)
 */
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}


// ==============================================
// CUSTOMIZABLE RUNNING GOALS TRACKER
// ==============================================

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth();

// Period shown by the goal charts. View-only state: the goals themselves stay global
// (localStorage 'training_goals') and are not stored per year/month. Resets to "now" on reload.
// The year applies to both the annual and the monthly charts; the month to the monthly ones.
let goalYear = currentYear;
let goalMonth = currentMonth;

const GOAL_METRICS = ['km', 'hours', 'activities'];
const DEFAULT_GOALS = {
    km: { annual: 1000, monthly: 100 },
    hours: { annual: 150, monthly: 15 },
    activities: { annual: 200, monthly: 20 }
};

function getGoalYears(activities) {
    const years = new Set([currentYear, ...getAvailableYears(activities)]);
    return [...years].sort((a, b) => b - a);
}

function renderYearOptions(years, selected) {
    return years.map(y => `<option value="${y}" ${y === selected ? 'selected' : ''}>${y}</option>`).join('');
}

function renderMonthOptions(selected) {
    return Array.from({ length: 12 }, (_, m) =>
        `<option value="${m}" ${m === selected ? 'selected' : ''}>${getMonthName(m)}</option>`
    ).join('');
}

const GOAL_SELECT_STYLE = 'padding:0.35rem 0.5rem;border:1px solid #ddd;border-radius:4px;background:#fff;';

/**
 * Outcome line for a goal chart: reached, missed (period over) or still in progress.
 */
function goalOutcomeBadge(total, goal, periodEnd) {
    if (total >= goal) return '<strong style="color:#27ae60;">✅ Goal reached</strong>';
    if (periodEnd < new Date()) return '<strong style="color:#e74c3c;">❌ Goal missed</strong>';
    return '';
}

const GOAL_SPORTS = [
    { label: 'All', value: 'all' },
    { label: '🏃 Run', value: 'Run' },
    { label: '🚴 Ride', value: 'Ride' },
    { label: '🚲 Static Bike', value: 'StaticBike' },
    { label: '💪 Gym', value: 'Workout' },
];

/** Goal metrics shown for a sport: static bike sessions have no distance, so no km goals. */
function goalMetricsFor(sport) {
    return sport === 'StaticBike' ? GOAL_METRICS.filter(metric => metric !== 'km') : GOAL_METRICS;
}

function filterActivitiesBySport(activities, sport) {
    if (!sport || sport === 'all') return activities;
    if (sport === 'StaticBike') return activities.filter(a => activitySportKey(a) === 'StaticBike');
    if (sport === 'Workout') return activities.filter(a => a.type && (a.type.includes('WeightTraining') || a.type.includes('Workout')));
    return activities.filter(a => a.type && a.type.includes(sport));
}

function loadGoals() {
    const goals = JSON.parse(localStorage.getItem('training_goals') || 'null') || {};
    GOAL_METRICS.forEach(metric => {
        goals[metric] = { ...DEFAULT_GOALS[metric], ...(goals[metric] || {}) };
    });
    goals.selectedSport = goals.selectedSport || 'all';
    return goals;
}

function saveGoals(goals) {
    localStorage.setItem('training_goals', JSON.stringify(goals));
}

const metricConfig = {
    km: {
        label: 'Distance (km)',
        unit: 'km',
        extract: (a) => (a.distance || 0) / 1000,
    },
    hours: {
        label: 'Time (hours)',
        unit: 'h',
        extract: (a) => (a.moving_time || 0) / 3600,
    },
    activities: {
        label: 'Activities',
        unit: '',
        extract: () => 1,
    },
};

// ==============================================
// MAIN RENDER FUNCTION
// ==============================================

export function renderGoalsSectionAdvanced(allActivities) {
    const container = document.getElementById('dashboard-tab');
    if (!container) return;

    const goals = loadGoals();
    const sport = goals.selectedSport;
    const goalYears = getGoalYears(allActivities);
    if (!goalYears.includes(goalYear)) goalYear = currentYear;

    if (!document.getElementById('goals-section')) {
        const goalsDiv = document.createElement('div');
        goalsDiv.id = 'goals-section';
        goalsDiv.style = 'margin-top:2rem;';
        container.appendChild(goalsDiv);
    }

    const div = document.getElementById('goals-section');
    div.innerHTML = `
    <!-- SPORT SELECTOR -->
    <div id="goal-sport-tabs" style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
        ${GOAL_SPORTS.map(s => `<button class="goal-sport-btn ${sport === s.value ? 'active' : ''}" data-sport="${s.value}" style="padding:0.4rem 0.9rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:${sport === s.value ? '#fc5200' : '#fff'};color:${sport === s.value ? '#fff' : '#333'};font-size:0.9em;">${s.label}</button>`).join('')}
    </div>
    <!-- PERIOD SELECTORS (year: annual + monthly charts, month: monthly charts) -->
    <div id="goal-period-controls" style="display:flex;gap:1.25rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem;">
        <label style="display:inline-flex;align-items:center;gap:0.5rem;">Year
            <select id="goal-year" style="${GOAL_SELECT_STYLE}">${renderYearOptions(goalYears, goalYear)}</select>
        </label>
        <label style="display:inline-flex;align-items:center;gap:0.5rem;">Month
            <select id="goal-month" style="${GOAL_SELECT_STYLE}">${renderMonthOptions(goalMonth)}</select>
        </label>
    </div>
    ${goalMetricsFor(sport).map(metric => renderGoalPairHtml(metric, goals)).join('')}
`;

    // Sport selector listeners
    div.querySelectorAll('.goal-sport-btn').forEach(btn => {
        btn.onclick = () => {
            const g = loadGoals();
            g.selectedSport = btn.dataset.sport;
            saveGoals(g);
            renderGoalsSectionAdvanced(allActivities);
        };
    });

    // Period selectors only change what is displayed, never the saved goals
    document.getElementById('goal-year').onchange = event => {
        goalYear = Number(event.target.value);
        renderGoalCharts(allActivities, loadGoals());
    };
    document.getElementById('goal-month').onchange = event => {
        goalMonth = Number(event.target.value);
        renderGoalCharts(allActivities, loadGoals());
    };

    // Goal inputs: one annual and one monthly goal per metric, global across all periods
    goalMetricsFor(sport).forEach(metric => {
        ['annual', 'monthly'].forEach(kind => {
            document.getElementById(`update-${kind}-btn-${metric}`).onclick = () => {
                const g = loadGoals();
                g[metric][kind] = parseFloat(document.getElementById(`${kind}-goal-${metric}`).value);
                saveGoals(g);
                renderGoalCharts(allActivities, loadGoals());
            };
        });
    });

    renderGoalCharts(allActivities, goals);
}

function renderGoalPairHtml(metric, goals) {
    const cfg = metricConfig[metric];
    const card = kind => `
        <div style="flex:1;min-width:300px;background:white;padding:1.5rem;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:0.5rem;flex-wrap:wrap;">
                <h4 id="${kind}-title-${metric}" style="margin:0;"></h4>
                <div>
                    <input type="number" id="${kind}-goal-${metric}" value="${goals[metric][kind]}" min="1"
                           style="width:100px;padding:0.5rem;border:1px solid #ddd;border-radius:4px;">
                    <span style="margin-left:0.5rem;">${cfg.unit}</span>
                    <button id="update-${kind}-btn-${metric}" style="margin-left:1rem;padding:0.5rem 1rem;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">
                        Update
                    </button>
                </div>
            </div>
            <div id="${kind}-stats-${metric}" style="margin-bottom:1rem;padding:0.8rem;background:#f8f9fa;border-radius:4px;"></div>
            <canvas id="${kind}-goal-chart-${metric}" style="max-height:300px;width:100%;"></canvas>
        </div>`;

    return `
    <h3 style="margin:1.5rem 0 0.75rem;">${cfg.label}</h3>
    <div style="display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:1rem;">
        ${card('annual')}
        ${card('monthly')}
    </div>`;
}

function renderGoalCharts(allActivities, goals) {
    const filteredActivities = filterActivitiesBySport(allActivities, goals.selectedSport);

    goalMetricsFor(goals.selectedSport).forEach(metric => {
        const cfg = metricConfig[metric];
        document.getElementById(`annual-title-${metric}`).textContent = `Annual Goal - ${goalYear}`;
        document.getElementById(`monthly-title-${metric}`).textContent = `Monthly Goal - ${getMonthName(goalMonth)} ${goalYear}`;
        renderAnnualChart(filteredActivities, cfg, goals[metric].annual || DEFAULT_GOALS[metric].annual, goals.selectedSport, goalYear, metric);
        renderMonthlyChart(filteredActivities, cfg, goals[metric].monthly || DEFAULT_GOALS[metric].monthly, goals.selectedSport, goalYear, goalMonth, metric);
    });
}

// ==============================================
// ANNUAL CHART
// ==============================================

function renderAnnualChart(allActivities, cfg, annualGoal, sport, year, metric) {
    const sportLabel = GOAL_SPORTS.find(s => s.value === (sport || 'all'))?.label || 'All';

    const labels = [];
    const actualData = [];
    const plannedData = [];
    let cumulative = 0;

    for (let m = 0; m < 12; m++) {
        labels.push(getMonthName(m));

        const monthStart = new Date(year, m, 1);
        const monthEnd = new Date(year, m + 1, 0, 23, 59, 59);

        const monthActivities = allActivities.filter(a => {
            const d = new Date(a.start_date_local);
            return d >= monthStart && d <= monthEnd;
        });

        const monthVal = monthActivities.reduce((sum, a) => sum + cfg.extract(a), 0);
        cumulative += monthVal;
        // Months that have not started yet are left out so the line stops at today
        actualData.push(monthStart > new Date() ? null : parseFloat(cumulative.toFixed(2)));
        plannedData.push(parseFloat((annualGoal / 12 * (m + 1)).toFixed(2)));
    }

    const currentTotal = cumulative;
    const percentage = ((currentTotal / annualGoal) * 100).toFixed(1);
    const remaining = Math.max(0, annualGoal - currentTotal).toFixed(1);

    const annualOutcome = goalOutcomeBadge(currentTotal, annualGoal, new Date(year, 11, 31, 23, 59, 59));
    document.getElementById(`annual-stats-${metric}`).innerHTML = `
        <strong>Sport:</strong> ${sportLabel}
        | <strong>Progress:</strong> ${currentTotal.toFixed(1)} / ${annualGoal} ${cfg.unit} (${percentage}%)
        | <strong>Remaining:</strong> ${remaining} ${cfg.unit}
        ${annualOutcome ? `| ${annualOutcome}` : ''}
    `;

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Goal',
                    data: plannedData,
                    borderColor: '#28a745',
                    borderDash: [8, 4],
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 3
                },
                {
                    label: 'Actual',
                    data: actualData,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#007bff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} ${cfg.unit}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: `Cumulative ${cfg.label}` }
                }
            }
        }
    };

    createDashboardChart(`annual-goal-chart-${metric}`, config);
}

// ==============================================
// MONTHLY CHART
// ==============================================

function renderMonthlyChart(allActivities, cfg, monthlyGoal, sport, year, month, metric) {
    const sportLabel = GOAL_SPORTS.find(s => s.value === (sport || 'all'))?.label || 'All';

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const labels = [];
    const actualData = [];
    const plannedData = [];
    let cumulative = 0;

    for (let d = 1; d <= daysInMonth; d++) {
        labels.push(d);

        const dayStart = new Date(year, month, d, 0, 0, 0);
        const dayEnd = new Date(year, month, d, 23, 59, 59);

        const dayActivities = allActivities.filter(a => {
            const dt = new Date(a.start_date_local);
            return dt >= dayStart && dt <= dayEnd;
        });

        const dayVal = dayActivities.reduce((sum, a) => sum + cfg.extract(a), 0);
        cumulative += dayVal;
        // Days that have not happened yet are left out so the line stops at today
        actualData.push(dayStart > new Date() ? null : parseFloat(cumulative.toFixed(2)));
        plannedData.push(parseFloat((monthlyGoal / daysInMonth * d).toFixed(2)));
    }

    const currentTotal = cumulative;
    const percentage = ((currentTotal / monthlyGoal) * 100).toFixed(1);
    const remaining = Math.max(0, monthlyGoal - currentTotal).toFixed(1);

    const monthlyOutcome = goalOutcomeBadge(currentTotal, monthlyGoal, new Date(year, month, daysInMonth, 23, 59, 59));
    document.getElementById(`monthly-stats-${metric}`).innerHTML = `
        <strong>Sport:</strong> ${sportLabel}
        | <strong>Progress:</strong> ${currentTotal.toFixed(1)} / ${monthlyGoal} ${cfg.unit} (${percentage}%)
        | <strong>Remaining:</strong> ${remaining} ${cfg.unit}
        ${monthlyOutcome ? `| ${monthlyOutcome}` : ''}
    `;

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Goal',
                    data: plannedData,
                    borderColor: '#28a745',
                    borderDash: [8, 4],
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                },
                {
                    label: 'Actual',
                    data: actualData,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointBackgroundColor: '#007bff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} ${cfg.unit}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: `Cumulative ${cfg.label}` }
                },
                x: {
                    title: { display: true, text: 'Day of Month' }
                }
            }
        }
    };

    createDashboardChart(`monthly-goal-chart-${metric}`, config);
}

// ==============================================
// HELPER FUNCTION
// ==============================================

function getMonthName(monthIndex) {
    return new Date(2000, monthIndex, 1).toLocaleString('default', { month: 'short' });
}
