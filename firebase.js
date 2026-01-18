import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
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

const writeEvent = async (uid, name, meta) => {
  const count = await incrementEventCounter(uid);
  const now = new Date();
  const payload = {
    name,
    timestamp: now.getTime(),
    time_utc_plus_2: formatUtcPlus2(now),
    ...meta,
  };
  await set(ref(db, `users/${uid}/events/event${count}`), payload);
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

const logEvent = async (name, meta = {}) => {
  if (!currentUser || !userRecordReady) {
    pendingEvents.push({ name, meta });
    return;
  }
  await writeEvent(currentUser.uid, name, meta);
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
      userRecordReady = true;
      await flushPendingEvents();
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
  return user;
};

const getCurrentUser = () => currentUser;

const waitForAuth = () => authReadyPromise;

export { getCurrentUser, logEvent, onAuthReady, registerWithEmail, waitForAuth };
