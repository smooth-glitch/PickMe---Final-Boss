(() => {
    const $ = (id) => document.getElementById(id);
    const API = "https://api.themoviedb.org/3";

    const LS_POOL = "mnp_pool_v1";
    const LS_WATCHED = "mnp_watched_v1";
    const LS_THEME = "mnp_theme_v1";
    const LS_FILTERS = "mnp_filters_v1";

    const state = {
        imgBase: "https://image.tmdb.org/t/p/",
        posterSize: "w500",
        results: [],
        pool: loadJson(LS_POOL, []),
        watched: new Set(loadJson(LS_WATCHED, [])),
        filters: loadJson(LS_FILTERS, { excludeWatched: true, minRating: 6 }),
        currentDetails: null,
        busy: false
    };

    // ---------- storage ----------
    // ---------- storage (sessionStorage + safe fallback) ----------
    const STORE = (() => {
        try {
            // sessionStorage should persist across reloads in the same tab/session. [web:126]
            sessionStorage.setItem("__mnp_test__", "1");
            sessionStorage.removeItem("__mnp_test__");
            return sessionStorage;
        } catch {
            return null; // storage blocked (don’t crash the whole app)
        }
    })();

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
            // ignore write errors so UI/features still work
        }
    }


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
            type === "success" ? "alert alert-success shadow-lg" :
                type === "error" ? "alert alert-error shadow-lg" :
                    "alert alert-info shadow-lg";

        el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
        wrap.appendChild(el);

        setTimeout(() => {
            el.remove();
            if (!wrap.children.length) wrap.remove();
        }, 2200);
    }

    function setBusy(on) {
        state.busy = !!on;

        const ids = ["btnSearch", "btnTrending", "btnPick", "btnClearPool"];
        for (const id of ids) {
            const b = $(id);
            if (b) b.disabled = state.busy;
        }
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
            // fallback ok
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
            return;
        }
        empty?.classList.add("hidden");

        for (const m of state.results) {
            const inPool = state.pool.some(x => x.id === m.id);

            const card = document.createElement("div");
            card.className = "card bg-base-100 shadow-md hover:shadow-xl transition-shadow";

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
          <div class="card-body p-4">
            <div class="flex items-start justify-between gap-2">
              <h3 class="card-title text-base leading-snug">${escapeHtml(m.title || "Untitled")}</h3>
              <span class="badge badge-primary badge-outline">${Number(m.vote_average ?? 0).toFixed(1)}</span>
            </div>
            <p class="text-sm text-base-content/60">${escapeHtml(year(m.release_date))}</p>
  
            <div class="card-actions mt-2 justify-end">
              <button class="btn btn-sm btn-ghost" data-action="details" data-id="${m.id}">Details</button>
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
    }

    function renderPool() {
        const wrap = $("pool");
        const empty = $("poolEmpty");
        if (!wrap) return;

        wrap.innerHTML = "";

        const minRating = Number(state.filters.minRating ?? 0);
        const excludeWatched = !!state.filters.excludeWatched;

        const filtered = state.pool.filter(m => {
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
        const m = state.results.find(x => x.id === id);
        if (!m) return;

        if (state.pool.some(x => x.id === id)) {
            toast("Already in pool", "info");
            return;
        }

        state.pool.unshift(pickFields(m));
        saveJson(LS_POOL, state.pool);

        renderPool();
        renderResults(state.results);
        toast("Added to pool", "success");
    }

    function removeFromPool(id) {
        state.pool = state.pool.filter(x => x.id !== id);
        saveJson(LS_POOL, state.pool);
        renderPool();
    }

    function toggleWatched(id) {
        if (state.watched.has(id)) state.watched.delete(id);
        else state.watched.add(id);

        saveJson(LS_WATCHED, Array.from(state.watched));
        renderPool();
    }

    function clearPool() {
        state.pool = [];
        saveJson(LS_POOL, state.pool);
        renderPool();
        toast("Pool cleared", "info");
    }

    function getPickCandidates() {
        const minRating = Number(state.filters.minRating ?? 0);
        const excludeWatched = !!state.filters.excludeWatched;

        return state.pool.filter(m => {
            const okRating = Number(m.vote_average ?? 0) >= minRating;
            const okWatched = excludeWatched ? !state.watched.has(m.id) : true;
            return okRating && okWatched;
        });
    }

    function pickForMe() {
        const candidates = getPickCandidates();
        if (!candidates.length) {
            toast("No movies match your filters.", "error");
            return;
        }

        // small “shuffle” feel
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        openDetails(chosen.id, { highlight: true });
    }

    // ---------- details modal ----------
    async function openDetails(id, opts = {}) {
        try {
            setBusy(true);
            const data = await tmdb(`/movie/${id}`, { language: "en-US" });
            state.currentDetails = data;

            $("dlgTitle").textContent = data.title || "Untitled";

            const parts = [];
            parts.push(year(data.release_date));
            if (typeof data.runtime === "number" && data.runtime > 0) parts.push(`${data.runtime} min`);
            if (Array.isArray(data.genres) && data.genres.length) parts.push(data.genres.map(g => g.name).join(", "));
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
        } catch (e) {
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

    // ---------- search / trending ----------
    async function loadTrending() {
        try {
            setBusy(true);
            renderResultsLoading();
            const data = await tmdb("/trending/movie/day", { language: "en-US" });
            renderResults(data.results || []);
        } catch {
            toast("Trending failed. Check API key / network.", "error");
            renderResults([]);
        } finally {
            setBusy(false);
        }
    }

    async function doSearch() {
        const q = $("q").value.trim();
        if (!q) {
            toast("Type something to search.", "info");
            return;
        }

        try {
            setBusy(true);
            renderResultsLoading();
            const data = await tmdb("/search/movie", { query: q, language: "en-US" });
            renderResults(data.results || []);
        } catch {
            toast("Search failed. Check API key / network.", "error");
            renderResults([]);
        } finally {
            setBusy(false);
        }
    }

    // ---------- theme ----------
    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        $("themeToggle").checked = theme !== "synthwave";
        saveJson(LS_THEME, theme);
    }


    function initTheme() {
        const saved = loadJson(LS_THEME, "synthwave");
        applyTheme(saved);
    }

    // ---------- boot ----------
    function syncControls() {
        $("excludeWatched").checked = !!state.filters.excludeWatched;
        $("minRating").value = String(state.filters.minRating ?? 6);
    }

    async function boot() {
        initTheme();
        syncControls();

        $("excludeWatched").addEventListener("change", () => {
            state.filters.excludeWatched = $("excludeWatched").checked;
            saveJson(LS_FILTERS, state.filters);
            renderPool();
        });

        $("minRating").addEventListener("input", () => {
            const v = Number($("minRating").value);
            state.filters.minRating = Number.isFinite(v) ? v : 0;
            saveJson(LS_FILTERS, state.filters);
            renderPool();
        });

        $("btnSearch").addEventListener("click", doSearch);
        $("btnTrending").addEventListener("click", loadTrending);
        $("btnPick").addEventListener("click", pickForMe);
        $("btnClearPool").addEventListener("click", clearPool);
        $("btnWatched").addEventListener("click", markCurrentWatched);

        $("q").addEventListener("keydown", (e) => {
            if (e.key === "Enter") doSearch();
        });

        $("themeToggle").addEventListener("change", () => {
            const theme = $("themeToggle").checked ? "cupcake" : "synthwave";
            applyTheme(theme);
        });

        renderPool();

        await loadTmdbConfig();
        await loadTrending();

        toast("Ready 🎬", "success");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
