import { loadJson, LSFILTERS } from "./storage.js";

export const API = "https://tmdb-proxy.idrisshakir445.workers.dev/tmdb";

export const DEFAULTFILTERS = {
    excludeWatched: true,
    minRating: 6,
    region: null,
    ott: { netflix: false, prime: false, hotstar: false },
};

export function normalizeFilters(f) {
    const out = { ...DEFAULTFILTERS, ...(f || {}) };
    out.ott = { ...DEFAULTFILTERS.ott, ...(f?.ott || {}) };
    return out;
}

export const state = {
    imgBase: "https://image.tmdb.org/t/p/",
    posterSize: "w500",
    results: [],
    pool: [],
    watched: new Set(),
    filters: normalizeFilters(loadJson(LSFILTERS, DEFAULTFILTERS)),
    currentDetails: null,
    busy: false,
    page: 1,
    totalPages: 1,
    lastMode: "trending",
    lastQuery: "",
    lastSort: "popularity.desc",
};

export const authState = { user: null };

export const roomState = {
    id: null,
    unsub: null,
    members: [], // for @-mentions
};

export function inRoom() {
    return !!roomState.id;
}

export function detectRegionFromBrowser() {
    const loc =
        Intl.DateTimeFormat().resolvedOptions().locale ||
        navigator.language ||
        "en-IN";
    try {
        const r = new Intl.Locale(loc).region;
        if (r && /^[A-Z]{2}$/.test(r)) return r;
    } catch { }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata") return "IN";
    const m = String(loc).match(/-([A-Za-z]{2})/);
    if (m) return m[1].toUpperCase();
    return "IN";
}

export function ensureWatchFilterDefaults() {
    state.filters = normalizeFilters(state.filters);
    if (!state.filters.region) state.filters.region = detectRegionFromBrowser();
    if (!state.filters.ott || typeof state.filters.ott !== "object") {
        state.filters.ott = { netflix: false, prime: false, hotstar: false };
    }
}

export let lastAutoOpenedPickKey = null;
export let lastPickedMovieId = null;

export function setLastAutoOpenedPickKey(v) {
    lastAutoOpenedPickKey = v;
}

export function setLastPickedMovieId(v) {
    lastPickedMovieId = v;
}
