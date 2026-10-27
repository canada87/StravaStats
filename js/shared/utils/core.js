// js/utils.js




export function filterActivitiesByDate(activities, from, to) {
    if (!from && !to) return activities;
    return activities.filter(act => {
        const date = act.start_date_local.substring(0, 10);
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
    });
}

// Max HR the per-run VO2max estimate has always assumed
export const VO2MAX_ESTIMATE_MAX_HR = 195;

/**
 * Per-run VO2max estimate (ml/kg/min) shown as "VO2max (est)" on the activity pages:
 * oxygen cost of the average pace (ACSM running equation) divided by the fraction of max HR
 * the run was done at. Returns null when it cannot be estimated (no heart rate, or an average
 * HR outside 50-120% of the assumed max HR).
 */
export function estimateRunVo2max(activity, maxHr = VO2MAX_ESTIMATE_MAX_HR) {
    if (!activity.distance || !activity.moving_time || !activity.average_heartrate) return null;
    const velocityMPerMin = (activity.distance / activity.moving_time) * 60;
    const vo2AtPace = velocityMPerMin * 0.2 + 3.5;
    const fractionOfMaxHr = activity.average_heartrate / maxHr;
    if (fractionOfMaxHr < 0.5 || fractionOfMaxHr > 1.2) return null;
    return vo2AtPace / fractionOfMaxHr;
}

// Heart-rate zones as % of max HR: Z1 <60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 >90
const HR_ZONE_BREAKPOINTS = [0, 0.60, 0.70, 0.80, 0.90];
const DEFAULT_MAX_HR = 190;

/**
 * Five %maxHR zones as [{ min, max }] (bpm, last zone max = -1 for "no upper limit").
 */
export function buildHrZoneRanges(maxHr) {
    if (!maxHr || maxHr <= 0) return null;
    return HR_ZONE_BREAKPOINTS.map((pct, i) => ({
        min: Math.round(maxHr * pct),
        max: i < HR_ZONE_BREAKPOINTS.length - 1 ? Math.round(maxHr * HR_ZONE_BREAKPOINTS[i + 1]) : -1
    }));
}

/**
 * Heart-rate zones used by the app: the saved training zones when there are any, otherwise
 * zones derived from the "Max HR" in Settings (default 190). `source` says which one was used.
 */
export function getHeartRateZones() {
    try {
        const saved = JSON.parse(localStorage.getItem('strava_training_zones') || 'null');
        const zones = saved?.heart_rate?.zones;
        if (Array.isArray(zones) && zones.length >= 2) {
            return { zones, source: 'saved training zones' };
        }
    } catch (_e) {
        // malformed value: fall back to Max HR
    }

    let maxHr = DEFAULT_MAX_HR;
    try {
        const settings = JSON.parse(localStorage.getItem('dashboard_settings') || '{}');
        maxHr = Number(settings.hrMax) || DEFAULT_MAX_HR;
    } catch (_e) {
        // keep the default
    }
    return { zones: buildHrZoneRanges(maxHr), source: `Max HR ${maxHr} bpm (Settings)` };
}

/**
 * Period shown by the Run/Bike consistency calendar grids, following the date filter:
 * - no filter: the current year (Jan-Dec);
 * - filter (a year button or a manual range): from/to of the filter. A missing end means
 *   today, a missing start means 12 months before the end.
 * The grid is never longer than 12 months: a longer range shows its last 12 months
 * (`truncated` is true so the caller can say so).
 */
export function getConsistencyGridPeriod(dateFilterFrom, dateFilterTo, today = new Date()) {
    const parseIso = iso => {
        const [year, month, day] = iso.split('-').map(Number);
        return new Date(year, month - 1, day);
    };

    if (!dateFilterFrom && !dateFilterTo) {
        return {
            periodStart: new Date(today.getFullYear(), 0, 1),
            periodEnd: new Date(today.getFullYear(), 11, 31),
            truncated: false
        };
    }

    const periodEnd = dateFilterTo ? parseIso(dateFilterTo) : new Date(today);
    let periodStart = dateFilterFrom
        ? parseIso(dateFilterFrom)
        : new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 11, 1);

    const months = (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 + (periodEnd.getMonth() - periodStart.getMonth()) + 1;
    const truncated = months > 12;
    if (truncated) {
        periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 11, 1);
    }

    return { periodStart, periodEnd, truncated };
}

export function rollingMean(arr, windowSize) {
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const window = arr.slice(start, i + 1);
        const valid = window.filter(x => !isNaN(x) && x !== null);
        result.push(valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0);
    }
    return result;
}

