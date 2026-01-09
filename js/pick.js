// js/pick.js
import { state, authState, inRoom, setLastPickedMovieId, lastPickedMovieId } from "./state.js";
import { toast } from "./ui.js";
import { openAuthDialog } from "./auth.js";
import { openDetails } from "./details.js";
import { getPickCandidates } from "./pool.js";
import { activeDocRef } from "./rooms.js";

export async function pickForMe(opts = {}) {
    const excludeWatched = !!state.filters?.excludeWatched;

    let candidates = getPickCandidates();

    // If nothing matches filters:
    if (!candidates.length) {
        if (!state.pool.length) {
            toast("No movies in the pool to pick from.", "error");
            return;
        }

        // IMPORTANT: don't fall back to full pool when excludeWatched is ON
        if (excludeWatched) {
            toast("No unwatched movies match your filters.", "info");
            return;
        }

        // Exclude watched is OFF => OK to fall back to the full pool
        candidates = [...state.pool];
    }

    // Best-effort avoid repeating the same pick
    if (opts.avoidId && candidates.length > 1) {
        const filtered = candidates.filter((m) => m.id !== opts.avoidId);
        if (filtered.length) candidates = filtered;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    setLastPickedMovieId(chosen.id);

    const mediaType = chosen.mediaType ?? state.filters?.mediaType ?? "movie";

    // Room mode: write lastPick only; room listener will openDetails()
    if (inRoom()) {
        if (!authState.user) {
            toast("Login to pick in this room.", "info");
            openAuthDialog();
            return;
        }

        const fs = window.firebaseStore;
        const pickId =
            (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await fs.setDoc(
            activeDocRef(),
            {
                lastPick: {
                    pickId,                 // NEW stable id
                    clientPickedAt: Date.now(), // optional, for debugging/fallback
                    movieId: chosen.id,
                    title: chosen.title ?? null,
                    mediaType,
                    pickedBy: authState.user.uid,
                    pickedAt: fs.serverTimestamp(), // keep if you want server time
                },
                updatedAt: fs.serverTimestamp(),
            },
            { merge: true }
        );

        return; // IMPORTANT: no openDetails() here
    }

    // Non-room mode: open locally
    return openDetails(chosen.id, { highlight: true, mediaType });
}

export function rerollPick() {
    return pickForMe({ avoidId: lastPickedMovieId });
}
