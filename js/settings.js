import { id } from "./dom.js";
import { loadJson, saveJson, LSTHEME, LSFILTERS } from "./storage.js";
import { normalizeFilters } from "./state.js";

// Dedicated settings key (separate from filters/theme)
const LSSETTINGS = "mnp_settings_v1";

const DEFAULT_SETTINGS = {
    theme: "synthwave",
    textScale: 1,
    reduceMotion: false,

    defaultExcludeWatched: true,
    defaultMinRating: 6,
};

function getAuthUser() {
    return window.firebaseAuth?.auth?.currentUser ?? null;
}

function getUserDocRef(uid) {
    const fs = window.firebaseStore;
    return fs.doc(fs.db, "users", uid);
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    saveJson(LSTHEME, theme);
}

function applyTextScale(scale) {
    document.documentElement.style.fontSize = `${Number(scale) * 100}%`;
}

function applyReduceMotion(on) {
    document.documentElement.toggleAttribute("data-reduce-motion", !!on);
}

// Optional: push defaults into existing filters storage so the main app starts with them
function applyDefaultFiltersToStorage(settings) {
    const cur = loadJson(LSFILTERS, {});
    const next = normalizeFilters({
        ...cur,
        excludeWatched: !!settings.defaultExcludeWatched,
        minRating: Number(settings.defaultMinRating ?? 6),
    });
    saveJson(LSFILTERS, next);
}


async function loadSettingsFromCloudOrLocal() {
    const user = getAuthUser();
    const local = loadJson(LSSETTINGS, {});
    const mergedLocal = { ...DEFAULTSETTINGS, ...local };

    // Not signed in → local-only behavior (current)
    if (!user || !window.firebaseStore) return mergedLocal;

    const fs = window.firebaseStore;
    const snap = await fs.getDoc(getUserDocRef(user.uid));
    const data = snap.exists() ? snap.data() : null;

    const cloud = data?.settings && typeof data.settings === "object" ? data.settings : {};
    return { ...DEFAULTSETTINGS, ...mergedLocal, ...cloud };
}

async function saveSettingsEverywhere(s) {
    // Always cache locally too (fast startup / offline)
    saveJson(LSSETTINGS, s);

    const user = getAuthUser();
    if (!user || !window.firebaseStore) return;

    const fs = window.firebaseStore;
    await fs.setDoc(
        getUserDocRef(user.uid),
        { settings: s, settingsUpdatedAt: fs.serverTimestamp() },
        { merge: true }
    );
}


function syncUI(s) {
    id("setTheme").value = s.theme;
    id("setTextScale").value = String(s.textScale);
    id("setReduceMotion").checked = !!s.reduceMotion;

    id("setDefaultExcludeWatched").checked = !!s.defaultExcludeWatched;
    id("setDefaultMinRating").value = String(s.defaultMinRating ?? 6);
}

function readUI() {
    return {
        theme: id("setTheme").value,
        textScale: Number(id("setTextScale").value || 1),
        reduceMotion: !!id("setReduceMotion").checked,

        defaultExcludeWatched: !!id("setDefaultExcludeWatched").checked,
        defaultMinRating: Number(id("setDefaultMinRating").value || 6),
    };
}

function applyAll(s) {
    applyTheme(s.theme);
    applyTextScale(s.textScale);
    applyReduceMotion(s.reduceMotion);

    applyDefaultFiltersToStorage(s);
}


async function boot() {
    const s = await loadSettingsFromCloudOrLocal();

    // Keep your existing theme override behavior if you want,
    // but make cloud win overall (cloud is already merged in above).
    syncUI(s);
    applyAll(s);

    id("btnSaveSettings")?.addEventListener("click", async () => {
        const next = readUI();
        await saveSettingsEverywhere(next);
        applyAll(next);
        window.location.href = "index.html";
    });

    id("btnResetSettings")?.addEventListener("click", async () => {
        await saveSettingsEverywhere(DEFAULTSETTINGS);
        syncUI(DEFAULTSETTINGS);
        applyAll(DEFAULTSETTINGS);
    });
}

boot();


boot();
