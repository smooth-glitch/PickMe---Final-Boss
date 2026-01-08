import { API, state } from "./state.js";

export async function tmdb(path, params = {}) {
    const key = window.APP_CONFIG?.TMDB_API_KEY ?? window.APPCONFIG?.TMDBAPIKEY;

    if (!key) throw new Error("Missing TMDB key in config.js");

    const u = new URL(API + "/" + path.replace(/^\//, ""));
    u.searchParams.set("api_key", key);
    u.searchParams.set("include_adult", "false");

    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        u.searchParams.set(k, v);
    }

    const res = await fetch(u);
    if (!res.ok) throw new Error("TMDB error " + res.status);
    return res.json();
}

export async function loadTmdbConfig() {
    try {
        const cfg = await tmdb("configuration", {});
        const images = cfg?.images;
        if (images?.secure_base_url) state.imgBase = images.secure_base_url;
        const sizes = images?.poster_sizes || [];
        state.posterSize = sizes.includes("w500") ? "w500" : sizes.includes("w342") ? "w342" : (sizes[0] || "w500");
    } catch { }
}
