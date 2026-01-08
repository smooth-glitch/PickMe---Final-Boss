// js/rooms.js
import { id } from "./dom.js";
import {
    state,
    authState,
    roomState,
    inRoom,
    normalizeFilters,
    lastPickedMovieId,
    setLastPickedMovieId,
    lastAutoOpenedPickKey,
    setLastAutoOpenedPickKey,
} from "./state.js";
import { loadJson, saveJson, LSPOOL, LSWATCHED, LSFILTERS } from "./storage.js";
import { toast } from "./ui.js";
import { renderPool, renderResults } from "./render.js";
import { openDetails } from "./details.js";
import { openAuthDialog } from "./auth.js";

let unsubUserDoc = null;
let applyingRemote = false;
let saveTimer = null;

let unsubMembers = null;
let heartbeatTimer = null;

const HEARTBEATMS = 25000;
const ONLINEWINDOWMS = 70000;

// main.js should call setSyncControls(syncControlsFn)
let syncControlsCb = null;
// Top-level (near unsubMembers)
let membersInitDone = false;

export function stopMembersListener() {
    if (unsubMembers) unsubMembers();
    unsubMembers = null;

    // Reset so next room join doesn't suppress notifications forever
    membersInitDone = false;
}

export function startMembersListener() {
    const fs = window.firebaseStore;
    if (!fs || !inRoom()) return;

    stopMembersListener();

    const roomMembersWrap = id("roomMembersWrap");
    const roomMembersList = id("roomMembersList");
    const roomOnlineCount = id("roomOnlineCount");

    roomMembersWrap?.classList.remove("hidden");

    unsubMembers = fs.onSnapshot(
        membersColRef(),
        (snap) => {
            // 1) Join notifications (skip the initial snapshot)
            if (!membersInitDone) {
                membersInitDone = true;
            } else {
                const selfUid = authState.user?.uid || null;

                for (const ch of snap.docChanges()) {
                    if (ch.type !== "added") continue;          // only new joins
                    if (selfUid && ch.doc.id === selfUid) continue; // ignore your own join

                    const data = ch.doc.data() || {};
                    const label = data.name || data.email || ch.doc.id;
                    toast(`${label} joined`, "info");
                }
            }

            // 2) Your existing list rendering (unchanged)
            const now = Date.now();

            const members = snap.docs
                .map((d) => {
                    const m = d.data();
                    const ms = typeof m.lastSeenAt?.toMillis === "function" ? m.lastSeenAt.toMillis() : 0;
                    return {
                        id: d.id,
                        name: m.name,
                        email: m.email,
                        lastSeenMs: ms,
                        online: ms && now - ms < ONLINEWINDOWMS,
                    };
                })
                .sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));

            const onlineCount = members.filter((x) => x.online).length;
            if (roomOnlineCount) roomOnlineCount.textContent = `Online ${onlineCount}`;

            if (!roomMembersList) return;
            roomMembersList.innerHTML = members
                .map((m) => {
                    const label = m.name || m.email || m.id;
                    const badge = m.online ? "badge-success" : "badge-ghost";
                    const status = m.online ? "online" : "offline";
                    return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-base-200/40 border border-base-300">
              <div class="truncate">${label}</div>
              <span class="badge badge-sm ${badge}">${status}</span>
            </div>
          `;
                })
                .join("");
        },
        (err) => {
            console.warn("Members listener failed", err);
            toast(err?.message || "Failed to load room members.", "error");
        }
    );
}

export function setSyncControls(fn) {
    syncControlsCb = typeof fn === "function" ? fn : null;
}

export async function copyRoomLink() {
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

export function fsReady() {
    return !!window.firebaseStore && !!authState.user;
}

export function userDocRef() {
    const fs = window.firebaseStore;
    return fs.doc(fs.db, "users", authState.user.uid);
}

export function roomDocRef() {
    const fs = window.firebaseStore;
    return fs.doc(fs.db, "rooms", roomState.id);
}

export function activeDocRef() {
    return inRoom() ? roomDocRef() : userDocRef();
}

export function membersColRef() {
    const fs = window.firebaseStore;
    return fs.collection(fs.db, "rooms", roomState.id, "members");
}

export function requireLoginForRoomWrite() {
    if (!inRoom()) return true;
    if (authState.user) return true;
    toast("Login to edit this room.", "info");
    openAuthDialog();
    return false;
}

export function scheduleCloudSave() {
    if (!authState.user) return;
    if (!fsReady()) return;
    if (applyingRemote) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            const fs = window.firebaseStore;
            await fs.setDoc(
                activeDocRef(),
                {
                    pool: state.pool,
                    watched: Array.from(state.watched),
                    filters: state.filters,
                    updatedAt: fs.serverTimestamp(),
                },
                { merge: true }
            );
        } catch (e) {
            console.warn("Firestore save failed", e);
        }
    }, 400);
}

export async function ensureUserDoc() {
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
                updatedAt: fs.serverTimestamp(),
            },
            { merge: true }
        );
    }
}

export function stopUserDocListener() {
    if (unsubUserDoc) unsubUserDoc();
    unsubUserDoc = null;
}

export function startUserDocListener() {
    if (!fsReady()) return;

    const fs = window.firebaseStore;
    stopUserDocListener();

    unsubUserDoc = fs.onSnapshot(
        userDocRef(),
        (snap) => {
            if (!snap.exists()) return;

            const data = snap.data();
            applyingRemote = true;
            try {
                if (Array.isArray(data.pool)) state.pool = data.pool;
                if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
                if (data.filters && typeof data.filters === "object") state.filters = normalizeFilters(data.filters);

                // persist locally too
                saveJson(LSPOOL, state.pool);
                saveJson(LSWATCHED, Array.from(state.watched));
                saveJson(LSFILTERS, state.filters);

                syncControlsCb?.();
                renderPool();
                renderResults(state.results);
            } finally {
                applyingRemote = false;
            }
        },
        (err) => {
            console.warn("Firestore onSnapshot failed", err);
            toast(err?.message || "Error loading data from Firestore.", "error");
        }
    );
}

export function updateRoomUI() {
    const badge = id("roomBadge");
    const btnCreate = id("btnCreateRoom");
    const btnCopy = id("btnCopyRoomLink");
    const btnLeave = id("btnLeaveRoom");

    if (badge) {
        badge.classList.toggle("hidden", !inRoom());
        badge.textContent = inRoom() ? `Room ${roomState.id}` : "Room";
    }

    btnCreate?.classList.toggle("hidden", inRoom());
    btnCopy?.classList.toggle("hidden", !inRoom());
    btnLeave?.classList.toggle("hidden", !inRoom());
}

export function stopRoomListener() {
    if (roomState.unsub) roomState.unsub();
    roomState.unsub = null;
}

export function startRoomListener() {
    const fs = window.firebaseStore;
    if (!fs || !inRoom()) return;

    stopRoomListener();

    roomState.unsub = fs.onSnapshot(
        roomDocRef(),
        (snap) => {
            if (!snap.exists()) return;

            const data = snap.data();

            // Handle last pick banner + auto-open once per pick
            const lp = data.lastPick;
            if (lp?.movieId) {
                const banner = id("roomPickBanner");
                const text = id("roomPickText");
                if (banner && text) {
                    const title = lp.title ? String(lp.title) : "";
                    banner.classList.remove("hidden");
                    text.textContent = title ? `Tonight's pick: ${title}` : "Tonight's pick";
                }

                const pickedAtMs = typeof lp.pickedAt?.toMillis === "function" ? lp.pickedAt.toMillis() : 0;
                const key = `${lp.movieId}_${pickedAtMs}`;

                if (key && key !== lastAutoOpenedPickKey) {
                    setLastAutoOpenedPickKey(key);
                    setLastPickedMovieId(lp.movieId);
                    openDetails(lp.movieId, { highlight: true, mediaType: lp.mediaType || "movie" });
                }
            }

            applyingRemote = true;
            try {
                if (Array.isArray(data.pool)) state.pool = data.pool;
                if (Array.isArray(data.watched)) state.watched = new Set(data.watched);
                if (data.filters && typeof data.filters === "object") state.filters = normalizeFilters(data.filters);

                syncControlsCb?.();
                renderPool();
                renderResults(state.results);
            } finally {
                applyingRemote = false;
            }
        },
        (err) => {
            console.warn("Room listener failed", err);
            toast(err?.message || "Failed to load room.", "error");
        }
    );
}

