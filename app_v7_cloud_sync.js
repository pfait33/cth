const CLOUD_SYNC_STORAGE_KEY = "klondike_f1_cloud_sync_v1";
const CLOUD_SYNC_DEVICE_KEY = "klondike_f1_cloud_sync_device_v1";
const CLOUD_SYNC_META_KEY = "klondike_f1_cloud_sync_meta_v1";
const FIREBASE_WEB_SDK_VERSION = "10.12.2";
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBxEwRc8nUtF8hyDeSHErMTGuorPs3vZGs",
  authDomain: "cth-klondike-2026.firebaseapp.com",
  projectId: "cth-klondike-2026",
  storageBucket: "cth-klondike-2026.firebasestorage.app",
  messagingSenderId: "724444139351",
  appId: "1:724444139351:web:6a477d1fde9796be057812"
};

let firebaseSdkPromise = null;
let firebaseContext = null;
let queuedJob = null;
let syncTimer = null;
let syncInFlight = false;
let lastSyncedFingerprint = "";
let revisionCounter = 0;
let unsubscribeRace = null;
let suppressNextHook = false;

const syncState = {
  status: "disabled",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: "",
  lastRevision: "",
  lastSavedAt: null,
  deviceId: getOrCreateDeviceId(),
  authUid: "",
  authEmail: "",
  authProvider: "",
  canWrite: false,
  configured: false
};

const syncConfig = loadConfig();

window.__cthCloudSync = {
  getState,
  getConfig: () => clone(syncConfig),
  saveConfig,
  clearConfig,
  syncNow,
  signInAdmin,
  signOutAdmin,
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
    refreshRemoteState();
  } else {
    emitStatus();
  }
});

document.addEventListener("visibilitychange", function(){
  if (!document.hidden && isConfigured()) refreshRemoteState();
});

bootstrap();

async function bootstrap(){
  if (isConfigured()) {
    refreshRemoteState();
  } else {
    updateStatus(syncConfig.enabled ? "not-configured" : "disabled");
  }
}

function refreshRemoteState(){
  if (!isConfigured()) return;
  importLatestCloudState();
  startRemoteStateListener();
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
    enabled: true,
    raceId: "klondike-2026-hlavni-zavod",
    deviceLabel: "",
    firebase: {
      ...DEFAULT_FIREBASE_CONFIG
    }
  };

  try{
    const raw = localStorage.getItem(CLOUD_SYNC_STORAGE_KEY);
    if (!raw) {
      syncState.configured = !!defaults.enabled && hasFirebaseConfig(defaults.firebase) && !!String(defaults.raceId || "").trim();
      return defaults;
    }
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaults,
      ...parsed,
      firebase: sanitizeFirebaseConfig(parsed?.firebase || {})
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
    raceId: String(nextConfig?.raceId || "klondike-2026-hlavni-zavod").trim(),
    deviceLabel: String(nextConfig?.deviceLabel || "").trim(),
    firebase: sanitizeFirebaseConfig(nextConfig?.firebase || {})
  };

  Object.assign(syncConfig, normalized);
  localStorage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(syncConfig));
  syncState.configured = isConfigured();
  firebaseContext = null;
  firebaseSdkPromise = null;
  if (typeof unsubscribeRace === "function") unsubscribeRace();
  unsubscribeRace = null;
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

  refreshRemoteState();
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
  const source = firebase || {};
  return {
    apiKey: String(source.apiKey || DEFAULT_FIREBASE_CONFIG.apiKey || "").trim(),
    authDomain: String(source.authDomain || DEFAULT_FIREBASE_CONFIG.authDomain || "").trim(),
    projectId: String(source.projectId || DEFAULT_FIREBASE_CONFIG.projectId || "").trim(),
    storageBucket: String(source.storageBucket || DEFAULT_FIREBASE_CONFIG.storageBucket || "").trim(),
    messagingSenderId: String(source.messagingSenderId || DEFAULT_FIREBASE_CONFIG.messagingSenderId || "").trim(),
    appId: String(source.appId || DEFAULT_FIREBASE_CONFIG.appId || "").trim()
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
  if (suppressNextHook) {
    suppressNextHook = false;
    return;
  }
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

async function signInAdmin(email, password){
  const ctx = await ensureFirebase();
  const cleanEmail = String(email || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanEmail || !cleanPassword) {
    throw new Error("Vypln e-mail i heslo.");
  }
  updateStatus("authenticating");
  await ctx.signInWithEmailAndPassword(ctx.auth, cleanEmail, cleanPassword);
  updateAuthState(ctx.auth.currentUser);
  updateStatus("admin-ready");
  window.__cthApp?.setUIMode?.("admin");
  if (queuedJob) await flushQueue(true);
  return getState();
}

async function signOutAdmin(){
  const ctx = await ensureFirebase();
  await ctx.signOut(ctx.auth);
  await ctx.signInAnonymously(ctx.auth);
  updateAuthState(ctx.auth.currentUser);
  updateStatus("read-only");
  window.__cthApp?.setUIMode?.("kids");
  return getState();
}

async function importLatestCloudState(){
  const app = window.__cthApp;
  if (!app || typeof app.getClonedState !== "function" || typeof app.setState !== "function") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    updateStatus("offline");
    return;
  }

  updateStatus("checking-remote");

  try{
    const ctx = await ensureFirebase();
    const raceRef = ctx.doc(ctx.db, "races", syncConfig.raceId);
    const snap = await ctx.getDoc(raceRef);
    if (!snap.exists()) {
      updateStatus("pending");
      return;
    }

    const remote = snap.data();
    const remoteState = remote?.currentState;
    if (!remoteState) {
      updateStatus("pending");
      return;
    }

    applyRemoteState(remote, "startup");
  } catch (error){
    console.warn("Cloud import failed:", error);
    syncState.lastError = normalizeError(error);
    updateStatus("error");
  }
}

