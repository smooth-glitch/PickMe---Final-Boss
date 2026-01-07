# 🎬 PickMe – Movie Night Picker

A modern, responsive **movie night helper** built with **HTML**, **CSS (Tailwind + daisyUI)**, and **Vanilla JavaScript**, powered by **TMDB** and **Firebase Auth**. Pick, filter, and randomize movies for your next watch session from a clean, themeable UI.

***

## ✨ Highlights

- 🔍 Search or discover movies by **title**, **rating**, and **sort order**
- 📈 Smart filters for **minimum rating**, **exclude watched**, and **trending** mode
- 🎲 **Pick for me**: random “Tonight’s pick” from your curated pool
- 🎛️ Two themes (**Synthwave** & **Cupcake**) with a custom animated theme toggle
- 👤 Firebase **authentication** with email/password and Google sign-in
- 📱 Fully responsive layout with card-based grid and polished UI/UX

***

## 🧱 Tech Stack

<p align="center">
  <!-- Core -->
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3"/>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000" alt="JavaScript"/>

  <!-- UI -->
  <img src="https://img.shields.io/badge/Tailwind%20CSS-0EA5E9?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/>
  <img src="https://img.shields.io/badge/daisyUI-7E22CE?style=for-the-badge&logo=daisyui&logoColor=white" alt="daisyUI"/>

  <!-- APIs -->
  <img src="https://img.shields.io/badge/TMDB-01D277?style=for-the-badge&logo=themoviedatabase&logoColor=white" alt="TMDB"/>
  <img src="https://img.shields.io/badge/Firebase%20Auth-FFCA28?style=for-the-badge&logo=firebase&logoColor=000" alt="Firebase Auth"/>

  <!-- Storage -->
  <img src="https://img.shields.io/badge/SessionStorage-334155?style=for-the-badge" alt="SessionStorage"/>

  <!-- Hosting & Tools -->
  <img src="https://img.shields.io/badge/GitHub-121011?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/>
  <img src="https://img.shields.io/badge/Git-F05033?style=for-the-badge&logo=git&logoColor=white" alt="Git"/>
  <img src="https://img.shields.io/badge/GitHub%20Pages-222222?style=for-the-badge&logo=githubpages&logoColor=white" alt="GitHub Pages"/>
  <img src="https://img.shields.io/badge/Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white" alt="Netlify"/>
</p>

***

## 🚀 Getting Started

### ✅ Run locally

1. **Clone the repo:**

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

2. **Configure API keys**

Open `config.js` and set:

```js
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
```

> Note: TMDB + Firebase web config are **public client keys** and are safe to commit for frontend usage, but always secure access with TMDB/Firebase rules and quotas.

3. **Start a local server** (any static server works):

- VS Code: use the **Live Server** extension  
- or:

```bash
python -m http.server 5500
```

4. **Open in browser:**

- Live Server: usually `http://127.0.0.1:5500`  
- Python: `http://127.0.0.1:5500/index.html`

***

## 🎛️ Features

### 🔍 Search, Discover, Trending

- **Search mode**: type a movie title and hit **Search**.  
- **Discover mode**: leave the search box empty and use:
  - **Result sort**: Popular / Rating / Newest  
  - **Min rating** filter (on the right panel)
- **Trending**: fetches TMDB daily trending movies with one click.

### 🎥 Pool, Filters & “Pick for Me”

- **Add** movies from the left results into your **pool** on the right.  
- **Filters**:
  - `Exclude watched`  
  - `Min rating`
- **Pick for me**:
  - Randomly selects a movie from your filtered pool  
  - Opens the details dialog with a **“Tonight’s pick”** badge.

### 📋 Details & Watched State

- Clicking **Details** opens a modal with:
  - Poster, year, runtime, genres, rating  
  - Overview text
- **Mark watched** updates:
  - Pool row status (Watched badge)  
  - Optional exclusion from future picks when `Exclude watched` is on.

### 🎨 Themes & UI polish

- Two themes controlled via `data-theme`:
  - **synthwave** (dark neon)  
  - **cupcake** (light pastel)
- Custom **animated theme button** in the header:
  - Rotates and recolors between purple and teal.
- Responsive card grid:
  - Auto-fills columns based on width  
  - Bigger cards on desktop, 1–2 per row on mobile.

***

## 🔐 Firebase Auth

This project uses **Firebase Authentication** for simple user identity:

- Email/password sign-in and sign-up (auto-create on first try)  
- Google sign-in via popup  
- Signed-in state:
  - Updates the chip text with display name or email  
  - Shows a small **user icon** next to the name in the header

### Setup

1. Create a Firebase project and enable:
   - **Email/Password** provider  
   - (Optional) **Google** provider
2. Copy your web app config into `config.js` as shown above.  
3. Make sure the auth domain matches your local/hosted URL in Firebase console.

***

## 🛠️ Customization

- 🎨 **Branding**
  - Change app name (“PickMe”), header styles, and theme colors in `styles.css`.
- 🔢 **Defaults & filters**
  - Adjust min rating defaults, pagination, and discover sort in `app.js`.
- 🧪 **Experiment**
  - Swap themes, cards, and hover states by editing the Tailwind/daisyUI utility classes in `index.html` and the custom rules in `styles.css`.

***

## 📌 Roadmap (Ideas)

- 💾 Persist pool + watched list per user in Firestore  
- 🧑‍🤝‍🧑 Add multi-user / “group pick” mode with shared pools  
- 🧠 Smarter recommendations based on genres and history  
- 📲 Add “share this pick” deep links for friends  

***

## 🙌 Author

Designed & developed by **Arjun**.
