// ==UserScript==
// @name         Neri SafeSell - Vault Guard (Experimental Review)
// @namespace    neri.torn.local
// @version      0.9.4
// @description  SafeSell v0.9.4 Experimental Review: desktop-only Vault-first wallet guard with Property Vault/Cayman support, manual deposit, background DOM monitoring, and Torn API backup.
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
   * - Source is intentionally unobfuscated for review.
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
    console.info('[Neri SafeSell v0.9.4 Experimental Review] desktop-only runtime guard — SafeSell will not start on mobile or Torn PDA.');
    return;
  }

  const SUPPORTED_SCRIPT_HANDLERS = ['Tampermonkey', 'Violentmonkey'];
  let scriptHandlerName = null;
  try { scriptHandlerName = (typeof GM_info !== 'undefined' && GM_info?.scriptHandler) || null; } catch (_) {}
  if (!scriptHandlerName || !SUPPORTED_SCRIPT_HANDLERS.includes(scriptHandlerName)) {
    console.info('[Neri SafeSell v0.9.4 Experimental Review] unsupported userscript manager ("%s") — SafeSell will not start here.', scriptHandlerName || '(none)');
    return;
  }

  const requiredGmApisAvailable = typeof GM_xmlhttpRequest === 'function'
    && typeof GM_getValue === 'function'
    && typeof GM_setValue === 'function'
    && typeof GM_deleteValue === 'function'
    && typeof GM_addValueChangeListener === 'function';
  if (!requiredGmApisAvailable) {
    console.info('[Neri SafeSell v0.9.4 Experimental Review] required userscript APIs are unavailable — SafeSell will not start.');
    return;
  }

  console.info('[Neri SafeSell v0.9.4 Experimental Review] loaded on', location.hostname, '· userscript manager:', scriptHandlerName);

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
    walletSnapshot: 'NSS.walletSnapshot'
  });

  // One-time compatibility migration from pre-namespaced GM storage keys.
  // Legacy values remain untouched; SafeSell reads and writes only NSS.* keys afterward.
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
    walletSnapshot: 'walletSnapshot'
  });

  const STORAGE_MISSING = '__NSS_STORAGE_MISSING__';

  function migrateLegacyStorage() {
    for (const name of Object.keys(STORAGE)) {
      const targetKey = STORAGE[name];
      const legacyKey = LEGACY_STORAGE[name];
      const current = GM_getValue(targetKey, STORAGE_MISSING);
      if (current !== STORAGE_MISSING) continue;

      const legacy = GM_getValue(legacyKey, STORAGE_MISSING);
      if (legacy !== STORAGE_MISSING) {
        try { GM_setValue(targetKey, legacy); } catch (_) {}
      }
    }
  }

  migrateLegacyStorage();

  const CFG = {
    backgroundPollMs: Number(GM_getValue(STORAGE.backgroundPollMs, 2000) || 2000),
    minIncrease: 1,
    comment: 'NeriSafeSell',
    defaultVaultMax: 1_000_000_000,
    apiWindowMs: 60_000,
    maxOwnApiCallsPerMinute: 45,
    leaderHeartbeatMs: 2000,
    leaderStaleMs: 6500,
    leaderSettleMs: 120,
    foregroundApiBackupMs: 5000,
    staleDomMs: 4000
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
  let walletCycle = Number(GM_getValue(STORAGE.walletCycle, 0) || 0);

  let apiTimer = null;
  let apiPollKind = 'none';
  let apiFetching = false;
  let cashObserver = null;
  let shellObserver = null;
  let observedCashRoot = null;
  let reattachQueued = false;
  let panel = null;
  let panelHost = null;
  let panelShadow = null;
  let quickButton = null;
  let quickButtonHost = null;
  let quickButtonShadow = null;
  let quickButtonAnchor = null;
  let quickButtonPaddedAnchor = null;
  let quickButtonOriginalInlineMarginTop = '';
  let cornerSwitch = null;
  let cornerSwitchHost = null;
  let cornerSwitchShadow = null;
  let uiBootstrapObserver = null;
  let uiRefreshQueued = false;
  let audioCtx = null;
  let awaitingDeposit = false;
  let mode = 'OFF';
  let lastError = '';
  let apiCallTimes = [];
  let lastApiAt = 0;
  let lastDomChangeAt = 0;
  let sidebarObserver = null;
  let observedSidebarEl = null;
  let ctxCache = null;
  let ctxLastScan = 0;
  let lastPanelHtml = '';
  let quickNav = Boolean(GM_getValue(STORAGE.quickNav, false));

  // Automatic deposit is intentionally disabled in this review build.
  // Navigation and autofill remain available, but DEPOSIT always requires a user click.

  // --- Multi-tab coordination (local only; does not contact Torn servers) ---
  // The most recently focused Torn tab is the preferred API leader. Leadership uses a
  // short lease-settle step: a tab writes a unique token, waits briefly, then re-reads
  // the shared record before it is allowed to poll. This prevents simultaneous tabs from
  // both assuming they won the same election.
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

  function normalizeWalletSnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    const wallet = Number(value.wallet);
    const observedAt = Number(value.observedAt || 0);
    if (!Number.isFinite(wallet) || wallet < 0 || !Number.isFinite(observedAt) || observedAt < 0) return null;
    return {
      wallet: Math.floor(wallet),
      source: ['api', 'dom', 'none'].includes(value.source) ? value.source : 'none',
      observedAt,
      apiAt: Math.max(0, Number(value.apiAt || 0) || 0),
      domAt: Math.max(0, Number(value.domAt || 0) || 0),
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
    lastApiAt = snapshot.apiAt;
    lastDomChangeAt = snapshot.domAt;
    hasBaseline = snapshot.hasBaseline;
    pendingDeposit = snapshot.pendingDeposit;
    lastIncrease = snapshot.lastIncrease;
    walletCycle = Math.max(walletCycle, snapshot.cycle);
    return true;
  }

  function writeWalletSnapshot() {
    if (!lastObservedAt) lastObservedAt = Date.now();
    writeJsonValue(SNAPSHOT_KEY, {
      wallet: Math.max(0, Math.floor(Number(lastWallet || 0))),
      source: lastSource,
      observedAt: lastObservedAt,
      apiAt: lastApiAt,
      domAt: lastDomChangeAt,
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
      if (!isLeader) stopApiMode();
      if (armed) { ensureApi(); refreshModeLabel(); }
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
    const now = Date.now();
    const leader = currentLeader();
    const stale = !leaderIsFresh(leader, now);

    if (leader?.id === TAB_ID && leader?.token === leaderToken && !stale) {
      writeJsonValue(LEADER_KEY, { ...leader, heartbeat: now });
      isLeader = true;
    } else if (stale) {
      claimLeadership(isForeground() ? 'active' : 'stale');
      return;
    } else {
      if (isLeader) stopApiMode();
      isLeader = false;
    }

    if (armed) { ensureApi(); refreshModeLabel(); }
    renderPanel();
  }

  function startLeaderCoordination() {
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

  function saveState() {
    // The snapshot is the canonical multi-tab wallet state. Legacy scalar keys remain
    // for compatibility/UI, but source + timing metadata move together atomically.
    writeWalletSnapshot();
    GM_setValue(STORAGE.lastWallet, Math.max(0, Math.floor(Number(lastWallet || 0))));
    GM_setValue(STORAGE.hasBaseline, Boolean(hasBaseline));
    GM_setValue(STORAGE.pendingDeposit, Boolean(pendingDeposit));
    GM_setValue(STORAGE.lastIncrease, Math.floor(Number(lastIncrease || 0)));
  }

  function pruneApiCalls() {
    const cutoff = Date.now() - CFG.apiWindowMs;
    apiCallTimes = apiCallTimes.filter(t => t >= cutoff);
  }

  function noteApiCall() {
    apiCallTimes.push(Date.now());
    pruneApiCalls();
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

  function playAlarm() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      [0, 0.18, 0.36, 0.63, 0.81, 0.99].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = i < 3 ? 'square' : 'sawtooth';
        osc.frequency.value = i < 3 ? 980 : 1320;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.24, now + offset + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.145);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.17);
      });
    } catch (_) {}
  }

  function notifyIncrease(delta, wallet, source) {
    playAlarm();
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

  let travelCache = { at: 0, value: { travelling: false, cayman: false } };
  function getTravelInfo() {
    const now = performance.now();
    if (now - travelCache.at < 750) return travelCache.value;

    const kind = currentRouteKind();
    const text = document.body?.textContent || '';
    // The sid=travel URL is the primary immediate signal. Visible text remains as
    // a fallback for Torn variants and SPA transitions.
    const travelling = kind === 'travel' || /\btravel(l)?ing (from|to)\b|\bremaining flight time\b|\byou are (currently )?travel(l)?ing\b|\bin the air\b|\breturning (home|to torn)\b/i.test(text);
    const cayman = kind === 'cayman' || /\bcayman islands\b/i.test(text);
    travelCache = { at: now, value: { travelling, cayman } };
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

    const t = performance.now();
    if (t - ctxLastScan < 400) return null;   // avoid scanning the entire DOM on every mutation
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

  function parseMoneyText(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[^0-9]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  function readVaultDom(context = findDepositContext()) {
    if (!context?.root) return null;
    const text = context.root.textContent || '';

    const walletMatch = text.match(/You have\s+\$\s*([\d,.]+)\s+on (?:hand|you)/i);
    if (!walletMatch) return null;

    const storedMatch = text.match(/There is\s+\$\s*([\d,.]+)\s+stored in the vault/i);
    const maxMatch = text.match(/maximum of\s+\$\s*([\d,.]+)\s+in\s*to your/i);

    const wallet = parseMoneyText(walletMatch[1]);
    const stored = storedMatch ? parseMoneyText(storedMatch[1]) : null;
    const max = maxMatch ? parseMoneyText(maxMatch[1]) : CFG.defaultVaultMax;
    const capacity = Number.isFinite(stored) && Number.isFinite(max)
      ? Math.max(0, max - stored)
      : null;

    return { wallet, stored, max, capacity, context };
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
    if (dom && Number.isFinite(dom.capacity)) {
      return Math.max(0, Math.min(Math.floor(latestWallet), Math.floor(dom.capacity)));
    }
    return Math.max(0, Math.floor(latestWallet));
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

    if (source === 'dom' && !baseline && hasBaseline && !awaitingDeposit
        && lastSource === 'api' && wallet < lastWallet && observedAt - lastApiAt < CFG.staleDomMs) return;

    if (source === 'api') lastApiAt = Math.max(lastApiAt, observedAt);
    else if (wallet !== lastWallet) lastDomChangeAt = Math.max(lastDomChangeAt, observedAt);

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
      if (source === 'api') {
        lastSource = 'api';
        lastObservedAt = observedAt;
        writeWalletSnapshot();
      }
      if (pendingDeposit) fillDeposit();
      renderPanel();
      return;
    }

    lastWallet = wallet;
    lastSource = source;
    lastObservedAt = observedAt;

    if (delta >= CFG.minIncrease) {
      pendingDeposit = true;
      awaitingDeposit = false;
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
        awaitingDeposit = false;
        lastIncrease = 0;
        clearHighlight();
      } else if (awaitingDeposit) {
        pendingDeposit = true;
        awaitingDeposit = false;
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
    noteApiCall();

    const ts = Date.now();
    const url = `https://api.torn.com/v2/user/money?timestamp=${ts}&comment=${encodeURIComponent(CFG.comment)}`;

    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { Authorization: `ApiKey ${apiKey}` },
      timeout: 6000,
      onload: res => {
        apiFetching = false;
        try {
          const json = JSON.parse(res.responseText);
          if (res.status < 200 || res.status >= 300 || json.error) {
            lastError = json?.error?.error || `HTTP ${res.status}`;
            renderPanel();
            return;
          }
          const wallet = Number(json?.money?.wallet ?? json?.wallet);
          if (!Number.isFinite(wallet)) throw new Error('invalid wallet value');
          lastError = '';

          if (!ownsLeadership()) return;
          const sharedSnapshot = currentWalletSnapshot();
          if (ts < lastDomChangeAt) return;
          if (sharedSnapshot && ts < sharedSnapshot.observedAt) return;

          processWallet(wallet, 'api', { baseline, observedAt: Date.now() });
        } catch (e) {
          lastError = String(e.message || e);
          renderPanel();
        }
      },
      onerror: () => {
        apiFetching = false;
        lastError = 'API did not respond';
        renderPanel();
      },
      ontimeout: () => {
        apiFetching = false;
        lastError = 'API timeout';
        renderPanel();
      }
    });
  }

  function stopApiMode() {
    if (apiTimer) clearInterval(apiTimer);
    apiTimer = null;
    apiPollKind = 'none';
  }

  // Single API poller: only the leader tab polls, with cadence based on focus.
  // In this review build, API polling runs alongside DOM monitoring as a redundant source.
  function ensureApi() {
    if (!armed || !isLeader || !apiKey || currentLeader()?.id !== TAB_ID) { stopApiMode(); return; }
    const kind = isForeground() ? 'foreground' : 'background';
    if (apiTimer && apiPollKind === kind) return;
    stopApiMode();
    apiPollKind = kind;
    requestWallet({ baseline: !hasBaseline });
    apiTimer = setInterval(
      () => requestWallet(),
      kind === 'foreground' ? CFG.foregroundApiBackupMs : CFG.backgroundPollMs
    );
  }

  function refreshModeLabel() {
    if (!armed) { mode = 'OFF'; return; }
    const parts = [];
    if (observedCashRoot || observedSidebarEl) parts.push('DOM');
    if (apiKey) parts.push(isLeader ? 'API' : 'API (other tab)');
    const where = isForeground() ? 'FOREGROUND' : 'BACKGROUND';
    mode = parts.length ? `${where} · ${parts.join(' + ')}` : 'NO SOURCE · no DOM or API';
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

  // Cheap structural observer: reacts only when Torn/React replaces an observed node.
  function attachShellObserver() {
    if (shellObserver) return;
    shellObserver = new MutationObserver(mutations => {
      if (!armed) return;
      const lost = (observedCashRoot && !observedCashRoot.isConnected)
                || (observedSidebarEl && !observedSidebarEl.isConnected);
      if (!lost) return;
      const external = mutations.some(m => {
        const target = m.target instanceof Node ? m.target : null;
        if (panel && target && (target === panel || panel.contains(target))) return false;
        return m.addedNodes.length || m.removedNodes.length;
      });
      if (external) queueReattach();
    });
    shellObserver.observe(document.documentElement, { childList: true, subtree: true });
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
    shellObserver?.disconnect();
    shellObserver = null;
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
    attachShellObserver();

    // Prefer sidebar cash as the primary DOM reading; use the deposit page as fallback.
    const sidebarWallet = sidebarOk ? readSidebarMoney() : null;
    const w = Number.isFinite(sidebarWallet) ? sidebarWallet : vault?.wallet;
    if (Number.isFinite(w)) {
      if (freshArm) {
        processWallet(w, 'dom', { baseline: true });
      } else if (!(pendingDeposit && lastSource === 'api' && w < lastWallet)) {
        // Do not overwrite a newer API wallet value with a stale DOM render.
        processWallet(w, 'dom');
      }
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
    // Review behavior under evaluation: DOM monitoring remains active whenever a source exists,
    // including when Torn is not the focused tab. Automatic deposit is disabled in this build.
    startDomMode({ freshArm });
    ensureApi();                  // API: active whenever a key exists and this tab is leader
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
      awaitingDeposit = false;
      lastIncrease = 0;
      GM_setValue(STORAGE.pendingDeposit, false);
      GM_setValue(STORAGE.lastIncrease, 0);
      hasBaseline = false;
      GM_setValue(STORAGE.hasBaseline, false);
      clearHighlight();
      chooseMode();
      return;
    }

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
      apiKey = entered.trim();
      GM_setValue(STORAGE.apiKey, apiKey);
      lastError = '';
      chooseMode();
    }
  }

  function clearApiKey() {
    apiKey = '';
    GM_deleteValue(STORAGE.apiKey);
    lastError = '';
    chooseMode();
  }

  function testAlarm() {
    primeAudio();
    playAlarm();
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
    if (mode.startsWith('STANDBY')) return '#7aa7ff';
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
      'border-radius:10px','padding:10px 12px','font:13px/1.3 Arial,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.55)','min-width:255px','max-width:305px'
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

  function scheduleUiRefresh() {
    if (uiRefreshQueued) return;
    uiRefreshQueued = true;
    nextTick(() => {
      uiRefreshQueued = false;
      renderPanel();
      if (armed) chooseMode();
    });
  }

  function startUiBootstrapObserver() {
    if (uiBootstrapObserver) return;
    uiBootstrapObserver = new MutationObserver(mutations => {
      // If Torn replaces a mounted UI host, reinject SafeSell into the new DOM.
      // Intentional SafeSell removals clear the reference first and are ignored here.
      const lostOwnedHost = (cornerSwitchHost && !cornerSwitchHost.isConnected)
        || (quickButtonHost && !quickButtonHost.isConnected)
        || (panelHost && !panelHost.isConnected);
      if (lostOwnedHost) {
        quickButtonAnchor = null;
        scheduleUiRefresh();
        return;
      }

      const external = mutations.some(m => {
        const target = m.target instanceof Node ? m.target : null;
        if (panel && target && (target === panel || panel.contains(target))) return false;
        if (quickButton && target && (target === quickButton || quickButton.contains(target))) return false;
        if (cornerSwitch && target && (target === cornerSwitch || cornerSwitch.contains(target))) return false;
        const changed = [...m.addedNodes, ...m.removedNodes];
        if (!changed.length) return false;
        return changed.some(n => {
          if (n === panel || n === panelHost || n === quickButton || n === quickButtonHost
              || n === cornerSwitch || n === cornerSwitchHost) return false;
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (panel && panel.contains(n)) return false;
            if (quickButton && quickButton.contains(n)) return false;
            if (cornerSwitch && cornerSwitch.contains(n)) return false;
          }
          return true;
        });
      });
      if (external) scheduleUiRefresh();
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
          <div style="font-weight:700;color:#ffb13b">🛡 Neri SafeSell v0.9.4 Experimental Review</div>
          <div style="margin-top:7px;color:#bbb">⏳ ${routeLabel}: waiting for Torn to render the deposit form…</div>
          <div style="margin-top:6px;font-size:11px;color:#777">SafeSell remains active while the interface loads.</div>
        `;
        setPanelHtml(html);
        return;
      }

      pruneApiCalls();
      const dom = readVaultDom(ctx);
      const capacity = dom?.capacity;
      const target = pendingDeposit ? getDepositTarget() : 0;
      const vaultFull = pendingDeposit && Number.isFinite(capacity) && capacity <= 0 && latestWallet > 0;

      html = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="font-weight:700;color:#ffb13b">🛡 Neri SafeSell v0.9.4 Experimental Review</div>
          <div style="font-size:11px;color:${modeColor()}">${mode}</div>
        </div>

        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px">
          <input data-toggle type="checkbox" ${armed ? 'checked' : ''}>
          <b>${armed ? 'ON — ARMED' : 'OFF'}</b>
        </label>

        <div style="margin-top:7px;color:#bbb">
          Wallet: <b style="color:#eee">${money(latestWallet)}</b>
        </div>

        ${pendingDeposit ? `
          <div style="margin-top:6px;padding:7px;border-radius:7px;background:${vaultFull ? '#451818' : '#3d2b09'};color:${vaultFull ? '#ff9b94' : '#ffd27d'}">
            ${vaultFull
              ? `⚠ Vault full · ${money(latestWallet)} still exposed`
              : `💰 Pending · +${money(lastIncrease)}<br>DEPOSIT prepared: <b>${money(target)}</b>`}
          </div>
        ` : `
          <div style="margin-top:6px;color:#8f8f8f">Waiting for a wallet increase…</div>
        `}

        ${lastError ? `<div style="margin-top:6px;color:#ff7878">API: ${escapeHtml(lastError)}</div>` : ''}

        <div style="display:flex;gap:6px;margin-top:9px">
          <button data-test style="flex:1;cursor:pointer">🔊 Test</button>
          <button data-key style="flex:1;cursor:pointer">🔑 ${apiKey ? 'API ✓' : 'Set API'}</button>
        </div>

        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #333">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
            <input data-quicknav type="checkbox" ${quickNav ? 'checked' : ''}>
            Quick click on sidebar $
          </label>
          <div style="margin-top:5px;font-size:12px;color:#bbb">
            Quick storage: <b style="color:#eee">Property Vault</b>
          </div>
          <div style="margin-top:4px;font-size:10px;color:#777">
            Outside Vault/Cayman, a money button appears next to the sidebar. Green: navigate to Property Vault. Red: cash is exposed; it still only navigates. Once in the Vault, SafeSell can autofill the amount, but DEPOSIT always requires a manual click.
          </div>
        </div>

        <div style="margin-top:6px;font-size:11px;color:#777">
          Sources in parallel: DOM monitor${apiKey ? ` + API every ${((isForeground() ? CFG.foregroundApiBackupMs : CFG.backgroundPollMs)/1000).toFixed(1)} s · ${isLeader ? 'this tab is leader (last active)' : 'another tab is leader'}` : ' · no API (0 requests)'}.<br>
          Review behavior: <b>DOM monitoring remains active while Torn is in the background.</b><br>
          Alerts: <b>0 s cooldown</b>; only the same exact transition within the same cycle is deduplicated.<br>
          Baseline: ${hasBaseline ? 'established (includes $0)' : 'pending'}.<br>
          Shared API guardrail: ${sharedApiCount()}/${CFG.maxOwnApiCallsPerMinute} calls in 60 s.${apiKey ? '' : '<br>Without API, SafeSell only watches the DOM and depends on Torn updating the loaded page.'}<br>
          <span style="color:#888">♥ Neri_Nagaret's feet kissed: +1 (you)</span>
        </div>
      `;

      setPanelHtml(html);
      return;
    }

    // Other Torn pages: hide the large panel. If SafeSell is armed and the player is not
    // travelling, show only the compact navigation button.
    destroyPanelShell();
    if (quickNavigationAllowed()) renderQuickButton();
    else destroyQuickButton();
  }

  // Manual deposits remain human-triggered. pointerdown only ensures the input has
  // the freshest cash value before the same user click reaches Torn's button.
  document.addEventListener('pointerdown', e => {
    if (!armed || !pendingDeposit || !isForeground()) return;
    const ctx = findDepositContext();
    const btn = findDepositButton(ctx?.input);
    if (!btn || !(e.target === btn || btn.contains(e.target))) return;

    fillDeposit();
    awaitingDeposit = true;
  }, true);

  window.addEventListener('resize', () => {
    quickButtonAnchor = null;
    if (quickButtonHost?.isConnected) positionQuickButtonHost();
  });
  window.addEventListener('scroll', () => {
    if (quickButtonHost?.isConnected) positionQuickButtonHost();
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

  window.addEventListener('blur', () => {
    // Keep the last-used Torn tab as leader while the user is in another application.
    // A different Torn tab takes over when it receives focus.
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
      if (armed) startLeaderCoordination(); else stopLeaderCoordination();
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
    GM_addValueChangeListener(STORAGE.apiKey, (_k, _old, val, remote) => {
      if (!remote) return;
      apiKey = String(val || '');
      chooseMode();
    });
  } catch (_) {}

  window.addEventListener('beforeunload', () => {
    if (ownsLeadership()) GM_deleteValue(LEADER_KEY);
  });

  // Bootstrap observer waits for asynchronously mounted Torn UI without polling or requests.
  startUiBootstrapObserver();

  renderPanel();
  if (armed) {
    startLeaderCoordination();
    chooseMode();
  }
})();