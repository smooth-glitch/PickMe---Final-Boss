// js/gif.js
export async function searchGifs(query, { limit = 24 } = {}) {
    const apiKey = window.APPCONFIG?.GIPHY_API_KEY;
    if (!apiKey) throw new Error("Missing GIPHY_API_KEY in config.js");

    const q = (query || "").trim();
    const endpoint = q
        ? "https://api.giphy.com/v1/gifs/search"
        : "https://api.giphy.com/v1/gifs/trending";

    const url = new URL(endpoint);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("limit", String(limit));
    if (q) url.searchParams.set("q", q);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GIPHY error ${res.status}`);

    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];

    return list.map((item) => {
        const id = item.id;
        const title = item.title || "";
        const images = item.images || {};
        const thumb =
            images.fixed_width_small?.url ||
            images.fixed_height_small?.url ||
            images.preview_gif?.url ||
            images.original?.url ||
            "";
        const full =
            images.original?.url ||
            images.downsized_medium?.url ||
            images.downsized?.url ||
            thumb;

        return { id, title, thumb, url: full };
    });
}