export function stopMembersListener() {
    if (unsubMembers) unsubMembers();
    unsubMembers = null;
}

export function startMembersListener() {
    const fs = window.firebaseStore;
    if (!fs || !inRoom()) return;

    stopMembersListener();

    const roomMembersWrap = id("roomMembersWrap");
    const roomMembersList = id("roomMembersList");
    const roomOnlineCount = id("roomOnlineCount");

    roomMembersWrap?.classList.remove("hidden");

    unsubMembers = fs.onSnapshot(membersColRef(), (snap) => {
        const now = Date.now();

        const members = snap.docs
            .map((d) => {
                const m = d.data();
                const ms = typeof m.lastSeenAt?.toMillis === "function" ? m.lastSeenAt.toMillis() : 0;
                return {
                    id: d.id,
                    name: m.name,
                    email: m.email,
                    lastSeenMs: ms,
                    online: ms && now - ms < ONLINEWINDOWMS,
                };
            })
            .sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));

        const onlineCount = members.filter((x) => x.online).length;
        if (roomOnlineCount) roomOnlineCount.textContent = `Online ${onlineCount}`;

        if (!roomMembersList) return;
        roomMembersList.innerHTML = members
            .map((m) => {
                const label = m.name || m.email || m.id;
                const badge = m.online ? "badge-success" : "badge-ghost";
                const status = m.online ? "online" : "offline";
                return `
          <div class="flex items-center justify-between p-2 rounded-xl bg-base-200/40 border border-base-300">
            <div class="truncate">${label}</div>
            <span class="badge badge-sm ${badge}">${status}</span>
          </div>
        `;
            })
            .join("");
    });
}

