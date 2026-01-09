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
    if (site === "youtube")
        return `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}`;
    if (site === "vimeo")
        return `https://vimeo.com/${encodeURIComponent(v.key)}`;
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

        const kind = opts?.mediaType || state.filters?.mediaType || "movie";

        const data = await tmdb(`${kind}/${idNum}`, {
            language: "en-US",
            ...(kind === "tv"
                ? { append_to_response: "recommendations,similar" }
                : {}),
        });

        state.currentDetails = { ...data, mediaType: kind };

        const title =
            kind === "tv"
                ? data.name || data.original_name || "Untitled"
                : data.title || data.original_title || "Untitled";
        const dateStr =
            kind === "tv" ? data.first_air_date : data.release_date;

        dlgTitle.textContent = title;

        const parts = [];
        parts.push(year(dateStr));

        if (kind === "movie") {
            if (typeof data.runtime === "number" && data.runtime > 0) {
                parts.push(`${data.runtime} min`);
            }
        } else {
            const rt = Array.isArray(data.episode_run_time)
                ? data.episode_run_time[0]
                : null;
            if (typeof rt === "number" && rt > 0) {
                parts.push(`${rt} min/ep`);
            }
        }

        if (Array.isArray(data.genres) && data.genres.length) {
            parts.push(data.genres.map((g) => g.name).join(", "));
        }
        parts.push(Number(data.vote_average ?? 0).toFixed(1));

        dlgMeta.textContent = parts.filter(Boolean).join(" • ");

        box.innerHTML = "";

        const wrap = document.createElement("div");
        wrap.className = "flex gap-4 flex-col sm:flex-row";

        const left = document.createElement("div");
        left.className = "sm:w-40";
        const p = posterUrl(data.poster_path);
        left.innerHTML = p
            ? `<img class="rounded-xl w-full aspect-[2/3] object-cover" src="${p}" alt="" loading="lazy" />`
            : `<div class="rounded-xl bg-base-200 aspect-[2/3] grid place-items-center text-base-content/60">No poster</div>`;

        const right = document.createElement("div");
        right.className = "flex-1";

        const ov = document.createElement("p");
        ov.className = "leading-relaxed";
        ov.textContent = data.overview || "No overview available.";
        right.appendChild(ov);

        // Trailer + Teleparty + Play together row
        try {
            const videos = await loadBestVideos(kind, idNum);
            const best = pickBestTrailer(videos);
            const url = trailerUrl(best);

            const trailerWrap = document.createElement("div");
            trailerWrap.className = "mt-3 flex flex-wrap items-center gap-2";

            if (url) {
                const btnTrailer = document.createElement("a");
                btnTrailer.className = "btn btn-sm btn-primary";
                btnTrailer.href = url;
                btnTrailer.target = "_blank";
                btnTrailer.rel = "noopener noreferrer";
                btnTrailer.textContent = "Watch trailer";
                trailerWrap.appendChild(btnTrailer);
            } else {
                const none = document.createElement("div");
                none.className = "text-sm opacity-60";
                none.textContent = "Not available";
                trailerWrap.appendChild(none);
            }

            if (inRoom()) {
                const btnTeleparty = document.createElement("button");
                btnTeleparty.type = "button";
                btnTeleparty.className =
                    "btn btn-sm btn-primary flex items-center gap-2";

                const icon = document.createElement("span");
                icon.className =
                    "inline-flex items-center justify-center w-5 h-5 rounded-full bg-base-100 text-xs font-semibold";
                icon.textContent = "TP";

                const text = document.createElement("span");
                text.textContent = "Teleparty";

                btnTeleparty.appendChild(icon);
                btnTeleparty.appendChild(text);

                btnTeleparty.addEventListener("click", async () => {
                    const existing = prompt(
                        "Paste your Teleparty link here (install the Teleparty extension, start a party, then paste the link):",
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

                trailerWrap.appendChild(btnTeleparty);

                const btnPlayTogether = document.createElement("button");
                btnPlayTogether.type = "button";
                btnPlayTogether.className = "btn btn-sm btn-primary";
                btnPlayTogether.textContent = "Play together";

                btnPlayTogether.addEventListener("click", () => {
                    const cur = state.currentDetails;
                    if (!cur) return;

                    const mediaId = cur.id;
                    const mediaType =
                        cur.mediaType || state.filters.mediaType || "movie";

                    updatePlaybackFromLocal({
                        mediaId,
                        mediaType,
                        position: 0,
                        isPlaying: true,
                    });
                });

                trailerWrap.appendChild(btnPlayTogether);
            }

            right.appendChild(trailerWrap);
        } catch {
            // ignore trailer errors
        }

        // Where to watch
        try {
            const wp = await tmdb(`${kind}/${idNum}/watch/providers`, {});
            const wpSection = renderWatchProvidersSection(wp);
            if (wpSection) right.appendChild(wpSection);
        } catch {
            // ignore
        }

        // TV seasons (prequel/sequel as previous/next season)
        if (kind === "tv" && Array.isArray(data.seasons)) {
            const seasonsSection = renderTvSeasonsSection(data);
            if (seasonsSection) right.appendChild(wrapInCollapse("Seasons", seasonsSection));
        }

        if (kind === "movie" && data.belongs_to_collection?.id) {
            try {
                const col = await tmdb(`collection/${data.belongs_to_collection.id}`, {
                    language: "en-US",
                });
                const colSection = renderMovieCollectionSection(data, col);
                if (colSection) right.appendChild(colSection);
            } catch {
                // ignore collection errors
            }
        }


        // TV recommendations/similar
        if (kind === "tv") {
            if (Array.isArray(data.recommendations?.results) && data.recommendations.results.length) {
                const recInner = renderMiniList(
                    "Recommended shows",
                    data.recommendations.results,
                    "tv"
                );
                if (recInner) {
                    right.appendChild(wrapInCollapse("Recommended shows", recInner));
                }
            }

            if (Array.isArray(data.similar?.results) && data.similar.results.length) {
                const simInner = renderMiniList(
                    "Similar shows",
                    data.similar.results,
                    "tv"
                );
                if (simInner) {
                    right.appendChild(wrapInCollapse("Similar shows", simInner));
                }
            }
        }


        if (kind === "movie") {
            const rec = await tmdb(`movie/${idNum}/recommendations`, { language: "en-US" });
            if (Array.isArray(rec.results) && rec.results.length) {
                const recInner = renderMiniList("Recommended movies", rec.results, "movie");
                if (recInner) {
                    right.appendChild(wrapInCollapse("Recommended movies", recInner));
                }
            }

            const sim = await tmdb(`movie/${idNum}/similar`, { language: "en-US" });
            if (Array.isArray(sim.results) && sim.results.length) {
                const simInner = renderMiniList("Similar movies", sim.results, "movie");
                if (simInner) {
                    right.appendChild(wrapInCollapse("Similar movies", simInner));
                }
            }
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

        if (btnReroll) btnReroll.classList.toggle("hidden", !opts?.highlight);

        dlg.showModal();
    } catch {
        toast("Failed to load details.", "error");
    } finally {
        setBusy(false);
    }
}

// Mini horizontal list for recommendations/similar
function renderMiniList(title, items, kind) {
    const list = Array.isArray(items) ? items.slice(0, 3) : [];
    if (!list.length) return null;

    const wrap = document.createElement("div");
    wrap.className = "space-y-2";

    const heading = document.createElement("div");
    heading.className = "text-sm font-semibold";
    heading.textContent = title;
    wrap.appendChild(heading);

    const row = document.createElement("div");
    row.className = "space-y-2";
    wrap.appendChild(row);

    for (const raw of list) {
        const id = raw.id;
        if (!id) continue;

        const card = document.createElement("button");
        card.type = "button";
        card.className =
            "w-full flex items-center gap-2 p-2 rounded-lg bg-base-200/40 border border-base-300 hover:bg-base-200 transition-colors";

        const p = posterUrl(raw.poster_path);
        const posterHtml = p
            ? `<img src="${p}" alt="" class="w-10 h-14 rounded object-cover" loading="lazy" />`
            : `<div class="w-10 h-14 rounded bg-base-300 grid place-items-center text-[0.6rem] opacity-70">No</div>`;

        const titleText =
            kind === "tv"
                ? raw.name || raw.original_name || "Untitled"
                : raw.title || raw.original_title || "Untitled";

        const yearStr = year(
            kind === "tv" ? raw.first_air_date : raw.release_date
        );
        const rating = Number(raw.vote_average ?? 0).toFixed(1);

        card.innerHTML = `
  ${posterHtml}
  <div class="flex-1 min-w-0">
    <div class="text-xs font-semibold line-clamp-1">${titleText}</div>
    <div class="text-[0.65rem] opacity-70">${yearStr || ""}</div>
  </div>
  <div class="text-[0.7rem] opacity-80">${rating}</div>
`;

        card.addEventListener("click", () => {
            openDetails(id, { mediaType: kind });
        });

        row.appendChild(card);
    }

    return wrap;
}


function wrapInCollapse(titleText, inner) {
    const root = document.createElement("div");
    root.className = "mt-3 join join-vertical bg-base-100";

    const item = document.createElement("div");
    item.className =
        "collapse collapse-arrow join-item border border-base-300 bg-base-100";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "peer";
    // Optionally default open for Recommended only

    const head = document.createElement("div");
    head.className = "collapse-title text-xs font-semibold";
    head.textContent = titleText;

    const content = document.createElement("div");
    content.className = "collapse-content pt-0 pb-2 px-4";
    content.appendChild(inner);

    item.appendChild(input);
    item.appendChild(head);
    item.appendChild(content);
    root.appendChild(item);
    return root;
}


function renderTvSeasonsSection(tv) {
    const seasons = Array.isArray(tv.seasons) ? tv.seasons : [];
    if (!seasons.length) return null;

    const wrap = document.createElement("div");
    wrap.className = "space-y-2";

    const title = document.createElement("div");
    title.className = "text-sm font-semibold";
    title.textContent = "Seasons";
    wrap.appendChild(title);

    const btnRow = document.createElement("div");
    btnRow.className = "flex flex-wrap gap-2";
    wrap.appendChild(btnRow);

    const currentSeasonNumber =
        typeof tv.last_air_date === "string"
            ? tv.seasons
                .filter((s) => s.air_date)
                .sort(
                    (a, b) =>
                        new Date(b.air_date).getTime() -
                        new Date(a.air_date).getTime()
                )[0]?.season_number ?? null
            : null;

    const fallbackSeasonNumber =
        seasons
            .map((s) => s.season_number)
            .filter((n) => typeof n === "number")
            .sort((a, b) => a - b)
            .pop() ?? null;

    const selectedSeasonNumber = currentSeasonNumber ?? fallbackSeasonNumber;

    for (const s of seasons) {
        const n = s.season_number;
        if (typeof n !== "number") continue;

        const btn = document.createElement("button");
        const isSelected = n === selectedSeasonNumber;

        btn.className =
            "btn btn-xs " +
            (isSelected ? "btn-primary" : "btn-ghost border border-base-300");
        btn.textContent = s.name || `Season ${n}`;

        btn.addEventListener("click", () => {
            toast(`Selected ${s.name || "Season " + n}`, "info");
        });

        btnRow.appendChild(btn);
    }

    const nums = seasons
        .map((s) => s.season_number)
        .filter((n) => typeof n === "number")
        .sort((a, b) => a - b);

    const idx = nums.indexOf(selectedSeasonNumber);
    const prevSeasonNum = idx > 0 ? nums[idx - 1] : null;
    const nextSeasonNum =
        idx >= 0 && idx < nums.length - 1 ? nums[idx + 1] : null;

    const controls = document.createElement("div");
    controls.className = "flex gap-2 text-[0.7rem] text-base-content/70";
    wrap.appendChild(controls);

    const prevBtn = document.createElement("button");
    prevBtn.className =
        "btn btn-ghost btn-xs px-2 border border-base-300" +
        (prevSeasonNum == null ? " btn-disabled opacity-40" : "");
    prevBtn.textContent = "Previous season";
    if (prevSeasonNum != null) {
        prevBtn.addEventListener("click", () => {
            const s = seasons.find((ss) => ss.season_number === prevSeasonNum);
            if (s)
                toast(`Previous: ${s.name || "Season " + prevSeasonNum}`, "info");
        });
    }

    const nextBtn = document.createElement("button");
    nextBtn.className =
        "btn btn-ghost btn-xs px-2 border border-base-300" +
        (nextSeasonNum == null ? " btn-disabled opacity-40" : "");
    nextBtn.textContent = "Next season";
    if (nextSeasonNum != null) {
        nextBtn.addEventListener("click", () => {
            const s = seasons.find((ss) => ss.season_number === nextSeasonNum);
            if (s)
                toast(`Next: ${s.name || "Season " + nextSeasonNum}`, "info");
        });
    }

    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);

    return wrap;
}

function renderMovieCollectionSection(currentMovie, collection) {
    const parts = Array.isArray(collection?.parts) ? collection.parts.slice() : [];
    if (!parts.length) return null;

    parts.sort((a, b) => {
        const da = a.release_date ? new Date(a.release_date).getTime() : 0;
        const db = b.release_date ? new Date(b.release_date).getTime() : 0;
        return da - db;
    });

    const inner = renderMiniList(collection.name || "Collection", parts, "movie");
    if (!inner) return null;
    const idx = parts.findIndex((p) => p.id === currentMovie.id);
    const prev = idx > 0 ? parts[idx - 1] : null;
    const next = idx >= 0 && idx < parts.length - 1 ? parts[idx + 1] : null;

    const wrap = document.createElement("div");
    wrap.className = "space-y-2";

    const title = document.createElement("div");
    title.className = "text-sm font-semibold";
    title.textContent = collection.name || "Collection";
    wrap.appendChild(title);

    const row = document.createElement("div");
    row.className = "flex flex-wrap gap-2 text-[0.7rem]";
    wrap.appendChild(row);

    if (prev) {
        const btnPrev = document.createElement("button");
        btnPrev.className = "btn btn-ghost btn-xs px-2 border border-base-300";
        btnPrev.textContent = `Prequel: ${prev.title || "Previous"}`;
        btnPrev.addEventListener("click", () =>
            openDetails(prev.id, { mediaType: "movie" })
        );
        row.appendChild(btnPrev);
    }

    if (next) {
        const btnNext = document.createElement("button");
        btnNext.className = "btn btn-ghost btn-xs px-2 border border-base-300";
        btnNext.textContent = `Sequel: ${next.title || "Next"}`;
        btnNext.addEventListener("click", () =>
            openDetails(next.id, { mediaType: "movie" })
        );
        row.appendChild(btnNext);
    }

    // Optional: small inline list of all parts
    const all = document.createElement("div");
    all.className = "w-full text-[0.7rem] opacity-70 mt-1";
    all.textContent =
        "In this series: " +
        parts
            .map((p) => p.title || p.original_title || "Untitled")
            .join(" • ");
    wrap.appendChild(all);

    return wrapInCollapse(collection.name || "Collection", inner);
}
