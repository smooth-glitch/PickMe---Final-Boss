// js/main.js
import { id } from "./dom.js";
import {
    state,
    authState,
    roomState,
    ensureWatchFilterDefaults,
    normalizeFilters,
    lastPickedMovieId,
} from "./state.js";
import {
    LSPOOL,
    LSWATCHED,
    LSFILTERS,
    LSTHEME,
    loadJson,
    saveJson,
} from "./storage.js";
import { toast, bindDropdownRowToggle } from "./ui.js";
import { tmdb, loadTmdbConfig } from "./tmdb.js";
import { renderPager, renderPool, toggleHiddenPoolItems } from "./render.js";
import { openDetails, markCurrentWatched } from "./details.js";
import { clearPool } from "./pool.js";
import { loadTrending, doSearch } from "./search.js";
import { initWatchFiltersUI } from "./watchFilters.js";
import {
    updateUserChip,
    openAuthDialog,
    handleAuthSubmit,
    handleGoogleSignIn,
    handleSignOut,
} from "./auth.js";
import { pickForMe, rerollPick } from "./pick.js";
import { importSharedListToAccount } from "./importList.js";
import { sharePoolOnWhatsApp } from "./share.js";
import {
    updateRoomUI,
    createRoom,
    leaveRoom,
    startRoomListener,
    startMembersListener,
    startHeartbeat,
    ensureUserDoc,
    startUserDocListener,
    copyRoomLink,
    joinRoom,
    registerReplyDraftSetter,
} from "./rooms.js";
import { setSyncControls, registerReplyDraftSetter, setReplyDraft } from "./rooms.js";
import { searchGifs } from "./gif.js";

let liveSearchTimer = null;
// reply draft for chat
let currentReplyTarget = null;

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    saveJson(LSTHEME, theme);
}

function initTheme() {
    const saved = loadJson(LSTHEME, "synthwave");
    applyTheme(saved);
}

function updateGenreDropdownLabel() {
    const countEl = id("genreDropdownCount");
    const n = Array.isArray(state.filters.genres)
        ? state.filters.genres.length
        : 0;
    if (countEl) countEl.textContent = n ? `${n} selected` : "";
}

async function loadGenres(kind) {
    const data = await tmdb(`genre/${kind}/list`, { language: "en-US" });
    return Array.isArray(data.genres) ? data.genres : [];
}

async function populateGenreSelect(kind) {
    const menu = id("genreDropdownMenu");
    if (!menu) return;

    if (!Array.isArray(state.filters.genres)) state.filters.genres = [];
    const chosen = new Set(state.filters.genres);

    menu.innerHTML = `<div class="text-xs opacity-60 p-2">Loading...</div>`;
    const genres = await loadGenres(kind);
    menu.innerHTML = "";

    for (const g of genres) {
        const row = document.createElement("label");
        row.className =
            "flex items-center gap-2 p-2 rounded-lg hover:bg-base-200/40 cursor-pointer";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "checkbox checkbox-xs";
        cb.checked = chosen.has(g.id);

        cb.addEventListener("change", () => {
            if (cb.checked) chosen.add(g.id);
            else chosen.delete(g.id);

            state.filters.genres = Array.from(chosen);
            saveJson(LSFILTERS, state.filters);
            updateGenreDropdownLabel();

            if (state.lastMode !== "trending") doSearch(1);
        });

        const txt = document.createElement("span");
        txt.className = "text-sm";
        txt.textContent = g.name;

        row.appendChild(cb);
        row.appendChild(txt);
        menu.appendChild(row);
    }

    updateGenreDropdownLabel();
}

function syncControls() {
    const ex = id("excludeWatched");
    const mr = id("minRatingPool");
    const mediaType = id("mediaType");
    const yearFilter = id("yearFilter");

    if (ex) ex.checked = !!state.filters.excludeWatched;
    if (mr) mr.value = String(state.filters.minRating ?? 6);
    if (mediaType) mediaType.value = state.filters.mediaType || "movie";
    if (yearFilter) yearFilter.value = String(state.filters.year || "");

    updateGenreDropdownLabel();
}

setSyncControls(syncControls);

function updateSignOutLabel() {
    const el = id("btnMenuSignOut");
    if (!el) return;

    const u = authState.user;
    const name = u ? u.displayName || u.email || "Signed in" : "";

    el.textContent = u ? `Sign out (${name})` : "Sign out";
}