function parseLocalDateKey(dateLike) {
    const datePart = String(dateLike || '').substring(0, 10);
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function buildEddingtonSeries(activities, distanceGetter, options = {}) {
    const unitStep = Number(options.unitStep) > 0 ? Number(options.unitStep) : 1;
    const projectionCount = Number(options.projectionCount) > 0 ? Number(options.projectionCount) : 10;
    const recentWindowDays = Number(options.recentWindowDays) > 0 ? Number(options.recentWindowDays) : 90;
    const dailyTotals = new Map();

    activities.forEach(activity => {
        if (!activity?.start_date_local) return;

        const date = parseLocalDateKey(activity.start_date_local);
        if (!date) return;

        const key = toLocalDateKey(date);
        const distance = Number(distanceGetter(activity)) || 0;
        dailyTotals.set(key, (dailyTotals.get(key) || 0) + distance);
    });

    const dailySeries = Array.from(dailyTotals.entries())
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, distance]) => ({
            date,
            distance: +distance.toFixed(3),
            thresholdUnits: Math.max(0, Math.floor(distance / unitStep))
        }));

    const maxThreshold = dailySeries.reduce((maxValue, day) => Math.max(maxValue, day.thresholdUnits), 0);
    if (!dailySeries.length || maxThreshold <= 0) {
        return {
            summary: { current: 0, maxThreshold: 0, activeDays: dailySeries.length },
            achievementSeries: [],
            distributionSeries: []
        };
    }

    const exceedCounts = new Array(maxThreshold + 1).fill(0);
    dailySeries.forEach(day => {
        for (let threshold = 1; threshold <= day.thresholdUnits; threshold++) {
            exceedCounts[threshold] += 1;
        }
    });

    const achievementCounts = new Array(maxThreshold + 1).fill(0);
    const achievementDates = new Array(maxThreshold + 1).fill(null);
    const achievementActiveDays = new Array(maxThreshold + 1).fill(null);
    dailySeries.forEach((day, index) => {
        for (let threshold = 1; threshold <= day.thresholdUnits; threshold++) {
            achievementCounts[threshold] += 1;
            if (!achievementDates[threshold] && achievementCounts[threshold] >= threshold) {
                achievementDates[threshold] = day.date;
                achievementActiveDays[threshold] = index + 1;
            }
        }
    });

    const firstDate = parseLocalDateKey(dailySeries[0].date);
    const lastDate = parseLocalDateKey(dailySeries[dailySeries.length - 1].date);
    const elapsedCalendarDays = firstDate && lastDate
        ? Math.max(1, Math.round((lastDate - firstDate) / 86400000) + 1)
        : dailySeries.length;
    const recentCutoff = lastDate ? new Date(lastDate) : null;
    if (recentCutoff) {
        recentCutoff.setDate(recentCutoff.getDate() - recentWindowDays + 1);
        recentCutoff.setHours(0, 0, 0, 0);
    }
    const recentSeries = recentCutoff
        ? dailySeries.filter(day => {
            const date = parseLocalDateKey(day.date);
            return date && date >= recentCutoff;
        })
        : dailySeries;
    const recentActiveDays = recentSeries.length;
    const distributionSeries = [];
    const achievementSeries = [];
    let current = 0;

    for (let threshold = 1; threshold <= maxThreshold; threshold++) {
        const achievedDate = achievementDates[threshold];
        if (achievedDate) {
            current = threshold;
            const reachedDate = parseLocalDateKey(achievedDate);
            const daysNeeded = firstDate && reachedDate
                ? Math.round((reachedDate - firstDate) / 86400000) + 1
                : null;
            const activeDaysNeeded = achievementActiveDays[threshold];

            distributionSeries.push({
                threshold,
                qualifyingDays: exceedCounts[threshold],
                daysNeeded,
                activeDaysNeeded,
                projectedActiveDaysNeeded: activeDaysNeeded,
                isAchieved: true
            });
            achievementSeries.push({
                threshold,
                date: achievedDate,
                daysNeeded,
                activeDaysNeeded
            });
            continue;
        }

        const remainingQualifiers = threshold - exceedCounts[threshold];
        const recentQualifyingDays = recentSeries.reduce((count, day) => {
            return count + (day.thresholdUnits >= threshold ? 1 : 0);
        }, 0);
        const projectedActiveDaysNeeded = threshold <= current + projectionCount && recentQualifyingDays > 0
            ? dailySeries.length + Math.ceil(remainingQualifiers * (recentActiveDays / recentQualifyingDays))
            : null;

        distributionSeries.push({
            threshold,
            qualifyingDays: exceedCounts[threshold],
            daysNeeded: null,
            activeDaysNeeded: null,
            projectedActiveDaysNeeded,
            isAchieved: false
        });
    }

    return {
        summary: {
            current,
            maxThreshold,
            activeDays: dailySeries.length,
            elapsedCalendarDays,
            projectionCount,
            recentWindowDays,
            recentActiveDays
        },
        achievementSeries,
        distributionSeries
    };
}

