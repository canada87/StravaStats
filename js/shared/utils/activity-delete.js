// js/shared/utils/activity-delete.js
// Lets the user delete an activity outright from within its own detail page (run.html,
// bike.html, swim.html, activity.html) — the GPX-import equivalent of removing a mistaken
// upload, since there's no Strava account to delete it from anymore.
import { deleteActivity } from '../../services/index.js';

export function attachDeleteActivityButton(buttonEl, activityId) {
    if (!buttonEl) return;

    buttonEl.addEventListener('click', async () => {
        if (!confirm('Delete this activity permanently? The GPX file and all its data will be removed. This cannot be undone.')) return;

        buttonEl.disabled = true;
        buttonEl.textContent = 'Deleting...';
        try {
            await deleteActivity(activityId);
            // This page was opened as its own tab (from the Activities table or the router), so
            // closing it is the natural outcome of the activity it shows no longer existing.
            window.close();
            // If the tab wasn't script-opened, window.close() silently no-ops — fall back to
            // navigating away rather than leaving the user stuck looking at a deleted activity.
            window.location.href = '../index.html';
        } catch (error) {
            alert(`Could not delete activity: ${error.message}`);
            buttonEl.disabled = false;
            buttonEl.textContent = '🗑 Delete activity';
        }
    });
}
