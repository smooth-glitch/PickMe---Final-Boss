# 🎬 PickMe – Movie Night Picker

A modern, responsive **movie night helper** built with **HTML**, **Tailwind + daisyUI**, and **Vanilla JavaScript**, powered by **TMDB** and **Firebase (Auth + Firestore)**. Build a pool, filter it, and hit **Pick for me** to instantly get tonight’s movie.

---

## ✨ Highlights

- 🔍 Search or discover movies/TV by **title**, **sort**, **year**, and **genres**.  
- 🎛️ **Genres multi-select dropdown** with a live “N selected” counter.  
- 🧼 **Reset filters** to quickly return to clean defaults.  
- 📺 “Watch filters”: auto-detected **region** + **OTT accounts (multi)** to refine Discover results.  
- 🎲 **Pick for me**: random “Tonight’s pick” from your curated pool.  
- 👤 Firebase **authentication** (Email/Password + Google).  
- 🧑‍🤝‍🧑 **Room mode**: share a room link, see online members, and sync “Tonight’s pick”.  
- 📤 Share your pool as a link (easy import on another device/account).  
- 🎨 Two themes (**Synthwave** & **Cupcake**) with a custom animated theme toggle.  

---

## 🧱 Tech Stack

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3"/>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000" alt="JavaScript"/>

  <img src="https://img.shields.io/badge/Tailwind%20CSS-0EA5E9?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/>
  <img src="https://img.shields.io/badge/daisyUI-7E22CE?style=for-the-badge&logo=daisyui&logoColor=white" alt="daisyUI"/>

  <img src="https://img.shields.io/badge/TMDB-01D277?style=for-the-badge&logo=themoviedatabase&logoColor=white" alt="TMDB"/>
  <img src="https://img.shields.io/badge/Firebase%20Auth-FFCA28?style=for-the-badge&logo=firebase&logoColor=000" alt="Firebase Auth"/>
  <img src="https://img.shields.io/badge/Firestore-FFA000?style=for-the-badge&logo=firebase&logoColor=000" alt="Firestore"/>

  <img src="https://img.shields.io/badge/SessionStorage-334155?style=for-the-badge" alt="SessionStorage"/>
</p>

---

## 🚀 Getting Started

### ✅ Run locally

1. **Clone the repo**
```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

2. **Create / update `config.js`**

> TMDB + Firebase web configs are public client keys for frontend usage. Still, secure access with sensible quotas and Firebase rules.

```js
// config.js

window.APP_CONFIG = {
  TMDB_API_KEY: "YOUR_TMDB_API_KEY",
  firebaseConfig: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "YOUR_FIREBASE_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  }
};

// Compatibility shim (optional):
// app.js reads window.APPCONFIG.TMDBAPIKEY, and firebase-init.js reads window.APPCONFIG.firebaseConfig.
window.APPCONFIG = {
  TMDBAPIKEY: window.APP_CONFIG.TMDB_API_KEY,
  firebaseConfig: window.APP_CONFIG.firebaseConfig
};
```

3. **Start a local server**
- VS Code: **Live Server**
- or:
```bash
python -m http.server 5500
```

4. **Open in browser**
- http://127.0.0.1:5500/index.html

---

## 🎛️ Features

### 🔍 Search / Discover / Trending
- **Search**: type a title and click **Search** (or press Enter).
- **Discover**: leave the search box empty and use:
  - **Result sort** (Popular / Rating / Newest)
  - **Genres** (multi-select dropdown)
  - **Year**
  - **Watch filters** (right panel): Region + OTT accounts
- **Trending**: daily trending movies with one click.

### 🎚️ Pool, Filters & Reset
- Add movies from results into your **pool**.
- Pool filters:
  - **Exclude watched**
  - **Min rating**
- **Reset filters** restores defaults (media type, year, genres, watch filters, etc.).

### 🎲 “Pick for me”
- Randomly selects from your filtered pool.
- Opens the details modal and highlights it as **Tonight’s pick**.

### 📋 Details + “Where to Watch”
- Details modal shows poster + metadata + overview.
- “Where to watch” provider badges appear when TMDB provider data is available for your region.

### 🧑‍🤝‍🧑 Rooms (Group Mode)
- Create a room, share/copy the link, and invite others.
- Room members list shows who’s online.
- “Tonight’s pick” syncs to everyone in the room.

### 📤 Sharing (Pool Links)
- Share your pool as a link.
- Import a shared list into your signed-in account.

---

## 🔐 Firebase Setup

1. Create a Firebase project and enable:
   - **Authentication → Email/Password**
   - (Optional) **Authentication → Google**
2. Paste your Firebase web config into `config.js`.
3. Add your local/hosted domain in Firebase Console:
   - Authentication → Settings → Authorized domains

---

## 🛠️ Customization

- **Branding & UI**
  - Change app name, spacing, and theme polish in `styles.css`.
- **Defaults**
  - Adjust filter defaults (min rating, exclude watched, etc.) in `app.js`.

---

## 📌 Roadmap (Future Enhancements)

- 💾 Stronger Firestore persistence
  - Clear guest vs signed-in state separation
  - Better merge/conflict handling across devices
- 🧑‍🤝‍🧑 Rooms upgrades
  - Host controls / permissions
  - Room-level shared settings (region/OTT/min rating)
  - Better activity history (“who picked what, when”)
- 🧠 Smarter recommendations
  - Suggestions based on genres + watch history
  - Avoid repeats automatically
- 📲 PWA improvements
  - Offline-friendly experience + installable app
- 🎛️ More filters
  - Language, runtime, providers expansion
  - Better movie vs TV tuning

---

## 🙌 Author

Designed & developed by **Arjun**.
```
