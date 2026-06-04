(async () => {
  const security = window.ExCreatorSecurity;
  const proxy = window.ExCreatorProxy;
  if (!security || !proxy) return;

  const config = await security.loadRuntimeConfig();
  const siteRules = Array.isArray(config.floatingToggleUrls) ? config.floatingToggleUrls : [];
  const contentRules = Array.isArray(config.contentRules) ? config.contentRules : [];
  const extensionName = security.cleanText(config.extensionName, 'Extension', 80);
  const buttonText = security.cleanText(config.buttonText, 'Show message', 80);
  const guideUrl = security.safeUrl(config.guideUrl, 'https://test-ipv6.com/');
  const actionButtonText = security.cleanText(config.activateButtonText, `Activate ${buttonText}`, 100);
  const ipv6ButtonMessage = config.ipv6ButtonMessage || `You have connected to ${extensionName} website successfully. To activate ${buttonText}, you need to add the proxy.pac file to the Files folder.\n\nTo guide, follow Step 5/6 on the following page:\n${guideUrl}`;
  const proxyFirstButtonMessage = config.proxyFirstButtonMessage || `Congratulations! You have successfully activated ${buttonText}`;
  const proxyNextButtonMessage = config.proxyNextButtonMessage || `${siteRules[0]?.url || extensionName} has blocked your proxy. Please check the following URL for troubleshooting:\n${guideUrl}`;
  const pageUrl = location.href;
  let proxyMessageTimer = null;
  let activationFallbackTimer = null;
  let proxyPacDetected = false;
  let proxyPacPollTimer = null;

  const matchedSite = siteRules.find((site) => security.matchesExactRuleUrl(pageUrl, site.url));
  const matchedRules = contentRules.filter((rule) => security.matchesExactRuleUrl(pageUrl, rule.url) && rule.existingContent);
  const hasMatch = Boolean(matchedSite || matchedRules.length || (!siteRules.length && !contentRules.length));
  if (!hasMatch) return;

  const stateKey = `ex-creator:${matchedSite?.url || matchedRules[0]?.url || location.origin}`;
  const activationKey = `${stateKey}:activated`;
  const defaults = {
    enabled: false,
    connected: false,
    bridgeReady: false,
    localProActivated: false,
    theme: 'aurora',
    font: 'system',
    proxyMode: false,
    proxyPacFingerprint: '',
    proxySeenFingerprints: [],
    proxyBlockedFingerprints: [],
    proxyFirstUntil: 0,
    proxyPhase: 'none',
    messageShown: false,
    messageTone: 'ipv6',
    messageText: '',
    buttonVisible: true,
  };
  const getState = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(stateKey, (result) => resolve(security.normalizeState(result[stateKey], defaults)));
    });
  const saveState = (nextState) =>
    new Promise((resolve) => chrome.storage.local.set({ [stateKey]: nextState }, resolve));

  function readPersistentActivation() {
    try {
      return localStorage.getItem(activationKey) === '1';
    } catch {
      return false;
    }
  }

  function writePersistentActivation(enabled) {
    try {
      if (enabled) localStorage.setItem(activationKey, '1');
      else localStorage.removeItem(activationKey);
    } catch {
      // Ignore storage failures on restricted origins.
    }
  }

  function getBlockedFingerprintList() {
    return security.normalizeSeenFingerprints(state.proxyBlockedFingerprints, state.proxyBlockedFingerprint ? [state.proxyBlockedFingerprint] : []);
  }

  function isBlockedProxyFingerprint(fingerprint) {
    return Boolean(fingerprint) && getBlockedFingerprintList().includes(fingerprint);
  }

  function rememberBlockedProxyFingerprint(fingerprint) {
    if (!fingerprint) return;
    state.proxyBlockedFingerprints = security.normalizeSeenFingerprints(
      state.proxyBlockedFingerprints,
      [fingerprint],
    );
  }

  function stopProxyPacPolling() {
    if (proxyPacPollTimer) clearInterval(proxyPacPollTimer);
    proxyPacPollTimer = null;
  }

  async function refreshProxyPacState() {
    proxyPacDetected = await proxy.hasProxyPac();
    if (proxyPacDetected && state.connected && !state.localProActivated && state.messageTone === 'ipv6') {
      state.messageShown = false;
      state.messageText = '';
      await saveState(state);
    }
    renderState();
    if (proxyPacDetected) stopProxyPacPolling();
    return proxyPacDetected;
  }

  function startProxyPacPolling() {
    if (proxyPacDetected) return;
    if (proxyPacPollTimer) return;
    proxyPacPollTimer = setInterval(() => {
      void refreshProxyPacState();
    }, 3000);
  }

  function getActiveSiteOrigin() {
    try {
      const url = new URL(pageUrl);
      return url.origin;
    } catch {
      return '';
    }
  }

  let state = await getState();
  state.proxySeenFingerprints = security.normalizeSeenFingerprints(state.proxySeenFingerprints, state.proxySeenFingerprint ? [state.proxySeenFingerprint] : []);
  let proxyAccess = null;
  const persistentActivation = readPersistentActivation();
  if (state.localProActivated || persistentActivation) {
    state.enabled = true;
    state.connected = true;
    state.proxyMode = true;
    state.bridgeReady = true;
    state.localProActivated = true;
    state.messageShown = true;
    state.messageTone = 'proxy-first';
    state.messageText = proxyFirstButtonMessage;
    state.buttonVisible = false;
  }
  if (state.localProActivated || persistentActivation) {
    await saveState(state);
  }
  proxyPacDetected = await proxy.hasProxyPac();
  if (!proxyPacDetected) startProxyPacPolling();
  const styleId = 'ex-creator-style';
  const widgetId = 'ex-creator-widget';
  let rootEl = null;
  let observer = null;
  let proxyLifecyclePoll = null;
  let topBannerEl = null;
  let ipCodeValue = '';
  let accessCode = '';

  const fontMap = {
    system: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    rounded: '"Avenir Next", "Nunito", "Segoe UI", sans-serif',
  };

  const themeMap = {
    aurora: { bg: '#f5f7ff', text: '#101828', accent: '#2563eb', panel: '#ffffff' },
    midnight: { bg: '#08111d', text: '#edf4ff', accent: '#14b8a6', panel: '#0f172a' },
    sunset: { bg: '#fff6ef', text: '#3a220f', accent: '#ea580c', panel: '#ffffff' },
    forest: { bg: '#eff8f1', text: '#103223', accent: '#16a34a', panel: '#ffffff' },
    candy: { bg: '#fff1f7', text: '#3b1022', accent: '#db2777', panel: '#ffffff' },
    paper: { bg: '#fafafa', text: '#1f2937', accent: '#52525b', panel: '#ffffff' },
  };

  function injectStyles() {
    if (document.getElementById(styleId)) return;
    const link = document.createElement('link');
    link.id = styleId;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');
    document.documentElement.appendChild(link);
  }

  function applyAppearance() {
    const theme = themeMap[state.theme] || themeMap.aurora;
    document.documentElement.dataset.exConnected = state.connected ? 'true' : 'false';
    document.documentElement.style.setProperty('--ex-font', fontMap[state.font] || fontMap.system);
    document.documentElement.style.setProperty('--ex-bg', theme.bg);
    document.documentElement.style.setProperty('--ex-text', theme.text);
    document.documentElement.style.setProperty('--ex-accent', theme.accent);
    document.documentElement.style.setProperty('--ex-panel', theme.panel);
  }

  function renderRichText(container, text) {
    security.renderRichText(container, text);
  }

  function getBannerAnchor() {
    return document.querySelector('h1') || document.querySelector('p') || null;
  }

  function ensureBanner() {
    if (topBannerEl) return topBannerEl;
    const banner = document.createElement('section');
    banner.id = 'ex-creator-page-banner';
    banner.className = 'ex-banner';
    banner.hidden = true;
    banner.innerHTML = `
      <div class="ex-banner-head">
        <span class="ex-banner-copy">Connected</span>
        <span class="ex-banner-dot">●</span>
      </div>
    `;
    topBannerEl = banner;
    return banner;
  }

  function renderTopBanner() {
    const shouldShow = hasMatch && state.connected && state.bridgeReady === true;
    if (!shouldShow) {
      topBannerEl?.remove();
      topBannerEl = null;
      return;
    }

    const banner = ensureBanner();
    const anchor = getBannerAnchor();
    if (anchor?.parentElement) {
      if (banner.parentElement !== anchor.parentElement || anchor.nextSibling !== banner) {
        anchor.insertAdjacentElement('afterend', banner);
      }
    } else if (banner.parentElement !== document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.hidden = false;
  }

  function applyRules() {
    if (!state.connected || state.bridgeReady !== true || !matchedRules.length || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(`#${widgetId}`) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'PRE', 'CODE'].includes(parent.tagName)) continue;
      let nextValue = node.nodeValue;
      for (const rule of matchedRules) {
        nextValue = nextValue.split(rule.existingContent).join(typeof rule.modifiedContent === 'string' ? rule.modifiedContent : '');
      }
      if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
    }
  }

  function syncObserver() {
    if (!state.connected) {
      observer?.disconnect();
      observer = null;
      return;
    }
    if (!observer) {
      observer = new MutationObserver(() => applyRules());
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  function updateControls(root) {
    if (!root) return;
    root.querySelectorAll('[data-theme]').forEach((button) => {
      button.dataset.active = String(button.dataset.theme === state.theme);
    });
    root.querySelectorAll('[data-font]').forEach((button) => {
      button.dataset.active = String(button.dataset.font === state.font);
    });
    renderButtonState();
    renderMessageState();
  }

  async function persistAndSync() {
    await saveState(state);
    applyAppearance();
    updateControls(rootEl);
    syncObserver();
    applyRules();
    syncWidgetVisibility();
  }

  function getButtonMessage() {
    if (state.messageShown && state.messageText) return state.messageText;
    if (!state.proxyMode) return ipv6ButtonMessage;
    return state.messageTone === 'proxy-second' ? proxyNextButtonMessage : proxyFirstButtonMessage;
  }

  function scheduleProxyBlockedCheck(shouldWarn) {
    if (proxyMessageTimer) clearTimeout(proxyMessageTimer);
    proxyMessageTimer = null;
    if (!state.proxyMode || !state.connected || !shouldWarn) return;
    proxyMessageTimer = setTimeout(() => {
      state.messageShown = true;
      state.buttonVisible = false;
      state.messageTone = 'proxy-second';
      state.messageText = proxyNextButtonMessage;
      saveState(state);
      renderState();
    }, 30000);
  }

  function clearActivationFallbackTimer() {
    if (activationFallbackTimer) clearTimeout(activationFallbackTimer);
    activationFallbackTimer = null;
  }

  function showActivationSuccess() {
    state.messageShown = true;
    state.buttonVisible = false;
    state.messageTone = 'proxy-first';
    state.messageText = proxyFirstButtonMessage;
  }

  function showActivationBlocked() {
    state.messageShown = true;
    state.buttonVisible = false;
    state.messageTone = 'proxy-second';
    state.messageText = proxyNextButtonMessage;
  }

  function scheduleActivationFallbackCheck() {
    clearActivationFallbackTimer();
    activationFallbackTimer = setTimeout(async () => {
      const persistent = readPersistentActivation();
      const active = state.connected && (state.localProActivated || persistent);
      if (active) {
        state.bridgeReady = true;
        showActivationSuccess();
      } else {
        state.bridgeReady = false;
        rememberBlockedProxyFingerprint(state.proxyPacFingerprint);
        showActivationBlocked();
      }
      await saveState(state);
      renderState();
    }, 30000);
  }

  async function activateLocalPro(accessCode) {
    if (state.localProActivated || readPersistentActivation()) {
      state.localProActivated = true;
      state.bridgeReady = true;
      writePersistentActivation(true);
      await saveState(state);
      return true;
    }
    const siteOrigin = getActiveSiteOrigin();
    if (!siteOrigin || !accessCode) return false;
    try {
      const response = await fetch(`${siteOrigin}/api/dev/activate-pro`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ accessCode }),
      });
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      if (!data || data.ok !== true) return false;
      state.localProActivated = true;
      state.bridgeReady = true;
      writePersistentActivation(true);
      await saveState(state);
      return true;
    } catch {
      return false;
    }
  }

  function showIpv6MessageAfterLoading() {
    const loader = rootEl?.querySelector('.ex-loader');
    if (!loader) return;
    state.messageShown = true;
    state.buttonVisible = false;
    state.messageTone = 'ipv6';
    state.messageText = ipv6ButtonMessage;
    saveState(state);
    renderState();
    loader.hidden = true;
  }

  function renderButtonState() {
    const button = rootEl?.querySelector('.ex-message-btn');
    if (!button) return;
    button.textContent = actionButtonText;
    button.hidden = state.messageShown || !state.proxyMode || !state.connected || !proxyPacDetected;
    button.style.display = button.hidden ? 'none' : '';
  }

  function renderMessageState() {
    const messageBox = rootEl?.querySelector('.ex-message');
    const loader = rootEl?.querySelector('.ex-loader');
    if (!messageBox) return;
    messageBox.classList.toggle('proxy-first', state.messageTone === 'proxy-first');
    messageBox.classList.toggle('proxy-second', state.messageTone === 'proxy-second');
    if (state.messageShown) {
      renderRichText(messageBox, getButtonMessage());
      messageBox.hidden = false;
    } else {
      messageBox.hidden = true;
    }
    loader?.classList.add('hidden');
  }

  function renderLockState() {
    if (!rootEl) return;
    const value = rootEl.querySelector('.ex-ip-value');
    if (value) value.textContent = ipCodeValue || 'Loading...';
  }

  function renderState() {
    applyAppearance();
    renderLockState();
    renderButtonState();
    renderMessageState();
    renderTopBanner();
    syncWidgetVisibility();
  }

  function createWidget() {
    if (document.getElementById(widgetId)) return;
    injectStyles();
    const root = document.createElement('div');
    root.id = widgetId;
    rootEl = root;
    root.innerHTML = `
      <div class="ex-panel" hidden>
        <div class="ex-lock">
          <div class="ex-lock-title">You must connect the ${security.escapeHtml(extensionName)} before access this website.</div>
          <div class="ex-ip-card">
            <div class="ex-ip-head">
              <span>Your IPCode</span>
              <button class="ex-copy" type="button">Copy</button>
            </div>
            <div class="ex-ip-value">Loading...</div>
          </div>
          <div class="ex-help">
            After copying your IPCode, visit Step 4 of the following URL to get your access code.<br>
            <a href="${security.escapeHtml(guideUrl)}" target="_blank" rel="noreferrer noopener">${security.escapeHtml(guideUrl)}</a>
          </div>
          <label class="ex-field">
            <span>Activation part</span>
            <input class="ex-code" type="text" autocomplete="off" spellcheck="false" placeholder="Paste code here">
          </label>
          <button class="ex-connect" type="button">Connect</button>
          <div class="ex-status" aria-live="polite"></div>
        </div>
        <div class="ex-body">
          <div class="ex-head">
            <span>${security.escapeHtml(extensionName)}</span>
          </div>
          <details class="ex-section" open>
            <summary>Themes</summary>
            <div class="ex-row">
              <button class="ex-chip" type="button" data-theme="aurora">Aurora</button>
              <button class="ex-chip" type="button" data-theme="midnight">Midnight</button>
              <button class="ex-chip" type="button" data-theme="sunset">Sunset</button>
              <button class="ex-chip" type="button" data-theme="forest">Forest</button>
              <button class="ex-chip" type="button" data-theme="candy">Candy</button>
              <button class="ex-chip" type="button" data-theme="paper">Paper</button>
            </div>
          </details>
          <details class="ex-section">
            <summary>Fonts</summary>
            <div class="ex-row">
              <button class="ex-chip" type="button" data-font="system">Clean</button>
              <button class="ex-chip" type="button" data-font="serif">Serif</button>
              <button class="ex-chip" type="button" data-font="mono">Mono</button>
              <button class="ex-chip" type="button" data-font="rounded">Rounded</button>
            </div>
          </details>
          <button class="ex-primary ex-message-btn" type="button" hidden>${security.escapeHtml(actionButtonText)}</button>
          <div class="ex-loader" hidden>Loading...</div>
          <div class="ex-message" hidden></div>
          <button class="ex-danger ex-disconnect" type="button">Disconnect</button>
        </div>
      </div>
      <button class="ex-launch" type="button" aria-label="Open ${security.escapeHtml(extensionName)}">
        <span class="ex-launch-mark">✨</span>
        <span class="ex-launch-name">${security.escapeHtml(extensionName)}</span>
      </button>
    `;

    const panel = root.querySelector('.ex-panel');
    const launch = root.querySelector('.ex-launch');
    const messageBtn = root.querySelector('.ex-message-btn');
    const loader = root.querySelector('.ex-loader');
    const copyBtn = root.querySelector('.ex-copy');
    const connectBtn = root.querySelector('.ex-connect');
    const codeInput = root.querySelector('.ex-code');
    const status = root.querySelector('.ex-status');

    launch.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
    root.querySelectorAll('[data-theme]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.theme = button.dataset.theme || state.theme;
        await persistAndSync();
      });
    });
    root.querySelectorAll('[data-font]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.font = button.dataset.font || state.font;
        await persistAndSync();
      });
    });
    copyBtn.addEventListener('click', async () => {
      if (!ipCodeValue) {
        if (status) status.textContent = 'IPCode is unavailable right now.';
        return;
      }
      await navigator.clipboard.writeText(ipCodeValue);
      copyBtn.textContent = 'Copied';
      if (status) status.textContent = 'After copying your IPCode, visit Step 4 of the following URL to get your access code.';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1200);
    });
    connectBtn.addEventListener('click', async () => {
      if (!accessCode) {
        if (status) status.textContent = 'Unable to verify IPCode right now.';
        return;
      }
      if (codeInput.value.trim() !== accessCode) {
        if (status) status.textContent = 'Invalid code. Try again.';
        codeInput.focus();
        codeInput.select();
        return;
      }
      state.enabled = true;
      state.connected = true;
      state.proxyMode = true;
      state.bridgeReady = false;
      state.localProActivated = false;
      state.messageShown = !proxyPacDetected;
      state.buttonVisible = true;
      state.messageTone = proxyPacDetected ? 'proxy-first' : 'ipv6';
      state.messageText = proxyPacDetected ? '' : ipv6ButtonMessage;
      state.proxyPacFingerprint = '';
      writePersistentActivation(false);
      await persistAndSync();
      if (!proxyPacDetected) startProxyPacPolling();
      if (status) status.textContent = 'Code verified. Add proxy.pac, then activate from the extension.';
    });
    messageBtn.addEventListener('click', async () => {
      if (!state.connected) {
        if (status) status.textContent = 'Connect first, then activate.';
        return;
      }
      clearActivationFallbackTimer();
      const pacAvailable = await proxy.hasProxyPac();
      if (!pacAvailable) {
        proxyPacDetected = false;
        startProxyPacPolling();
        state.messageShown = true;
        state.messageTone = 'ipv6';
        state.messageText = ipv6ButtonMessage;
        await persistAndSync();
        loader.hidden = true;
        return;
      }
      const refreshedProxyAccess = await proxy.loadProxyPacAccess();
      if (!refreshedProxyAccess) {
        rememberBlockedProxyFingerprint(state.proxyPacFingerprint);
        showActivationBlocked();
        await saveState(state);
        renderState();
        loader.hidden = true;
        return;
      }
      proxyAccess = refreshedProxyAccess;
      const fingerprint = proxyAccess.fingerprint || proxy.getProxyPacFingerprint(proxyAccess);
      if (isBlockedProxyFingerprint(fingerprint)) {
        state.proxyPacFingerprint = fingerprint;
        showActivationBlocked();
        await persistAndSync();
        loader.hidden = true;
        return;
      }
      state.proxyPacFingerprint = fingerprint;
      proxyPacDetected = true;
      stopProxyPacPolling();
      showActivationSuccess();
      await persistAndSync();
      loader.hidden = true;
      scheduleActivationFallbackCheck();
      void activateLocalPro(proxyAccess.accessCode || accessCode);
    });
    root.querySelector('.ex-disconnect').addEventListener('click', async () => {
      state.enabled = false;
      state.connected = false;
      state.proxyMode = false;
      state.bridgeReady = false;
      state.localProActivated = false;
      state.proxyPhase = 'none';
      state.messageShown = false;
      state.buttonVisible = true;
      state.messageTone = 'ipv6';
      state.messageText = '';
      state.proxyPacFingerprint = '';
      writePersistentActivation(false);
      clearActivationFallbackTimer();
      stopProxyPacPolling();
      proxyPacDetected = false;
      if (codeInput) codeInput.value = '';
      if (loader) loader.hidden = true;
      await persistAndSync();
    });

    document.body.append(root);
    updateControls(root);
    syncWidgetVisibility();
  }

  function syncWidgetVisibility() {
    if (!rootEl) return;
    rootEl.style.display = hasMatch ? 'block' : 'none';
    const lock = rootEl.querySelector('.ex-lock');
    const body = rootEl.querySelector('.ex-body');
    if (lock) lock.hidden = state.connected;
    if (body) body.hidden = !state.connected;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[stateKey]) return;
    state = security.normalizeState(changes[stateKey].newValue, defaults);
    updateControls(rootEl);
    renderState();
    syncObserver();
    applyRules();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'ex-creator-sync-state') return;
    if (message.state && typeof message.state === 'object') {
      state = security.normalizeState({ ...state, ...message.state }, defaults);
      updateControls(rootEl);
      renderState();
      syncObserver();
      applyRules();
    }
    sendResponse({ ok: true });
    return true;
  });

  createWidget();
  renderState();
  proxy.fetchIPCode().then(async (resolvedIpCode) => {
    ipCodeValue = resolvedIpCode || '';
    accessCode = await proxy.encodeIP(ipCodeValue);
    renderLockState();
  });
  syncObserver();
  applyRules();
})();