export function upsertChartInfo(canvasId, options = {}) {
    const canvas = document.getElementById(canvasId);
    const container = canvas?.closest('.chart-container');
    if (!canvas || !container) return;

    const {
        title = 'How to read this chart',
        bodyHtml = '',
        accentColor = '#111'
    } = options;

    container.style.position = 'relative';

    let button = container.querySelector(`.chart-info-button[data-chart-info-for="${canvasId}"]`);
    let panel = container.querySelector(`.chart-info-panel[data-chart-info-for="${canvasId}"]`);

    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'chart-info-button';
        button.dataset.chartInfoFor = canvasId;
        button.setAttribute('aria-label', `Explain ${canvasId}`);
        button.textContent = '?';
        container.appendChild(button);
    }

    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'chart-info-panel';
        panel.dataset.chartInfoFor = canvasId;
        container.appendChild(panel);
    }

    button.style.setProperty('--chart-info-accent', accentColor);
    panel.style.setProperty('--chart-info-accent', accentColor);
    panel.innerHTML = `
        <div class="chart-info-panel__title">${title}</div>
        <div class="chart-info-panel__body">${bodyHtml}</div>
    `;

    if (button.dataset.bound === 'true') return;

    button.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = button.classList.toggle('is-open');
        panel.classList.toggle('is-open', isOpen);
    });

    document.addEventListener('click', event => {
        if (!container.contains(event.target)) {
            button.classList.remove('is-open');
            panel.classList.remove('is-open');
        }
    });

    button.dataset.bound = 'true';
}

export function aggregateByWeek(activities, distanceFn) {
    const map = new Map();
    for (const a of activities) {
        const dateLike = a.start_date_local || a.start_date || a.date || '';
        const datePart = String(dateLike).substring(0, 10);
        const [year, month, day] = datePart.split('-').map(Number);
        if (!year) continue;
        const d = new Date(year, (month || 1) - 1, day || 1);
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        map.set(key, (map.get(key) || 0) + distanceFn(a));
    }
    return Array.from(map.entries())
        .map(([date, total]) => ({ start_date_local: date, total }))
        .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));
}

export function calculateFitness(dailyEffort) {
    function expMovingAvg(arr, lambda) {
        const result = [];
        let prev = arr[0] || 0;
        for (let i = 0; i < arr.length; i++) {
            const val = arr[i] || 0;
            prev = prev + lambda * (val - prev);
            result.push(prev);
        }
        return result;
    }

    const atl = expMovingAvg(dailyEffort, 1 / 7);
    const ctl = expMovingAvg(dailyEffort, 1 / 42);
    const tsb = ctl.map((c, i) => c - atl[i]);

    const injuryRisk = tsb.map(tsbVal => {
        const k = 0.25;  // steepness of the curve
        const x0 = -10;  // TSB where risk = 50%
        const risk = 1 / (1 + Math.exp(-k * (x0 - tsbVal))); // sigmoid
        return +(risk * 100).toFixed(2); // convert to %
    });

    return { atl, ctl, tsb, injuryRisk };
}



export function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}


export function formatTime(sec) {
    if (!isFinite(sec) || sec <= 0) return 'N/A';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h > 0 ? h + ':' : '') + m.toString().padStart(h > 0 ? 2 : 1, '0') + ':' + s.toString().padStart(2, '0');
}

