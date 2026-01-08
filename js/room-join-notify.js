// snippets/room-join-notify.js
(() => {
    let unsub = null;
    let currentRoomId = null;
    let initDone = false;
  
    function getRoomIdFromUrl() {
      return new URL(window.location.href).searchParams.get("room");
    }
  
    function getSelfUid() {
      return window.firebaseAuth?.auth?.currentUser?.uid || null;
    }
  
    function notifyJoin(label) {
      const msg = `${label} joined`;
      if (typeof window.toast === "function") window.toast(msg, "info");
      else console.log(msg);
    }
  
    function stop() {
      if (typeof unsub === "function") unsub();
      unsub = null;
      initDone = false;
    }
  
    function canStart() {
      // firebase-init.js exposes these on window.firebaseStore
      return !!(window.firebaseStore?.db && window.firebaseStore?.collection && window.firebaseStore?.onSnapshot);
    }
  
    function start(roomId) {
      const fs = window.firebaseStore;
      const membersRef = fs.collection(fs.db, "rooms", roomId, "members");
  
      stop();
      currentRoomId = roomId;
  
      unsub = fs.onSnapshot(membersRef, (snap) => {
        // Skip the initial snapshot so existing members don't spam notifications.
        if (!initDone) {
          initDone = true;
          return;
        }
  
        const selfUid = getSelfUid();
  
        for (const ch of snap.docChanges()) {
          if (ch.type !== "added") continue;
          if (selfUid && ch.doc.id === selfUid) continue;
  
          const data = ch.doc.data() || {};
          const label = data.name || data.email || ch.doc.id;
          notifyJoin(label);
        }
      });
    }
  
    function tick() {
      const roomId = getRoomIdFromUrl();
  
      // Leaving room: URL param removed by app.js, so stop listener.
      if (!roomId) {
        if (unsub) stop();
        currentRoomId = null;
        return;
      }
  
      // Joining / switching rooms
      if (roomId !== currentRoomId) {
        if (!canStart()) return; // firebase not ready yet
        start(roomId);
      }
    }
  
    // Poll for room changes because app.js uses history.replaceState for room join/leave.
    setInterval(tick, 800);
    window.addEventListener("popstate", tick);
    document.addEventListener("visibilitychange", tick);
  
    // Kick once on load
    tick();
  })();
  