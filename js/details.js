import { id } from "./dom.js";
import { state, inRoom } from "./state.js";
import { tmdb } from "./tmdb.js";
import { toast } from "./ui.js";
import { setBusy, posterUrl, year } from "./render.js";
import { renderWatchProvidersSection } from "./watchFilters.js";
import { saveJson, LSWATCHED } from "./storage.js";
import { renderPool } from "./render.js";
import { updatePlaybackFromLocal, saveTelepartyUrl } from "./rooms.js";

export async function loadBestVideos(kind, id) {
    const attempts = [{ language: "en-US" }, {}];
    for (const params of attempts) {
        try {
            const data = await tmdb(`${kind}/${id}/videos`, params);
            const list = Array.isArray(data?.results) ? data.results : [];
            if (list.length) return list;
        } catch { }
    }
    return [];
}

export function pickBestTrailer(videos) {
    const list = Array.isArray(videos) ? videos : [];
    const yt = list.filter((v) => String(v.site).toLowerCase() === "youtube");
    return (
        yt.find((v) => v.type === "Trailer" && v.official) ||
        yt.find((v) => v.type === "Trailer") ||
        yt.find((v) => v.type === "Teaser" && v.official) ||
        yt.find((v) => v.type === "Teaser") ||
        yt[0] ||
        list[0] ||
        null
    );
}

export function markCurrentWatched() {
    const id = state.currentDetails?.id;
    if (!id) return;
    state.watched.add(id);
    saveJson(LSWATCHED, Array.from(state.watched));
    renderPool();
    toast("Marked watched", "success");
}

export function trailerUrl(v) {
    if (!v || !v.key) return null;
    const site = String(v.site).toLowerCase();
    if (site === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}`;
    if (site === "vimeo") return `https://vimeo.com/${encodeURIComponent(v.key)}`;
    return null;
}

export async function openDetails(idNum, opts = {}) {
    const dlg = id("dlg");
    const dlgTitle = id("dlgTitle");
    const dlgMeta = id("dlgMeta");
    const box = id("dlgOverview");
    const btnReroll = id("btnReroll");

    try {
        setBusy(true);

        const kind = opts.mediaType || state.filters?.mediaType || "movie";
        const data = await tmdb(`${kind}/${idNum}`, { language: "en-US" });
        state.currentDetails = { ...data, mediaType: kind };

        const title = kind === "tv" ? (data.name || data.original_name || "Untitled") : (data.title || data.original_title || "Untitled");
        const dateStr = kind === "tv" ? data.first_air_date : data.release_date;

        dlgTitle.textContent = title;

        const parts = [];
        parts.push(year(dateStr));

        if (kind === "movie") {
            if (typeof data.runtime === "number" && data.runtime > 0) parts.push(`${data.runtime} min`);
        } else {
            const rt = Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : null;
            if (typeof rt === "number" && rt > 0) parts.push(`${rt} min/ep`);
        }

        if (Array.isArray(data.genres) && data.genres.length) parts.push(data.genres.map((g) => g.name).join(", "));
        parts.push(Number(data.vote_average ?? 0).toFixed(1));

        dlgMeta.textContent = parts.filter(Boolean).join(" • ");

        box.innerHTML = "";

        const wrap = document.createElement("div");
        wrap.className = "flex gap-4 flex-col sm:flex-row";

        const left = document.createElement("div");
        left.className = "sm:w-40";
        const p = posterUrl(data.poster_path);
        left.innerHTML = p
            ? `<img class="rounded-xl w-full aspect-23 object-cover" src="${p}" alt="" loading="lazy" />`
            : `<div class="rounded-xl bg-base-200 aspect-23 grid place-items-center text-base-content/60">No poster</div>`;

        const right = document.createElement("div");
        right.className = "flex-1";
        const ov = document.createElement("p");
        ov.className = "leading-relaxed";
        ov.textContent = data.overview || "No overview available.";
        right.appendChild(ov);

        try {
            const videos = await loadBestVideos(kind, idNum);
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

            // NEW: Watch together (Teleparty help) — only in rooms
            if (inRoom()) {
                const sep = document.createElement("span");
                sep.className = "opacity-40 text-xs";
                sep.textContent = "·";
                trailerWrap.appendChild(sep);

                const wtBtn = document.createElement("button");
                wtBtn.className = "btn btn-sm btn-outline";
                wtBtn.textContent = "Watch together";
                wtBtn.addEventListener("click", async () => {
                    const existing = prompt(
                        "Paste your Teleparty link here (or install the Teleparty extension, start a party on Netflix/Disney+, then paste the link):",
                        ""
                    );
                    if (!existing) return;
                    try {
                        await saveTelepartyUrl(existing.trim());
                        toast("Teleparty link saved for this room.", "success");
                    } catch {
                        toast("Failed to save Teleparty link.", "error");
                    }
                });
                trailerWrap.appendChild(wtBtn);
            }
            right.appendChild(trailerWrap);
        } catch { }

        try {
            const wp = await tmdb(`${kind}/${idNum}/watch/providers`, {});
            const wpSection = renderWatchProvidersSection(wp);
            if (wpSection) right.appendChild(wpSection);
        } catch { }

        if (opts.highlight) {
            const hint = document.createElement("div");
            hint.className = "mt-3 badge badge-primary badge-outline";
            hint.textContent = "Tonight’s pick";
            right.appendChild(hint);
        }

        // Teleparty: Play together button (room mode only)
        if (inRoom()) {
            const tpWrap = document.createElement("div");
            tpWrap.className = "mt-3 flex flex-wrap items-center gap-2";

            const label = document.createElement("div");
            label.className = "text-sm opacity-70";
            label.textContent = "Watch together";
            tpWrap.appendChild(label);

            const btn = document.createElement("button");
            btn.className = "btn btn-sm btn-primary";
            btn.textContent = "Play together";
            btn.addEventListener("click", () => {
                const cur = state.currentDetails;
                if (!cur) return;

                const mediaId = cur.id;
                const mediaType = cur.mediaType || state.filters.mediaType || "movie";

                // No real player yet, start at 0s and mark as playing
                updatePlaybackFromLocal({
                    mediaId,
                    mediaType,
                    position: 0,
                    isPlaying: true,
                });
            });

            tpWrap.appendChild(btn);
            right.appendChild(tpWrap);
        }


        wrap.appendChild(left);
        wrap.appendChild(right);
        box.appendChild(wrap);

        if (btnReroll) btnReroll.classList.toggle("hidden", !opts?.highlight);

        dlg.showModal();
    } catch {
        toast("Failed to load details.", "error");
    } finally {
        setBusy(false);
    }
}
