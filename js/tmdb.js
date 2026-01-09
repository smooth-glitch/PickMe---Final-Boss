// tmdb.js
import { API, state } from "./state.js";

export async function tmdb(path, params = {}) {
    const fullPath = path.startsWith("/") ? path : "/" + path;
    const u = new URL(API + fullPath);

    u.searchParams.set("include_adult", "false");
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, v);
    }

    const res = await fetch(u.toString());
    if (!res.ok) {
        throw new Error(`TMDB error ${res.status}`);
    }
    return res.json();
}

export async function loadTmdbConfig() {
    try {
        const cfg = await tmdb("configuration", {});
        const images = cfg?.images;
        if (images?.secure_base_url) state.imgBase = images.secure_base_url;
        const sizes = images?.poster_sizes || [];
        state.posterSize = sizes.includes("w500")
            ? "w500"
            : sizes.includes("w342")
                ? "w342"
                : sizes[0] || "w500";
    } catch { }
}
