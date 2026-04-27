const CLOUD_SYNC_STORAGE_KEY = "klondike_f1_cloud_sync_v1";
const CLOUD_SYNC_DEVICE_KEY = "klondike_f1_cloud_sync_device_v1";
const FIREBASE_WEB_SDK_VERSION = "10.12.2";

let firebaseSdkPromise = null;
let firebaseContext = null;
let queuedJob = null;
let syncTimer = null;
let syncInFlight = false;
let lastSyncedFingerprint = "";
let revisionCounter = 0;

const syncState = {
  status: "disabled",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: "",
  lastRevision: "",
  lastSavedAt: null,
  deviceId: getOrCreateDeviceId(),
  authUid: "",
  configured: false
};

const syncConfig = loadConfig();

window.__cthCloudSync = {
  getState,
  getConfig: () => clone(syncConfig),
  saveConfig,
  clearConfig,
  syncNow,
  isReady: isConfigured
};

window.__cthCloudSyncHook = function(payload){
  const snapshot = payload?.state;
  if (!snapshot) return;
  syncState.lastSavedAt = payload.savedAt || snapshot.lastSavedAt || null;
  if (!isConfigured()){
    updateStatus(syncConfig.enabled ? "not-configured" : "disabled");
    return;
  }
  queueSync(snapshot, payload);
};

window.__cthCloudSyncGetLabel = function(){
  return getStatusLabel();
};

window.addEventListener("online", function(){
  if (isConfigured()) {
    queueCurrentState("browser-online");
  } else {
    emitStatus();
  }
});

document.addEventListener("visibilitychange", function(){
  if (!document.hidden && isConfigured()) queueCurrentState("tab-visible");
});

bootstrap();

async function bootstrap(){
  if (isConfigured()) {
    queueCurrentState("bootstrap");
  } else {
    updateStatus(syncConfig.enabled ? "not-configured" : "disabled");
  }
}

function getState(){
  return {
    ...clone(syncState),
    label: getStatusLabel(),
    config: clone(syncConfig),
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false
  };
}

function loadConfig(){
  const defaults = {
    enabled: false,
    raceId: "",
    deviceLabel: "",
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: ""
    }
  };

  try{
    const raw = localStorage.getItem(CLOUD_SYNC_STORAGE_KEY);
    if (!raw) {
      syncState.configured = false;
      return defaults;
    }
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaults,
      ...parsed,
      firebase: {
        ...defaults.firebase,
        ...(parsed?.firebase || {})
      }
    };
    syncState.configured = !!merged.enabled && hasFirebaseConfig(merged.firebase) && !!String(merged.raceId || "").trim();
    return merged;
  } catch (error){
    console.warn("Cloud sync config load failed:", error);
    syncState.configured = false;
    return defaults;
  }
}

function saveConfig(nextConfig){
  const normalized = {
    enabled: !!nextConfig?.enabled,
    raceId: String(nextConfig?.raceId || "").trim(),
    deviceLabel: String(nextConfig?.deviceLabel || "").trim(),
    firebase: sanitizeFirebaseConfig(nextConfig?.firebase || {})
  };

  Object.assign(syncConfig, normalized);
  localStorage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(syncConfig));
  syncState.configured = isConfigured();
  firebaseContext = null;
  firebaseSdkPromise = null;
  lastSyncedFingerprint = "";
  queuedJob = null;

  if (!syncConfig.enabled) {
    updateStatus("disabled");
    return getState();
  }

  if (!syncState.configured) {
    updateStatus("not-configured");
    return getState();
  }

  queueCurrentState("config-saved");
  return getState();
}

function clearConfig(){
  saveConfig({
    enabled: false,
    raceId: "",
    deviceLabel: "",
    firebase: {}
  });
}

function sanitizeFirebaseConfig(firebase){
  return {
    apiKey: String(firebase.apiKey || "").trim(),
    authDomain: String(firebase.authDomain || "").trim(),
    projectId: String(firebase.projectId || "").trim(),
    storageBucket: String(firebase.storageBucket || "").trim(),
    messagingSenderId: String(firebase.messagingSenderId || "").trim(),
    appId: String(firebase.appId || "").trim()
  };
}

function hasFirebaseConfig(firebase){
  return !!(
    firebase &&
    firebase.apiKey &&
    firebase.authDomain &&
    firebase.projectId &&
    firebase.appId
  );
}

