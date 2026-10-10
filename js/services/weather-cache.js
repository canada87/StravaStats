// Persistent cache for historical weather (Open-Meteo archive data never changes once published).
// Kept in its own IndexedDB database so it is independent from the activity cache and its versioning.
const DB_NAME = 'strava-weather-cache';
const DB_VERSION = 1;
const STORE_NAME = 'weather';

function openWeatherDb() {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available'));
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open weather cache'));
    });
}

// Same place + same day + same hour => same weather, regardless of activity id.
export function buildWeatherCacheKey(activity) {
    const latlng = activity?.start_latlng;
    if (!latlng || latlng.length < 2 || !activity.start_date_local) return null;
    const [lat, lon] = latlng;
    const date = String(activity.start_date_local);
    return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}|${date.slice(0, 13)}`;
}

/** Loads the whole cache into a Map(key -> weather). Never throws: on failure returns an empty Map. */
export async function loadWeatherCache() {
    const cache = new Map();
    try {
        const db = await openWeatherDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAll();
            request.onsuccess = () => {
                (request.result || []).forEach(entry => cache.set(entry.key, entry.weather));
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
        });
    } catch (error) {
        console.warn('[Weather] Cache unavailable, fetching from network:', error);
    }
    return cache;
}

/** Persists newly fetched entries ([key, weather] pairs) in one transaction. Never throws. */
export async function saveWeatherEntries(entries) {
    if (!entries?.length) return;
    try {
        const db = await openWeatherDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            entries.forEach(([key, weather]) => store.put({ key, weather }));
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
        });
    } catch (error) {
        console.warn('[Weather] Failed to save weather cache:', error);
    }
}