function resetAllFilters() {
    state.filters = normalizeFilters({
        excludeWatched: true,
        minRating: 6,
        region: state.filters.region || "IN",
        ott: { netflix: false, prime: false, hotstar: false },
    });

    state.filters.mediaType = "movie";
    state.filters.year = "";
    state.filters.genres = [];

    ensureWatchFilterDefaults();

    const qEl = id("q");
    const mediaTypeEl = id("mediaType");
    const yearEl = id("yearFilter");
    const sortEl = id("resultSort");
    const excludeEl = id("excludeWatched");
    const minRatingEl = id("minRating");

    if (qEl) qEl.value = "";
    if (mediaTypeEl) mediaTypeEl.value = "movie";
    if (yearEl) yearEl.value = "";
    if (sortEl) sortEl.value = "popularity.desc";
    if (excludeEl) excludeEl.checked = true;
    if (minRatingEl) minRatingEl.value = "6";

    const cbNetflix = id("ottNetflix");
    const cbPrime = id("ottPrime");
    const cbHotstar = id("ottHotstar");
    if (cbNetflix) cbNetflix.checked = false;
    if (cbPrime) cbPrime.checked = false;
    if (cbHotstar) cbHotstar.checked = false;

    saveJson(LSFILTERS, state.filters);

    populateGenreSelect("movie");
    renderPool();
    loadTrending(1);

    toast("Filters reset.", "info");
}

async function loadSharedListFromUrl() {
    const fs = window.firebaseStore;
    if (!fs) return;

    const url = new URL(window.location.href);
    const listId = url.searchParams.get("list");
    if (!listId) return;

    const snap = await fs.getDoc(fs.doc(fs.db, "sharedLists", listId));
    if (!snap.exists()) return toast("Shared list not found.", "error");

    const data = snap.data();
    if (Array.isArray(data.pool)) state.pool = data.pool;
    if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
    if (data.filters && typeof data.filters === "object")
        state.filters = data.filters;

    renderPool();
    syncControls();

    id("btnImportList")?.classList.remove("hidden");
}

function syncUserMenu() {
    const signedIn = !!authState.user;
    id("btnMenuSignIn")?.classList.toggle("hidden", signedIn);
    id("btnMenuSignOut")?.classList.toggle("hidden", !signedIn);
    id("btnMenuCopyUid")?.classList.toggle("hidden", !signedIn);
}