function isConfigured(){
  return !!(syncConfig.enabled && String(syncConfig.raceId || "").trim() && hasFirebaseConfig(syncConfig.firebase));
}

function queueCurrentState(reason){
  const app = window.__cthApp;
  if (!app || typeof app.getClonedState !== "function") return;
  queueSync(app.getClonedState(), { reason, savedAt: app.getState?.()?.lastSavedAt || null, force: true });
}

function queueSync(snapshot, meta){
  if (!isConfigured()) {
    updateStatus(syncConfig.enabled ? "not-configured" : "disabled");
    return;
  }

  const safeSnapshot = clone(snapshot);
  const fingerprint = JSON.stringify(safeSnapshot);
  if (!meta?.force && fingerprint === lastSyncedFingerprint && !queuedJob) {
    updateStatus(syncState.lastSuccessAt ? "synced" : "pending");
    return;
  }

  queuedJob = {
    snapshot: safeSnapshot,
    fingerprint,
    meta: {
      reason: meta?.reason || "persist",
      savedAt: meta?.savedAt || safeSnapshot.lastSavedAt || null,
      force: !!meta?.force
    }
  };

  updateStatus((typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "pending");

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(flushQueue, 900);
}

async function syncNow(){
  if (!isConfigured()) {
    updateStatus(syncConfig.enabled ? "not-configured" : "disabled");
    return getState();
  }
  queueCurrentState("manual-sync");
  await flushQueue(true);
  return getState();
}

async function flushQueue(immediate){
  if (!queuedJob || syncInFlight) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    updateStatus("offline");
    return;
  }

  if (syncTimer && immediate) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  const job = queuedJob;
  queuedJob = null;
  syncInFlight = true;
  syncState.lastAttemptAt = new Date().toISOString();
  updateStatus("syncing");

  try{
    const ctx = await ensureFirebase();
    const revision = `${Date.now()}-${(++revisionCounter).toString().padStart(3, "0")}`;
    const deviceLabel = syncConfig.deviceLabel || `Stanice ${syncState.deviceId.slice(-4)}`;
    const raceRef = ctx.doc(ctx.db, "races", syncConfig.raceId);
    const logRef = ctx.doc(ctx.collection(raceRef, "syncEvents"), revision);
    const summary = buildSummary(job.snapshot, job.meta.reason);

    await Promise.all([
      ctx.setDoc(raceRef, {
        raceId: syncConfig.raceId,
        revision,
        appVersion: "cth-f1-web-sync-v1",
        updatedAt: ctx.serverTimestamp(),
        lastSavedAt: job.meta.savedAt || job.snapshot.lastSavedAt || null,
        updatedBy: {
          uid: ctx.auth.currentUser?.uid || syncState.authUid || null,
          deviceId: syncState.deviceId,
          deviceLabel
        },
        currentState: job.snapshot,
        summary
      }, { merge: true }),
      ctx.setDoc(logRef, {
        revision,
        raceId: syncConfig.raceId,
        reason: job.meta.reason,
        syncedAt: ctx.serverTimestamp(),
        savedAt: job.meta.savedAt || job.snapshot.lastSavedAt || null,
        updatedBy: {
          uid: ctx.auth.currentUser?.uid || syncState.authUid || null,
          deviceId: syncState.deviceId,
          deviceLabel
        },
        summary
      })
    ]);

    lastSyncedFingerprint = job.fingerprint;
    syncState.lastRevision = revision;
    syncState.lastSuccessAt = new Date().toISOString();
    syncState.lastError = "";
    updateStatus("synced");
  } catch (error){
    console.warn("Cloud sync failed:", error);
    queuedJob = job;
    syncState.lastError = normalizeError(error);
    updateStatus((typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "error");
    scheduleRetry();
  } finally {
    syncInFlight = false;
    if (queuedJob && !syncTimer) scheduleRetry();
  }
}

function scheduleRetry(){
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(function(){
    syncTimer = null;
    flushQueue(true);
  }, 4500);
}

async function ensureFirebase(){
  if (!isConfigured()) {
    throw new Error("Cloud sync neni plne nastaven.");
  }
  if (firebaseContext) return firebaseContext;

  const sdk = await loadFirebaseSdk();
  const appName = `cth-sync-${syncConfig.firebase.projectId}`;
  const existingApp = sdk.getApps().find(function(item){ return item.name === appName; });
  const firebaseApp = existingApp || sdk.initializeApp(syncConfig.firebase, appName);

  let db;
  try{
    db = sdk.initializeFirestore(firebaseApp, {
      localCache: sdk.persistentLocalCache({
        tabManager: sdk.persistentSingleTabManager()
      })
    });
  } catch (error){
    db = sdk.getFirestore(firebaseApp);
  }

  const auth = sdk.getAuth(firebaseApp);
  if (!auth.currentUser) {
    await sdk.signInAnonymously(auth);
  }

  syncState.authUid = auth.currentUser?.uid || "";

  firebaseContext = {
    ...sdk,
    app: firebaseApp,
    auth,
    db
  };

  return firebaseContext;
}

function loadFirebaseSdk(){
  if (firebaseSdkPromise) return firebaseSdkPromise;

  firebaseSdkPromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-firestore.js`)
  ]).then(function(modules){
    const appMod = modules[0];
    const authMod = modules[1];
    const dbMod = modules[2];
    return {
      initializeApp: appMod.initializeApp,
      getApps: appMod.getApps,
      getAuth: authMod.getAuth,
      signInAnonymously: authMod.signInAnonymously,
      initializeFirestore: dbMod.initializeFirestore,
      persistentLocalCache: dbMod.persistentLocalCache,
      persistentSingleTabManager: dbMod.persistentSingleTabManager,
      getFirestore: dbMod.getFirestore,
      doc: dbMod.doc,
      setDoc: dbMod.setDoc,
      collection: dbMod.collection,
      serverTimestamp: dbMod.serverTimestamp
    };
  });

  return firebaseSdkPromise;
}

function buildSummary(snapshot, reason){
  const onTrack = Array.isArray(snapshot?.teams)
    ? snapshot.teams.filter(function(team){ return !team.offTrack; }).sort(function(a, b){ return (b.total || 0) - (a.total || 0); })
    : [];
  return {
    reason: reason || "persist",
    roundNo: snapshot?.round?.number || 1,
    phase: snapshot?.phase || "race",
    leader: onTrack[0]?.name || "",
    leaderTotal: onTrack[0]?.total || 0,
    eventThird: snapshot?.eventThird || 1,
    historyEntries: Array.isArray(snapshot?.history) ? snapshot.history.length : 0,
    archivedRounds: Array.isArray(snapshot?.roundArchive) ? snapshot.roundArchive.length : 0
  };
}

function updateStatus(nextStatus){
  syncState.status = nextStatus;
  emitStatus();
}

function emitStatus(){
  window.dispatchEvent(new CustomEvent("cth-cloud-sync-status", { detail: getState() }));
  const app = window.__cthApp;
  if (app && typeof app.render === "function") app.render();
}

function getStatusLabel(){
  if (!syncConfig.enabled) return "vypnuto";
  if (!syncState.configured) return "chybi nastaveni";
  if (syncState.status === "syncing") return "probihajici sync";
  if (syncState.status === "offline") return "ceka na internet";
  if (syncState.status === "error") return syncState.lastError ? `chyba (${syncState.lastError})` : "chyba";
  if (syncState.status === "synced") {
    if (!syncState.lastSuccessAt) return "synchronizovano";
    const time = new Date(syncState.lastSuccessAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    return `synchronizovano ${time}`;
  }
  if (syncState.status === "pending") return "ceka na odeslani";
  return "pripraveno";
}

function normalizeError(error){
  const message = String(error?.message || error || "neznamy problem");
  if (/auth\/operation-not-allowed/i.test(message)) return "zapni Anonymous Auth";
  if (/Missing or insufficient permissions/i.test(message)) return "zkontroluj Firestore pravidla";
  if (/Failed to fetch dynamically imported module/i.test(message)) return "nelze nacist Firebase SDK";
  return message.length > 80 ? `${message.slice(0, 77)}...` : message;
}

function getOrCreateDeviceId(){
  const existing = localStorage.getItem(CLOUD_SYNC_DEVICE_KEY);
  if (existing) return existing;
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  localStorage.setItem(CLOUD_SYNC_DEVICE_KEY, id);
  return id;
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}
