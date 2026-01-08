(() => {
    const $ = (id) => document.getElementById(id);
    const API = "https://api.themoviedb.org/3";
    const id = (x) => document.getElementById(x);
    const LS_POOL = "mnp_pool_v1";
    const LS_WATCHED = "mnp_watched_v1";
    const LS_THEME = "mnp_theme_v1";
    const LSFILTERS = "mnp_filters_v1";
    let unsubUserDoc = null;
    let applyingRemote = false;
    let saveTimer = null;
    let loadedSharedList = null;
    let lastAutoOpenedPickKey = null;
    let lastPickedMovieId = null;
    const btnResetFilters = id("btnResetFilters");

    let unsubMembers = null;
    let heartbeatTimer = null;

    const HEARTBEAT_MS = 25000;        // 25s
    const ONLINE_WINDOW_MS = 70000;    // 70s (>= HEARTBEAT_MS * 2 is safe)

    const state = {
        imgBase: "https://image.tmdb.org/t/p/",
        posterSize: "w500",
        results: [],
        pool: [],
        watched: new Set(),
        filters: {
            excludeWatched: true,
            minRating: 6,
            mediaType: "movie",
            year: "",
            genres: [] // array of genre ids
        },
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

    const DEFAULT_FILTERS = {
        excludeWatched: true,
        minRating: 6,
        region: null, // auto-filled
        ott: { netflix: false, prime: false, hotstar: false }
    };

    function normalizeFilters(f) {
        const out = { ...DEFAULT_FILTERS, ...(f || {}) };
        out.ott = { ...DEFAULT_FILTERS.ott, ...(f?.ott || {}) };
        return out;
    }

    state.filters = normalizeFilters(loadJson(LSFILTERS, DEFAULT_FILTERS));

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

    const roomState = { id: null, unsub: null };

    function getMultiSelectValues(sel) {
        if (!sel) return [];
        return Array.from(sel.selectedOptions).map(o => Number(o.value)).filter(Number.isFinite);
    }

    function requireLoginForRoomWrite() {
        if (!inRoom()) return true;      // non-room mode: allow local edits
        if (authState.user) return true; // room mode + logged in: allow
        toast("Login to edit this room.", "info");
        openAuthDialog();
        return false;
    }

    // ===== Watch filters (Region auto + OTT multi) =====
    function detectRegionFromBrowser() {
        const loc =
            Intl.DateTimeFormat().resolvedOptions().locale ||
            navigator.language ||
            "en-IN";

        try {
            const r = new Intl.Locale(loc).region;
            if (r && /^[A-Z]{2}$/.test(r)) return r;
        } catch { }

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (tz === "Asia/Kolkata") return "IN";

        const m = String(loc).match(/-([A-Za-z]{2})\b/);
        if (m) return m[1].toUpperCase();

        return "IN";
    }


    async function loadGenres(kind) {
        // kind: "movie" or "tv"
        const data = await tmdb(`/genre/${kind}/list`, { language: "en-US" });
        return Array.isArray(data.genres) ? data.genres : [];
    }

    function updateOttDropdownLabel() {
        const countEl = document.getElementById("ottDropdownCount");
        if (!countEl) return;

        const ott = state.filters?.ott || {};
        const n = Number(!!ott.netflix) + Number(!!ott.prime) + Number(!!ott.hotstar);
        countEl.textContent = n ? `${n} selected` : "";
    }

    function updateGenreDropdownLabel() {
        const countEl = document.getElementById("genreDropdownCount");
        const n = Array.isArray(state.filters.genres) ? state.filters.genres.length : 0;
        if (countEl) countEl.textContent = n ? `${n} selected` : "";
    }

    async function populateGenreSelect(kind) {
        const menu = document.getElementById("genreDropdownMenu");
        if (!menu) return;

        if (!Array.isArray(state.filters.genres)) state.filters.genres = [];
        const chosen = new Set(state.filters.genres);

        menu.innerHTML = `<div class="text-xs opacity-60 p-2">Loading…</div>`;
        const genres = await loadGenres(kind);

        menu.innerHTML = "";
        for (const g of genres) {
            const row = document.createElement("label");
            row.className = "flex items-center gap-2 p-2 rounded-lg hover:bg-base-200/40 cursor-pointer";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "checkbox checkbox-xs";
            cb.checked = chosen.has(g.id);

            cb.addEventListener("change", () => {
                if (cb.checked) chosen.add(g.id);
                else chosen.delete(g.id);

                state.filters.genres = Array.from(chosen);
                saveJson(LSFILTERS, state.filters);
                scheduleCloudSave();
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




    function ensureWatchFilterDefaults() {
        if (!state.filters || typeof state.filters !== "object") state.filters = {};
        if (state.filters.excludeWatched === undefined) state.filters.excludeWatched = true;
        if (state.filters.minRating === undefined) state.filters.minRating = 6;

        if (!state.filters.region) state.filters.region = detectRegionFromBrowser();
        if (!state.filters.ott || typeof state.filters.ott !== "object") {
            state.filters.ott = { netflix: false, prime: false, hotstar: false };
        }
    }



    function membersColRef() {
        const fs = window.firebaseStore;
        return fs.collection(fs.db, "rooms", roomState.id, "members");
    }

    function stopMembersListener() {
        if (unsubMembers) unsubMembers();
        unsubMembers = null;
    }

    function stopHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    async function heartbeatOnce() {
        if (!inRoom() || !authState.user) return;

        const fs = window.firebaseStore;
        const u = authState.user;

        await fs.setDoc(
            fs.doc(fs.db, "rooms", roomState.id, "members", u.uid),
            {
                uid: u.uid,
                name: u.displayName || "",
                email: u.email || "",
                lastSeenAt: fs.serverTimestamp()
            },
            { merge: true }
        );
    }

    function startHeartbeat() {
        stopHeartbeat();
        if (!inRoom() || !authState.user) return;

        heartbeatOnce().catch(() => { });
        heartbeatTimer = setInterval(() => heartbeatOnce().catch(() => { }), HEARTBEAT_MS);

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") heartbeatOnce().catch(() => { });
        });
    }

    let providerIdsByKey = { netflix: null, prime: null, hotstar: null };

    async function loadAvailableRegions() {
        const data = await tmdb("/watch/providers/regions", { language: "en-US" }); // regions list [web:13]
        return Array.isArray(data?.results) ? data.results : [];
    }

    async function loadProviderIdsForRegion(region) {
        const data = await tmdb("/watch/providers/movie", { watch_region: region, language: "en-US" }); // provider list [web:29]
        const list = Array.isArray(data?.results) ? data.results : [];

        const findId = (patterns) => {
            const hit = list.find(p =>
                patterns.some(rx => rx.test(String(p.provider_name || "").toLowerCase()))
            );
            return hit?.provider_id ?? null;
        };

        providerIdsByKey.netflix = findId([/netflix/]);
        providerIdsByKey.prime = findId([/prime video/, /amazon prime/]);
        providerIdsByKey.hotstar = findId([/hotstar/, /disney\+ hotstar/, /disney plus hotstar/]);
    }

    function selectedProviderIds() {
        const ids = [];
        if (state.filters.ott?.netflix) ids.push(providerIdsByKey.netflix);
        if (state.filters.ott?.prime) ids.push(providerIdsByKey.prime);
        if (state.filters.ott?.hotstar) ids.push(providerIdsByKey.hotstar);
        return ids.filter((x) => Number.isFinite(x));
    }

    async function initWatchFiltersUI() {
        const cbNetflix = document.getElementById("ottNetflix");
        const cbPrime = document.getElementById("ottPrime");
        const cbHotstar = document.getElementById("ottHotstar");

        // Region UI is optional now (you removed it from HTML)
        const regionSel = document.getElementById("watchRegion");
        const hint = document.getElementById("regionHint");

        if (!cbNetflix || !cbPrime || !cbHotstar) return;

        // Ensure defaults exist (this sets state.filters.region using detectRegionFromBrowser)
        ensureWatchFilterDefaults();
        saveJson(LSFILTERS, state.filters);

        // If region dropdown exists, populate + sync it; otherwise just use detected/saved region
        if (regionSel) {
            const data = await tmdb("watch/providers/regions", { language: "en-US" });
            const regions = Array.isArray(data?.results) ? data.results : [];

            regionSel.innerHTML = regions
                .map(
                    (r) =>
                        `<option value="${r.iso_3166_1}">${escapeHtml(r.english_name)} (${r.iso_3166_1})</option>`
                )
                .join("");

            const detected = detectRegionFromBrowser();
            state.filters.region = state.filters.region || detected;

            const exists = regions.some((r) => r.iso_3166_1 === state.filters.region);
            regionSel.value = exists ? state.filters.region : "IN";

            if (hint) hint.textContent = `Auto ${regionSel.value}`;

            regionSel.addEventListener("change", async () => {
                state.filters.region = regionSel.value;
                if (hint) hint.textContent = `Selected ${state.filters.region}`;
                saveJson(LSFILTERS, state.filters);

                await loadProviderIdsForRegion(state.filters.region);
                scheduleCloudSave();
                if (state.lastMode !== "trending") doSearch(1);
            });
        } else {
            // No region UI: just lock to detected/saved region
            state.filters.region = state.filters.region || detectRegionFromBrowser();
        }

        // Restore checkbox state from saved filters
        cbNetflix.checked = !!state.filters.ott?.netflix;
        cbPrime.checked = !!state.filters.ott?.prime;
        cbHotstar.checked = !!state.filters.ott?.hotstar;
        updateOttDropdownLabel();

        // IMPORTANT: load provider IDs so selectedProviderIds() returns real numbers
        await loadProviderIdsForRegion(state.filters.region);

        const onOttChange = () => {
            state.filters.ott = {
                netflix: cbNetflix.checked,
                prime: cbPrime.checked,
                hotstar: cbHotstar.checked,
            };
            updateOttDropdownLabel();
            saveJson(LSFILTERS, state.filters);
            scheduleCloudSave();

            if (state.lastMode !== "trending") doSearch(1);
        };

        cbNetflix.addEventListener("change", onOttChange);
        cbPrime.addEventListener("change", onOttChange);
        cbHotstar.addEventListener("change", onOttChange);
    }



    async function filterResultsByOtt(kind, items) {
        const providerIds = selectedProviderIds();
        if (!providerIds.length) return items;

        const region = (state.filters.region || "IN").toUpperCase();

        // limit to avoid rate limits; you can tune this
        const batch = items.slice(0, 20);

        const checks = await Promise.allSettled(
            batch.map(async (it) => {
                const wp = await tmdb(`${kind}/${it.id}/watch/providers`, {});
                const entry = wp?.results?.[region];
                const flatrate = Array.isArray(entry?.flatrate) ? entry.flatrate : [];
                const ids = new Set(flatrate.map((p) => p.provider_id));
                const ok = providerIds.some((pid) => ids.has(pid));
                return ok ? it : null;
            })
        );

        return checks
            .map((r) => (r.status === "fulfilled" ? r.value : null))
            .filter(Boolean);
    }

    function pickWatchCountry(wpResults) {
        // Prefer saved region if present, else try browser locale, else fallback IN/US
        const preferred = (state.filters?.region || "").toUpperCase();
        if (preferred && wpResults?.[preferred]) return preferred;

        const loc = Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || "en-IN";
        const m = String(loc).match(/-([A-Za-z]{2})\b/);
        const fromLocale = m ? m[1].toUpperCase() : null;
        if (fromLocale && wpResults?.[fromLocale]) return fromLocale;

        if (wpResults?.IN) return "IN";
        if (wpResults?.US) return "US";

        // Any available country
        const keys = wpResults ? Object.keys(wpResults) : [];
        return keys[0] || null;
    }

    function renderWatchProvidersSection(wpData) {
        const results = wpData?.results;
        if (!results || typeof results !== "object") return null;

        const country = pickWatchCountry(results);
        if (!country) return null;

        const entry = results[country];
        if (!entry) return null;

        const wrap = document.createElement("div");
        wrap.className = "wp-section";

        const title = document.createElement("div");
        title.className = "wp-title";
        title.textContent = `Where to watch (${country})`;
        wrap.appendChild(title);

        const badgeWrap = document.createElement("div");
        badgeWrap.className = "wp-badges";
        wrap.appendChild(badgeWrap);

        // Collect unique providers across flatrate/rent/buy/free/ads
        const buckets = [
            ["Stream", entry.flatrate],
            ["Rent", entry.rent],
            ["Buy", entry.buy],
            ["Free", entry.free],
            ["Ads", entry.ads],
        ];

        const byId = new Map(); // provider_id -> { provider, types:Set }
        for (const [type, arr] of buckets) {
            if (!Array.isArray(arr)) continue;
            for (const p of arr) {
                const id = p?.provider_id;
                if (!id) continue;
                if (!byId.has(id)) byId.set(id, { provider: p, types: new Set() });
                byId.get(id).types.add(type);
            }
        }

        const providers = Array.from(byId.values());

        // optional: prioritize Stream first, then others
        providers.sort((a, b) => {
            const aStream = a.types.has("Stream") ? 1 : 0;
            const bStream = b.types.has("Stream") ? 1 : 0;
            if (aStream !== bStream) return bStream - aStream;
            return String(a.provider.provider_name || "").localeCompare(String(b.provider.provider_name || ""));
        });

        // Render unique pills (limit to avoid huge UI)
        for (const item of providers.slice(0, 12)) {
            const p = item.provider;
            const types = Array.from(item.types);

            const pill = document.createElement("a");
            pill.className = "wp-pill";
            pill.href = entry.link || "#";
            pill.target = "_blank";
            pill.rel = "noopener noreferrer";
            pill.title = `${p.provider_name} • ${types.join(", ")}`;

            const icon = document.createElement("img");
            icon.alt = p.provider_name;
            icon.loading = "lazy";
            icon.src = p.logo_path ? `https://image.tmdb.org/t/p/w45${p.logo_path}` : "";
            icon.onerror = () => (icon.style.display = "none");

            const text = document.createElement("span");
            text.textContent = p.provider_name;

            const tag = document.createElement("span");
            tag.className = "opacity-70";
            tag.style.fontSize = "0.7rem";
            tag.textContent = `(${types.join("/")})`;

            pill.appendChild(icon);
            pill.appendChild(text);
            pill.appendChild(tag);
            badgeWrap.appendChild(pill);
        }

        if (!providers.length) return null;
        return wrap;
    }


    function startMembersListener() {
        const fs = window.firebaseStore;
        if (!fs || !inRoom()) return;

        stopMembersListener();

        $("roomMembersWrap")?.classList.remove("hidden");

        unsubMembers = fs.onSnapshot(
            membersColRef(),
            (snap) => {
                const now = Date.now();
                const members = snap.docs.map((d) => {
                    const m = d.data() || {};
                    const ms = typeof m.lastSeenAt?.toMillis === "function" ? m.lastSeenAt.toMillis() : 0;
                    const online = ms && (now - ms) <= ONLINE_WINDOW_MS;
                    return { id: d.id, name: m.name, email: m.email, lastSeenMs: ms, online };
                }).sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));

                const onlineCount = members.filter(x => x.online).length;
                const countEl = $("roomOnlineCount");
                if (countEl) countEl.textContent = `Online: ${onlineCount}`;

                const list = $("roomMembersList");
                if (!list) return;
                list.innerHTML = members.map(m => {
                    const label = (m.name || m.email || m.id);
                    const badge = m.online ? "badge-success" : "badge-ghost";
                    const status = m.online ? "online" : "offline";
                    return `
                <div class="flex items-center justify-between p-2 rounded-xl bg-base-200/40 border border-base-300">
                  <div class="truncate">${escapeHtml(label)}</div>
                  <span class="badge badge-sm ${badge}">${status}</span>
                </div>
              `;
                }).join("");
            }
        );
    }

    function inRoom() {
        return !!roomState.id;
    }

    function roomDocRef() {
        const fs = window.firebaseStore;
        return fs.doc(fs.db, "rooms", roomState.id);
    }

    function activeDocRef() {
        return inRoom() ? roomDocRef() : userDocRef();
    }

    function updateRoomUI() {
        const badge = $("roomBadge");
        const btnCreate = $("btnCreateRoom");
        const btnCopy = $("btnCopyRoomLink");
        const btnLeave = $("btnLeaveRoom");

        if (badge) {
            badge.classList.toggle("hidden", !inRoom());
            badge.textContent = inRoom() ? `Room: ${roomState.id}` : "Room: —";
        }
        if (btnCreate) btnCreate.classList.toggle("hidden", inRoom());
        if (btnCopy) btnCopy.classList.toggle("hidden", !inRoom());
        if (btnLeave) btnLeave.classList.toggle("hidden", !inRoom());
    }

    function fsReady() {
        return !!window.firebaseStore && !!authState.user;
    }

    function userDocRef() {
        const fs = window.firebaseStore;
        return fs.doc(fs.db, "users", authState.user.uid);
    }

    function scheduleCloudSave() {
        if (!authState.user) return;
        if (!fsReady() || applyingRemote) return;

        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const fs = window.firebaseStore;
                await fs.setDoc(activeDocRef(), {
                    pool: state.pool,
                    watched: Array.from(state.watched),
                    filters: state.filters,
                    updatedAt: fs.serverTimestamp()
                }, { merge: true });

            } catch (e) {
                // keep app working even if firestore fails
                console.warn("Firestore save failed", e);
            }
        }, 400);
    }

    function stopRoomListener() {
        if (roomState.unsub) roomState.unsub();
        roomState.unsub = null;
    }

    function startRoomListener() {
        const fs = window.firebaseStore;
        if (!fs || !inRoom()) return;

        stopRoomListener();

        roomState.unsub = fs.onSnapshot(
            roomDocRef(),
            (snap) => {
                if (!snap.exists()) return;
                const data = snap.data() || {};
                const lp = data.lastPick;

                if (lp && lp.movieId) {

                    const banner = document.getElementById("roomPickBanner");
                    const text = document.getElementById("roomPickText");

                    if (banner && text) {
                        const title = lp.title || "Tonight’s pick";
                        banner.classList.remove("hidden");
                        text.textContent = `Tonight’s pick: ${title}`;
                    }
                    // Build a stable key so we open only once per pick
                    const pickedAtMs =
                        typeof lp.pickedAt?.toMillis === "function" ? lp.pickedAt.toMillis() : "";
                    const key = `${lp.movieId}_${pickedAtMs}`;

                    if (key !== lastAutoOpenedPickKey) {
                        lastAutoOpenedPickKey = key;

                        // Sync filters UI too (optional but recommended)
                        syncControls();

                        // Auto-open for everyone
                        openDetails(lp.movieId, { highlight: true });
                    }
                }



                applyingRemote = true;
                try {
                    if (Array.isArray(data.pool)) state.pool = data.pool;
                    if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
                    if (data.filters && typeof data.filters === "object") state.filters = normalizeFilters(data.filters);

                    renderPool();
                    renderResults(state.results);
                } finally {
                    applyingRemote = false;
                }
            },
            (err) => {
                console.warn("Room listener failed:", err);
                toast(err?.message || "Failed to load room.", "error");
            }
        );
    }

    function setRoomInUrl(roomId) {
        const url = new URL(window.location.href);
        if (roomId) url.searchParams.set("room", roomId);
        else url.searchParams.delete("room");
        history.replaceState({}, "", url.toString());
    }

    async function createRoom() {
        const fs = window.firebaseStore;
        if (!fs) return toast("Firestore not ready.", "error");
        if (!authState.user) {
            openAuthDialog();
            toast("Sign in to create a room.", "info");
            return;
        }

        const ref = fs.doc(fs.collection(fs.db, "rooms"));
        await fs.setDoc(ref, {
            ownerUid: authState.user.uid,
            pool: state.pool,
            watched: Array.from(state.watched),
            filters: state.filters,
            createdAt: fs.serverTimestamp(),
            updatedAt: fs.serverTimestamp()
        });

        joinRoom(ref.id);
    }

    function joinRoom(roomId) {
        // stop user listener so it doesn't overwrite the room state
        if (unsubUserDoc) unsubUserDoc();
        unsubUserDoc = null;

        roomState.id = roomId;
        setRoomInUrl(roomId);
        updateRoomUI();
        startRoomListener();
        startMembersListener();
        startHeartbeat();

    }

    function leaveRoom() {
        stopRoomListener();
        stopMembersListener();
        stopHeartbeat();
        $("roomMembersWrap")?.classList.add("hidden");
        lastPickedMovieId = null;
        roomPickBanner?.classList.add("hidden");

        roomState.id = null;
        setRoomInUrl(null);
        updateRoomUI();

        // go back to local view immediately
        state.pool = loadJson(LS_POOL, []);
        state.watched = new Set(loadJson(LS_WATCHED, []));
        state.filters = loadJson(LSFILTERS, { excludeWatched: true, minRating: 6 });
        syncControls();
        renderPool();

        // and if logged-in, reattach user sync
        if (authState.user) {
            ensureUserDoc().then(() => startUserDocListener());
        }
    }

    async function copyRoomLink() {
        if (!inRoom()) return;
        const url = new URL(window.location.href);
        url.searchParams.set("room", roomState.id);

        try {
            await navigator.clipboard.writeText(url.toString());
            toast("Room link copied.", "success");
        } catch {
            window.prompt("Copy room link:", url.toString());
        }
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

        unsubUserDoc = fs.onSnapshot(
            ref,
            (snap) => {
                // If doc isn't created yet, just stop (ensureUserDoc should create it)
                if (!snap.exists()) {
                    console.warn("User doc does not exist yet:", authState.user?.uid);
                    return;
                }

                const data = snap.data() || {};

                applyingRemote = true;
                try {
                    if (Array.isArray(data.pool)) state.pool = data.pool;
                    if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
                    if (data.filters && typeof data.filters === "object") state.filters = normalizeFilters(data.filters);


                    saveJson(LS_POOL, state.pool);
                    saveJson(LS_WATCHED, Array.from(state.watched));
                    saveJson(LSFILTERS, state.filters);

                    syncControls();
                    renderPool();
                    renderResults(state.results);
                } finally {
                    applyingRemote = false;
                }
            },
            (err) => {
                console.warn("Firestore onSnapshot failed:", err);
                toast(err?.message || "Error loading data from Firestore.", "error");
            }
        );
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

    function openWhatsAppShare(text) {
        const url = "https://wa.me/?text=" + encodeURIComponent(text);
        window.open(url, "_blank", "noopener,noreferrer");
    }

    async function createSharedList() {
        const fs = window.firebaseStore;
        if (!fs) throw new Error("Firestore not ready");

        // auto-id doc: doc(collection(...))
        const ref = fs.doc(fs.collection(fs.db, "sharedLists"));

        await fs.setDoc(ref, {
            pool: state.pool,
            watched: Array.from(state.watched),
            filters: state.filters,
            createdAt: fs.serverTimestamp()
        });

        return ref.id;
    }

    async function sharePoolOnWhatsApp() {
        if (!authState.user) {
            toast("Sign in to share your list.", "error");
            return;
        }

        try {
            const id = await createSharedList();

            const shareUrl = new URL(window.location.href);
            shareUrl.searchParams.set("list", id);

            const msg = `Movie Night list:\n${shareUrl.toString()}`;
            openWhatsAppShare(msg);
        } catch (e) {
            console.warn(e);
            toast(e?.message || "Failed to create share link.", "error");
        }
    }

    // init persisted state
    state.pool = loadJson(LS_POOL, []);
    state.watched = new Set(loadJson(LS_WATCHED, []));
    state.filters = loadJson(LSFILTERS, { excludeWatched: true, minRating: 6 });

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

        for (const raw of state.results) {
            const m = normalizeItem(raw, state.filters.mediaType || "movie");
            if (!m) continue;
            const inPool = state.pool.some((x) => x.id === m.id);

            const card = document.createElement("div");
            card.className =
                "card bg-base-100 shadow-md hover:shadow-xl transition-shadow w-full";

            const p = posterUrl(m.poster_path);
            const poster = p
                ? `<figure class="px-3 pt-3 cursor-pointer" data-click="details">
        <img class="rounded-xl aspect-23 object-cover w-full" src="${p}" alt="${escapeHtml(m.title)} Poster" loading="lazy" />
     </figure>`
                : `<div class="m-3 rounded-xl bg-base-200 aspect-23 grid place-items-center text-base-content60 cursor-pointer" data-click="details">
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
                // NEW: clicking poster/placeholder opens details
                if (e.target.closest('[data-click="details"]')) {
                    openDetails(m.id);
                    return;
                }

                const btn = e.target.closest('button[data-action]');
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

                if (action === "details") {
                    const item = state.pool.find((x) => x.id === id);
                    openDetails(id, { mediaType: item?.mediaType || "movie" });
                    return;
                }

                if (action === "toggleWatched") toggleWatched(id);
                if (action === "remove") removeFromPool(id);
            });


            wrap.appendChild(row);
        }
    }

    // ---------- pool ops ----------
    function pickFields(m) {
        const kind = state.filters.mediaType || "movie";
        const n = normalizeItem(m, kind);

        return {
            id: n.id,
            title: n.title,
            posterpath: n.poster_path,      // keep existing pool schema to avoid migration
            voteaverage: n.vote_average ?? n.voteaverage,
            releasedate: n.release_date,    // keep existing pool schema
            mediaType: kind                 // NEW: remember if it’s movie or tv
        };
    }


    function addToPoolById(id) {
        if (!requireLoginForRoomWrite()) return;
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
        if (!requireLoginForRoomWrite()) return;
        state.pool = state.pool.filter((x) => x.id !== id);
        saveJson(LS_POOL, state.pool);
        renderPool();
        scheduleCloudSave();
    }

    function toggleWatched(id) {
        if (!requireLoginForRoomWrite()) return;
        if (state.watched.has(id)) state.watched.delete(id);
        else state.watched.add(id);

        saveJson(LS_WATCHED, Array.from(state.watched));
        renderPool();
        scheduleCloudSave();
    }

    function clearPool() {
        if (!requireLoginForRoomWrite()) return;
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

    async function pickForMe(opts = {}) {
        let candidates = getPickCandidates();

        if (!candidates.length && state.pool.length) candidates = [...state.pool];
        if (!candidates.length) {
            toast("No movies in the pool to pick from.", "error");
            return;
        }

        // ✅ avoid repeating the same pick on reroll (when possible)
        if (opts.avoidId && candidates.length > 1) {
            candidates = candidates.filter(m => m.id !== opts.avoidId);
        }

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];

        // ✅ remember last picked
        lastPickedMovieId = chosen.id;

        if (inRoom()) {
            if (!authState.user) {
                toast("Login to pick in this room.", "info");
                openAuthDialog();
                return;
            }
            const fs = window.firebaseStore;
            await fs.setDoc(
                activeDocRef(),
                {
                    lastPick: {
                        movieId: chosen.id,
                        title: chosen.title,
                        pickedBy: authState.user.uid,
                        pickedAt: fs.serverTimestamp(),
                    },
                    updatedAt: fs.serverTimestamp(),
                },
                { merge: true }
            );
            return;
        }

        openDetails(chosen.id, { highlight: true, mediaType: chosen.mediaType || state.filters.mediaType });
    }

    function rerollPick() {
        // reroll should avoid repeating the same id if possible
        pickForMe({ avoidId: lastPickedMovieId });
    }

    async function loadBestVideos(kind, id) {
        const attempts = [{ language: "en-US" }, {}];

        for (const params of attempts) {
            try {
                const data = await tmdb(`/${kind}/${id}/videos`, params); // ✅ leading /
                const list = Array.isArray(data?.results) ? data.results : [];
                if (list.length) return list;
            } catch {
                // try next
            }
        }
        return [];
    }


    function pickBestTrailer(videos) {
        const list = Array.isArray(videos) ? videos : [];
        const yt = list.filter(v => String(v.site).toLowerCase() === "youtube");

        return (
            yt.find(v => v.type === "Trailer" && v.official) ||
            yt.find(v => v.type === "Trailer") ||
            yt.find(v => v.type === "Teaser" && v.official) ||
            yt.find(v => v.type === "Teaser") ||
            yt[0] ||
            list[0] ||
            null
        );
    }

    function trailerUrl(v) {
        if (!v || !v.key) return null;
        const site = String(v.site || "").toLowerCase();
        if (site === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}`;
        if (site === "vimeo") return `https://vimeo.com/${encodeURIComponent(v.key)}`;
        return null;
    }


    // ---------- details ----------
    async function openDetails(id, opts = {}) {
        try {
            setBusy(true);

            // Decide whether this id is a movie or tv show.
            // Priority: opts.mediaType (when opening from pool) -> current UI filter -> default "movie"
            const kind = opts.mediaType || state.filters?.mediaType || "movie"; // "movie" | "tv"

            // Details
            const data = await tmdb(`/${kind}/${id}`, { language: "en-US" });
            state.currentDetails = { ...data, mediaType: kind };

            // Title + date fields differ for tv
            const title =
                kind === "tv"
                    ? data.name || data.original_name || "Untitled"
                    : data.title || data.original_title || "Untitled";

            const dateStr = kind === "tv" ? data.first_air_date : data.release_date;

            $("dlgTitle").textContent = title;

            const parts = [];
            parts.push(year(dateStr));

            // Runtime differs for tv (episode_run_time array)
            if (kind === "movie") {
                if (typeof data.runtime === "number" && data.runtime > 0) parts.push(`${data.runtime} min`);
            } else {
                const rt = Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : null;
                if (typeof rt === "number" && rt > 0) parts.push(`${rt} min/ep`);
            }

            if (Array.isArray(data.genres) && data.genres.length) {
                parts.push(data.genres.map((g) => g.name).join(", "));
            }

            parts.push(`★ ${Number(data.vote_average ?? 0).toFixed(1)}`);
            $("dlgMeta").textContent = parts.filter(Boolean).join(" • ");

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

            // Trailer button (with fallback fetch so non-English titles still work)
            try {
                const videos = await loadBestVideos(kind, id);
                const best = pickBestTrailer(videos);
                const url = trailerUrl(best);

                const trailerWrap = document.createElement("div");
                trailerWrap.className = "mt-3 flex flex-wrap items-center gap-2";

                const label = document.createElement("div");
                label.className = "text-sm opacity-70";
                label.textContent = "Trailer";

                trailerWrap.appendChild(label);

                if (url) {
                    const btn = document.createElement("a");
                    btn.className = "btn btn-sm btn-primary";
                    btn.href = url;
                    btn.target = "_blank";
                    btn.rel = "noopener noreferrer";
                    btn.textContent = "Watch trailer";
                    trailerWrap.appendChild(btn);
                } else {
                    const none = document.createElement("div");
                    none.className = "text-sm opacity-60";
                    none.textContent = "Not available";
                    trailerWrap.appendChild(none);
                }

                right.appendChild(trailerWrap);
            } catch {
                // ignore
            }


            // Where to watch (movie vs tv endpoint)
            try {
                const wp = await tmdb(`/${kind}/${id}/watch/providers`, {});
                const wpSection = renderWatchProvidersSection(wp);
                if (wpSection) right.appendChild(wpSection);
            } catch {
                // silent fail: details should still work
            }

            if (opts.highlight) {
                const hint = document.createElement("div");
                hint.className = "mt-3 badge badge-primary badge-outline";
                hint.textContent = "Tonight’s pick";
                right.appendChild(hint);
            }

            wrap.appendChild(left);
            wrap.appendChild(right);
            box.appendChild(wrap);

            const btnReroll = document.getElementById("btnReroll");
            if (btnReroll) {
                btnReroll.classList.toggle("hidden", !opts?.highlight);
            }

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
        const query = q.value.trim();
        const sort = resultSort?.value || "popularity.desc";
        const minVote = Number(state.filters.minRating ?? 0);

        const kind = state.filters.mediaType || "movie";
        const year = String(state.filters.year || "").trim();
        const genres = Array.isArray(state.filters.genres) ? state.filters.genres : [];
        const withGenres = genres.length ? genres.join(",") : undefined; // AND semantics [web:16]

        try {
            setBusy(true);
            renderResultsLoading();

            state.page = page;
            state.lastSort = sort;

            let data;
            if (query) {
                state.lastMode = "search";
                state.lastQuery = query;

                data = await tmdb(`/search/${kind}`, {
                    query,
                    language: "en-US",
                    include_adult: false,
                    page
                });
                data.results = await filterResultsByOtt(kind, data.results || []);
                data.total_pages = 1; // since we filtered client-side; keeps pager sane

            } else {
                state.lastMode = "discover";
                state.lastQuery = "";

                const params = {
                    language: "en-US",
                    sort_by: sort,
                    "vote_average.gte": minVote,
                    "vote_count.gte": 100,
                    with_genres: withGenres,
                    page
                };

                if (kind === "movie" && year) params.primary_release_year = year; // [web:16]
                if (kind === "tv" && year) params.first_air_date_year = year;      // [web:22]

                // ✅ OTT provider filter applies only to Discover (empty search)
                const providerIds = selectedProviderIds();
                if (providerIds.length) {
                    params.with_watch_providers = providerIds.join("|");     // OR list
                    params.watch_region = state.filters.region || "IN";
                    params.with_watch_monetization_types = "flatrate";
                }

                data = await tmdb(`/discover/${kind}`, params);
            }

            state.totalPages = data.total_pages || 1;
            renderResults(data.results);
        } catch (e) {
            toast("Search/discover failed.", "error");
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


    function normalizeItem(item, kind) {
        if (!item) return null;

        if (kind === "tv") {
            return {
                ...item,
                title: item.name || item.original_name || "Untitled",
                release_date: item.first_air_date || "",
                poster_path: item.poster_path || item.posterpath || null,
            };
        }

        // movie default
        return {
            ...item,
            title: item.title || item.original_title || "Untitled",
            release_date: item.release_date || item.releasedate || "",
            poster_path: item.poster_path || item.posterpath || null,
        };
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
        const ex = excludeWatched;
        const mr = minRating;

        if (ex) ex.checked = !!state.filters.excludeWatched;
        if (mr) mr.value = String(state.filters.minRating ?? 6);

        if (mediaType) mediaType.value = state.filters.mediaType || "movie";
        if (yearFilter) yearFilter.value = String(state.filters.year || "");

        updateGenreDropdownLabel(); // new
    }


    function bindDropdownRowToggle(menuId) {
        const menu = document.getElementById(menuId);
        if (!menu || menu.dataset.rowToggleBound) return;
        menu.dataset.rowToggleBound = "1";

        // Key part: ensure focus moves INTO the dropdown (checkbox),
        // so daisyUI doesn't close the menu due to focus leaving.
        menu.addEventListener("mousedown", (e) => {
            const row = e.target.closest("label");
            if (!row || !menu.contains(row)) return;

            const cb = row.querySelector('input[type="checkbox"]');
            if (!cb) return;

            // If user didn't click the checkbox itself, force focus to checkbox.
            if (e.target !== cb) {
                e.preventDefault();
                cb.focus({ preventScroll: true });
            }
        });

        menu.addEventListener("click", (e) => {
            const row = e.target.closest("label");
            if (!row || !menu.contains(row)) return;

            const cb = row.querySelector('input[type="checkbox"]');
            if (!cb) return;

            // Clicking the checkbox circle: let native behavior happen.
            if (e.target === cb) return;

            // Clicking the text/row: toggle once + keep focus inside menu.
            e.preventDefault();
            e.stopPropagation();

            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
            cb.focus({ preventScroll: true });
        });
    }


    function resetAllFilters() {
        if (!requireLoginForRoomWrite()) return;

        // Reset core filter state
        state.filters = normalizeFilters(DEFAULT_FILTERS);
        state.filters.mediaType = "movie";
        state.filters.year = "";
        state.filters.genres = [];
        ensureWatchFilterDefaults();

        // Reset visible UI fields
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

        // Reset watch filters UI
        const regionSel = id("watchRegion");
        const hint = id("regionHint");
        const cbNetflix = id("ottNetflix");
        const cbPrime = id("ottPrime");
        const cbHotstar = id("ottHotstar");

        if (regionSel) regionSel.value = state.filters.region;
        if (hint) hint.textContent = `Auto ${state.filters.region}`;
        if (cbNetflix) cbNetflix.checked = false;
        if (cbPrime) cbPrime.checked = false;
        if (cbHotstar) cbHotstar.checked = false;

        updateOttDropdownLabel();

        // Persist + refresh
        saveJson(LSFILTERS, state.filters);
        scheduleCloudSave();

        populateGenreSelect("movie");        // rebuild genre checkbox list for movies
        updateGenreDropdownLabel();          // "0 selected"
        renderPool();

        // Load something visible immediately
        loadTrending(1);

        toast("Filters reset.", "info");
    }



    async function boot() {
        initTheme();
        syncControls();
        await initWatchFiltersUI();
        bindDropdownRowToggle("genreDropdownMenu");
        bindDropdownRowToggle("ottDropdownMenu");

        await populateGenreSelect(state.filters.mediaType || "movie");
        renderPager();
        updateUserChip();
        await loadSharedListFromUrl();

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
                if (inRoom()) {
                    updateRoomUI();
                    startMembersListener();
                    startHeartbeat();   // now you’ll appear in the members list
                    return;             // IMPORTANT: don’t start user-doc sync in room mode
                }
                updateRoomUI();
                const url = new URL(window.location.href);
                const roomId = url.searchParams.get("room");
                if (roomId) {
                    roomState.id = roomId;
                    updateRoomUI();
                    startRoomListener();
                }
                startMembersListener(); // show + live-update members list even for viewers
                startHeartbeat();       // will do nothing if not logged in (your code checks auth)


                if (!authState.user) {
                    if (unsubUserDoc) unsubUserDoc();
                    unsubUserDoc = null;
                    return;
                }

                await ensureUserDoc();
                startUserDocListener();
            });

        }

        async function loadSharedListFromUrl() {

            const fs = window.firebaseStore;
            if (!fs) return;

            const url = new URL(window.location.href);
            const id = url.searchParams.get("list");
            if (!id) return;

            const snap = await fs.getDoc(fs.doc(fs.db, "sharedLists", id));
            if (!snap.exists()) {
                toast("Shared list not found.", "error");
                return;
            }

            const data = snap.data() || {};
            loadedSharedList = data;
            $("btnImportList")?.classList.remove("hidden");

            if (Array.isArray(data.pool)) state.pool = data.pool;
            if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
            if (data.filters && typeof data.filters === "object") state.filters = normalizeFilters(data.filters);



            renderPool();
        }

        $("excludeWatched")?.addEventListener("change", () => {
            state.filters.excludeWatched = $("excludeWatched").checked;
            saveJson(LSFILTERS, state.filters);
            renderPool();
            scheduleCloudSave();
        });

        $("minRating")?.addEventListener("input", () => {
            const v = Number($("minRating").value);
            state.filters.minRating = Number.isFinite(v) ? v : 0;
            saveJson(LSFILTERS, state.filters);
            renderPool();
            scheduleCloudSave();
        });

        $("btnSearch")?.addEventListener("click", () => doSearch(1));
        $("btnTrending")?.addEventListener("click", () => loadTrending(1));
        $("btnPick")?.addEventListener("click", pickForMe);
        $("btnClearPool")?.addEventListener("click", clearPool);
        $("btnWatched")?.addEventListener("click", markCurrentWatched);
        $("btnShareList")?.addEventListener("click", sharePoolOnWhatsApp);
        $("btnCreateRoom")?.addEventListener("click", createRoom);
        $("btnLeaveRoom")?.addEventListener("click", leaveRoom);
        $("btnCopyRoomLink")?.addEventListener("click", copyRoomLink);
        btnReroll?.addEventListener("click", rerollPick);

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

        btnOpenPicked?.addEventListener("click", () => {
            if (!lastPickedMovieId) return toast("No pick yet.", "info");
            openDetails(lastPickedMovieId, { highlight: true });
        });

        btnResetFilters?.addEventListener("click", resetAllFilters);

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

        mediaType?.addEventListener("change", async () => {
            state.filters.mediaType = mediaType.value;
            saveJson(LSFILTERS, state.filters);
            await populateGenreSelect(state.filters.mediaType); // swap genre list
            doSearch(1);
        });

        yearFilter?.addEventListener("input", () => {
            state.filters.year = yearFilter.value;
            saveJson(LSFILTERS, state.filters);
        });

        $("btnImportList")?.addEventListener("click", async () => {
            if (!authState.user) {
                openAuthDialog();            // show your existing auth modal
                toast("Sign in to import this list.", "info");
                return;
            }

            // Save current state (which came from the shared link) into user's doc
            saveJson(LS_POOL, state.pool);
            saveJson(LS_WATCHED, Array.from(state.watched));
            saveJson(LSFILTERS, state.filters);

            syncControls();
            renderPool();
            scheduleCloudSave();

            toast("Imported to your account.", "success");
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
