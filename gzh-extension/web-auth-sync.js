(() => {
  const TOKEN_KEY = 'gzh_token';
  const PROFILE_KEY = 'gzh_profile';
  const LOGOUT_FLAG_KEY = 'gzh_logout_flag';
  const CONTEXT_INVALIDATED_RE = /extension context invalidated|invalidated|receiving end does not exist/i;

  let lastToken = '__init__';
  let lastProfileRaw = '__init__';
  let lastLogoutFlag = '__init__';

  function isRuntimeAvailable() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function isContextInvalidatedError(errorOrMessage) {
    const msg = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : String(errorOrMessage?.message || errorOrMessage || '');
    return CONTEXT_INVALIDATED_RE.test(msg);
  }

  function parseProfile(raw) {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function pushAuthToken(token, profileRaw) {
    const profile = parseProfile(profileRaw);
    const payload = {
      gzhAuthToken: token || '',
      gzhAuthProfile: profile || null,
    };
    if (!isRuntimeAvailable() || !chrome.storage?.local) {
      return;
    }
    try {
      chrome.storage.local.set(payload, () => {
        const err = chrome.runtime?.lastError;
        if (err && !isContextInvalidatedError(err.message)) {
          console.warn('[gzh-extension] web-auth-sync storage.set failed', err.message);
        }
      });
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        console.warn('[gzh-extension] web-auth-sync storage.set threw', error);
      }
    }
  }

  function syncFromWebStorage() {
    let token = '';
    let profileRaw = '';
    let logoutFlag = '';
    try {
      token = localStorage.getItem(TOKEN_KEY) || '';
      profileRaw = localStorage.getItem(PROFILE_KEY) || '';
      logoutFlag = localStorage.getItem(LOGOUT_FLAG_KEY) || '';
    } catch {
      return;
    }

    if (token === lastToken && profileRaw === lastProfileRaw && logoutFlag === lastLogoutFlag) {
      return;
    }

    lastToken = token;
    lastProfileRaw = profileRaw;
    lastLogoutFlag = logoutFlag;

    if (token) {
      pushAuthToken(token, profileRaw);
      return;
    }

    // Keep extension login state when web storage is empty (e.g. browser clears site data on exit).
    // Only clear extension auth if web explicitly marked logout.
    if (logoutFlag) {
      pushAuthToken('', '');
    }
  }

  syncFromWebStorage();
  window.setInterval(syncFromWebStorage, 1000);
  window.addEventListener('focus', syncFromWebStorage);
  window.addEventListener('beforeunload', syncFromWebStorage);
  window.addEventListener('pagehide', syncFromWebStorage);
  document.addEventListener('visibilitychange', () => {
    syncFromWebStorage();
  });
})();
