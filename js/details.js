import { id } from "./dom.js";
import { state, inRoom } from "./state.js";
import { tmdb } from "./tmdb.js";
import { toast } from "./ui.js";
import { setBusy, posterUrl, year } from "./render.js";
import { renderWatchProvidersSection } from "./watchFilters.js";
import { saveJson, LSWATCHED } from "./storage.js";
import { renderPool } from "./render.js";
import { updatePlaybackFromLocal, saveTelepartyUrl } from "./rooms.js";
import { addToPoolById } from "./pool.js";


let currentDetailsId = null;

export function getCurrentDetailsId() {
    return currentDetailsId;
}

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
    const ovEl = id("dlgOverview");
    const btnReroll = id("btnReroll");
    const posterEl = id("dlgPoster");
    const mainExtras = id("dlgMainExtras");
    const extraContent = id("dlgExtraContent");

    try {
        setBusy(true);

        currentDetailsId = idNum;
        const kind = opts?.mediaType || state.filters?.mediaType || "movie";

        if (!dlg || !dlgTitle || !dlgMeta || !ovEl) return;

        dlgTitle.textContent = "Loading…";
        dlgMeta.textContent = "";
        ovEl.innerHTML = `
        <div class="flex items-center justify-center py-10">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      `;

        if (posterEl) {
            posterEl.src = "";
            posterEl.alt = "";
        }
        if (mainExtras) mainExtras.innerHTML = "";
        if (extraContent) extraContent.innerHTML = "";

        dlg.showModal();

        const data = await tmdb(`${kind}/${idNum}`, {
            language: "en-US",
            ...(kind === "tv"
                ? { append_to_response: "recommendations,similar" }
                : {}),
        });

        state.currentDetails = { ...data, mediaType: kind };

        // ----- Title & meta -----
        const title =
            kind === "tv"
                ? data.name || data.original_name || "Untitled"
                : data.title || data.original_title || "Untitled";
        const dateStr = kind === "tv" ? data.first_air_date : data.release_date;

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

        // Poster
        if (posterEl) {
            const p = posterUrl(data.poster_path);
            if (p) {
                posterEl.src = p;
                posterEl.alt = title;
            } else {
                posterEl.src = "";
                posterEl.alt = "";
            }
        }

        // Overview
        ovEl.textContent = data.overview || "No overview available.";

        // ----- Main extras (trailers / providers / seasons / collection) -----
        if (mainExtras) mainExtras.innerHTML = "";
        const rightExtras = document.createElement("div");
        rightExtras.className = "space-y-4";

        // Trailer row
        try {
            const videos = await loadBestVideos(kind, idNum);
            const best = pickBestTrailer(videos);
            const url = trailerUrl(best);

            const trailerWrap = document.createElement("div");
            trailerWrap.className = "flex flex-wrap items-center gap-2";

            if (url) {
                const btnTrailer = document.createElement("a");
                btnTrailer.className = "btn btn-sm btn-secondary gap-2";
                btnTrailer.href = url;
                btnTrailer.target = "_blank";
                btnTrailer.rel = "noopener noreferrer";
                btnTrailer.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Watch trailer
          `;
                trailerWrap.appendChild(btnTrailer);
            } else {
                const none = document.createElement("div");
                none.className = "text-xs opacity-60";
                none.textContent = "Trailer not available";
                trailerWrap.appendChild(none);
            }

            if (inRoom()) {
                const btnTeleparty = document.createElement("button");
                btnTeleparty.type = "button";
                btnTeleparty.className = "btn btn-sm btn-primary gap-2";
                btnTeleparty.innerHTML = `
            <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-base-100 text-[10px] font-semibold">TP</span>
            <span>Teleparty</span>
          `;
                btnTeleparty.addEventListener("click", async () => {
                    const existing = prompt(
                        "Paste your Teleparty link here:",
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
                btnPlayTogether.className = "btn btn-sm btn-primary gap-2";
                btnPlayTogether.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <polygon points="10 9 15 12 10 15 10 9"/>
            </svg>
            Play together
          `;
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

            rightExtras.appendChild(trailerWrap);
        } catch {
            // ignore trailer errors
        }

        // Where to watch
        try {
            const wp = await tmdb(`${kind}/${idNum}/watch/providers`, {});
            const wpSection = renderWatchProvidersSection(wp);
            if (wpSection) rightExtras.appendChild(wpSection);
        } catch {
            // ignore
        }

        // Seasons (TV)
        if (kind === "tv" && Array.isArray(data.seasons)) {
            const seasonsSection = renderTvSeasonsSection(data);
            if (seasonsSection) {
                rightExtras.appendChild(
                    wrapInCollapse("Seasons", seasonsSection)
                );
            }
        }

        // Movie collection
        if (kind === "movie" && data.belongs_to_collection?.id) {
            try {
                const col = await tmdb(
                    `collection/${data.belongs_to_collection.id}`,
                    { language: "en-US" }
                );
                const colSection = renderMovieCollectionSection(data, col);
                if (colSection) rightExtras.appendChild(colSection);
            } catch {
                // ignore collection errors
            }
        }

        if (mainExtras) mainExtras.appendChild(rightExtras);

        // ----- Recommendations / Similar -----
        if (extraContent) extraContent.innerHTML = "";

        async function buildSection(title, list, mediaType) {
            if (!Array.isArray(list) || list.length === 0) return "";

            const cards = list.slice(0, 10).map((item) => {
                const p = posterUrl(item.poster_path);
                const name =
                    mediaType === "tv"
                        ? item.name || item.original_name
                        : item.title || item.original_title;

                return `
            <button
              type="button"
              class="flex-none w-24 text-left group"
              data-id="${item.id}"
              data-kind="${mediaType}"
            >
              <div class="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-300 mb-1.5">
                ${p
                        ? `<img src="${p}" alt="${escapeHtml(name || "")}"
                           class="w-full h-full object-cover transition group-hover:scale-105" loading="lazy" />`
                        : `<div class="w-full h-full grid place-items-center text-[10px] opacity-60">No poster</div>`
                    }
              </div>
              <p class="text-[11px] leading-tight line-clamp-2 group-hover:text-primary">
                ${escapeHtml(name || "Untitled")}
              </p>
            </button>
          `;
            }).join("");

            if (!cards) return "";

            return `
          <section class="space-y-2">
            <h4 class="font-semibold text-sm flex items-center gap-2 opacity-80">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              ${title}
            </h4>
            <div class="flex gap-3 overflow-x-auto pb-2">
              ${cards}
            </div>
          </section>
        `;
        }

        let sectionsHtml = "";

        if (kind === "tv") {
            const tvRecs = data.recommendations?.results || [];
            const tvSimilar = data.similar?.results || [];

            console.log("TV recs length:", tvRecs.length);
            console.log("TV similar length:", tvSimilar.length);

            if (tvRecs.length) {
                sectionsHtml += await buildSection("Recommended shows", tvRecs, "tv");
            }
            if (tvSimilar.length) {
                sectionsHtml += await buildSection("Similar shows", tvSimilar, "tv");
            }
        } else {
            const rec = await tmdb(`movie/${idNum}/recommendations`, {
                language: "en-US",
            });
            const sim = await tmdb(`movie/${idNum}/similar`, {
                language: "en-US",
            });

            const movieRecs = rec.results || [];
            const movieSimilar = sim.results || [];

            console.log("Movie recs length:", movieRecs.length);
            console.log("Movie similar length:", movieSimilar.length);

            if (movieRecs.length) {
                sectionsHtml += await buildSection("Recommended movies", movieRecs, "movie");
            }
            if (movieSimilar.length) {
                sectionsHtml += await buildSection("Similar movies", movieSimilar, "movie");
            }
        }

        if (extraContent) {
            if (sectionsHtml) {
                extraContent.innerHTML = sectionsHtml;

                // Delegate click to openDetails on recs/similar cards
                extraContent.querySelectorAll("button[data-id]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const mid = Number(btn.getAttribute("data-id"));
                        const mkind = btn.getAttribute("data-kind") || kind;
                        if (!Number.isFinite(mid)) return;
                        openDetails(mid, { mediaType: mkind });
                    });
                });
            } else {
                extraContent.innerHTML = `
            <p class="text-xs text-base-content/50">
              No recommendations or similar titles available for this title yet.
            </p>
          `;
            }
        }

        if (opts.highlight) {
            const hint = document.createElement("div");
            hint.className = "mt-3 badge badge-primary badge-outline";
            hint.textContent = "Tonight’s pick";
            mainExtras?.appendChild(hint);
        }

        if (btnReroll) {
            btnReroll.classList.toggle("hidden", !opts?.highlight);
        }

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