async function boot() {
    // persisted state
    state.pool = loadJson(LSPOOL, []);
    state.watched = new Set(loadJson(LSWATCHED, []));
    state.filters = loadJson(LSFILTERS, { excludeWatched: true, minRating: 6 });

    ensureWatchFilterDefaults();

    initTheme();
    syncControls();

    await initWatchFiltersUI({
        onChange: () => {
            if (state.lastMode !== "trending") doSearch(1);
        },
    });

    bindDropdownRowToggle("genreDropdownMenu");
    bindDropdownRowToggle("ottDropdownMenu");

    await populateGenreSelect(state.filters.mediaType || "movie");

    renderPager();
    updateUserChip();
    syncUserMenu();
    updateSignOutLabel();
    await loadSharedListFromUrl();

    // firebase auth state
    const fa = window.firebaseAuth;
    if (fa) {
        fa.onAuthStateChanged(fa.auth, async (user) => {
            authState.user = user || null;

            const fs = window.firebaseStore;
            if (user && fs) {
                await fs.setDoc(
                    fs.doc(fs.db, "users", user.uid),
                    { email: user.email || null, createdAt: fs.serverTimestamp() },
                    { merge: true }
                );
            }

            updateUserChip();
            syncUserMenu();
            updateSignOutLabel();

            const url = new URL(window.location.href);
            const roomId = url.searchParams.get("room");
            if (roomId) {
                joinRoom(roomId);
                return;
            }

            updateRoomUI();

            if (!authState.user) return;
            await ensureUserDoc();
            startUserDocListener();
        });
    }

    const qEl = id("q");

    // UI wiring
    id("excludeWatched")?.addEventListener("change", () => {
        state.filters.excludeWatched = id("excludeWatched").checked;
        saveJson(LSFILTERS, state.filters);
        renderPool();
    });

    id("minRatingPool")?.addEventListener("input", () => {
        const v = Number(id("minRatingPool").value);
        state.filters.minRating = Number.isFinite(v) ? v : 0;
        saveJson(LSFILTERS, state.filters);
        renderPool();
    });

    id("btnSearch")?.addEventListener("click", () => doSearch(1));
    id("btnTrending")?.addEventListener("click", () => loadTrending(1));

    id("btnPick")?.addEventListener("click", () => pickForMe());
    id("btnPickPool")?.addEventListener("click", pickForMe);

    id("btnReroll")?.addEventListener("click", rerollPick);
    id("btnWatched")?.addEventListener("click", markCurrentWatched);

    id("btnCopyRoomLink")?.addEventListener("click", copyRoomLink);

    id("btnImportList")?.addEventListener("click", importSharedListToAccount);
    id("btnToggleHiddenPool")?.addEventListener("click", toggleHiddenPoolItems);
    id("btnOpenPicked")?.addEventListener("click", () => {
        if (!lastPickedMovieId) return toast("No pick yet.", "info");
        openDetails(lastPickedMovieId, { highlight: true });
    });

    id("btnClearPool")?.addEventListener("click", clearPool);
    id("btnShareList")?.addEventListener("click", sharePoolOnWhatsApp);

    id("btnCreateRoom")?.addEventListener("click", createRoom);
    id("btnLeaveRoom")?.addEventListener("click", leaveRoom);

    id("btnResetFilters")?.addEventListener("click", resetAllFilters);

    id("q")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSearch(1);
    });

    id("q")?.addEventListener("input", () => {
        if (liveSearchTimer) clearTimeout(liveSearchTimer);

        liveSearchTimer = setTimeout(() => {
            const query = id("q")?.value.trim() || "";

            if (!query) return loadTrending(1);
            if (query.length < 2) return;

            doSearch(1);
        }, 350);
    });

    id("resultSort")?.addEventListener("change", () => {
        if (state.lastMode === "trending") loadTrending(1);
        else doSearch(1);
    });

    id("mediaType")?.addEventListener("change", async () => {
        state.filters.mediaType = id("mediaType").value;
        saveJson(LSFILTERS, state.filters);
        await populateGenreSelect(state.filters.mediaType);
        doSearch(1);
    });

    id("yearFilter")?.addEventListener("input", () => {
        state.filters.year = id("yearFilter").value;
        saveJson(LSFILTERS, state.filters);
    });

    id("themeToggleBtn")?.addEventListener("click", () => {
        const current =
            document.documentElement.getAttribute("data-theme") || "synthwave";
        applyTheme(current === "synthwave" ? "cupcake" : "synthwave");
    });

    id("btnMenuSignIn")?.addEventListener("click", openAuthDialog);
    id("btnMenuSignOut")?.addEventListener("click", handleSignOut);

    id("btnMenuCopyUid")?.addEventListener("click", async () => {
        const uid = authState.user?.uid;
        if (!uid) return toast("Not signed in.", "info");
        try {
            await navigator.clipboard.writeText(uid);
            toast("UID copied.", "success");
        } catch {
            window.prompt("Copy UID:", uid);
        }
    });

    id("btnAuthSubmit")?.addEventListener("click", handleAuthSubmit);
    id("btnGoogleDemo")?.addEventListener("click", handleGoogleSignIn);

    id("btnPrevPage")?.addEventListener("click", () => {
        if (state.page <= 1 || state.busy) return;
        const nextPage = state.page - 1;
        if (state.lastMode === "trending") loadTrending(nextPage);
        else doSearch(nextPage);
    });

    id("btnNextPage")?.addEventListener("click", () => {
        if (state.page >= state.totalPages || state.busy) return;
        const nextPage = state.page + 1;
        if (state.lastMode === "trending") loadTrending(nextPage);
        else doSearch(nextPage);
    });

    // Chat form + GIF + reply wiring
    const chatForm = id("roomChatForm");
    const chatInput = id("roomChatInput");
    const gifBtn = id("roomGifBtn");
    const replyPreview = id("roomReplyPreview");
    const replyToName = id("roomReplyToName");
    const replyToSnippet = id("roomReplyToSnippet");
    const replyClear = id("roomReplyClear");
    const gifDialog = id("dlgGifPicker");
    const gifSearchInput = id("gifSearchInput");
    const gifResults = id("gifResults");

    function clearReplyDraft() {
        currentReplyTarget = null;
        if (replyPreview) replyPreview.classList.add("hidden");
    }

    // inside boot(), after defining clearReplyDraft:
    registerReplyDraftSetter((msg) => {
        currentReplyTarget = msg || null;
        if (!msg) {
            if (replyPreview) replyPreview.classList.add("hidden");
            return;
        }
        if (replyPreview) replyPreview.classList.remove("hidden");
        if (replyToName) replyToName.textContent = msg.userName || "Anon";
        if (replyToSnippet) {
            if (msg.type === "gif") {
                replyToSnippet.textContent = "GIF";
            } else {
                const t = msg.text || "";
                replyToSnippet.textContent =
                    t.length > 30 ? t.slice(0, 30) + "…" : t || "";
            }
        }
    });

    if (replyClear) {
        replyClear.addEventListener("click", () => {
            clearReplyDraft();
        });
    }

    // allow rooms.js to set reply target when user clicks a message
    registerReplyDraftSetter((msg) => {
        currentReplyTarget = msg || null;
        if (!msg) {
            if (replyPreview) replyPreview.classList.add("hidden");
            return;
        }
        if (replyPreview) replyPreview.classList.remove("hidden");
        if (replyToName) replyToName.textContent = msg.userName || "Anon";
        if (replyToSnippet) {
            if (msg.type === "gif") {
                replyToSnippet.textContent = "GIF";
            } else {
                const t = msg.text || "";
                replyToSnippet.textContent =
                    t.length > 30 ? t.slice(0, 30) + "…" : t || "";
            }
        }
    });

    if (chatForm && chatInput) {
        chatForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const text = chatInput.value.trim();
            if (!text || !roomState.id) return;

            const fs = window.firebaseStore;
            if (!fs) return;
            const u = authState.user;

            const payload = {
                type: "text",
                text,
                gifUrl: null,
                userId: u?.uid ?? null,
                userName: u?.displayName ?? u?.email ?? "Anon",
                createdAt: fs.serverTimestamp(),
            };

            if (currentReplyTarget) {
                payload.replyTo = {
                    id: currentReplyTarget.id,
                    userName: currentReplyTarget.userName || "Anon",
                    type: currentReplyTarget.type || "text",
                    text: currentReplyTarget.text || null,
                    gifUrl: currentReplyTarget.gifUrl || null,
                };
            }

            try {
                await fs.addDoc(
                    fs.collection(fs.db, "rooms", roomState.id, "messages"),
                    payload
                );
                chatInput.value = "";
                clearReplyDraft();
            } catch (err) {
                toast("Failed to send message.", "error");
                console.warn(err);
            }
        });
    }

    if (gifBtn && gifDialog && gifSearchInput && gifResults) {
        gifBtn.addEventListener("click", async () => {
            gifSearchInput.value = "";
            gifResults.innerHTML = "";
            try {
                const gifs = await searchGifs("");
                renderGifResults(gifs);
            } catch (e) {
                console.warn(e);
                gifResults.innerHTML =
                    '<div class="text-xs opacity-70 p-2">Failed to load GIFs.</div>';
            }
            gifDialog.showModal();
            gifSearchInput.focus();
        });

        gifSearchInput.addEventListener("input", () => {
            const q = gifSearchInput.value.trim();
            if (!q) return;
            if (gifSearchInput._timer) clearTimeout(gifSearchInput._timer);
            gifSearchInput._timer = setTimeout(async () => {
                try {
                    const gifs = await searchGifs(q);
                    renderGifResults(gifs);
                } catch (e) {
                    console.warn(e);
                    gifResults.innerHTML =
                        '<div class="text-xs opacity-70 p-2">Failed to load GIFs.</div>';
                }
            }, 300);
        });

        async function sendGifMessage(gif) {
            if (!roomState.id) return;
            const fs = window.firebaseStore;
            if (!fs) return;
            const u = authState.user;

            const payload = {
                type: "gif",
                text: null,
                gifUrl: gif.url,
                userId: u?.uid ?? null,
                userName: u?.displayName ?? u?.email ?? "Anon",
                createdAt: fs.serverTimestamp(),
            };

            if (currentReplyTarget) {
                payload.replyTo = {
                    id: currentReplyTarget.id,
                    userName: currentReplyTarget.userName || "Anon",
                    type: currentReplyTarget.type || "text",
                    text: currentReplyTarget.text || null,
                    gifUrl: currentReplyTarget.gifUrl || null,
                };
            }

            try {
                await fs.addDoc(
                    fs.collection(fs.db, "rooms", roomState.id, "messages"),
                    payload
                );
                clearReplyDraft();
            } catch (err) {
                toast("Failed to send GIF.", "error");
                console.warn(err);
            }
        }

        function renderGifResults(list) {
            gifResults.innerHTML = "";
            if (!list.length) {
                gifResults.innerHTML =
                    '<div class="text-xs opacity-70 p-2 col-span-3">No GIFs found.</div>';
                return;
            }
            for (const g of list) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className =
                    "relative w-full aspect-[4/3] overflow-hidden rounded-lg border border-base-300";
                btn.innerHTML = `<img src="${g.thumb}" alt="${g.title || ""}" class="w-full h-full object-cover" loading="lazy" />`;
                btn.addEventListener("click", async () => {
                    await sendGifMessage(g);
                    gifDialog.close();
                });
                gifResults.appendChild(btn);
            }
        }
    }

    await loadTmdbConfig();
    await loadTrending(1);
}

if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
else boot();
