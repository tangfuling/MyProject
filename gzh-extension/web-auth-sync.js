(() => {
  const TOKEN_KEY = 'gzh_token';
  const PROFILE_KEY = 'gzh_profile';

  let lastToken = '__init__';
  let lastProfileRaw = '__init__';

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
    chrome.storage.local.set(payload);
  }

  function syncFromWebStorage() {
    let token = '';
    let profileRaw = '';
    try {
      token = localStorage.getItem(TOKEN_KEY) || '';
      profileRaw = localStorage.getItem(PROFILE_KEY) || '';
    } catch {
      return;
    }

    if (token === lastToken && profileRaw === lastProfileRaw) {
      return;
    }

    lastToken = token;
    lastProfileRaw = profileRaw;
    pushAuthToken(token, profileRaw);
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
