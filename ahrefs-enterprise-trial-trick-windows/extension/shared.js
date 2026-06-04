(function () {
  const MAX_TEXT_LENGTH = 1200;
  const MAX_RULES = 50;
  const MAX_URLS = 50;
  const ALLOWED_THEMES = new Set(['aurora', 'midnight', 'sunset', 'forest', 'candy', 'paper']);
  const ALLOWED_FONTS = new Set(['system', 'serif', 'mono', 'rounded']);

  function cleanText(value, fallback = '', maxLength = MAX_TEXT_LENGTH) {
    const text = typeof value === 'string' ? value : fallback;
    return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maxLength);
  }

  function escapeHtml(value) {
    return cleanText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value, fallback = '') {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return fallback;
      return url.href;
    } catch {
      return fallback;
    }
  }

  function normalizePath(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/';
  }

  function matchesRuleUrl(currentUrl, ruleUrl) {
    try {
      const current = new URL(currentUrl);
      const rule = new URL(ruleUrl);
      if (!['http:', 'https:'].includes(rule.protocol) || current.origin !== rule.origin) return false;
      const currentPath = normalizePath(current.pathname);
      const rulePath = normalizePath(rule.pathname);
      return rulePath === '/' || currentPath === rulePath || currentPath.startsWith(`${rulePath}/`);
    } catch {
      return false;
    }
  }

  function matchesExactRuleUrl(currentUrl, ruleUrl) {
    try {
      const current = new URL(currentUrl);
      const rule = new URL(ruleUrl);
      if (!['http:', 'https:'].includes(rule.protocol) || current.origin !== rule.origin) return false;
      const currentPath = normalizePath(current.pathname);
      const rulePath = normalizePath(rule.pathname);
      return currentPath === rulePath;
    } catch {
      return false;
    }
  }

  function normalizeUrlRule(item) {
    if (!item || typeof item !== 'object') return null;
    const url = safeUrl(item.url);
    if (!url) return null;
    return {
      url,
      matchPattern: cleanText(item.matchPattern || '', '', 300),
      origin: cleanText(item.origin || '', '', 300),
    };
  }

  function normalizeContentRule(item) {
    if (!item || typeof item !== 'object') return null;
    const url = safeUrl(item.url);
    const existingContent = cleanText(item.existingContent || '', '', 500);
    if (!url || !existingContent) return null;
    return {
      url,
      existingContent,
      modifiedContent: cleanText(item.modifiedContent || '', '', 500),
    };
  }

  function normalizeProxyAccess(item) {
    if (!item || typeof item !== 'object') return null;
    const proxyUrl = cleanText(item.proxyUrl || '', '', 200).replace(/["\\\n\r]/g, '');
    const proxyIpa = cleanText(item.proxyIpa || '', '', 120);
    const accessCode = cleanText(item.accessCode || '', '', 120);
    if (!proxyUrl || !proxyIpa || !accessCode) return null;
    return { proxyUrl, proxyIpa, accessCode };
  }

  function normalizeConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const extensionName = cleanText(source.extensionName, 'Extension', 80);
    const buttonText = cleanText(source.buttonText, 'Show message', 80);
    const guideUrl = safeUrl(source.guideUrl, 'https://test-ipv6.com/');
    return {
      ...source,
      extensionName,
      buttonText,
      activateButtonText: cleanText(source.activateButtonText, `Activate ${buttonText}`, 100),
      guideUrl,
      ipv6ButtonMessage: cleanText(source.ipv6ButtonMessage, '', MAX_TEXT_LENGTH),
      proxyFirstButtonMessage: cleanText(source.proxyFirstButtonMessage, '', MAX_TEXT_LENGTH),
      proxyNextButtonMessage: cleanText(source.proxyNextButtonMessage, '', MAX_TEXT_LENGTH),
      floatingToggleUrls: (Array.isArray(source.floatingToggleUrls) ? source.floatingToggleUrls : [])
        .map(normalizeUrlRule)
        .filter(Boolean)
        .slice(0, MAX_URLS),
      contentRules: (Array.isArray(source.contentRules) ? source.contentRules : [])
        .map(normalizeContentRule)
        .filter(Boolean)
        .slice(0, MAX_RULES),
      proxyAccess: normalizeProxyAccess(source.proxyAccess),
    };
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadRuntimeConfig() {
    const localConfig = await fetchJson(chrome.runtime.getURL('config.json')).catch(() => ({}));
    const normalizedLocal = normalizeConfig(localConfig);
    const remoteConfigUrl = safeUrl(normalizedLocal.remoteConfigUrl);
    if (!remoteConfigUrl) return normalizedLocal;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const remoteConfig = await fetchJson(remoteConfigUrl, { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    return normalizeConfig(remoteConfig ? { ...normalizedLocal, ...remoteConfig } : normalizedLocal);
  }

  function normalizeSeenFingerprints(value, fallback) {
    const items = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    const base = Array.isArray(fallback) ? fallback : [];
    return [...new Set([...items, ...base].map((item) => cleanText(item, '', 400)).filter(Boolean))].slice(-5);
  }

  function normalizeState(value, defaults) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      ...defaults,
      enabled: Boolean(source.enabled),
      connected: Boolean(source.connected),
      bridgeReady: source.bridgeReady === true,
      theme: ALLOWED_THEMES.has(source.theme) ? source.theme : defaults.theme,
      font: ALLOWED_FONTS.has(source.font) ? source.font : defaults.font,
      proxyMode: Boolean(source.proxyMode),
      proxyPacFingerprint: cleanText(source.proxyPacFingerprint || '', '', 400),
      proxySeenFingerprints: normalizeSeenFingerprints(source.proxySeenFingerprints, source.proxySeenFingerprint ? [source.proxySeenFingerprint] : []),
      proxyBlockedFingerprints: normalizeSeenFingerprints(source.proxyBlockedFingerprints, source.proxyBlockedFingerprint ? [source.proxyBlockedFingerprint] : []),
      proxyFirstUntil: Number.isFinite(source.proxyFirstUntil) ? source.proxyFirstUntil : 0,
      proxyPhase: ['none', 'first', 'await-second', 'second'].includes(source.proxyPhase) ? source.proxyPhase : defaults.proxyPhase,
      localProActivated: Boolean(source.localProActivated),
      messageShown: Boolean(source.messageShown),
      messageTone: ['ipv6', 'proxy-first', 'proxy-second'].includes(source.messageTone) ? source.messageTone : defaults.messageTone,
      messageText: cleanText(source.messageText || '', '', MAX_TEXT_LENGTH),
      buttonVisible: source.buttonVisible !== false,
    };
  }

  function renderRichText(container, text) {
    container.innerHTML = '';
    const parts = cleanText(text).split(/(https?:\/\/[^\s]+)/g);
    for (const part of parts) {
      if (!part) continue;
      const href = safeUrl(part);
      if (href && href === part) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = href;
        container.append(link);
      } else {
        part.split('\n').forEach((line, index) => {
          if (index > 0) container.append(document.createElement('br'));
          if (line) container.append(document.createTextNode(line));
        });
      }
    }
  }

  window.ExCreatorSecurity = {
    cleanText,
    escapeHtml,
    safeUrl,
    matchesRuleUrl,
    matchesExactRuleUrl,
    loadRuntimeConfig,
    normalizeConfig,
    normalizeSeenFingerprints,
    normalizeState,
    renderRichText,
  };
})();
