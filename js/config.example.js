// js/config.example.js
// Copy this file to js/config.js and fill in YOUR REAL values locally.
// DO NOT COMMIT js/config.js - it's in .gitignore for a reason.

window.APP_CONFIG = {
    // For backend: your server holds TMDB key, frontend calls your server endpoint
    API_BASE_URL: "http://localhost:3000",

    // If you absolutely need it here temporarily, use a placeholder - NEVER the real key
    TMDB_API_KEY: "REPLACE_ME_WITH_YOUR_TMDB_KEY",

    firebaseConfig: {
        apiKey: "REPLACE_ME",
        authDomain: "movienight-picker.firebaseapp.com",
        projectId: "movienight-picker",
        storageBucket: "movienight-picker.appspot.com",
        messagingSenderId: "REPLACE_ME",
        appId: "REPLACE_ME",
        measurementId: "REPLACE_ME",
    },
};

// Backward/forward compatible alias for other modules in your app:
window.APPCONFIG = {
    TMDBAPIKEY: window.APP_CONFIG.TMDB_API_KEY,
    firebaseConfig: window.APP_CONFIG.firebaseConfig,
};