export function formatDistance(meters) {
    if (!isFinite(meters) || meters < 0) return 'N/A';
    if (meters < 1000) {
        return `${meters.toFixed(0)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
}

export function formatPace(seconds, km) {
    if (!isFinite(seconds) || !isFinite(km) || km <= 0) return '-';
    const pace = seconds / km; // pace in seconds per km
    let min = Math.floor(pace / 60);
    let secRest = Math.round(pace % 60);
    if (secRest === 60) {
        min += 1;
        secRest = 0;
    }
    return `${min}:${secRest.toString().padStart(2, '0')} /km`;
}

export function calculateEnvironmentalDifficulty(activity) {
    const weather = activity.weather || {};
    let difficulty = 0;

    // Temperature: quadratic deviation from ideal 15°C (up to 40pts)
    const temp = weather.temperature ?? weather.temp;
    if (temp !== undefined) {
        const deviation = Math.abs(temp - 15);
        difficulty += Math.min(40, (deviation * deviation) / 15.625);
    }

    // Humidity: linear penalty >50% with heat interaction (up to 25pts)
    const humidity = weather.humidity;
    if (humidity !== undefined && humidity > 50) {
        let humidityScore = ((humidity - 50) / 50) * 15;
        // Heat-humidity interaction: extra penalty when hot and humid
        if (temp !== undefined && temp > 20) {
            humidityScore += ((temp - 20) / 20) * ((humidity - 50) / 50) * 10;
        }
        difficulty += Math.min(25, humidityScore);
    }

    // Wind: linear scale 0-30 km/h (up to 20pts)
    const wind = weather.wind_speed;
    if (wind !== undefined) {
        difficulty += Math.min(20, (wind / 30) * 20);
    }

    // Precipitation: direct mapping (up to 10pts)
    const precip = weather.precipitation;
    if (precip !== undefined) {
        difficulty += Math.min(10, precip * 2);
    }

    // Pressure: deviation from 1013 hPa (up to 5pts)
    const pressure = weather.pressure;
    if (pressure !== undefined) {
        const pressureDeviation = Math.abs(pressure - 1013);
        difficulty += Math.min(5, (pressureDeviation / 40) * 5);
    }

    return Math.min(Math.round(difficulty), 100);
}

export function formatDate(date) {
    if (!(date instanceof Date)) date = new Date(date);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

export function parseDateInputToIso(value) {
    const raw = (value || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return '';

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';

    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) return '';

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isoToDisplayDate(value) {
    const iso = parseDateInputToIso(value);
    if (!iso) return '';
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
}

export const SPORT_EMOJI = {
    Run: '🏃',
    TrailRun: '🏔️',
    VirtualRun: '🏃',
    Ride: '🚴',
    VirtualRide: '🚴',
    GravelRide: '🪨',
    MountainBikeRide: '🚵',
    EBikeRide: '🚴',
    StaticBike: '🚲',
    Walk: '🚶',
    Hike: '🥾',
    Tennis: '🎾',
    Padel: '🎾',
    Soccer: '⚽',
    Football: '⚽',
    AlpineSki: '⛷️',
    NordicSki: '⛷️',
    Snowboard: '🏂',
    Workout: '💪',
    WeightTraining: '🏋️',
    Yoga: '🧘',
    Crossfit: '💥',
    Kayaking: '🚣',
    Rowing: '🚣',
    IceSkate: '⛸️'
};

export function sportEmoji(type) {
    return SPORT_EMOJI[type] || '🏅';
}

export function formatPaceRun(secondsPerKm) {
    if (secondsPerKm == null || !isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
    let min = Math.floor(secondsPerKm / 60);
    let sec = Math.round(secondsPerKm % 60);
    if (sec === 60) { min += 1; sec = 0; }
    return `${min}:${sec.toString().padStart(2, '0')} /km`;
}

export function formatSpeedBike(kmh) {
    if (kmh == null || !isFinite(kmh)) return '—';
    return `${kmh.toFixed(1)} km/h`;
}

export function formatSportPace(value, sport) {
    if (value == null || !isFinite(value)) return '—';
    const s = sport || '';
    if (/Ride|Bike|Cycling/i.test(s)) return formatSpeedBike(value);
    if (/Run/i.test(s)) return formatPaceRun(value);
    return formatPaceRun(value);
}

export function paceDecimalToTime(paceDecimal) {
    if (isNaN(paceDecimal) || paceDecimal <= 0) return "–";

    const minutes = Math.floor(paceDecimal);
    const seconds = Math.round((paceDecimal - minutes) * 60);

    const adjMinutes = seconds === 60 ? minutes + 1 : minutes;
    const adjSeconds = seconds === 60 ? 0 : seconds;

    return `${adjMinutes}:${adjSeconds.toString().padStart(2, "0")}`;
}


// --- helpers de icono/color --- 
export function trendColor(p) {
    return p > 0 ? '#2ECC40' : (p < 0 ? '#FF4136' : '#888');
}
export function trendIcon(p) {
    return p > 0 ? '▲' : (p < 0 ? '▼' : '•');
}

// --- Colores e iconos por métrica ---
export function metricColor(metric, change) {
    if (change == 0) return '#888';

    // Menor es mejor → verde si baja
    if (['pace', 'hr'].includes(metric))
        return change < 0 ? '#2ECC40' : '#FF4136';

    // Mayor es mejor → verde si sube
    return change > 0 ? '#2ECC40' : '#FF4136';
}

export function metricIcon(metric, change) {
    if (change == 0) return '•';

    if (['pace', 'hr'].includes(metric))
        return change < 0 ? '▼' : '▲'; // baja = mejora

    return change > 0 ? '▲' : '▼';
}