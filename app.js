(() => {
    const $ = (id) => document.getElementById(id);
    const API = "https://api.themoviedb.org/3";

    const LS_POOL = "mnp_pool_v1";
    const LS_WATCHED = "mnp_watched_v1";
    const LS_THEME = "mnp_theme_v1";
    const LS_FILTERS = "mnp_filters_v1";
    let unsubUserDoc = null;
    let applyingRemote = false;
    let saveTimer = null;

    const state = {
        imgBase: "https://image.tmdb.org/t/p/",
        posterSize: "w500",
        results: [],
        pool: [],
        watched: new Set(),
        filters: { excludeWatched: true, minRating: 6 },
        currentDetails: null,
        busy: false,

        // pagination
        page: 1,
        totalPages: 1,
        lastMode: "trending", // "trending" | "search" | "discover"
        lastQuery: "",
        lastSort: "popularity.desc"
    };

    const authState = {
        user: null // firebase.User or null
    };

    // ---------- storage (sessionStorage + safe fallback) ----------
    const STORE = (() => {
        try {
            sessionStorage.setItem("__mnp_test__", "1");
            sessionStorage.removeItem("__mnp_test__");
            return sessionStorage;
        } catch {
            return null;
        }
    })();

    function fsReady() {
        return !!window.firebaseStore && !!authState.user;
    }

    function userDocRef() {
        const fs = window.firebaseStore;
        return fs.doc(fs.db, "users", authState.user.uid);
    }

    function scheduleCloudSave() {
        if (!fsReady() || applyingRemote) return;

        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const fs = window.firebaseStore;
                await fs.setDoc(
                    userDocRef(),
                    {
                        pool: state.pool,
                        watched: Array.from(state.watched),
                        filters: state.filters,
                        updatedAt: fs.serverTimestamp()
                    },
                    { merge: true }
                );
            } catch (e) {
                // keep app working even if firestore fails
                console.warn("Firestore save failed", e);
            }
        }, 400);
    }

    async function ensureUserDoc() {
        if (!fsReady()) return;
        const fs = window.firebaseStore;

        const ref = userDocRef();
        const snap = await fs.getDoc(ref);
        if (!snap.exists()) {
            await fs.setDoc(
                ref,
                {
                    pool: state.pool,
                    watched: Array.from(state.watched),
                    filters: state.filters,
                    createdAt: fs.serverTimestamp(),
                    updatedAt: fs.serverTimestamp()
                },
                { merge: true }
            );
        }
    }

    function startUserDocListener() {
        if (!fsReady()) return;
        const fs = window.firebaseStore;

        if (unsubUserDoc) unsubUserDoc();
        const ref = userDocRef();

        unsubUserDoc = fs.onSnapshot(ref, (snap) => {
            if (!snap.exists()) return;
            const data = snap.data() || {};

            applyingRemote = true;
            try {
                if (Array.isArray(data.pool)) state.pool = data.pool;
                if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
                if (data.filters && typeof data.filters === "object") state.filters = data.filters;

                // persist locally too (keeps old behavior)
                saveJson(LS_POOL, state.pool);
                saveJson(LS_WATCHED, Array.from(state.watched));
                saveJson(LS_FILTERS, state.filters);

                syncControls();
                renderPool();
                renderResults(state.results);
            } finally {
                applyingRemote = false;
            }
        });
    }

    function loadJson(key, fallback) {
        try {
            if (!STORE) return fallback;
            const v = JSON.parse(STORE.getItem(key));
            return v ?? fallback;
        } catch {
            return fallback;
        }
    }

    function saveJson(key, value) {
        try {
            if (!STORE) return;
            STORE.setItem(key, JSON.stringify(value));
        } catch {
            // ignore
        }
    }

    // init persisted state
    state.pool = loadJson(LS_POOL, []);
    state.watched = new Set(loadJson(LS_WATCHED, []));
    state.filters = loadJson(LS_FILTERS, { excludeWatched: true, minRating: 6 });

    // ---------- UI helpers ----------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[c]));
    }

    function toast(msg, type = "info") {
        let wrap = document.getElementById("toasts");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.id = "toasts";
            wrap.className = "toast toast-top toast-end z-[999]";
            document.body.appendChild(wrap);
        }

        const el = document.createElement("div");
        el.className =
            type === "success"
                ? "alert alert-success shadow-lg"
                : type === "error"
                    ? "alert alert-error shadow-lg"
                    : "alert alert-info shadow-lg";

        el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
        wrap.appendChild(el);

        setTimeout(() => {
            el.remove();
            if (!wrap.children.length) wrap.remove();
        }, 2200);
    }

    function setBusy(on) {
        state.busy = !!on;
        const ids = [
            "btnSearch",
            "btnTrending",
            "btnPick",
            "btnClearPool",
            "btnPrevPage",
            "btnNextPage"
        ];
        for (const id of ids) {
            const b = $(id);
            if (b) b.disabled = state.busy;
        }
        renderPager();
    }

    function year(dateStr) {
        return (dateStr || "").slice(0, 4) || "—";
    }

    function posterUrl(path) {
        if (!path) return "";
        return `${state.imgBase}${state.posterSize}${path}`;
    }

    function renderResultsLoading() {
        const wrap = $("results");
        const empty = $("resultsEmpty");
        if (!wrap) return;
        wrap.innerHTML = "";
        empty?.classList.add("hidden");

        for (let i = 0; i < 8; i++) {
            const sk = document.createElement("div");
            sk.className = "card bg-base-100 shadow-md";
            sk.innerHTML = `
          <div class="m-3 rounded-xl bg-base-200 aspect-[2/3] animate-pulse"></div>
          <div class="p-4 space-y-3">
            <div class="h-4 bg-base-200 rounded animate-pulse"></div>
            <div class="h-3 bg-base-200 rounded w-2/3 animate-pulse"></div>
            <div class="flex justify-end gap-2 pt-2">
              <div class="h-8 w-20 bg-base-200 rounded animate-pulse"></div>
              <div class="h-8 w-16 bg-base-200 rounded animate-pulse"></div>
            </div>
          </div>
        `;
            wrap.appendChild(sk);
        }
    }

    // ---------- pager ----------
    function renderPager() {
        const cur = $("pageCurrent");
        const tot = $("pageTotal");
        const prev = $("btnPrevPage");
        const next = $("btnNextPage");

        if (!cur || !tot || !prev || !next) return;

        cur.textContent = String(state.page);
        tot.textContent = String(state.totalPages);

        prev.disabled = state.page <= 1 || state.busy;
        next.disabled = state.page >= state.totalPages || state.busy;
    }

    // ---------- TMDB ----------
    async function tmdb(path, params = {}) {
        const key = window.APP_CONFIG?.TMDB_API_KEY;
        if (!key) throw new Error("Missing TMDB key in config.js");

        const u = new URL(API + path);
        u.searchParams.set("api_key", key);
        u.searchParams.set("include_adult", "false");

        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null || v === "") continue;
            u.searchParams.set(k, v);
        }

        const res = await fetch(u);
        if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
        return res.json();
    }

    async function loadTmdbConfig() {
        try {
            const cfg = await tmdb("/configuration");
            const images = cfg?.images;
            if (images?.secure_base_url) state.imgBase = images.secure_base_url;
            const sizes = images?.poster_sizes || [];
            state.posterSize =
                sizes.includes("w500") ? "w500" :
                    sizes.includes("w342") ? "w342" :
                        (sizes[0] || "w500");
        } catch {
            // ignore
        }
    }

    // ---------- rendering ----------
    function renderResults(list) {
        state.results = Array.isArray(list) ? list : [];
        const wrap = $("results");
        const empty = $("resultsEmpty");
        if (!wrap) return;

        wrap.innerHTML = "";

        if (!state.results.length) {
            empty?.classList.remove("hidden");
            renderPager();
            return;
        }
        empty?.classList.add("hidden");

        for (const m of state.results) {
            const inPool = state.pool.some((x) => x.id === m.id);

            const card = document.createElement("div");
            card.className =
                "card bg-base-100 shadow-md hover:shadow-xl transition-shadow w-full";

            const p = posterUrl(m.poster_path);
            const poster = p
                ? `<figure class="px-3 pt-3">
               <img class="rounded-xl aspect-[2/3] object-cover w-full"
                    src="${p}"
                    alt="${escapeHtml(m.title || "Poster")}"
                    loading="lazy" />
             </figure>`
                : `<div class="m-3 rounded-xl bg-base-200 aspect-[2/3] grid place-items-center text-base-content/60">
               No poster
             </div>`;

            card.innerHTML = `
             ${poster}
             <div class="card-body p-4 gap-2">
               <div class="flex items-start justify-between gap-3">
                 <h3 class="card-title text-base leading-snug line-clamp-2 flex-1">
                   ${escapeHtml(m.title || "Untitled")}
                 </h3>
                 <span class="badge badge-primary badge-outline shrink-0">
                   ${Number(m.vote_average ?? 0).toFixed(1)}
                 </span>
               </div>
               <p class="text-sm text-base-content/60">
                 ${escapeHtml(year(m.release_date))}
               </p>
               <div class="card-actions mt-3 justify-end gap-2">
                 <button class="btn btn-sm btn-ghost" data-action="details" data-id="${m.id}">
                   Details
                 </button>
                 <button class="btn btn-sm ${inPool ? "btn-disabled" : "btn-secondary"}"
                         data-action="add" data-id="${m.id}">
                   ${inPool ? "In pool" : "Add"}
                 </button>
               </div>
             </div>
           `;


            card.addEventListener("click", (e) => {
                const btn = e.target.closest("button[data-action]");
                if (!btn) return;

                const id = Number(btn.dataset.id);
                const action = btn.dataset.action;

                if (action === "details") openDetails(id);
                if (action === "add") addToPoolById(id);
            });

            wrap.appendChild(card);
        }

        renderPager();
    }

    function renderPool() {
        const wrap = $("pool");
        const empty = $("poolEmpty");
        if (!wrap) return;

        wrap.innerHTML = "";

        const minRating = Number(state.filters.minRating ?? 0);
        const excludeWatched = !!state.filters.excludeWatched;

        const filtered = state.pool.filter((m) => {
            const okRating = Number(m.vote_average ?? 0) >= minRating;
            const okWatched = excludeWatched ? !state.watched.has(m.id) : true;
            return okRating && okWatched;
        });

        if (!filtered.length) {
            if (empty) {
                empty.textContent = state.pool.length
                    ? "No movies match your filters."
                    : "Add movies from results to build your pool.";
                empty.classList.remove("hidden");
            }
        } else {
            empty?.classList.add("hidden");
        }

        for (const m of filtered) {
            const row = document.createElement("div");
            row.className = "flex items-center gap-3 p-2 rounded-xl bg-base-200/40 border border-base-300";

            const p = posterUrl(m.poster_path);
            const thumb = p
                ? `<img class="w-12 h-16 rounded-lg object-cover" src="${p}" alt="" loading="lazy">`
                : `<div class="w-12 h-16 rounded-lg bg-base-200 grid place-items-center text-xs text-base-content/60">—</div>`;

            const isWatched = state.watched.has(m.id);

            row.innerHTML = `
          ${thumb}
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">${escapeHtml(m.title || "Untitled")}</div>
            <div class="text-xs text-base-content/60 flex gap-2 items-center flex-wrap">
              <span>${escapeHtml(year(m.release_date))}</span>
              <span class="badge badge-outline badge-sm">${Number(m.vote_average ?? 0).toFixed(1)}</span>
              ${isWatched ? `<span class="badge badge-accent badge-sm">Watched</span>` : ``}
            </div>
          </div>
  
          <div class="flex gap-2">
            <button class="btn btn-xs btn-ghost" data-action="details" data-id="${m.id}">Details</button>
            <button class="btn btn-xs ${isWatched ? "btn-ghost" : "btn-accent"}" data-action="toggleWatched" data-id="${m.id}">
              ${isWatched ? "Unwatch" : "Watched"}
            </button>
            <button class="btn btn-xs btn-error btn-outline" data-action="remove" data-id="${m.id}">Remove</button>
          </div>
        `;

            row.addEventListener("click", (e) => {
                const btn = e.target.closest("button[data-action]");
                if (!btn) return;

                const id = Number(btn.dataset.id);
                const action = btn.dataset.action;

                if (action === "details") openDetails(id);
                if (action === "toggleWatched") toggleWatched(id);
                if (action === "remove") removeFromPool(id);
            });

            wrap.appendChild(row);
        }
    }

    // ---------- pool ops ----------
    function pickFields(m) {
        return {
            id: m.id,
            title: m.title,
            poster_path: m.poster_path,
            vote_average: m.vote_average,
            release_date: m.release_date
        };
    }

    function addToPoolById(id) {
        const m = state.results.find((x) => x.id === id);
        if (!m) return;

        if (state.pool.some((x) => x.id === id)) {
            toast("Already in pool", "info");
            return;
        }

        state.pool.unshift(pickFields(m));
        saveJson(LS_POOL, state.pool);

        renderPool();
        renderResults(state.results);
        scheduleCloudSave();
        toast("Added to pool", "success");
    }

    function removeFromPool(id) {
        state.pool = state.pool.filter((x) => x.id !== id);
        saveJson(LS_POOL, state.pool);
        renderPool();
        scheduleCloudSave();
    }

    function toggleWatched(id) {
        if (state.watched.has(id)) state.watched.delete(id);
        else state.watched.add(id);

        saveJson(LS_WATCHED, Array.from(state.watched));
        renderPool();
        scheduleCloudSave();
    }

    function clearPool() {
        state.pool = [];
        saveJson(LS_POOL, state.pool);
        renderPool();
        scheduleCloudSave();
        toast("Pool cleared", "info");
    }

    function getPickCandidates() {
        const minRating = Number(state.filters.minRating ?? 0);
        const excludeWatched = !!state.filters.excludeWatched;

        return state.pool.filter((m) => {
            const okRating = Number(m.vote_average ?? 0) >= minRating;
            const okWatched = excludeWatched ? !state.watched.has(m.id) : true;
            return okRating && okWatched;
        });
    }

    function pickForMe() {
        let candidates = getPickCandidates();

        if (!candidates.length && state.pool.length) {
            candidates = [...state.pool];
        }

        if (!candidates.length) {
            toast("No movies in the pool to pick from.", "error");
            return;
        }

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        openDetails(chosen.id, { highlight: true });
    }

    // ---------- details ----------
    async function openDetails(id, opts = {}) {
        try {
            setBusy(true);
            const data = await tmdb(`/movie/${id}`, { language: "en-US" });
            state.currentDetails = data;

            $("dlgTitle").textContent = data.title || "Untitled";

            const parts = [];
            parts.push(year(data.release_date));
            if (typeof data.runtime === "number" && data.runtime > 0) parts.push(`${data.runtime} min`);
            if (Array.isArray(data.genres) && data.genres.length) parts.push(data.genres.map((g) => g.name).join(", "));
            parts.push(`★ ${Number(data.vote_average ?? 0).toFixed(1)}`);

            $("dlgMeta").textContent = parts.join(" • ");

            const box = $("dlgOverview");
            box.innerHTML = "";

            const wrap = document.createElement("div");
            wrap.className = "flex gap-4 flex-col sm:flex-row";

            const left = document.createElement("div");
            left.className = "sm:w-40";
            const p = posterUrl(data.poster_path);

            left.innerHTML = p
                ? `<img class="rounded-xl w-full aspect-[2/3] object-cover" src="${p}" alt="" loading="lazy">`
                : `<div class="rounded-xl bg-base-200 aspect-[2/3] grid place-items-center text-base-content/60">No poster</div>`;

            const right = document.createElement("div");
            right.className = "flex-1";

            const ov = document.createElement("p");
            ov.className = "leading-relaxed";
            ov.textContent = data.overview || "No overview available.";
            right.appendChild(ov);

            if (opts.highlight) {
                const hint = document.createElement("div");
                hint.className = "mt-3 badge badge-primary badge-outline";
                hint.textContent = "Tonight’s pick";
                right.appendChild(hint);
            }

            wrap.appendChild(left);
            wrap.appendChild(right);
            box.appendChild(wrap);

            $("dlg").showModal();
        } catch {
            toast("Failed to load details.", "error");
        } finally {
            setBusy(false);
        }
    }

    function markCurrentWatched() {
        const id = state.currentDetails?.id;
        if (!id) return;
        state.watched.add(id);
        saveJson(LS_WATCHED, Array.from(state.watched));
        renderPool();
        toast("Marked watched", "success");
    }

    // ---------- search / discover / trending ----------
    async function loadTrending(page = 1) {
        try {
            setBusy(true);
            renderResultsLoading();

            state.lastMode = "trending";
            state.lastQuery = "";
            state.page = page;

            const data = await tmdb("/trending/movie/day", {
                language: "en-US",
                page
            });

            state.totalPages = data.total_pages || 1;
            renderResults(data.results || []);
        } catch {
            toast("Trending failed. Check API key / network.", "error");
            state.totalPages = 1;
            renderResults([]);
        } finally {
            setBusy(false);
        }
    }

    async function doSearch(page = 1) {
        const q = $("q").value.trim();
        const sort = $("resultSort")?.value || "popularity.desc";
        const minVote = Number(state.filters.minRating ?? 0);

        try {
            setBusy(true);
            renderResultsLoading();

            state.page = page;
            state.lastSort = sort;

            let data;
            if (q) {
                state.lastMode = "search";
                state.lastQuery = q;

                data = await tmdb("/search/movie", {
                    query: q,
                    language: "en-US",
                    include_adult: "false",
                    page
                });
            } else {
                state.lastMode = "discover";
                state.lastQuery = "";

                data = await tmdb("/discover/movie", {
                    language: "en-US",
                    sort_by: sort,
                    "vote_average.gte": minVote,
                    "vote_count.gte": 100,
                    page
                });
            }

            state.totalPages = data.total_pages || 1;
            renderResults(data.results || []);
        } catch {
            toast("Search / discover failed.", "error");
            state.totalPages = 1;
            renderResults([]);
        } finally {
            setBusy(false);
        }
    }

    // ---------- theme ----------
    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        saveJson(LS_THEME, theme);
    }

    function initTheme() {
        const saved = loadJson(LS_THEME, "synthwave");
        applyTheme(saved);
    }

    // ---------- auth helpers ----------
    function updateUserChip() {
        const chip = $("userChip");
        const icon = $("userStatusIcon");
        if (!chip) return;

        if (authState.user) {
            const u = authState.user;
            chip.textContent = u.displayName || u.email || "Signed in";
            if (icon) icon.classList.remove("hidden");
        } else {
            chip.textContent = "Sign in";
            if (icon) icon.classList.add("hidden");
        }
    }


    function openAuthDialog() {
        const dlg = $("dlgAuth");
        if (!dlg) return;

        if (authState.user) {
            toast(
                `Signed in as ${authState.user.displayName || authState.user.email}`,
                "info"
            );
            return;
        }

        $("authName").value = "";
        $("authEmail").value = "";
        $("authPass").value = "";
        dlg.showModal();
    }

    function handleAuthSubmit() {
        const fa = window.firebaseAuth;
        if (!fa) {
            toast("Auth not ready. Check Firebase config.", "error");
            return;
        }

        const name = $("authName").value.trim();
        const email = $("authEmail").value.trim();
        const pass = $("authPass").value.trim();

        if (!email || !pass) {
            toast("Email and password required.", "error");
            return;
        }

        fa
            .signInWithEmailAndPassword(fa.auth, email, pass)
            .then(() => {
                $("dlgAuth")?.close();
                toast("Signed in.", "success");
            })
            .catch((err) => {
                if (err.code === "auth/user-not-found") {
                    return fa
                        .createUserWithEmailAndPassword(fa.auth, email, pass)
                        .then(() => {
                            $("dlgAuth")?.close();
                            toast("Account created & signed in.", "success");
                        });
                }
                toast(err.message || "Sign-in failed.", "error");
            });
    }

    function handleGoogleSignIn() {
        const fa = window.firebaseAuth;
        if (!fa) {
            toast("Auth not ready. Check Firebase config.", "error");
            return;
        }

        fa
            .signInWithPopup(fa.auth, fa.provider)
            .then(() => {
                $("dlgAuth")?.close();
                toast("Signed in with Google.", "success");
            })
            .catch((err) => {
                if (err.code !== "auth/popup-closed-by-user") {
                    toast(err.message || "Google sign-in failed.", "error");
                }
            });
    }

    function handleSignOut() {
        const fa = window.firebaseAuth;
        if (!fa) return;
        fa
            .signOut(fa.auth)
            .then(() => {
                toast("Signed out.", "info");
            })
            .catch((err) => {
                toast(err.message || "Sign-out failed.", "error");
            });
    }

    // ---------- boot ----------
    function syncControls() {
        const ex = $("excludeWatched");
        const mr = $("minRating");
        if (ex) ex.checked = !!state.filters.excludeWatched;
        if (mr) mr.value = String(state.filters.minRating ?? 6);
    }

    async function boot() {
        initTheme();
        syncControls();
        renderPool();
        renderPager();
        updateUserChip();

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

                if (!authState.user) {
                    if (unsubUserDoc) unsubUserDoc();
                    unsubUserDoc = null;
                    return;
                }

                await ensureUserDoc();
                startUserDocListener();
            });

        }

        $("excludeWatched")?.addEventListener("change", () => {
            state.filters.excludeWatched = $("excludeWatched").checked;
            saveJson(LS_FILTERS, state.filters);
            renderPool();
            scheduleCloudSave();
        });

        $("minRating")?.addEventListener("input", () => {
            const v = Number($("minRating").value);
            state.filters.minRating = Number.isFinite(v) ? v : 0;
            saveJson(LS_FILTERS, state.filters);
            renderPool();
            scheduleCloudSave();
        });

        $("btnSearch")?.addEventListener("click", () => doSearch(1));
        $("btnTrending")?.addEventListener("click", () => loadTrending(1));
        $("btnPick")?.addEventListener("click", pickForMe);
        $("btnClearPool")?.addEventListener("click", clearPool);
        $("btnWatched")?.addEventListener("click", markCurrentWatched);

        $("q")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") doSearch(1);
        });

        $("resultSort")?.addEventListener("change", () => {
            if (state.lastMode === "trending") loadTrending(1);
            else doSearch(1);
        });

        $("btnPrevPage")?.addEventListener("click", () => {
            if (state.page <= 1 || state.busy) return;
            const nextPage = state.page - 1;
            if (state.lastMode === "trending") loadTrending(nextPage);
            else doSearch(nextPage);
        });

        $("btnNextPage")?.addEventListener("click", () => {
            if (state.page >= state.totalPages || state.busy) return;
            const nextPage = state.page + 1;
            if (state.lastMode === "trending") loadTrending(nextPage);
            else doSearch(nextPage);
        });

        $("themeToggleBtn")?.addEventListener("click", () => {
            const current =
                document.documentElement.getAttribute("data-theme") || "synthwave";
            const next = current === "synthwave" ? "cupcake" : "synthwave";
            applyTheme(next);
        });


        $("btnUser")?.addEventListener("click", () => {
            if (authState.user) {
                handleSignOut();
            } else {
                openAuthDialog();
            }
        });

        $("btnAuthSubmit")?.addEventListener("click", handleAuthSubmit);
        $("btnGoogleDemo")?.addEventListener("click", handleGoogleSignIn);

        await loadTmdbConfig();
        await loadTrending(1);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