async function startRemoteStateListener(){
  if (!isConfigured()) return;
  if (typeof unsubscribeRace === "function") unsubscribeRace();

  try{
    const ctx = await ensureFirebase();
    const raceRef = ctx.doc(ctx.db, "races", syncConfig.raceId);
    unsubscribeRace = ctx.onSnapshot(raceRef, function(snap){
      if (!snap.exists()) return;
      applyRemoteState(snap.data(), "listener");
    }, function(error){
      console.warn("Cloud listener failed:", error);
      syncState.lastError = normalizeError(error);
      updateStatus("error");
    });
  } catch (error){
    console.warn("Cloud listener setup failed:", error);
    syncState.lastError = normalizeError(error);
    updateStatus("error");
  }
}

function applyRemoteState(remote, source){
  const app = window.__cthApp;
  const remoteState = remote?.currentState;
  const remoteRevision = String(remote?.revision || "");
  if (!app || typeof app.setState !== "function" || !remoteState || !remoteRevision) return false;

  const meta = loadRemoteMeta();
  if (meta.revision === remoteRevision || syncState.lastRevision === remoteRevision) {
    updateStatus(syncState.canWrite ? "synced" : "read-only");
    return false;
  }

  if (syncState.canWrite && queuedJob) {
    updateStatus("pending");
    return false;
  }

  lastSyncedFingerprint = JSON.stringify(remoteState);
  suppressNextHook = true;
  try{
    app.setState(remoteState, { preserveCloudSnapshot: true });
  } finally {
    suppressNextHook = false;
  }
  saveRemoteMeta({
    revision: remoteRevision,
    lastSavedAt: remote.lastSavedAt || remoteState.lastSavedAt || null,
    importedAt: new Date().toISOString(),
    source: source || "remote"
  });
  syncState.lastSuccessAt = new Date().toISOString();
  syncState.lastRevision = remoteRevision;
  syncState.lastError = "";
  updateStatus(source === "listener" ? "remote-updated" : "imported");
  return true;
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
    if (!isAdminUser(ctx.auth.currentUser)) {
      queuedJob = job;
      syncState.lastError = "prihlas se jako admin pro zapis";
      updateAuthState(ctx.auth.currentUser);
      updateStatus("read-only");
      return;
    }

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
    saveRemoteMeta({
      revision,
      lastSavedAt: job.meta.savedAt || job.snapshot.lastSavedAt || null,
      importedAt: new Date().toISOString(),
      source: "local-write"
    });
    updateStatus("synced");
  } catch (error){
    console.warn("Cloud sync failed:", error);
    queuedJob = job;
    syncState.lastError = normalizeError(error);
    updateStatus((typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "error");
    scheduleRetry();
  } finally {
    syncInFlight = false;
    if (queuedJob && !syncTimer && syncState.status !== "read-only") scheduleRetry();
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
  sdk.onAuthStateChanged(auth, function(user){
    updateAuthState(user);
  });
  if (!auth.currentUser) {
    await sdk.signInAnonymously(auth);
  }

  updateAuthState(auth.currentUser);

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
      signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
      signOut: authMod.signOut,
      onAuthStateChanged: authMod.onAuthStateChanged,
      initializeFirestore: dbMod.initializeFirestore,
      persistentLocalCache: dbMod.persistentLocalCache,
      persistentSingleTabManager: dbMod.persistentSingleTabManager,
      getFirestore: dbMod.getFirestore,
      doc: dbMod.doc,
      setDoc: dbMod.setDoc,
      getDoc: dbMod.getDoc,
      onSnapshot: dbMod.onSnapshot,
      collection: dbMod.collection,
      serverTimestamp: dbMod.serverTimestamp
    };
  });

  return firebaseSdkPromise;
}

function updateAuthState(user){
  const provider = user?.providerData?.[0]?.providerId || "";
  syncState.authUid = user?.uid || "";
  syncState.authEmail = user?.email || "";
  syncState.authProvider = provider || (user?.isAnonymous ? "anonymous" : "");
  syncState.canWrite = isAdminUser(user);
  if (syncConfig.enabled && !syncState.canWrite) {
    window.__cthApp?.setUIMode?.("kids");
  }
}

function isAdminUser(user){
  return !!user && !user.isAnonymous && user.providerData?.some(function(provider){
    return provider.providerId === "password";
  });
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
  if (syncState.status === "authenticating") return "prihlasovani admina";
  if (syncState.status === "admin-ready") return `admin ${syncState.authEmail || "prihlasen"}`;
  if (syncState.status === "read-only") return "jen cteni, prihlas admina pro zapis";
  if (syncState.status === "syncing") return "probihajici sync";
  if (syncState.status === "checking-remote") return "kontrola cloudu";
  if (syncState.status === "imported") return "obnoveno z cloudu";
  if (syncState.status === "remote-updated") return "aktualizovano z cloudu";
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
  if (/auth\/invalid-credential|auth\/wrong-password|auth\/user-not-found/i.test(message)) return "neplatny e-mail nebo heslo";
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

function loadRemoteMeta(){
  try{
    return JSON.parse(localStorage.getItem(CLOUD_SYNC_META_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveRemoteMeta(meta){
  localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(meta || {}));
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}
