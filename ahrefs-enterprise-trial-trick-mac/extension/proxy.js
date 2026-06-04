(function () {
  const security = window.ExCreatorSecurity;

  function expandIPv6(ipv6) {
    const raw = String(ipv6 || '').trim().toLowerCase();
    const [headRaw = '', tailRaw = ''] = raw.split('::');
    const headParts = headRaw ? headRaw.split(':').filter(Boolean) : [];
    const tailParts = tailRaw ? tailRaw.split(':').filter(Boolean) : [];
    const fill = Math.max(0, 8 - (headParts.length + tailParts.length));
    return [...headParts, ...Array(fill).fill('0'), ...tailParts]
      .slice(0, 8)
      .map((part) => part.padStart(4, '0'))
      .join(':');
  }

  function bytesToCode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '^').replace(/\//g, '%').replace(/=/g, '');
  }

  function codeToBytes(code) {
    const b64 = String(code || '').replace(/\^/g, '+').replace(/%/g, '/');
    return Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  }

  async function encodeIP(ip) {
    const raw = String(ip || '').trim();
    if (!raw) return '';
    if (raw.includes('.')) {
      const parts = raw.split('.').map(Number);
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return '';
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(parts));
      const padding = Array.from(new Uint8Array(digest)).slice(0, 12);
      return bytesToCode([4, ...parts, ...padding]);
    }
    const hex = expandIPv6(raw).split(':').map((x) => x.padStart(4, '0')).join('');
    if (!hex || hex.length < 32) return '';
    const bytes = hex.match(/.{2}/g).map((part) => parseInt(part, 16));
    return bytesToCode([6, ...bytes]);
  }

  function decodeIP(code) {
    const bytes = codeToBytes(code);
    const version = bytes[0];
    if (version === 4) return Array.from(bytes.slice(1, 5)).join('.');
    const hex = Array.from(bytes.slice(1)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex.match(/.{4}/g)?.join(':') || '';
  }

  function parseProxyPac(text) {
    const clean = security?.cleanText || ((value) => String(value || ''));
    const getValue = (key) => {
      const match = String(text || '').match(new RegExp(`^//\\s*${key}=(.*)$`, 'm'));
      return match ? clean(match[1].trim(), '', 220).replace(/["\\\n\r]/g, '') : '';
    };
    return {
      proxyUrl: getValue('EX_CREATOR_PROXY_URL'),
      proxyIpa: getValue('EX_CREATOR_PROXY_IPA'),
      accessCode: getValue('EX_CREATOR_ACCESS_CODE'),
    };
  }

  function makeProxyFingerprint(proxyAccess) {
    return [proxyAccess.proxyUrl, proxyAccess.proxyIpa, proxyAccess.accessCode].join('|');
  }

  async function loadProxyPacAccess() {
    try {
      const response = await fetch(chrome.runtime.getURL('proxy.pac'), { cache: 'no-store' });
      if (!response.ok) return null;
      const proxyAccess = parseProxyPac(await response.text());
      if (!proxyAccess.proxyIpa || !proxyAccess.accessCode) return null;
      return {
        ...proxyAccess,
        fingerprint: makeProxyFingerprint(proxyAccess),
        valid: await encodeIP(proxyAccess.proxyIpa) === proxyAccess.accessCode,
      };
    } catch {
      return null;
    }
  }

  async function hasProxyPac() {
    try {
      const response = await fetch(chrome.runtime.getURL('proxy.pac'), { cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  }

  function randomProxyFirstDuration() {
    return 30000 + Math.floor(Math.random() * 10001);
  }

  function getProxyPacFingerprint(proxyAccess) {
    return makeProxyFingerprint(proxyAccess);
  }

  async function fetchIPCode() {
    try {
      const response = await fetch('https://api64.ipify.org?format=json')
        .then((r) => r.json())
        .catch(() => fetch('https://api6.ipify.org?format=json').then((r) => r.json()));
      return response?.ip || '';
    } catch {
      return '';
    }
  }

  window.ExCreatorProxy = {
    decodeIP,
    encodeIP,
    fetchIPCode,
    hasProxyPac,
    getProxyPacFingerprint,
    loadProxyPacAccess,
    randomProxyFirstDuration,
  };
})();
