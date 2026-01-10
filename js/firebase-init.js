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
  addDoc,
  query,
  orderBy,
  limit,
  updateDoc,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const cfg =
  window.APPCONFIG?.firebaseConfig ?? window.APP_CONFIG?.firebaseConfig;

if (!cfg) {
  console.error(
    "Missing firebaseConfig in config.js (window.APPCONFIG / window.APP_CONFIG)."
  );
} else {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  const db = getFirestore(app);

  window.firebaseAuth = {
    auth,
    googleProvider,
    onAuthStateChanged,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
  };

  window.firebaseStore = {
    db,
    collection,
    doc,
    setDoc,
    getDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
    addDoc,
    query,
    orderBy,
    limit,
    updateDoc,
    deleteField,
  };
}
