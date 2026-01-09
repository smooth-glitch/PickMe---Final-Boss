// js/stickers.js

// config.js runs before this and sets window.APPCONFIG.GIPHY_API_KEY
const GIPHY_API_KEY = window.APPCONFIG?.GIPHY_API_KEY || "";

const BASE = "https://api.giphy.com/v1/stickers";

function mapGiphySticker(item) {
    const id = item.id;
    const title = item.title || "";
    const images = item.images || {};
    const fixed =
        images.fixed_height_small || images.fixed_height || images.original || {};
    const url = fixed.url || "";
    const thumb = fixed.url || "";
    return { id, title, url, thumb };
}

export async function searchStickers(query = "") {
    const params = new URLSearchParams({
        api_key: GIPHY_API_KEY,
        limit: "24",
        rating: "pg-13",
    });

    let endpoint = "trending";
    if (query && query.trim().length >= 2) {
        endpoint = "search";
        params.set("q", query.trim());
    }

    const res = await fetch(`${BASE}/${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load stickers");
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    return data.map(mapGiphySticker);
}
