// js/prefs.js
import { state } from "./state.js";

const PREFS_KEY = "cinecircle:prefs";

export function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
}

export function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
            const stored = JSON.parse(raw);
            state.prefs = { ...state.prefs, ...stored };
        }
    } catch { }
    applyTheme(state.prefs.theme);
}

export function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    } catch { }
}