export async function heartbeatOnce() {
    if (!inRoom() || !authState.user) return;

    const fs = window.firebaseStore;
    const u = authState.user;

    await fs.setDoc(
        fs.doc(fs.db, "rooms", roomState.id, "members", u.uid),
        {
            uid: u.uid,
            name: u.displayName || null,
            email: u.email || null,
            lastSeenAt: fs.serverTimestamp(),
        },
        { merge: true }
    );
}

export function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

export function startHeartbeat() {
    stopHeartbeat();
    if (!inRoom() || !authState.user) return;

    heartbeatOnce().catch(() => { });
    heartbeatTimer = setInterval(() => heartbeatOnce().catch(() => { }), HEARTBEATMS);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") heartbeatOnce().catch(() => { });
    });
}

export function setRoomInUrl(roomId) {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set("room", roomId);
    else url.searchParams.delete("room");
    history.replaceState({}, "", url.toString());
}

export async function createRoom() {
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
        updatedAt: fs.serverTimestamp(),
    });

    joinRoom(ref.id);
}

export function joinRoom(roomId) {
    // stop user doc sync so it doesn't overwrite room state (same as app.js) [file:189]
    stopUserDocListener();

    roomState.id = roomId;
    setRoomInUrl(roomId);

    updateRoomUI();
    startRoomListener();
    startMembersListener();
    startHeartbeat();
}

export function leaveRoom() {
    stopRoomListener();
    stopMembersListener();
    stopHeartbeat();

    id("roomMembersWrap")?.classList.add("hidden");
    id("roomPickBanner")?.classList.add("hidden");

    setLastPickedMovieId(null);

    roomState.id = null;
    setRoomInUrl(null);
    updateRoomUI();

    // Restore local view immediately (same as app.js) [file:189]
    state.pool = loadJson(LSPOOL, []);
    state.watched = new Set(loadJson(LSWATCHED, []));
    state.filters = loadJson(LSFILTERS, { excludeWatched: true, minRating: 6 });

    syncControlsCb?.();
    renderPool();

    // Reattach user sync when logged in (same as app.js) [file:189]
    if (authState.user) {
        ensureUserDoc().then(startUserDocListener);
    }
}
