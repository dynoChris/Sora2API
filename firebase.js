import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import {
  getDatabase,
  get,
  ref,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB55TxlyNoPhCVozYeEkeDYIfMVvEjSETc",
  authDomain: "sora2api-9feeb.firebaseapp.com",
  databaseURL: "https://sora2api-9feeb-default-rtdb.firebaseio.com",
  projectId: "sora2api-9feeb",
  storageBucket: "sora2api-9feeb.firebasestorage.app",
  messagingSenderId: "694746657630",
  appId: "1:694746657630:web:4989fa45d78c7286e095cf",
  measurementId: "G-MNNZFGJ89H",
};

const app = initializeApp(firebaseConfig);

const initAnalytics = async () => {
  try {
    const { getAnalytics } = await import(
      "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js"
    );
    getAnalytics(app);
  } catch (error) {
    console.info("Firebase analytics unavailable", error);
  }
};

initAnalytics();

const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let userRecordReady = false;
const pendingEvents = [];
const pendingVideos = [];
let authReadyResolve = null;
const authReadyPromise = new Promise((resolve) => {
  authReadyResolve = resolve;
});

const pad = (value) => String(value).padStart(2, "0");

const formatUtcPlus2 = (date) => {
  const adjusted = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  const year = adjusted.getUTCFullYear();
  const month = pad(adjusted.getUTCMonth() + 1);
  const day = pad(adjusted.getUTCDate());
  const hour = pad(adjusted.getUTCHours());
  const minute = pad(adjusted.getUTCMinutes());
  const second = pad(adjusted.getUTCSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC+02:00`;
};

const ensureUserRecord = async (user) => {
  const userRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(userRef);
  const now = Date.now();

  if (!snapshot.exists()) {
    await set(userRef, {
      status: user.isAnonymous ? "anonymous" : "registered",
      created_at: now,
      created_at_local: formatUtcPlus2(new Date(now)),
      email: user.email || null,
      event_counter: 0,
      video_counter: 0,
    });
    return;
  }

  const updates = {};
  if (!user.isAnonymous && snapshot.val().status !== "registered") {
    updates.status = "registered";
  }
  if (user.email && snapshot.val().email !== user.email) {
    updates.email = user.email;
  }
  if (Object.keys(updates).length > 0) {
    await update(userRef, updates);
  }
};

const incrementEventCounter = async (uid) => {
  const counterRef = ref(db, `users/${uid}/event_counter`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  if (!result.committed) {
    throw new Error("Event counter update failed");
  }
  return result.snapshot.val();
};

const incrementVideoCounter = async (uid) => {
  const counterRef = ref(db, `users/${uid}/video_counter`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  if (!result.committed) {
    throw new Error("Video counter update failed");
  }
  return result.snapshot.val();
};

const migrateEventKeys = async (uid) => {
  const eventsRef = ref(db, `users/${uid}/events`);
  const snapshot = await get(eventsRef);
  if (!snapshot.exists()) {
    return;
  }

  const events = snapshot.val();
  const updates = {};
  let maxNumeric = 0;

  Object.entries(events).forEach(([key, value]) => {
    const legacyMatch = key.match(/^event(\d+)$/);
    if (legacyMatch) {
      const numericKey = String(parseInt(legacyMatch[1], 10));
      if (events[numericKey] == null) {
        updates[`users/${uid}/events/${numericKey}`] = value;
      }
      updates[`users/${uid}/events/${key}`] = null;
      maxNumeric = Math.max(maxNumeric, parseInt(numericKey, 10));
      return;
    }

    if (/^\d+$/.test(key)) {
      maxNumeric = Math.max(maxNumeric, parseInt(key, 10));
    }
  });

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }

  if (maxNumeric > 0) {
    await runTransaction(ref(db, `users/${uid}/event_counter`), (current) =>
      Math.max(current || 0, maxNumeric)
    );
  }
};

const writeEvent = async (uid, name, meta) => {
  const count = await incrementEventCounter(uid);
  const now = new Date();
  const payload = {
    name,
    timestamp: now.getTime(),
    time_utc_plus_2: formatUtcPlus2(now),
    ...meta,
  };
  await set(ref(db, `users/${uid}/events/${count}`), payload);
};

const writeVideo = async (uid, meta) => {
  const count = await incrementVideoCounter(uid);
  const now = new Date();
  const payload = {
    timestamp: now.getTime(),
    time_utc_plus_2: formatUtcPlus2(now),
    ...meta,
  };
  await set(ref(db, `users/${uid}/videos/${count}`), payload);
};

const flushPendingEvents = async () => {
  if (!currentUser || !userRecordReady || pendingEvents.length === 0) {
    return;
  }

  const queue = pendingEvents.splice(0, pendingEvents.length);
  for (const item of queue) {
    await writeEvent(currentUser.uid, item.name, item.meta);
  }
};

const flushPendingVideos = async () => {
  if (!currentUser || !userRecordReady || pendingVideos.length === 0) {
    return;
  }

  const queue = pendingVideos.splice(0, pendingVideos.length);
  for (const item of queue) {
    await writeVideo(currentUser.uid, item);
  }
};

const logEvent = async (name, meta = {}) => {
  if (!currentUser || !userRecordReady) {
    pendingEvents.push({ name, meta });
    return;
  }
  await writeEvent(currentUser.uid, name, meta);
};

const getUserVideos = async () => {
  if (!currentUser) {
    return null;
  }
  const snapshot = await get(ref(db, `users/${currentUser.uid}/videos`));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.val();
};

const saveGeneratedVideo = async (meta = {}) => {
  if (!currentUser || !userRecordReady) {
    pendingVideos.push(meta);
    return;
  }
  await writeVideo(currentUser.uid, meta);
};

const onAuthReady = (callback) => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Firebase anonymous auth failed", error);
      }
      return;
    }

    currentUser = user;
    userRecordReady = false;
    try {
      await ensureUserRecord(user);
      await migrateEventKeys(user.uid);
      userRecordReady = true;
      await flushPendingEvents();
      await flushPendingVideos();
    } catch (error) {
      console.error("Firebase user record init failed", error);
    }

    if (authReadyResolve) {
      authReadyResolve(user);
      authReadyResolve = null;
    }

    if (callback) {
      callback(user);
    }
  });
};

const registerWithEmail = async (email, password) => {
  if (!auth.currentUser) {
    throw new Error("No active user session");
  }

  let user = auth.currentUser;
  if (user.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(user, credential);
    user = result.user;
  }

  const now = Date.now();
  await update(ref(db, `users/${user.uid}`), {
    status: "registered",
    email: user.email || email,
    registered_at: now,
    registered_at_local: formatUtcPlus2(new Date(now)),
  });

  currentUser = user;
  userRecordReady = true;
  await flushPendingVideos();
  return user;
};

const signInWithEmail = async (email, password) => {
  const result = await signInWithEmailAndPassword(auth, email, password);
  const user = result.user;
  await ensureUserRecord(user);

  const now = Date.now();
  await update(ref(db, `users/${user.uid}`), {
    status: "registered",
    email: user.email || email,
    last_login_at: now,
    last_login_at_local: formatUtcPlus2(new Date(now)),
  });

  currentUser = user;
  userRecordReady = true;
  await flushPendingVideos();
  return user;
};

const signOutUser = async () => {
  await signOut(auth);
  currentUser = null;
  userRecordReady = false;
};

const getCurrentUser = () => currentUser;

const getIdToken = async () => {
  if (!currentUser) {
    return null;
  }
  return currentUser.getIdToken();
};

const waitForAuth = () => authReadyPromise;

export {
  getCurrentUser,
  getIdToken,
  logEvent,
  getUserVideos,
  onAuthReady,
  registerWithEmail,
  saveGeneratedVideo,
  signInWithEmail,
  signOutUser,
  waitForAuth,
};
