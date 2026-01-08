import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const cfg = window.APPCONFIG?.firebaseConfig;

if (!cfg) {
  console.error("Missing firebaseConfig in config.js (window.APPCONFIG).");
} else {
  const app = initializeApp(cfg);

  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  const db = getFirestore(app);

  window.firebaseAuth = {
    auth,
    provider,
    onAuthStateChanged,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
  };

  // Expose Firestore helpers (used across the app)
  window.firebaseStore = {
    db,
    collection,
    doc,
    setDoc,
    getDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
  };
}
