// js/shared/utils/sport-editor.js
// Lets the user manually re-classify an activity's sport from within its own detail page
// (run.html, bike.html, swim.html, activity.html) when the GPX auto-classifier got it wrong
// (e.g. a fast group ride guessed as a run by the average-speed fallback in
// api/_local/gpxIngest.js, or vice versa). Saving redirects through activity-router.html so the
// page always ends up on the template that matches the corrected sport.
import { updateActivityType } from '../../services/index.js';

// Every sport value the app already has pace/cadence-unit or emoji handling for
// (see the RUN_TYPES/SWIM_TYPES/BIKE_TYPES sets in js/tabs/activities.js).
const SPORT_TYPE_OPTIONS = ['Run', 'TrailRun', 'VirtualRun', 'Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'Swim', 'OpenWaterSwim', 'Hike', 'Walk'];

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function renderSportEditor(currentType) {
    const options = SPORT_TYPE_OPTIONS.includes(currentType) ? SPORT_TYPE_OPTIONS : [currentType, ...SPORT_TYPE_OPTIONS];
    const optionsHtml = options.map(opt =>
        `<option value="${escapeHtml(opt)}" ${opt === currentType ? 'selected' : ''}>${escapeHtml(opt)}</option>`
    ).join('');

    return `
        <span class="sport-editor">
            <button type="button" class="sport-editor__toggle">✏️ Wrong sport?</button>
            <span class="sport-editor__form hidden">
                <select class="sport-editor__select">${optionsHtml}</select>
                <button type="button" class="sport-editor__save">Save</button>
                <button type="button" class="sport-editor__cancel">Cancel</button>
            </span>
        </span>
    `;
}

export function attachSportEditor(rootEl, activityId) {
    const editor = rootEl?.querySelector('.sport-editor');
    if (!editor) return;

    const toggle = editor.querySelector('.sport-editor__toggle');
    const form = editor.querySelector('.sport-editor__form');
    const select = editor.querySelector('.sport-editor__select');
    const saveBtn = editor.querySelector('.sport-editor__save');
    const cancelBtn = editor.querySelector('.sport-editor__cancel');

    toggle.addEventListener('click', () => {
        toggle.classList.add('hidden');
        form.classList.remove('hidden');
    });
    cancelBtn.addEventListener('click', () => {
        form.classList.add('hidden');
        toggle.classList.remove('hidden');
    });
    saveBtn.addEventListener('click', async () => {
        const newType = select.value;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            await updateActivityType(activityId, newType);
            // The page's own template (run/bike/swim/activity) is picked by sport, so a
            // corrected sport needs the same routing logic activity-router.html already has —
            // simplest to just send the browser back through it.
            window.location.href = `activity-router.html?id=${encodeURIComponent(activityId)}`;
        } catch (error) {
            alert(`Could not update sport: ${error.message}`);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    });
}
