(async () => {
  const security = window.ExCreatorSecurity;
  const proxy = window.ExCreatorProxy;
  if (!security || !proxy) return;

  const els = {
    extName: document.querySelector('#extName'),
    mainHeader: document.querySelector('#mainHeader'),
    closeBtn: document.querySelector('#closeBtn'),
    status: document.querySelector('#status'),
    wrongSiteView: document.querySelector('#wrongSiteView'),
    connectView: document.querySelector('#connectView'),
    featureView: document.querySelector('#featureView'),
    connectText: document.querySelector('#connectText'),
    codeInput: document.querySelector('#codeInput'),
    connectBtn: document.querySelector('#connectBtn'),
    ipv6Value: document.querySelector('#ipv6Value'),
    copyIpv6Btn: document.querySelector('#copyIpv6Btn'),
    helpText: document.querySelector('#helpText'),
    guideLink: document.querySelector('#guideLink'),
    themeButtons: document.querySelector('#themeButtons'),
    fontButtons: document.querySelector('#fontButtons'),
    disconnectBtn: document.querySelector('#disconnectBtn'),
    messageButton: document.querySelector('#messageButton'),
    loader: document.querySelector('#loader'),
    messageBox: document.querySelector('#messageBox'),
  };

  els.mainHeader?.classList.remove('hidden');
  els.status?.classList.remove('hidden');
  if (els.status) els.status.textContent = 'Loading...';

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
  let proxyMessageTimer = null;
  let activationFallbackTimer = null;
  let proxyPacDetected = false;
  let proxyPacPollTimer = null;

  const currentTab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
  const pageUrl = currentTab?.url || '';

  const matchedSite = siteRules.find((site) => security.matchesExactRuleUrl(pageUrl, site.url));
  const matchedRules = contentRules.filter((rule) => security.matchesExactRuleUrl(pageUrl, rule.url) && rule.existingContent);
  const hasMatch = Boolean(matchedSite || matchedRules.length || (!siteRules.length && !contentRules.length));
  const stateKey = `ex-creator:${matchedSite?.url || matchedRules[0]?.url || location.origin}`;
  const activationKey = `${stateKey}:activated`;
  const defaults = {
    enabled: false,
    connected: false,
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
  const state = await new Promise((resolve) => {
    chrome.storage.local.get(stateKey, (result) => resolve(security.normalizeState(result[stateKey], defaults)));
  });
  state.proxySeenFingerprints = security.normalizeSeenFingerprints(state.proxySeenFingerprints, state.proxySeenFingerprint ? [state.proxySeenFingerprint] : []);

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
      const hostname = url.hostname.toLowerCase();
      if (hostname !== 'vokxi.com' && hostname !== 'www.vokxi.com' && !hostname.endsWith('.vokxi.com')) return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  if (state.localProActivated || readPersistentActivation()) {
    state.enabled = true;
    state.connected = true;
    state.proxyMode = true;
    state.localProActivated = true;
    state.messageShown = true;
    state.messageTone = 'proxy-first';
    state.messageText = proxyFirstButtonMessage;
    state.buttonVisible = false;
    await saveState(state);
  }
  proxyPacDetected = await proxy.hasProxyPac();
  if (!proxyPacDetected) startProxyPacPolling();

  const syncPage = () => {
    if (currentTab?.id == null) return;
    chrome.tabs.sendMessage(currentTab.id, { type: 'ex-creator-sync-state', state }, () => {
      void chrome.runtime.lastError;
    });
  };

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
      syncPage();
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

  function showProxyMessage() {
    state.messageShown = false;
    state.buttonVisible = true;
    state.messageTone = 'proxy-first';
    state.messageText = '';
  }

  function scheduleActivationFallbackCheck() {
    clearActivationFallbackTimer();
    activationFallbackTimer = setTimeout(async () => {
      const persistent = readPersistentActivation();
      const active = state.connected && (state.localProActivated || persistent);
      if (active) showActivationSuccess();
      else {
        rememberBlockedProxyFingerprint(state.proxyPacFingerprint);
        showActivationBlocked();
      }
      await saveState(state);
      renderState();
      syncPage();
    }, 30000);
  }

  function showIpv6MessageAfterLoading() {
    if (!els.loader || !els.messageBox) return;
    state.messageShown = true;
    state.buttonVisible = false;
    state.messageTone = 'ipv6';
    state.messageText = ipv6ButtonMessage;
    saveState(state);
    renderState();
    els.loader.hidden = true;
  }

  function renderButtonState() {
    if (!els.messageButton) return;
    els.messageButton.textContent = actionButtonText;
    els.messageButton.hidden = state.messageShown || !state.proxyMode || !state.connected || !proxyPacDetected;
  }

  function renderMessageState() {
    if (!els.messageBox) return;
    const text = getButtonMessage();
    els.messageBox.classList.toggle('proxy-first', state.messageTone === 'proxy-first');
    els.messageBox.classList.toggle('proxy-second', state.messageTone === 'proxy-second');
    renderRichText(els.messageBox, text);
    els.messageBox.classList.toggle('hidden', !state.messageShown);
    els.loader?.classList.add('hidden');
  }

  async function fetchIPv6() {
    try {
      const response = await fetch('https://api64.ipify.org?format=json')
        .then((r) => r.json())
        .catch(() => fetch('https://api6.ipify.org?format=json').then((r) => r.json()));
      return response?.ip || '';
    } catch {
      return '';
    }
  }

  async function activateLocalPro(accessCode) {
    if (state.localProActivated || readPersistentActivation()) {
      state.localProActivated = true;
      writePersistentActivation(true);
      await saveState(state);
      syncPage();
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
      writePersistentActivation(true);
      await saveState(state);
      syncPage();
      return true;
    } catch {
      return false;
    }
  }

  function renderRichText(container, text) {
    security.renderRichText(container, text);
  }

  function renderState() {
    els.mainHeader?.classList.remove('hidden');
    els.wrongSiteView?.classList.toggle('hidden', hasMatch);
    els.connectView?.classList.toggle('hidden', hasMatch ? state.connected : true);
    els.featureView?.classList.toggle('hidden', !hasMatch || !state.connected);
    els.status?.classList.toggle('hidden', false);
    if (els.status) {
      if (!hasMatch) els.status.textContent = 'You are trying to connect wrong website.';
      else if (state.connected) els.status.textContent = 'Connected.';
      else els.status.textContent = 'Copy your IP, then get your access code.';
    }
    els.themeButtons?.querySelectorAll('button').forEach((button) => {
      button.dataset.active = String(button.dataset.theme === state.theme);
    });
    els.fontButtons?.querySelectorAll('button').forEach((button) => {
      button.dataset.active = String(button.dataset.font === state.font);
    });
    renderButtonState();
    renderMessageState();
  }

  if (els.extName) els.extName.textContent = extensionName;
  if (els.connectText) els.connectText.textContent = `You must connect the ${extensionName} before access this website.`;
  if (els.guideLink) els.guideLink.href = guideUrl;
  if (els.guideLink) els.guideLink.textContent = guideUrl;

  renderState();

  let ipv6 = '';
  let accessCode = '';
  let proxyAccess = null;

  fetchIPv6().then(async (resolvedIpv6) => {
    ipv6 = resolvedIpv6 || '';
    accessCode = await proxy.encodeIP(ipv6);
    if (els.ipv6Value) els.ipv6Value.textContent = ipv6 || 'Unavailable';
    renderState();
  });

  els.copyIpv6Btn?.addEventListener('click', async () => {
    if (!ipv6) {
      if (els.status) els.status.textContent = 'IP is unavailable right now.';
      return;
    }
    await navigator.clipboard.writeText(ipv6);
    els.copyIpv6Btn.textContent = 'Copied';
    if (els.status) els.status.textContent = 'After copying your IP, visit Step 4 of the following URL to get your access code.';
    setTimeout(() => {
      els.copyIpv6Btn.textContent = 'Copy';
    }, 1200);
  });

  els.connectBtn?.addEventListener('click', async () => {
    if (!hasMatch) return;
    if (!accessCode) {
      if (els.status) els.status.textContent = 'Unable to verify IP right now.';
      return;
    }
    if (els.codeInput.value.trim() !== accessCode) {
      if (els.status) els.status.textContent = 'Invalid code. Try again.';
      els.codeInput.focus();
      els.codeInput.select();
      return;
    }
    state.enabled = true;
    state.connected = true;
    state.proxyMode = true;
    state.proxyPacFingerprint = '';
    state.proxyFirstUntil = 0;
    state.proxyPhase = 'first';
    state.messageShown = !proxyPacDetected;
    state.messageTone = proxyPacDetected ? 'proxy-first' : 'ipv6';
    state.messageText = proxyPacDetected ? '' : ipv6ButtonMessage;
    state.buttonVisible = true;
    state.localProActivated = false;
    writePersistentActivation(false);
    await saveState(state);
    renderState();
    if (!proxyPacDetected) startProxyPacPolling();
    syncPage();
  });

  els.themeButtons?.querySelectorAll('button[data-theme]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.theme = button.dataset.theme || state.theme;
      await saveState(state);
      renderState();
      syncPage();
    });
  });

  els.fontButtons?.querySelectorAll('button[data-font]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.font = button.dataset.font || state.font;
      await saveState(state);
      renderState();
      syncPage();
    });
  });

  els.messageButton?.addEventListener('click', async () => {
    if (!state.connected) {
      if (els.status) els.status.textContent = 'Connect first, then activate.';
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
      await saveState(state);
      renderState();
      syncPage();
      return;
    }
    const refreshedProxyAccess = await proxy.loadProxyPacAccess();
    if (!refreshedProxyAccess) {
      showActivationBlocked();
      rememberBlockedProxyFingerprint(state.proxyPacFingerprint);
      await saveState(state);
      renderState();
      syncPage();
      return;
    }
    proxyAccess = refreshedProxyAccess;
    const fingerprint = proxyAccess.fingerprint || proxy.getProxyPacFingerprint(proxyAccess);
    if (isBlockedProxyFingerprint(fingerprint)) {
      state.proxyPacFingerprint = fingerprint;
      showActivationBlocked();
      await saveState(state);
      renderState();
      syncPage();
      return;
    }
    state.proxyPacFingerprint = fingerprint;
    proxyPacDetected = true;
    stopProxyPacPolling();
    showActivationSuccess();
    await saveState(state);
    renderState();
    scheduleActivationFallbackCheck();
    void activateLocalPro(proxyAccess.accessCode || accessCode);
    syncPage();
  });

  els.disconnectBtn?.addEventListener('click', async () => {
    state.enabled = false;
    state.connected = false;
    state.localProActivated = false;
    state.proxyMode = false;
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
    if (els.codeInput) els.codeInput.value = '';
    if (els.loader) els.loader.hidden = true;
    if (els.messageBox) els.messageBox.classList.add('hidden');
    await saveState(state);
    renderState();
    if (els.connectView) els.connectView.classList.remove('hidden');
    if (els.featureView) els.featureView.classList.add('hidden');
    if (els.status) els.status.textContent = 'Disconnected. You can connect again.';
    syncPage();
  });

  els.closeBtn?.addEventListener('click', () => window.close());
})();
