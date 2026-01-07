import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const cfg = window.APP_CONFIG?.firebaseConfig;

if (!cfg) {
  console.error("Missing firebaseConfig in config.js (window.APP_CONFIG).");
} else {
  const app = initializeApp(cfg);

  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  const db = getFirestore(app);

  // expose to window so app.js can use it
  window.firebaseAuth = {
    auth,
    provider,
    onAuthStateChanged,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
  };

  // expose Firestore helpers app.js expects
  window.firebaseStore = {
    db,
    doc,
    setDoc,
    getDoc,
    onSnapshot,
    serverTimestamp
  };
}
