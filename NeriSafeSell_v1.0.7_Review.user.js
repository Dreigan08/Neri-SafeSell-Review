// ==UserScript==
// @name         Neri SafeSell - Vault Guard (Review)
// @namespace    neri.torn.local
// @version      1.0.7
// @description  SafeSell v1.0.7 Review: DOM-first desktop wallet guard with Property Vault/Cayman support, manual deposit, optional Torn API backup, and multi-tab coordination.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  /*
   * SECURITY / PRIVACY
   * - No analytics or telemetry.
   * - No third-party servers. Network requests are limited to api.torn.com.
   * - Use a CUSTOM Torn API key limited to user/money. Never use a Full Access key.
   * - The API key is stored by the userscript manager via GM storage.
   * - Desktop-only release: mobile browsers and Torn PDA exit before initialization.
   */

  // Runtime guardrails: SafeSell is intentionally desktop-only. @noframes and
  // these checks prevent initialization in embedded frames, mobile browsers, Torn PDA,
  // and userscript managers that are outside the supported desktop release surface.
  if (!['torn.com', 'www.torn.com'].includes(location.hostname)) return;
  if (window.top !== window.self) return;

  const userAgent = String(navigator.userAgent || '');
  const mobileByUaData = navigator.userAgentData?.mobile === true;
  const mobileByUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  const ipadDesktopUa = /Macintosh/i.test(userAgent) && Number(navigator.maxTouchPoints || 0) > 1;
  const hasTornPdaBridge = typeof window.flutter_inappwebview !== 'undefined'
    || typeof globalThis.flutter_inappwebview !== 'undefined';
  const hasTornPdaHelpers = typeof window.PDA_httpGet === 'function'
    || typeof window.PDA_httpPost === 'function'
    || typeof window.PDA_storage !== 'undefined'
    || typeof globalThis.PDA_httpGet === 'function'
    || typeof globalThis.PDA_httpPost === 'function'
    || typeof globalThis.PDA_storage !== 'undefined';

  if (mobileByUaData || mobileByUa || ipadDesktopUa || hasTornPdaBridge || hasTornPdaHelpers) {
    console.info('[Neri SafeSell v1.0.7 Review] desktop-only runtime guard — SafeSell will not start on mobile or Torn PDA.');
    return;
  }

  const SUPPORTED_SCRIPT_HANDLERS = ['Tampermonkey', 'Violentmonkey'];
  let scriptHandlerName = null;
  try { scriptHandlerName = (typeof GM_info !== 'undefined' && GM_info?.scriptHandler) || null; } catch (_) {}
  if (!scriptHandlerName || !SUPPORTED_SCRIPT_HANDLERS.includes(scriptHandlerName)) {
    console.info('[Neri SafeSell v1.0.7 Review] unsupported userscript manager ("%s") — SafeSell will not start here.', scriptHandlerName || '(none)');
    return;
  }

  const requiredGmApisAvailable = typeof GM_xmlhttpRequest === 'function'
    && typeof GM_getValue === 'function'
    && typeof GM_setValue === 'function'
    && typeof GM_deleteValue === 'function'
    && typeof GM_addValueChangeListener === 'function';
  if (!requiredGmApisAvailable) {
    console.info('[Neri SafeSell v1.0.7 Review] required userscript APIs are unavailable — SafeSell will not start.');
    return;
  }

  console.info('[Neri SafeSell v1.0.7 Review] loaded on', location.hostname, '· userscript manager:', scriptHandlerName);

  // Persistent userscript storage is fully namespaced so SafeSell can coexist
  // safely with other BoW/Torn modules inside the same userscript container.
  const STORAGE = Object.freeze({
    backgroundPollMs: 'NSS.backgroundPollMs',
    armed: 'NSS.armed',
    apiKey: 'NSS.apiKey',
    lastWallet: 'NSS.lastWallet',
    hasBaseline: 'NSS.hasBaseline',
    pendingDeposit: 'NSS.pendingDeposit',
    lastIncrease: 'NSS.lastIncrease',
    walletCycle: 'NSS.walletCycle',
    quickNav: 'NSS.quickNav',
    multiTabLeader: 'NSS.multiTabLeader',
    sharedApiRateBucket: 'NSS.sharedApiRateBucket',
    sharedLastAlert: 'NSS.sharedLastAlert',
    walletSnapshot: 'NSS.walletSnapshot',
    apiKeyRevision: 'NSS.apiKeyRevision',
    apiHealth: 'NSS.apiHealth',
    storageSchemaVersion: 'NSS.storageSchemaVersion'
  });

  // One-time compatibility migration from pre-namespaced GM storage keys.
  // The schema marker keeps compatibility without re-running the migration on every page.
  const STORAGE_SCHEMA_VERSION = 1;
  const LEGACY_STORAGE = Object.freeze({
    backgroundPollMs: 'backgroundPollMs',
    armed: 'armed',
    apiKey: 'apiKey',
    lastWallet: 'lastWallet',
    hasBaseline: 'hasBaseline',
    pendingDeposit: 'pendingDeposit',
    lastIncrease: 'lastIncrease',
    walletCycle: 'walletCycle',
    quickNav: 'quickNav',
    multiTabLeader: 'multiTabLeader',
    sharedApiRateBucket: 'sharedApiRateBucket',
    sharedLastAlert: 'sharedLastAlert',
    walletSnapshot: 'walletSnapshot',
    apiKeyRevision: 'apiKeyRevision',
    apiHealth: 'apiHealth'
  });

  function migrateStorageOnce() {
    const currentSchema = Number(GM_getValue(STORAGE.storageSchemaVersion, 0) || 0);
    if (currentSchema >= STORAGE_SCHEMA_VERSION) return;

    const missing = '__NSS_MISSING__';
    for (const [name, legacyKey] of Object.entries(LEGACY_STORAGE)) {
      const targetKey = STORAGE[name];
      if (!targetKey) continue;
      if (GM_getValue(targetKey, missing) !== missing) continue;
      const legacy = GM_getValue(legacyKey, missing);
      if (legacy !== missing) {
        try { GM_setValue(targetKey, legacy); } catch (_) {}
      }
    }
    try { GM_deleteValue('NSS.navigateTarget'); } catch (_) {}
    try { GM_setValue(STORAGE.storageSchemaVersion, STORAGE_SCHEMA_VERSION); } catch (_) {}
  }

  migrateStorageOnce();

  const CFG = {
    backgroundPollMs: Number(GM_getValue(STORAGE.backgroundPollMs, 2000) || 2000),
    minIncrease: 1,
    comment: 'NeriSafeSell',
    defaultVaultMax: 1_000_000_000,
    apiWindowMs: 60_000,
    maxOwnApiCallsPerMinute: 45,
    leaderHeartbeatMs: 30_000,
    leaderStaleMs: 180_000,
    leaderSettleMs: 120,
    foregroundApiBackupMs: 5000,
    apiBackoffBaseMs: 5000,
    apiBackoffMaxMs: 60000,
    apiRateBackoffMs: 65000
  };

  let armed = Boolean(GM_getValue(STORAGE.armed, false));
  let apiKey = String(GM_getValue(STORAGE.apiKey, '') || '');
  let lastWallet = Number(GM_getValue(STORAGE.lastWallet, 0) || 0);
  let latestWallet = lastWallet;
  let hasBaseline = Boolean(GM_getValue(STORAGE.hasBaseline, false));
  let pendingDeposit = Boolean(GM_getValue(STORAGE.pendingDeposit, false));
  let lastIncrease = Number(GM_getValue(STORAGE.lastIncrease, 0) || 0);
  let lastSource = 'none';
  let lastObservedAt = 0;
  let lastSnapshotWriteAt = 0;
  let walletCycle = Number(GM_getValue(STORAGE.walletCycle, 0) || 0);

  let apiTimer = null;
  let apiPollKind = 'none';
  let apiFetching = false;
  let apiRequestHandle = null;
  let apiRequestGeneration = 0;
  let apiKeyRevision = Number(GM_getValue(STORAGE.apiKeyRevision, 0) || 0);
  let cashObserver = null;
  let observedCashRoot = null;
  let reattachQueued = false;
  let panel = null;
  let panelHost = null;
  let panelShadow = null;
  let quickButton = null;
  let quickButtonHost = null;
  let quickButtonShadow = null;
  let quickButtonAnchor = null;
  let anchorScanAt = 0;
  let quickButtonPaddedAnchor = null;
  let quickButtonOriginalInlineMarginTop = '';
  let cornerSwitch = null;
  let cornerSwitchState = null;
  let cornerSwitchHost = null;
  let cornerSwitchShadow = null;
  let uiBootstrapObserver = null;
  let uiRefreshQueued = false;
  let audioCtx = null;
  let awaitingDeposit = false;
  let awaitingDepositTimer = null;
  let mode = 'OFF';
  let lastError = '';
  let apiFailureCount = 0;
  let apiBackoffUntil = 0;
  let apiSuspended = false;
  let apiSuspendedReason = '';
  let lastApiSuccessAt = 0;
  let lastApiStatus = 'Idle';
  let sidebarObserver = null;
  let observedSidebarEl = null;
  let ctxCache = null;
  let ctxLastScan = 0;
  let depositProbeTimer = null;
  let depositProbeStartedAt = 0;
  let lastPanelHtml = '';
  let quickNav = Boolean(GM_getValue(STORAGE.quickNav, false));

  // This Review build keeps the final DEPOSIT action manual; navigation and autofill remain available.

  // --- Multi-tab state coordination (local only; does not contact Torn servers) ---
  // Exactly one Torn tab owns shared wallet transitions and alerts at a time, even when
  // no API key is configured. The most recently focused Torn tab is preferred.
  // Optional API polling reuses the same owner.
  const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const LEADER_KEY = STORAGE.multiTabLeader;
  const RATE_KEY = STORAGE.sharedApiRateBucket;
  const ALERT_KEY = STORAGE.sharedLastAlert;
  const CYCLE_KEY = STORAGE.walletCycle;
  const SNAPSHOT_KEY = STORAGE.walletSnapshot;
  let leaderTimer = null;
  let leaderConfirmTimer = null;
  let leaderClaimSeq = 0;
  let leaderToken = '';
  let rateReservationSeq = 0;
  let isLeader = false;

  function readJsonValue(key, fallback) {
    try {
      const raw = GM_getValue(key, '');
      if (!raw) return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      return fallback;
    }
  }

  function writeJsonValue(key, value) {
    try { GM_setValue(key, JSON.stringify(value)); } catch (_) {}
  }

  function currentApiKeyRevision() {
    const value = Number(GM_getValue(STORAGE.apiKeyRevision, apiKeyRevision) || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function normalizeApiHealth(value) {
    if (!value || typeof value !== 'object') return null;
    const revision = Number(value.revision);
    if (!Number.isFinite(revision) || revision < 0) return null;
    return {
      revision: Math.floor(revision),
      failureCount: Math.max(0, Math.floor(Number(value.failureCount || 0) || 0)),
      backoffUntil: Math.max(0, Number(value.backoffUntil || 0) || 0),
      suspended: Boolean(value.suspended),
      reason: String(value.reason || ''),
      status: String(value.status || 'Idle'),
      lastSuccessAt: Math.max(0, Number(value.lastSuccessAt || 0) || 0),
      lastError: String(value.lastError || '')
    };
  }

  function publishApiHealth() {
    writeJsonValue(STORAGE.apiHealth, {
      revision: apiKeyRevision,
      failureCount: apiFailureCount,
      backoffUntil: apiBackoffUntil,
      suspended: apiSuspended,
      reason: apiSuspendedReason,
      status: lastApiStatus,
      lastSuccessAt: lastApiSuccessAt,
      lastError
    });
  }

  function applyApiHealth(value) {
    const health = normalizeApiHealth(value);
    if (!health || health.revision !== apiKeyRevision) return false;
    apiFailureCount = health.failureCount;
    apiBackoffUntil = health.backoffUntil;
    apiSuspended = health.suspended;
    apiSuspendedReason = health.reason;
    lastApiStatus = health.status;
    lastApiSuccessAt = health.lastSuccessAt;
    lastError = health.lastError;
    return true;
  }

  function syncApiHealth() {
    const revision = currentApiKeyRevision();
    if (revision !== apiKeyRevision) apiKeyRevision = revision;
    applyApiHealth(readJsonValue(STORAGE.apiHealth, null));
  }

  function normalizeWalletSnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    const wallet = Number(value.wallet);
    const observedAt = Number(value.observedAt || 0);
    if (!Number.isFinite(wallet) || wallet < 0 || !Number.isFinite(observedAt) || observedAt < 0) return null;
    return {
      wallet: Math.floor(wallet),
      source: ['api', 'dom', 'none'].includes(value.source) ? value.source : 'none',
      observedAt,
      hasBaseline: Boolean(value.hasBaseline),
      pendingDeposit: Boolean(value.pendingDeposit),
      lastIncrease: Math.max(0, Math.floor(Number(value.lastIncrease || 0) || 0)),
      cycle: Math.max(0, Math.floor(Number(value.cycle || 0) || 0)),
      tab: String(value.tab || '')
    };
  }

  function currentWalletSnapshot() {
    return normalizeWalletSnapshot(readJsonValue(SNAPSHOT_KEY, null));
  }

  function applyWalletSnapshot(value, { force = false } = {}) {
    const snapshot = normalizeWalletSnapshot(value);
    if (!snapshot) return false;
    if (!force && snapshot.observedAt < lastObservedAt) return false;

    lastWallet = snapshot.wallet;
    latestWallet = snapshot.wallet;
    lastSource = snapshot.source;
    lastObservedAt = snapshot.observedAt;
    hasBaseline = snapshot.hasBaseline;
    pendingDeposit = snapshot.pendingDeposit;
    lastIncrease = snapshot.lastIncrease;
    walletCycle = Math.max(walletCycle, snapshot.cycle);
    return true;
  }

  function writeWalletSnapshot() {
    lastSnapshotWriteAt = Date.now();
    if (!lastObservedAt) lastObservedAt = Date.now();
    writeJsonValue(SNAPSHOT_KEY, {
      wallet: Math.max(0, Math.floor(Number(lastWallet || 0))),
      source: lastSource,
      observedAt: lastObservedAt,
      hasBaseline: Boolean(hasBaseline),
      pendingDeposit: Boolean(pendingDeposit),
      lastIncrease: Math.max(0, Math.floor(Number(lastIncrease || 0))),
      cycle: Math.max(0, Math.floor(Number(walletCycle || 0))),
      tab: TAB_ID
    });
  }

  applyWalletSnapshot(currentWalletSnapshot(), { force: true });

  function currentLeader() {
    return readJsonValue(LEADER_KEY, null);
  }

  function leaderIsFresh(leader, now = Date.now()) {
    // A generous lease prevents background timer throttling from looking like tab death.
    // Focus/visibility transfers ownership immediately; this timeout is crash recovery.
    return Boolean(leader?.id && leader?.token
      && (now - Number(leader.heartbeat || 0)) <= CFG.leaderStaleMs);
  }

  function ownsLeadership() {
    const leader = currentLeader();
    return leaderIsFresh(leader)
      && leader.id === TAB_ID
      && leader.token === leaderToken;
  }

  function settleLeadership(token) {
    if (leaderConfirmTimer) clearTimeout(leaderConfirmTimer);
    leaderConfirmTimer = setTimeout(() => {
      leaderConfirmTimer = null;
      if (!armed || token !== leaderToken) return;

      isLeader = ownsLeadership();
      if (!isLeader) {
        stopApiMode();
      } else {
        startDomMode({ freshArm: !hasBaseline });
        if (apiKey) ensureApi();
      }
      refreshModeLabel();
      renderPanel();
    }, CFG.leaderSettleMs);
  }

  function claimLeadership(reason = 'stale') {
    if (!armed) return false;
    const now = Date.now();
    const token = `${TAB_ID}:${now.toString(36)}:${(++leaderClaimSeq).toString(36)}`;
    leaderToken = token;
    isLeader = false;
    stopApiMode();
    writeJsonValue(LEADER_KEY, {
      id: TAB_ID,
      token,
      heartbeat: now,
      activeAt: now,
      reason
    });
    settleLeadership(token);
    return true;
  }

  function heartbeatLeader() {
    if (!armed) {
      stopLeaderCoordination();
      return;
    }
    const now = Date.now();
    const leader = currentLeader();
    const stale = !leaderIsFresh(leader, now);

    if (leader?.id === TAB_ID && leader?.token === leaderToken) {
      // If this timer was delayed, renew the same token instead of creating a false handoff.
      writeJsonValue(LEADER_KEY, { ...leader, heartbeat: now });
      isLeader = true;
    } else if (stale) {
      claimLeadership(isForeground() ? 'active' : 'recovery');
      return;
    } else {
      if (isLeader) stopApiMode();
      isLeader = false;
    }

    if (armed) {
      if (apiKey) ensureApi();
      refreshModeLabel();
    }
    renderPanel();
  }

  function startLeaderCoordination() {
    if (!armed) {
      stopLeaderCoordination();
      return;
    }
    if (!leaderTimer) leaderTimer = setInterval(heartbeatLeader, CFG.leaderHeartbeatMs);
    if (isForeground()) claimLeadership('active');
    else heartbeatLeader();
  }

  function stopLeaderCoordination() {
    if (leaderTimer) clearInterval(leaderTimer);
    if (leaderConfirmTimer) clearTimeout(leaderConfirmTimer);
    leaderTimer = null;
    leaderConfirmTimer = null;
    const leader = currentLeader();
    if (leader?.id === TAB_ID && leader?.token === leaderToken) GM_deleteValue(LEADER_KEY);
    leaderToken = '';
    isLeader = false;
    stopApiMode();
  }

  function normalizeRateBucket(value, now = Date.now()) {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
      if (Number.isFinite(Number(entry))) {
        const at = Number(entry);
        return { at, token: `legacy:${at}:${index}`, tab: 'legacy' };
      }
      if (!entry || typeof entry !== 'object') return null;
      const at = Number(entry.at);
      if (!Number.isFinite(at)) return null;
      return {
        at,
        token: String(entry.token || `legacy:${at}:${index}`),
        tab: String(entry.tab || '')
      };
    }).filter(entry => entry && now - entry.at < CFG.apiWindowMs);
  }

  function sharedApiCountAndReserve() {
    const now = Date.now();
    if (!ownsLeadership()) return { allowed: false, count: sharedApiCount(), reason: 'not-leader' };

    let bucket = normalizeRateBucket(readJsonValue(RATE_KEY, []), now);
    if (bucket.length >= CFG.maxOwnApiCallsPerMinute) {
      writeJsonValue(RATE_KEY, bucket);
      return { allowed: false, count: bucket.length, reason: 'limit' };
    }

    const token = `${TAB_ID}:${now.toString(36)}:r${(++rateReservationSeq).toString(36)}`;
    bucket.push({ at: now, token, tab: TAB_ID });
    writeJsonValue(RATE_KEY, bucket);

    const verified = normalizeRateBucket(readJsonValue(RATE_KEY, []), Date.now());
    const reserved = verified.some(entry => entry.token === token);
    if (!reserved || !ownsLeadership()) {
      return { allowed: false, count: verified.length, reason: 'lost-leadership' };
    }
    return { allowed: true, count: verified.length, token };
  }

  function sharedApiCount() {
    return normalizeRateBucket(readJsonValue(RATE_KEY, []), Date.now()).length;
  }

  function currentWalletCycle() {
    const shared = Number(GM_getValue(CYCLE_KEY, walletCycle) || 0);
    if (Number.isFinite(shared) && shared >= 0) walletCycle = shared;
    return walletCycle;
  }

  function bumpWalletCycle() {
    walletCycle = currentWalletCycle() + 1;
    GM_setValue(CYCLE_KEY, walletCycle);
    return walletCycle;
  }

  function shouldEmitAlert(previous, wallet, delta) {
    const cycle = currentWalletCycle();
    const last = readJsonValue(ALERT_KEY, null);

    // ZERO time-based cooldown. We only suppress the exact SAME transition
    // (previous balance -> new balance) within the same wallet cycle. This prevents
    // DOM + API from duplicating the same alert, while never silencing a genuinely new
    // incoming payment just because it happened a few seconds later.
    if (last
        && Number(last.from) === Number(previous)
        && Number(last.to) === Number(wallet)
        && Number(last.cycle) === Number(cycle)) {
      return false;
    }

    writeJsonValue(ALERT_KEY, {
      from: Number(previous),
      to: Number(wallet),
      delta: Number(delta),
      cycle: Number(cycle),
      tab: TAB_ID
    });
    return true;
  }

  const money = n => '$' + Math.max(0, Math.floor(Number(n || 0))).toLocaleString('en-US');
  const isForeground = () => document.visibilityState === 'visible' && document.hasFocus();
  // requestAnimationFrame does not run reliably in hidden tabs; use setTimeout there.
  const nextTick = fn => (document.visibilityState === 'visible' ? requestAnimationFrame(fn) : setTimeout(fn, 30));

  function hasLiveDomSource() {
    return Boolean((observedSidebarEl?.isConnected) || (observedCashRoot?.isConnected));
  }

  function apiRuntimeEnabled() {
    return Boolean(armed && apiKey);
  }

  function apiOwnsWalletNow() {
    return Boolean(apiRuntimeEnabled() && (!isForeground() || !hasLiveDomSource()));
  }

  function apiBackoffRemainingMs() {
    if (apiKey) syncApiHealth();
    return Math.max(0, apiBackoffUntil - Date.now());
  }

  function apiCanProvideBackupNow() {
    return Boolean(apiOwnsWalletNow() && !apiSuspended && apiBackoffRemainingMs() <= 0);
  }

  function sourceIsAuthoritative(source) {
    if (!isLeader || !ownsLeadership()) return false;
    if (source === 'api') return apiCanProvideBackupNow();
    if (source === 'dom') return !apiCanProvideBackupNow();
    return false;
  }

  function resetApiHealth(status = 'Ready') {
    apiFailureCount = 0;
    apiBackoffUntil = 0;
    apiSuspended = false;
    apiSuspendedReason = '';
    lastApiStatus = status;
    lastApiSuccessAt = 0;
    lastError = '';
    publishApiHealth();
  }

  function apiProblemMessage(status, json, fallback = 'API request failed') {
    const apiMessage = String(json?.error?.error || json?.error?.message || json?.message || '').trim();
    if (apiMessage) return apiMessage;
    if (Number.isFinite(Number(status)) && Number(status) > 0) return `HTTP ${status}`;
    return fallback;
  }

  function registerApiFailure({ status = 0, json = null, fallback = 'API request failed' } = {}) {
    const message = apiProblemMessage(status, json, fallback);
    const lower = message.toLowerCase();
    const numericStatus = Number(status) || 0;

    if (numericStatus === 401 || numericStatus === 403
        || /invalid.*key|key.*invalid|permission|access denied|unauthori|forbidden/.test(lower)) {
      apiSuspended = true;
      apiSuspendedReason = message;
      lastApiStatus = 'Blocked';
      lastError = `${message} · API backup paused until the key is changed.`;
      publishApiHealth();
      stopApiMode();
      renderPanel();
      return;
    }

    apiFailureCount += 1;
    const rateLimited = numericStatus === 429 || /rate|too many|limit/.test(lower);
    const delay = rateLimited
      ? CFG.apiRateBackoffMs
      : Math.min(CFG.apiBackoffMaxMs, CFG.apiBackoffBaseMs * (2 ** Math.max(0, apiFailureCount - 1)));

    apiBackoffUntil = Date.now() + delay;
    lastApiStatus = rateLimited ? 'Rate backoff' : 'Backoff';
    lastError = `${message} · retry paused for ${Math.ceil(delay / 1000)} s.`;
    publishApiHealth();
    renderPanel();
  }

  function clearAwaitingDeposit() {
    awaitingDeposit = false;
    if (awaitingDepositTimer) clearTimeout(awaitingDepositTimer);
    awaitingDepositTimer = null;
  }

  function markAwaitingDeposit() {
    clearAwaitingDeposit();
    awaitingDeposit = true;
    awaitingDepositTimer = setTimeout(() => {
      awaitingDepositTimer = null;
      awaitingDeposit = false;
    }, 3000);
  }

  function saveState() {
    // The snapshot is the canonical multi-tab wallet state. Legacy scalar keys remain
    // for compatibility/UI, but source + timing metadata move together atomically.
    writeWalletSnapshot();
    GM_setValue(STORAGE.lastWallet, Math.max(0, Math.floor(Number(lastWallet || 0))));
    GM_setValue(STORAGE.hasBaseline, Boolean(hasBaseline));
    GM_setValue(STORAGE.pendingDeposit, Boolean(pendingDeposit));
    GM_setValue(STORAGE.lastIncrease, Math.floor(Number(lastIncrease || 0)));
  }


  function primeAudio() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.02);
    } catch (_) {}
  }

  function alarmVolumeScale(wallet) {
    wallet = Math.max(0, Number(wallet) || 0);
    if (wallet < 100_000) return 0;
    if (wallet >= 1_000_000) return 1;

    const t = (wallet - 100_000) / 900_000;
    return Math.min(1, 0.08 + 0.92 * Math.pow(t, 1.5));
  }

  function playAlarm(wallet = 1_000_000) {
    try {
      const volume = alarmVolumeScale(wallet);
      if (volume <= 0) return;

      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const peak = Math.max(0.0002, 0.24 * volume);

      [0, 0.18, 0.36, 0.63, 0.81, 0.99].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = i < 3 ? 'square' : 'sawtooth';
        osc.frequency.value = i < 3 ? 980 : 1320;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(peak, now + offset + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.145);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.17);
      });
    } catch (_) {}
  }

  function notifyIncrease(delta, wallet, source) {
    playAlarm(wallet);
    try {
      GM_notification({
        title: '💰 NERI SAFESELL — CASH RECEIVED',
        text: `+${money(delta)} | Wallet: ${money(wallet)} | ${source === 'dom' ? 'DOM monitor' : 'Torn API'}. Return to the Vault and press DEPOSIT.`,
        timeout: 0
      });
    } catch (_) {}
  }

  // SafeSell is Vault-first. Cayman is supported only when the player is already there.
  const VAULT_TARGET = {
    label: 'Vault',
    url: 'https://www.torn.com/properties.php#/p=options&tab=vault'
  };

  function currentRouteKind() {
    const path = location.pathname.toLowerCase();
    const hash = location.hash.toLowerCase();

    if (path.endsWith('/properties.php') && hash.includes('tab=vault')) return 'vault';
    if (path.endsWith('/index.php') && new URLSearchParams(location.search).get('page') === 'bank') return 'cayman';

    // Route state is available before Torn renders travel status text.
    if (path.endsWith('/page.php') && (new URLSearchParams(location.search).get('sid') || '').toLowerCase() === 'travel') return 'travel';

    return 'other';
  }

  const isDepositRoute = kind => ['vault', 'cayman'].includes(kind);

  let travelCache = { at: 0, value: { travelling: false } };
  function getTravelInfo() {
    const now = performance.now();
    if (now - travelCache.at < 10_000) return travelCache.value;

    let travelling = currentRouteKind() === 'travel';
    if (!travelling) {
      const text = document.body?.textContent || '';
      travelling = /\btravel(l)?ing (from|to)\b|\bremaining flight time\b|\byou are (currently )?travel(l)?ing\b|\bin the air\b|\breturning (home|to torn)\b/i.test(text);
    }
    travelCache = { at: now, value: { travelling } };
    return travelCache.value;
  }

  function quickNavigationAllowed() {
    if (!armed) return false;
    const kind = currentRouteKind();
    if (isDepositRoute(kind) || kind === 'travel') return false;
    return !getTravelInfo().travelling;
  }

  function usableInputs(node) {
    if (!node?.querySelectorAll) return [];
    return [...node.querySelectorAll('input')].filter(inp => {
      const t = (inp.getAttribute('type') || 'text').toLowerCase();
      return !inp.disabled && ['text', 'number', 'tel'].includes(t);
    });
  }

  function findDepositContextFast(routeKind = currentRouteKind()) {
    if (!isDepositRoute(routeKind)) return null;

    const buttons = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a')]
      .filter(b => /^\s*deposit\s*$/i.test((b.textContent || b.value || '').trim()));

    for (const btn of buttons) {
      let node = btn.parentElement;
      for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
        const inputs = usableInputs(node);
        if (inputs.length) {
          return { root: node, input: inputs[inputs.length - 1], button: btn, kind: routeKind };
        }
      }
    }
    return null;
  }

  function findDepositContext() {
    const routeKind = currentRouteKind();
    if (!isDepositRoute(routeKind)) {
      ctxCache = null;
      ctxLastScan = 0;
      return null;
    }

    if (ctxCache && ctxCache.kind === routeKind
        && ctxCache.root.isConnected && ctxCache.input.isConnected
        && (!ctxCache.button || ctxCache.button.isConnected)) return ctxCache;

    const fast = findDepositContextFast(routeKind);
    if (fast) {
      ctxCache = fast;
      return ctxCache;
    }

    const t = performance.now();
    if (t - ctxLastScan < 200) return null;
    ctxLastScan = t;
    ctxCache = findDepositContextSlow();
    return ctxCache;
  }


  // Property Vault and Cayman use different deposit wording. The shared pattern
  // recognizes both interfaces without depending on page-specific CSS classes.
  const DEPOSIT_PAGE_HINTS = /how much do you want to deposit\??|you have\s+\$[\d,.]+\s+on (?:hand|you)/i;

  function findDepositContextSlow() {
    const routeKind = currentRouteKind();
    if (!isDepositRoute(routeKind)) return null;

    // Main path: visible text from Property Vault or Cayman Overseas Bank.
    const hasPhrase = DEPOSIT_PAGE_HINTS.test(document.body?.textContent || '');
    const candidates = !hasPhrase ? [] : [...document.querySelectorAll('div,section,form,p,span,td')]
      .filter(el => DEPOSIT_PAGE_HINTS.test(el.textContent || ''))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);

    for (const el of candidates) {
      let node = el;
      for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
        const inputs = usableInputs(node);
        if (inputs.length) return { root: node, input: inputs[inputs.length - 1], kind: routeKind };
      }
    }

    // Fallback: exact DEPOSIT button and a neighboring input, restricted to
    // known deposit pages so unrelated Torn interfaces cannot be mistaken for Vault.
    const buttons = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a')]
      .filter(b => /^\s*deposit\s*$/i.test((b.textContent || b.value || '').trim()));
    for (const btn of buttons) {
      let node = btn.parentElement;
      for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
        const inputs = usableInputs(node);
        if (inputs.length) return { root: node, input: inputs[inputs.length - 1], kind: routeKind };
      }
    }
    return null;
  }

  function findDepositButton(input) {
    if (!input) return null;
    let node = input.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const btn = [...node.querySelectorAll('button,input[type="button"],input[type="submit"]')]
        .find(b => /deposit/i.test((b.textContent || b.value || '').trim()));
      if (btn) return btn;
    }
    return null;
  }

  function stopDepositContextProbe() {
    if (depositProbeTimer) clearTimeout(depositProbeTimer);
    depositProbeTimer = null;
    depositProbeStartedAt = 0;
  }

  function scheduleDepositContextProbe() {
    if (depositProbeTimer || !isDepositRoute(currentRouteKind())) return;
    if (!depositProbeStartedAt) depositProbeStartedAt = Date.now();

    const elapsed = Date.now() - depositProbeStartedAt;
    const delay = elapsed < 2500 ? 80 : 250;

    depositProbeTimer = setTimeout(() => {
      depositProbeTimer = null;
      if (!isDepositRoute(currentRouteKind())) {
        stopDepositContextProbe();
        return;
      }

      const ctx = findDepositContext();
      if (ctx) {
        stopDepositContextProbe();
        renderPanel();
        if (armed && pendingDeposit) fillDeposit();
        return;
      }
      scheduleDepositContextProbe();
    }, delay);
  }

  function parseMoneyText(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[^0-9]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  function readVaultDom(context = findDepositContext()) {
    if (!context?.root) return null;

    const routeKind = currentRouteKind();
    const walletRe = /You have\s+\$\s*([\d,.]+)\s+on (?:hand|you)/i;
    const storedRe = /There is\s+\$\s*([\d,.]+)\s+stored in the vault/i;

    let factsText = context.root.textContent || '';
    let node = context.root;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const text = node.textContent || '';
      const hasWallet = walletRe.test(text);
      const hasStored = routeKind !== 'vault' || storedRe.test(text);
      if (hasWallet && hasStored) {
        factsText = text;
        break;
      }
    }

    let walletMatch = factsText.match(walletRe);
    let storedMatch = routeKind === 'vault' ? factsText.match(storedRe) : null;

    if (!walletMatch || (routeKind === 'vault' && !storedMatch)) {
      const pageText = document.body?.textContent || '';
      walletMatch ||= pageText.match(walletRe);
      if (routeKind === 'vault') storedMatch ||= pageText.match(storedRe);
    }

    if (!walletMatch) return null;
    const wallet = parseMoneyText(walletMatch[1]);

    if (routeKind === 'vault') {
      const stored = storedMatch ? parseMoneyText(storedMatch[1]) : null;
      const max = CFG.defaultVaultMax;
      const capacity = Number.isFinite(stored)
        ? Math.max(0, max - stored)
        : null;

      return {
        wallet,
        stored,
        max,
        capacity,
        capacityState: Number.isFinite(capacity) ? 'confirmed' : 'unknown',
        context
      };
    }

    return {
      wallet,
      stored: null,
      max: null,
      capacity: null,
      capacityState: 'not-applicable',
      context
    };
  }

  function setReactInput(input, value) {
    const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getDepositTarget() {
    const dom = readVaultDom();
    const walletNow = dom && Number.isFinite(dom.wallet)
      ? Math.floor(dom.wallet)
      : Math.floor(latestWallet);

    if (currentRouteKind() === 'vault') {
      if (!dom || !Number.isFinite(dom.capacity)) return 0;
      return Math.max(0, Math.min(walletNow, Math.floor(dom.capacity)));
    }

    return Math.max(0, walletNow);
  }

  function fillDeposit() {
    if (!armed || !pendingDeposit || latestWallet <= 0) return false;
    const ctx = findDepositContext();
    if (!ctx?.input) return false;

    const target = getDepositTarget();
    if (target <= 0) {
      highlightDeposit(true);
      renderPanel();
      return false;
    }

    setReactInput(ctx.input, target);
    highlightDeposit(false);
    renderPanel();
    return true;
  }

  function highlightDeposit(vaultFull = false) {
    const ctx = findDepositContext();
    const btn = findDepositButton(ctx?.input);
    if (!btn) return;
    btn.style.outline = `3px solid ${vaultFull ? '#ff3b30' : '#ff9800'}`;
    btn.style.boxShadow = vaultFull
      ? '0 0 16px rgba(255,59,48,.95)'
      : '0 0 16px rgba(255,152,0,.9)';
  }

  function clearHighlight() {
    const ctx = findDepositContext();
    const btn = findDepositButton(ctx?.input);
    if (!btn) return;
    btn.style.outline = '';
    btn.style.boxShadow = '';
  }

  function processWallet(wallet, source, { baseline = false, observedAt = Date.now() } = {}) {
    if (!sourceIsAuthoritative(source)) return;

    const sharedSnapshot = currentWalletSnapshot();
    if (sharedSnapshot) {
      applyWalletSnapshot(sharedSnapshot);
    } else {
      const sharedLast = Number(GM_getValue(STORAGE.lastWallet, lastWallet) || 0);
      if (Number.isFinite(sharedLast) && sharedLast >= 0) lastWallet = sharedLast;
    }
    pendingDeposit = Boolean(GM_getValue(STORAGE.pendingDeposit, pendingDeposit));
    lastIncrease = Number(GM_getValue(STORAGE.lastIncrease, lastIncrease) || 0);

    wallet = Number(wallet);
    if (!Number.isFinite(wallet) || wallet < 0) return;
    wallet = Math.floor(wallet);
    observedAt = Number(observedAt);
    if (!Number.isFinite(observedAt) || observedAt <= 0) observedAt = Date.now();

    if (baseline || !hasBaseline) {
      lastWallet = wallet;
      latestWallet = wallet;
      hasBaseline = true;
      lastSource = source;
      lastObservedAt = observedAt;
      saveState();
      renderPanel();
      return;
    }

    const previous = lastWallet;
    const delta = wallet - previous;
    latestWallet = wallet;

    if (delta === 0) {
      lastSource = source;
      lastObservedAt = observedAt;
      writeWalletSnapshot();
      if (pendingDeposit) fillDeposit();
      renderPanel();
      return;
    }

    lastWallet = wallet;
    lastSource = source;
    lastObservedAt = observedAt;

    if (delta >= CFG.minIncrease) {
      pendingDeposit = true;
      clearAwaitingDeposit();
      lastIncrease = delta;
      saveState();
      if (shouldEmitAlert(previous, wallet, delta)) notifyIncrease(delta, wallet, source);
      fillDeposit();
      renderPanel();
      return;
    }

    if (delta < 0) {
      bumpWalletCycle();
      if (wallet <= 1) {
        pendingDeposit = false;
        clearAwaitingDeposit();
        lastIncrease = 0;
        clearHighlight();
      } else if (awaitingDeposit) {
        pendingDeposit = true;
        clearAwaitingDeposit();
      }
      saveState();
      if (pendingDeposit) fillDeposit();
      renderPanel();
      return;
    }

    if (pendingDeposit) fillDeposit();
    renderPanel();
  }

  function requestWallet({ baseline = false } = {}) {
    syncApiHealth();
    if (apiSuspended || apiBackoffRemainingMs() > 0) return;

    if (!armed || apiFetching || !apiKey || !isLeader || !ownsLeadership()) {
      if (isLeader && !ownsLeadership()) {
        isLeader = false;
        stopApiMode();
      }
      return;
    }

    const rate = sharedApiCountAndReserve();
    if (!rate.allowed) {
      if (rate.reason === 'limit') {
        lastError = `API guardrail: ${rate.count}/${CFG.maxOwnApiCallsPerMinute} calls in 60 s`;
        renderPanel();
      }
      return;
    }

    if (!ownsLeadership()) return;
    apiFetching = true;

    const requestLeaderToken = leaderToken;
    const requestGeneration = apiRequestGeneration;
    const requestRevision = currentApiKeyRevision();
    const requestApiKey = apiKey;
    const requestIsCurrent = () => (
      requestGeneration === apiRequestGeneration
      && requestRevision === currentApiKeyRevision()
      && requestApiKey === apiKey
      && requestLeaderToken === leaderToken
      && isLeader
      && ownsLeadership()
    );
    const ts = Date.now();
    const url = `https://api.torn.com/v2/user/money?timestamp=${ts}&comment=${encodeURIComponent(CFG.comment)}`;

    apiRequestHandle = GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { Authorization: `ApiKey ${apiKey}` },
      timeout: 6000,
      onload: res => {
        if (!requestIsCurrent()) return;
        apiRequestHandle = null;
        apiFetching = false;

        let json = null;
        try {
          json = JSON.parse(res.responseText);
        } catch (_) {
          registerApiFailure({ status: res.status, fallback: 'Invalid API response' });
          return;
        }

        if (res.status < 200 || res.status >= 300 || json.error) {
          registerApiFailure({ status: res.status, json });
          return;
        }

        const wallet = Number(json?.money?.wallet ?? json?.wallet);
        if (!Number.isFinite(wallet) || wallet < 0) {
          registerApiFailure({ status: res.status, fallback: 'Wallet value missing from API response' });
          return;
        }

        apiFailureCount = 0;
        apiBackoffUntil = 0;
        lastApiSuccessAt = Date.now();
        lastApiStatus = 'OK';
        lastError = '';
        publishApiHealth();

        if (requestLeaderToken !== leaderToken || !ownsLeadership()) return;
        const sharedSnapshot = currentWalletSnapshot();
        if (sharedSnapshot && ts < sharedSnapshot.observedAt) return;
        if (!apiCanProvideBackupNow()) return;

        processWallet(wallet, 'api', { baseline, observedAt: Date.now() });
      },
      onerror: () => {
        if (!requestIsCurrent()) return;
        apiRequestHandle = null;
        apiFetching = false;
        registerApiFailure({ fallback: 'API did not respond' });
      },
      ontimeout: () => {
        if (!requestIsCurrent()) return;
        apiRequestHandle = null;
        apiFetching = false;
        registerApiFailure({ fallback: 'API timeout' });
      }
    });
  }

  function stopApiMode() {
    if (apiTimer) clearInterval(apiTimer);
    apiTimer = null;
    apiPollKind = 'none';

    apiRequestGeneration += 1;
    // Tampermonkey/Violentmonkey may expose an abortable request handle. Abort an
    // in-flight request during leadership handoff when possible; stale callbacks are
    // still rejected by the leader token check above if abort cannot prevent delivery.
    try { apiRequestHandle?.abort?.(); } catch (_) {}
    apiRequestHandle = null;
    apiFetching = false;
  }

  // Optional API fallback. It is idle while foreground DOM monitoring is available,
  // and the API subsystem is never initialized without a key.
  function ensureApi() {
    if (apiSuspended || !apiOwnsWalletNow() || !isLeader || !ownsLeadership()) {
      stopApiMode();
      return;
    }

    const kind = isForeground() ? 'fallback' : 'background';
    if (apiTimer && apiPollKind === kind) return;

    stopApiMode();
    apiPollKind = kind;
    requestWallet({ baseline: !hasBaseline });
    apiTimer = setInterval(
      () => requestWallet(),
      kind === 'fallback' ? CFG.foregroundApiBackupMs : CFG.backgroundPollMs
    );
  }

  function refreshModeLabel() {
    if (!armed) { mode = 'OFF'; return; }
    const where = isForeground() ? 'FOREGROUND' : 'BACKGROUND';

    if (!apiKey) {
      mode = `${where} · DOM ONLY`;
      return;
    }
    if (apiSuspended) {
      mode = `${where} · DOM · API BLOCKED`;
      return;
    }
    if (apiBackoffRemainingMs() > 0) {
      mode = `${where} · DOM · API BACKOFF`;
      return;
    }
    if (apiOwnsWalletNow()) {
      mode = `${where} · API BACKUP${isLeader ? ' (leader)' : ' (other tab)'}`;
      return;
    }
    mode = `${where} · DOM PRIMARY · API STANDBY`;
  }

  function apiUiState() {
    if (!apiKey) return { label: 'Disabled', color: '#8b8b8b' };
    if (apiSuspended) return { label: 'Blocked', color: '#ff6b6b' };
    const remaining = apiBackoffRemainingMs();
    if (remaining > 0) return { label: `Backoff ${Math.ceil(remaining / 1000)}s`, color: '#ffb13b' };
    if (apiOwnsWalletNow()) return { label: isLeader ? 'Backup active' : 'Backup · other tab', color: '#a98cff' };
    return { label: 'Standby', color: '#7aa7ff' };
  }

  function modeBadge() {
    if (!armed) return { label: 'OFF', color: '#999' };
    if (apiSuspended) return { label: 'API BLOCKED', color: '#ff6b6b' };
    if (apiBackoffRemainingMs() > 0) return { label: 'API BACKOFF', color: '#ffb13b' };
    if (apiCanProvideBackupNow()) return { label: 'API BACKUP', color: '#a98cff' };
    return { label: apiKey ? 'DOM PRIMARY' : 'DOM ONLY', color: '#55d66b' };
  }

  // --- DOM source 1: Torn sidebar cash (available on most pages) ---
  function readSidebarMoney() {
    const el = document.getElementById('user-money');
    if (!el) return null;
    const attr = el.getAttribute('data-money');
    const n = parseMoneyText(attr != null && attr !== '' ? attr : el.textContent);
    return Number.isFinite(n) ? n : null;
  }

  function attachSidebarObserver() {
    const el = document.getElementById('user-money');
    if (!el) {
      sidebarObserver?.disconnect();
      sidebarObserver = null;
      observedSidebarEl = null;
      return false;
    }
    if (!el.dataset.neriQuicknavBound) {
      el.dataset.neriQuicknavBound = '1';
      el.addEventListener('click', e => {
        if (!armed || !quickNav || !quickNavigationAllowed()) return;

        // When SafeSell handles this shortcut, consume the click so Torn's
        // original click behavior does not compete with our navigation.
        e.preventDefault();
        e.stopPropagation();

        location.assign(VAULT_TARGET.url);
      });
    }

    const sidebarQuickActive = quickNav && quickNavigationAllowed();
    el.style.cursor = sidebarQuickActive ? 'pointer' : '';
    el.title = sidebarQuickActive
      ? `Neri SafeSell: click to go to ${VAULT_TARGET.label}`
      : '';

    if (el === observedSidebarEl && sidebarObserver) return true;
    sidebarObserver?.disconnect();
    observedSidebarEl = el;
    sidebarObserver = new MutationObserver(() => {
      if (!armed) return;
      const n = readSidebarMoney();
      if (Number.isFinite(n)) processWallet(n, 'dom');
    });
    sidebarObserver.observe(el, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-money']
    });
    return true;
  }

  // --- DOM source 2: Vault deposit-form text ---
  function attachVaultObserver(dom) {
    const root = dom?.context?.root;
    if (!root) return false;
    if (root !== observedCashRoot || !cashObserver) {
      cashObserver?.disconnect();
      observedCashRoot = root;
      cashObserver = new MutationObserver(() => {
        if (!armed) return;
        const current = readVaultDom();
        if (!current || current.context.root !== observedCashRoot) {
          queueReattach();
          return;
        }
        if (Number.isFinite(current.wallet)) processWallet(current.wallet, 'dom');
      });
      cashObserver.observe(root, { childList: true, subtree: true, characterData: true });
    }
    return true;
  }

  function queueReattach() {
    if (reattachQueued || !armed) return;
    reattachQueued = true;
    nextTick(() => {
      reattachQueued = false;
      if (armed) chooseMode();
    });
  }

  function stopDomMode() {
    cashObserver?.disconnect();
    cashObserver = null;
    sidebarObserver?.disconnect();
    sidebarObserver = null;
    if (observedSidebarEl) {
      observedSidebarEl.style.cursor = '';
      observedSidebarEl.title = '';
    }
    observedCashRoot = null;
    observedSidebarEl = null;
    reattachQueued = false;
  }

  function startDomMode({ freshArm = false } = {}) {
    if (!armed) return false;

    const vault = readVaultDom();
    const sidebarOk = attachSidebarObserver();

    if (vault) {
      attachVaultObserver(vault);
    } else {
      cashObserver?.disconnect();
      cashObserver = null;
      observedCashRoot = null;
    }

    if (!vault && !sidebarOk) {
      stopDomMode();
      return false;
    }

    // Prefer sidebar cash as the primary DOM reading; use the deposit page as fallback.
    const sidebarWallet = sidebarOk ? readSidebarMoney() : null;
    const w = Number.isFinite(sidebarWallet) ? sidebarWallet : vault?.wallet;
    if (Number.isFinite(w)) {
      if (freshArm) processWallet(w, 'dom', { baseline: true });
      else processWallet(w, 'dom');
    }

    if (pendingDeposit) fillDeposit();
    return true;
  }

  function chooseMode({ freshArm = false } = {}) {
    if (!armed) {
      stopApiMode();
      stopDomMode();
      mode = 'OFF';
      renderPanel();
      return;
    }
    // DOM monitoring remains active whenever a source exists. With an API key,
    // the API only becomes authoritative in background/no-DOM fallback situations.
    startDomMode({ freshArm });

    if (apiKey) ensureApi();
    else if (apiTimer || apiFetching || apiRequestHandle) stopApiMode();

    refreshModeLabel();
    renderPanel();
  }

  function setArmed(next) {
    armed = Boolean(next);
    GM_setValue(STORAGE.armed, armed);
    primeAudio();

    if (!armed) {
      stopLeaderCoordination();
      pendingDeposit = false;
      clearAwaitingDeposit();
      lastIncrease = 0;
      hasBaseline = false;

      // Keep the canonical multi-tab snapshot in sync with the cleared scalar state.
      // Without this, another tab could later hydrate a stale pending deposit after re-arming.
      lastObservedAt = Date.now();
      writeWalletSnapshot();

      GM_setValue(STORAGE.pendingDeposit, false);
      GM_setValue(STORAGE.lastIncrease, 0);
      GM_setValue(STORAGE.hasBaseline, false);
      clearHighlight();
      chooseMode();
      return;
    }

    bumpWalletCycle();
    startLeaderCoordination();
    // Every armed session establishes a fresh baseline. $0 is a perfectly valid baseline.
    hasBaseline = false;
    GM_setValue(STORAGE.hasBaseline, false);

    // When armed from the Vault, visible cash becomes the baseline and does NOT trigger an alert.
    const dom = readVaultDom();
    if (dom && Number.isFinite(dom.wallet)) {
      lastWallet = dom.wallet;
      latestWallet = dom.wallet;
      hasBaseline = true;
      pendingDeposit = false;
      lastIncrease = 0;
      lastSource = 'dom';
      saveState();
    }

    chooseMode({ freshArm: true });
  }

  function setApiKey() {
    primeAudio();
    const entered = prompt(
      'Paste a CUSTOM Torn API key with user/money permission only.\n\nNever use your Full Access key:',
      ''
    );
    if (entered?.trim()) {
      apiKeyRevision = currentApiKeyRevision() + 1;
      GM_setValue(STORAGE.apiKeyRevision, apiKeyRevision);
      apiKey = entered.trim();
      GM_setValue(STORAGE.apiKey, apiKey);
      stopApiMode();
      resetApiHealth('Ready');
      if (armed) startLeaderCoordination();
      chooseMode();
    }
  }

  function clearApiKey() {
    stopLeaderCoordination();
    apiKeyRevision = currentApiKeyRevision() + 1;
    GM_setValue(STORAGE.apiKeyRevision, apiKeyRevision);
    apiKey = '';
    GM_deleteValue(STORAGE.apiKey);
    stopApiMode();
    resetApiHealth('Disabled');
    chooseMode();
  }

  function testAlarm() {
    primeAudio();
    playAlarm(1_000_000);
    try {
      GM_notification({
        title: '🧪 Neri SafeSell — test',
        text: 'If you heard this and saw the notification, alerts are working.',
        timeout: 5000
      });
    } catch (_) {}
  }

  function modeColor() {
    if (!armed) return '#999';
    if (mode.startsWith('FOREGROUND')) return '#55d66b';
    if (mode.startsWith('BACKGROUND')) return '#a98cff';
    return '#ffb13b';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function destroyPanelShell() {
    panelHost?.remove();
    panelHost = null;
    panelShadow = null;
    panel = null;
    lastPanelHtml = '';
  }

  function restoreQuickButtonGap() {
    if (quickButtonPaddedAnchor?.isConnected) {
      quickButtonPaddedAnchor.style.marginTop = quickButtonOriginalInlineMarginTop;
    }
    quickButtonPaddedAnchor = null;
    quickButtonOriginalInlineMarginTop = '';
  }

  function reserveQuickButtonGap(notes) {
    if (!notes?.isConnected) {
      restoreQuickButtonGap();
      return;
    }

    if (quickButtonPaddedAnchor === notes) return;
    restoreQuickButtonGap();
    quickButtonPaddedAnchor = notes;
    quickButtonOriginalInlineMarginTop = notes.style.marginTop || '';
    const computed = Number.parseFloat(getComputedStyle(notes).marginTop) || 0;
    // Reserve a real row between Torn's three lower utility buttons and Notes.
    // The button still lives in <body>; this margin only prevents it from covering anything.
    notes.style.marginTop = `${computed + 29}px`;
  }

  function destroyQuickButton() {
    restoreQuickButtonGap();
    quickButtonHost?.remove();
    quickButtonHost = null;
    quickButtonShadow = null;
    quickButton = null;
    quickButtonAnchor = null;
  }

  function ensureCornerSwitch() {
    if (cornerSwitch?.isConnected && cornerSwitchHost?.isConnected) return cornerSwitch;

    cornerSwitchHost?.remove();
    cornerSwitchHost = document.createElement('div');
    cornerSwitchHost.id = 'neri-safesell-corner-host';
    cornerSwitchShadow = cornerSwitchHost.attachShadow({ mode: 'closed' });

    cornerSwitch = document.createElement('button');
    cornerSwitchState = null;
    cornerSwitch.type = 'button';
    cornerSwitch.setAttribute('role', 'switch');
    cornerSwitch.setAttribute('aria-label', 'Toggle Neri SafeSell');
    cornerSwitch.style.cssText = [
      'position:fixed','right:6px','top:6px','z-index:2147483647',
      'height:24px','min-width:68px','padding:0 7px',
      'border-radius:999px','border:1px solid rgba(255,255,255,.22)',
      'font:700 10px/1 Arial,sans-serif','letter-spacing:.35px',
      'display:flex','align-items:center','justify-content:center','gap:6px',
      'cursor:pointer','user-select:none','backdrop-filter:blur(5px)',
      'box-shadow:0 2px 8px rgba(0,0,0,.45)'
    ].join(';');

    cornerSwitch.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setArmed(!armed);
    });

    cornerSwitchShadow.appendChild(cornerSwitch);
    (document.body || document.documentElement).appendChild(cornerSwitchHost);
    return cornerSwitch;
  }

  function renderCornerSwitch() {
    const btn = ensureCornerSwitch();
    if (cornerSwitchState === armed) return;
    btn.setAttribute('aria-checked', armed ? 'true' : 'false');
    btn.title = armed
      ? 'Neri SafeSell is ON — click to silence/disarm'
      : 'Neri SafeSell is OFF — click to enable';

    const trackBg = armed ? '#2f9e44' : '#555';
    const knobLeft = armed ? '15px' : '2px';
    const textColor = armed ? '#dfffe5' : '#d3d3d3';
    btn.style.background = armed ? 'rgba(17,35,21,.94)' : 'rgba(28,28,28,.92)';
    btn.style.color = textColor;
    btn.style.boxShadow = armed
      ? '0 0 10px rgba(76,175,80,.45), 0 2px 8px rgba(0,0,0,.45)'
      : '0 2px 8px rgba(0,0,0,.45)';
    cornerSwitchState = armed;
    btn.innerHTML = `
      <span>SAFE</span>
      <span style="position:relative;display:inline-block;width:29px;height:16px;border-radius:999px;background:${trackBg};box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);transition:.15s ease">
        <span style="position:absolute;left:${knobLeft};top:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.45);transition:.15s ease"></span>
      </span>
    `;
  }

  // --- Quick navigation button -----------------------------------------------------
  // Do not insert SafeSell inside the sidebar's internal DOM. Torn/React may replace
  // those rows at any time. Instead, it lives directly in <body> and only
  // borrows visual coordinates from the sidebar. This makes it look integrated without depending
  // on private classes or on Notes belonging to any specific internal structure.
  function findNotesVisualAnchor() {
    if (quickButtonAnchor?.isConnected) return quickButtonAnchor;
    const scanNow = performance.now();
    if (scanNow - anchorScanAt < 2000) return null;
    anchorScanAt = scanNow;

    const nodes = [...document.querySelectorAll('a,button,div,span')]
      .filter(el => /^\s*Notes(?:\s|$)/i.test((el.textContent || '').trim()));

    let best = null;
    let bestScore = Infinity;
    for (const node of nodes) {
      let el = node;
      for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left > window.innerWidth * 0.45) continue;
        if (r.width < 90 || r.width > 280 || r.height < 18 || r.height > 48) continue;
        // Prefer a sidebar-sized Notes row as the visual anchor.
        const score = Math.abs(r.width - 150) + Math.abs(r.height - 22) * 3;
        if (score < bestScore) { best = el; bestScore = score; }
      }
    }

    quickButtonAnchor = best;
    return best;
  }

  function getSidebarInfoRect() {
    const moneyEl = document.getElementById('user-money');
    if (!moneyEl) return null;

    let node = moneyEl;
    let best = null;
    for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
      const r = node.getBoundingClientRect();
      if (r.left > window.innerWidth * 0.45) continue;
      // Use the sidebar information block as a stable positioning reference.
      if (r.width >= 120 && r.width <= 280 && r.height >= 180 && r.height <= 650) {
        if (!best || r.height > best.height) best = r;
      }
    }
    return best;
  }

  function positionQuickButtonHost() {
    if (!quickButtonHost?.isConnected) return;

    const notes = findNotesVisualAnchor();
    let left = 8;
    let top = 520;
    let width = 150;

    if (notes?.isConnected) {
      // Reserve a dedicated row above Notes so SafeSell never covers Torn's controls.
      reserveQuickButtonGap(notes);
      const r = notes.getBoundingClientRect();
      left = r.left;
      width = r.width;
      top = Math.max(34, r.top - 29);
    } else {
      restoreQuickButtonGap();
      const info = getSidebarInfoRect();
      if (info) {
        left = info.left;
        width = info.width;
        top = Math.min(window.innerHeight - 34, info.bottom + 5);
      } else {
        // Last-resort positioning uses the sidebar cash element as the anchor.
        const cash = document.getElementById('user-money')?.getBoundingClientRect();
        if (cash) {
          left = cash.left;
          width = Math.max(120, Math.min(200, cash.width || 150));
          top = Math.min(window.innerHeight - 34, cash.bottom + 280);
        }
      }
    }

    quickButtonHost.style.left = `${Math.round(left)}px`;
    quickButtonHost.style.top = `${Math.round(top)}px`;
    quickButtonHost.style.width = `${Math.round(Math.max(110, width))}px`;
  }

  function mountQuickButtonHost() {
    if (quickButton?.isConnected && quickButtonHost?.isConnected) {
      positionQuickButtonHost();
      return quickButton;
    }

    destroyQuickButton();

    quickButtonHost = document.createElement('div');
    quickButtonHost.id = 'neri-safesell-quick-host';
    quickButtonHost.style.cssText = [
      'position:fixed','z-index:2147483646','height:25px',
      'box-sizing:border-box','pointer-events:auto'
    ].join(';');
    quickButtonShadow = quickButtonHost.attachShadow({ mode: 'closed' });

    quickButton = document.createElement('button');
    quickButton.type = 'button';
    quickButton.setAttribute('aria-label', 'Neri SafeSell quick storage');
    quickButton.style.cssText = [
      'appearance:none','display:flex','align-items:center','justify-content:flex-start','gap:6px',
      'width:100%','height:25px','box-sizing:border-box',
      'border:1px solid #4caf50','border-radius:5px',
      'background:linear-gradient(180deg,rgba(28,42,30,.98),rgba(18,27,19,.98))',
      'color:#eaffed','padding:0 8px',
      'font:700 11px/1 Arial,sans-serif','text-align:left','cursor:pointer','user-select:none',
      'box-shadow:0 2px 7px rgba(0,0,0,.45),inset 0 0 8px rgba(76,175,80,.08)'
    ].join(';');

    quickButton.addEventListener('mouseenter', () => {
      quickButton.style.filter = 'brightness(1.14)';
    });
    quickButton.addEventListener('mouseleave', () => {
      quickButton.style.filter = '';
    });
    quickButton.addEventListener('click', e => {
      if (!quickNavigationAllowed()) return;
      e.preventDefault();
      e.stopPropagation();

      const tgt = VAULT_TARGET;

      // Both button states are navigation-only in this review build.
      // Red indicates exposed cash; once in the Vault, SafeSell may autofill the field,
      // but the player must click DEPOSIT manually.
      location.assign(tgt.url);
    });

    quickButtonShadow.appendChild(quickButton);
    (document.body || document.documentElement).appendChild(quickButtonHost);
    positionQuickButtonHost();
    return quickButton;
  }

  function ensureQuickButton() {
    return mountQuickButtonHost();
  }

  function renderQuickButton() {
    if (!quickNavigationAllowed()) {
      destroyQuickButton();
      return;
    }

    const btn = ensureQuickButton();
    if (!btn) return;
    const tgt = VAULT_TARGET;
    const danger = pendingDeposit && latestWallet > 0;

    btn.innerHTML = danger
      ? `<span style="font-size:15px;line-height:1">💰</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${money(latestWallet)} → ${tgt.label}</span>`
      : `<span style="font-size:15px;line-height:1">💰</span><span>Go to ${tgt.label}</span>`;

    btn.title = danger
      ? `Cash exposed: ${money(latestWallet)}. Click to go to ${tgt.label}; SafeSell will autofill, but DEPOSIT remains manual.`
      : `Click to go to ${tgt.label}. Navigation only.`;

    btn.style.borderColor = danger ? '#ff3b30' : '#4caf50';
    btn.style.background = danger
      ? 'linear-gradient(180deg,rgba(76,25,25,.98),rgba(43,18,18,.98))'
      : 'linear-gradient(180deg,rgba(28,42,30,.98),rgba(18,27,19,.98))';
    btn.style.color = danger ? '#ffe2df' : '#eaffed';
    btn.style.boxShadow = danger
      ? '0 0 9px rgba(255,59,48,.45),0 2px 7px rgba(0,0,0,.45)'
      : '0 2px 7px rgba(0,0,0,.45),inset 0 0 8px rgba(76,175,80,.08)';

    positionQuickButtonHost();
  }

  function ensurePanelShell() {
    destroyQuickButton();
    if (panel?.isConnected && panelHost?.isConnected) return panel;

    // The host is visible in Torn's normal DOM, but the actual UI lives inside a
    // closed Shadow DOM. This prevents normal panelHost.shadowRoot access and helps
    // isolate the panel so Torn/other-script CSS cannot easily leak into it or vice versa.
    // This does NOT protect the API key or
    // internal functions from malicious code running inside the SAME
    // userscript; the IIFE provides scope isolation. Shadow DOM is UI isolation only.
    if (!panelHost?.isConnected) {
      panelHost = document.createElement('div');
      panelHost.id = 'neri-safesell-host';
      panelShadow = panelHost.attachShadow({ mode: 'closed' });
      (document.body || document.documentElement).appendChild(panelHost);
    }

    panel = document.createElement('div');
    panel.id = 'neri-safesell-panel';
    panel.style.cssText = [
      'position:fixed','right:14px','top:135px','z-index:2147483647',
      'background:#171717','color:#eee','border:1px solid #ff9800',
      'border-radius:12px','padding:11px 12px','font:13px/1.3 Arial,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.55)','min-width:285px','max-width:325px'
    ].join(';');
    lastPanelHtml = '';
    panel.addEventListener('change', e => {
      if (e.target?.matches?.('[data-toggle]')) setArmed(e.target.checked);
      else if (e.target?.matches?.('[data-quicknav]')) {
        quickNav = e.target.checked;
        GM_setValue(STORAGE.quickNav, quickNav);
        if (observedSidebarEl) {
          const active = quickNav && quickNavigationAllowed();
          observedSidebarEl.style.cursor = active ? 'pointer' : '';
          observedSidebarEl.title = active
            ? `Neri SafeSell: click to go to ${VAULT_TARGET.label}`
            : '';
        }
      }
    });
    panel.addEventListener('click', e => {
      if (e.target?.closest?.('[data-test]')) testAlarm();
      else if (e.target?.closest?.('[data-key]')) {
        if (apiKey && e.shiftKey) clearApiKey();
        else setApiKey();
      }
    });
    panelShadow.appendChild(panel);
    return panel;
  }

  function setPanelHtml(html) {
    if (!panel || html === lastPanelHtml) return;   // do not rewrite unchanged markup
    lastPanelHtml = html;
    panel.innerHTML = html;
  }

  const UI_REFRESH_MIN_MS = 400;
  let lastUiRefreshAt = 0;

  function scheduleUiRefresh() {
    if (uiRefreshQueued) return;
    uiRefreshQueued = true;
    const wait = Math.max(0, UI_REFRESH_MIN_MS - (Date.now() - lastUiRefreshAt));
    setTimeout(() => nextTick(() => {
      uiRefreshQueued = false;
      lastUiRefreshAt = Date.now();
      renderPanel();
      if (armed) chooseMode();
    }), wait);
  }

  function addedTreeContains(node, selector) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    try { return node.matches?.(selector) || Boolean(node.querySelector?.(selector)); }
    catch (_) { return false; }
  }

  function addedTreeLooksLikeNotes(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return /\bNotes\b/i.test(String(node.textContent || ''));
  }

  function startUiBootstrapObserver() {
    if (uiBootstrapObserver) return;
    uiBootstrapObserver = new MutationObserver(mutations => {
      const lostDomSource = (observedCashRoot && !observedCashRoot.isConnected)
        || (observedSidebarEl && !observedSidebarEl.isConnected);
      if (lostDomSource) {
        queueReattach();
        return;
      }

      const lostOwnedHost = (cornerSwitchHost && !cornerSwitchHost.isConnected)
        || (quickButtonHost && !quickButtonHost.isConnected)
        || (panelHost && !panelHost.isConnected);
      if (lostOwnedHost) {
        quickButtonAnchor = null;
        anchorScanAt = 0;
        scheduleUiRefresh();
        return;
      }

      const needSidebar = armed && !observedSidebarEl;
      const needNotes = armed && quickNavigationAllowed() && !quickButtonAnchor;
      const needDepositUi = isDepositRoute(currentRouteKind()) && !ctxCache;

      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n === panelHost || n === quickButtonHost || n === cornerSwitchHost) continue;
          if (needSidebar && addedTreeContains(n, '#user-money')) {
            scheduleUiRefresh();
            return;
          }
          if (needDepositUi && addedTreeContains(n, 'input,button,form')) {
            scheduleUiRefresh();
            return;
          }
          if (needNotes && addedTreeLooksLikeNotes(n)) {
            scheduleUiRefresh();
            return;
          }
        }
      }
    });
    uiBootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function renderPanel() {
    renderCornerSwitch();
    let html;
    const routeKind = currentRouteKind();
    const ctx = findDepositContext();
    const onDepositPage = isDepositRoute(routeKind) || Boolean(ctx);

    // Vault / Cayman: full panel. If Torn has not finished
    // rendering the deposit form, keep the panel visible and show a waiting state.
    if (onDepositPage) {
      destroyQuickButton();
      ensurePanelShell();

      if (!ctx) {
        const routeLabel = routeKind === 'cayman' ? 'Cayman Overseas Bank' : 'Property Vault';

        html = `
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <div style="font-weight:800;color:#ffb13b">🛡 Neri SafeSell</div>
            <span style="font-size:9px;font-weight:800;letter-spacing:.5px;color:#b9d6ff;border:1px solid #294b78;background:#142033;border-radius:999px;padding:2px 6px">REVIEW</span>
            <span style="font-size:10px;color:#777">v1.0.7</span>
          </div>
          <div style="margin-top:8px;color:#bbb">⏳ ${routeLabel}: waiting for Torn to render the deposit form…</div>
          <div style="margin-top:6px;font-size:11px;color:#777">SafeSell remains active while the interface loads.</div>
        `;
        setPanelHtml(html);
        scheduleDepositContextProbe();
        return;
      }

      stopDepositContextProbe();
      const dom = readVaultDom(ctx);
      const capacity = dom?.capacity;
      const target = pendingDeposit ? getDepositTarget() : 0;
      const vaultFull = pendingDeposit && Number.isFinite(capacity) && capacity <= 0 && latestWallet > 0;

      const apiState = apiUiState();
      const badge = modeBadge();
      const capacityState = routeKind === 'cayman'
        ? { label: 'No fixed cap', color: '#8b8b8b' }
        : dom?.capacityState === 'confirmed' && Number.isFinite(dom?.capacity)
          ? { label: `${money(dom.capacity)} left`, color: '#55d66b' }
          : { label: 'Unknown', color: '#ffb13b' };
      const baselineState = hasBaseline
        ? { label: 'Ready', color: '#55d66b' }
        : { label: 'Pending', color: '#ffb13b' };
      const lastApiText = lastApiSuccessAt
        ? `${Math.max(0, Math.floor((Date.now() - lastApiSuccessAt) / 1000))}s ago`
        : 'none this session';

      html = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div style="font-weight:800;color:#ffb13b">🛡 Neri SafeSell</div>
              <span style="font-size:9px;font-weight:800;letter-spacing:.5px;color:#b9d6ff;border:1px solid #294b78;background:#142033;border-radius:999px;padding:2px 6px">REVIEW</span>
            </div>
            <div style="margin-top:2px;font-size:10px;color:#777">v1.0.0</div>
          </div>
          <div style="text-align:right">
            <div style="display:inline-block;padding:3px 7px;border:1px solid ${badge.color}55;border-radius:999px;background:${badge.color}12;color:${badge.color};font-size:9px;font-weight:800;letter-spacing:.35px">${badge.label}</div>
            <div style="margin-top:3px;font-size:9px;color:#666">${isForeground() ? 'FOREGROUND' : 'BACKGROUND'}</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:8px 9px;border:1px solid #2e2e2e;border-radius:8px;background:#131313">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input data-toggle type="checkbox" ${armed ? 'checked' : ''}>
            <b>${armed ? 'ON — ARMED' : 'OFF'}</b>
          </label>
          <div style="text-align:right">
            <div style="font-size:9px;color:#777">WALLET</div>
            <div style="font-weight:800;color:#eee">${money(latestWallet)}</div>
          </div>
        </div>

        ${pendingDeposit ? `
          <div style="margin-top:7px;padding:8px 9px;border:1px solid ${vaultFull ? '#7c2b2b' : (routeKind === 'vault' && !Number.isFinite(capacity) ? '#79551b' : '#6f4b14')};border-radius:8px;background:${vaultFull ? '#351818' : '#2d240f'};color:${vaultFull ? '#ff9b94' : '#ffd27d'}">
            ${vaultFull
              ? `⚠ <b>Vault full</b> · ${money(latestWallet)} still exposed`
              : (routeKind === 'vault' && !Number.isFinite(capacity)
                  ? `⚠ <b>Vault capacity unavailable</b><br><span style="font-size:11px">SafeSell will not autofill until Torn's stored amount is readable.</span>`
                  : `💰 <b>Cash pending</b> · +${money(lastIncrease)}<br><span style="font-size:11px">Prepared: <b>${money(target)}</b></span>`)}
          </div>
        ` : `
          <div style="margin-top:7px;padding:7px 9px;border-radius:8px;background:#131313;color:#8f8f8f">Waiting for a wallet increase…</div>
        `}

        ${lastError ? `<div style="margin-top:7px;padding:6px 8px;border-left:3px solid #ff6b6b;background:#281717;color:#ff9b9b;font-size:11px">API: ${escapeHtml(lastError)}</div>` : ''}

        <div style="display:flex;gap:6px;margin-top:9px">
          <button data-test style="flex:1;cursor:pointer;padding:4px 6px">🔊 Test alarm</button>
          <button data-key title="${apiKey ? 'Click to replace the API key · Shift-click to remove it' : 'Optional Torn API backup'}" style="flex:1;cursor:pointer;padding:4px 6px">🔑 ${apiKey ? 'API backup ✓' : 'Enable API'}</button>
        </div>

        <div style="margin-top:9px;padding:8px 9px;border:1px solid #2c2c2c;border-radius:8px;background:#141414">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
            <input data-quicknav type="checkbox" ${quickNav ? 'checked' : ''}>
            <b>Sidebar $ shortcut</b>
          </label>
          <div style="margin-top:5px;font-size:11px;color:#aaa">
            Destination: <b style="color:#eee">Property Vault</b>
          </div>
          <div style="margin-top:4px;font-size:10px;color:#737373">
            Green navigates only. Red indicates exposed cash and also navigates only. SafeSell can autofill the current amount after reaching the Vault; DEPOSIT remains manual.
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:9px;font-size:10px">
          <div style="padding:6px 7px;border-radius:7px;background:#121212;border:1px solid #292929"><span style="color:#777">Source</span><br><b style="color:#55d66b">DOM primary</b></div>
          <div style="padding:6px 7px;border-radius:7px;background:#121212;border:1px solid #292929"><span style="color:#777">API</span><br><b style="color:${apiState.color}">${apiState.label}</b></div>
          <div style="padding:6px 7px;border-radius:7px;background:#121212;border:1px solid #292929"><span style="color:#777">Baseline</span><br><b style="color:${baselineState.color}">${baselineState.label}</b></div>
          <div style="padding:6px 7px;border-radius:7px;background:#121212;border:1px solid #292929"><span style="color:#777">Vault capacity</span><br><b style="color:${capacityState.color}">${capacityState.label}</b></div>
        </div>

        <details style="margin-top:8px;border-top:1px solid #2d2d2d;padding-top:7px;color:#777;font-size:10px">
          <summary style="cursor:pointer;color:#999;user-select:none">Diagnostics</summary>
          <div style="margin-top:6px;line-height:1.45">
            Mode: <b style="color:${modeColor()}">${mode}</b><br>State owner: <b>${isLeader && ownsLeadership() ? 'this tab' : 'another tab'}</b> · recovery lease: <b>${Math.round(CFG.leaderStaleMs / 1000)}s</b>.<br>
            Background DOM monitoring remains enabled in this review build.<br>
            Alert dedupe: exact wallet transition + wallet cycle; no time cooldown.<br>
            Alarm volume: silent below <b>$100k</b>, progressive from <b>$100k–$1M</b>, full at <b>$1M+</b>.<br>
            Baseline includes $0: <b>${hasBaseline ? 'yes' : 'not established yet'}</b>.<br>
            ${apiKey ? `API guardrail: <b>${sharedApiCount()}/${CFG.maxOwnApiCallsPerMinute}</b> calls / 60 s · last success: ${lastApiText} · status: ${escapeHtml(lastApiStatus)}.<br>` : 'API polling is idle because no key is configured; shared state-owner coordination remains active.<br>'}
            ${apiKey ? 'Shift-click the API button to remove the stored key.<br>' : ''}
            ${routeKind === 'vault'
              ? `Property Vault cap: <b>${money(CFG.defaultVaultMax)}</b> · stored: <b>${Number.isFinite(dom?.stored) ? money(dom.stored) : 'unavailable'}</b> · remaining: <b>${Number.isFinite(dom?.capacity) ? money(dom.capacity) : 'unknown'}</b>.`
              : 'Cayman: Property Vault capacity limit does not apply.'}
          </div>
        </details>

        <div style="margin-top:7px;font-size:10px;color:#707070">♥ Neri_Nagaret's feet kissed: +1 (you)</div>
      `;

      setPanelHtml(html);
      return;
    }

    // Other Torn pages: hide the large panel. If SafeSell is armed and the player is not
    // travelling, show only the compact navigation button.
    stopDepositContextProbe();
    destroyPanelShell();
    if (quickNavigationAllowed()) renderQuickButton();
    else destroyQuickButton();
  }

  // pointerdown only refreshes the field before the user's click reaches Torn.
  document.addEventListener('pointerdown', e => {
    if (!armed || !pendingDeposit || !isForeground()) return;
    const ctx = findDepositContext();
    const btn = findDepositButton(ctx?.input);
    if (!btn || !(e.target === btn || btn.contains(e.target))) return;
    fillDeposit();
  }, true);

  // Only an actual click marks a deposit attempt, and the marker expires automatically
  // if Torn does not produce a wallet decrease shortly afterward.
  document.addEventListener('click', e => {
    if (!armed || !pendingDeposit || !isForeground()) return;
    const ctx = findDepositContext();
    const btn = findDepositButton(ctx?.input);
    if (!btn || !(e.target === btn || btn.contains(e.target))) return;
    const written = parseMoneyText(ctx?.input?.value);
    if (Number.isFinite(written) && written > 0) markAwaitingDeposit();
  }, true);

  window.addEventListener('resize', () => {
    quickButtonAnchor = null;
    anchorScanAt = 0;
    if (quickButtonHost?.isConnected) positionQuickButtonHost();
  });
  let scrollPositionQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollPositionQueued || !quickButtonHost?.isConnected) return;
    scrollPositionQueued = true;
    requestAnimationFrame(() => {
      scrollPositionQueued = false;
      if (quickButtonHost?.isConnected) positionQuickButtonHost();
    });
  }, { passive: true });

  window.addEventListener('focus', () => {
    if (!armed) {
      renderPanel();
      return;
    }
    primeAudio();
    claimLeadership('focus');
    chooseMode();
    if (pendingDeposit) fillDeposit();
  });

  window.addEventListener('pageshow', () => {
    if (!armed) return;
    if (document.visibilityState === 'visible') claimLeadership('pageshow');
    chooseMode();
  });

  document.addEventListener('freeze', () => {
    if (apiTimer || apiFetching || apiRequestHandle) stopApiMode();
  });
  document.addEventListener('resume', () => {
    if (!armed) return;
    if (document.visibilityState === 'visible') claimLeadership('resume');
    else heartbeatLeader();
    chooseMode();
  });

  window.addEventListener('blur', () => {
    // Keep the last-used Torn tab as owner while the user is in another application.
    // A different Torn tab takes over immediately when it receives focus.
    if (armed) chooseMode();
  });

  document.addEventListener('visibilitychange', () => {
    if (!armed) {
      renderPanel();
      return;
    }
    if (document.visibilityState === 'visible' && document.hasFocus()) claimLeadership('visible');
    chooseMode();
  });

  // Torn is an SPA. Listen for navigation initiated by the interface so SafeSell can
  // refresh route-dependent state when returning to the Vault without navigation polling.
  let modeRefreshQueued = false;
  function scheduleModeRefresh() {
    // Route-dependent DOM references must never survive an SPA navigation. Torn may
    // keep old React nodes connected while replacing the visible route.
    ctxCache = null;
    ctxLastScan = 0;
    travelCache.at = 0;

    if (modeRefreshQueued) return;
    modeRefreshQueued = true;
    nextTick(() => {
      modeRefreshQueued = false;
      if (armed) chooseMode();
      else renderPanel();
    });
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original === 'function') {
      history[method] = function(...args) {
        const result = original.apply(this, args);
        scheduleModeRefresh();
        return result;
      };
    }
  }
  window.addEventListener('popstate', scheduleModeRefresh);
  window.addEventListener('hashchange', scheduleModeRefresh);

  // Synchronize state between tabs without generating any request to Torn.
  try {
    GM_addValueChangeListener(STORAGE.armed, (_k, _old, val, remote) => {
      if (!remote) return;
      armed = Boolean(val);
      if (armed) startLeaderCoordination();
      else stopLeaderCoordination();
      chooseMode();
    });
    GM_addValueChangeListener(SNAPSHOT_KEY, (_k, _old, val, remote) => {
      if (!remote) return;
      const snapshot = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch (_) { return null; } })() : val;
      if (applyWalletSnapshot(snapshot)) {
        if (pendingDeposit) fillDeposit();
        renderPanel();
      }
    });
    GM_addValueChangeListener(STORAGE.lastWallet, (_k, _old, val, remote) => {
      if (!remote) return;
      if (currentWalletSnapshot()) return;
      const n = Number(val);
      if (Number.isFinite(n)) { lastWallet = n; latestWallet = n; }
      renderPanel();
    });
    GM_addValueChangeListener(STORAGE.hasBaseline, (_k, _old, val, remote) => {
      if (!remote) return;
      hasBaseline = Boolean(val);
      renderPanel();
    });
    GM_addValueChangeListener(STORAGE.pendingDeposit, (_k, _old, val, remote) => {
      if (!remote) return;
      pendingDeposit = Boolean(val);
      if (pendingDeposit) fillDeposit();
      renderPanel();
    });
    GM_addValueChangeListener(STORAGE.lastIncrease, (_k, _old, val, remote) => {
      if (!remote) return;
      lastIncrease = Number(val || 0);
      renderPanel();
    });
    GM_addValueChangeListener(LEADER_KEY, (_k, _old, _val, remote) => {
      if (remote && armed) heartbeatLeader();
    });
    GM_addValueChangeListener(STORAGE.apiKeyRevision, (_k, _old, val, remote) => {
      if (!remote) return;
      const nextRevision = Number(val || 0);
      if (Number.isFinite(nextRevision) && nextRevision >= 0) apiKeyRevision = Math.floor(nextRevision);
      stopApiMode();
      syncApiHealth();
      chooseMode();
    });
    GM_addValueChangeListener(STORAGE.apiHealth, (_k, _old, val, remote) => {
      if (!remote) return;
      const health = typeof val === 'string'
        ? (() => { try { return JSON.parse(val); } catch (_) { return null; } })()
        : val;
      if (applyApiHealth(health)) chooseMode();
    });
    GM_addValueChangeListener(STORAGE.apiKey, (_k, _old, val, remote) => {
      if (!remote) return;
      stopApiMode();
      apiKey = String(val || '');
      apiKeyRevision = currentApiKeyRevision();
      if (!applyApiHealth(readJsonValue(STORAGE.apiHealth, null))) {
        resetApiHealth(apiKey ? 'Ready' : 'Disabled');
      }
      if (armed) startLeaderCoordination();
      else stopLeaderCoordination();
      chooseMode();
    });
  } catch (_) {}

  const releaseLeadershipOnExit = () => {
    if (ownsLeadership()) GM_deleteValue(LEADER_KEY);
  };
  window.addEventListener('pagehide', releaseLeadershipOnExit);
  window.addEventListener('beforeunload', releaseLeadershipOnExit);

  // Bootstrap observer waits for asynchronously mounted Torn UI without polling or requests.
  startUiBootstrapObserver();

  renderPanel();
  if (armed) {
    startLeaderCoordination();
    syncApiHealth();
    chooseMode();
  }
})();