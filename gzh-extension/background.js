importScripts('http-config.js');

const STORAGE_KEY = 'gzh_extension_state';
const HTTP_CONFIG = globalThis.GzhHttpConfig;
if (!HTTP_CONFIG) {
  throw new Error('GzhHttpConfig is required.');
}
const API_BASE_URL = HTTP_CONFIG.getBaseUrl();
const ALLOWED_PROXY_PREFIX = `${API_BASE_URL}/`;
const LOG_PREFIX = '[tfling]';

function bgLog(level, message, payload) {
  if (String(level || '').toLowerCase() === 'info') {
    return;
  }
  const fn = typeof console?.[level] === 'function' ? console[level] : console.log;
  if (payload === undefined) {
    fn(`${LOG_PREFIX} ${message}`);
    return;
  }
  fn(`${LOG_PREFIX} ${message}`, payload);
}

function isAllowedProxyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  return rawUrl.startsWith(ALLOWED_PROXY_PREFIX);
}

function setState(state) {
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
      if (chrome.runtime.lastError) {
        bgLog('warn', 'bg setState failed', chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    bgLog('warn', 'bg setState threw', error?.message || error);
  }
}

function safeRespond(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (error) {
    bgLog('warn', 'bg sendResponse failed', error?.message || error);
  }
}

function safeBroadcast(payload) {
  try {
    chrome.runtime.sendMessage(payload, () => {
      if (chrome.runtime.lastError) {
        // No receiver is normal when popup/content-script is not open.
      }
    });
  } catch (error) {
    bgLog('warn', 'bg broadcast threw', error?.message || error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setState({ stage: 'idle', message: 'Waiting sync', progress: 0, synced: 0, total: 0 });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
  if (message?.type === 'trigger-sync') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        const state = { stage: 'error', message: '未找到当前页面，请重试', progress: 0, synced: 0, total: 0 };
        setState(state);
        safeBroadcast({ type: 'sync-state-broadcast', payload: state });
        safeRespond(sendResponse, { ok: false, error: 'no-active-tab' });
        return;
      }
      if (!tab.url || !tab.url.includes('https://mp.weixin.qq.com')) {
        const state = {
          stage: 'login_expired',
          message: '请先打开并登录微信公众号后台页面后再同步',
          progress: 0,
          synced: 0,
          total: 0,
        };
        setState(state);
        safeBroadcast({ type: 'sync-state-broadcast', payload: state });
        safeRespond(sendResponse, { ok: false, error: 'not-mp-page' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'start-sync' }, (response) => {
        if (chrome.runtime.lastError) {
          const state = {
            stage: 'login_expired',
            message: '微信后台登录已过期，请刷新页面后重试',
            progress: 0,
            synced: 0,
            total: 0,
          };
          setState(state);
          safeBroadcast({ type: 'sync-state-broadcast', payload: state });
          safeRespond(sendResponse, { ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        safeRespond(sendResponse, { ok: true, response });
      });
    });
    return true;
  }

  if (message?.type === 'sync-state') {
    setState(message.payload);
    safeBroadcast({ type: 'sync-state-broadcast', payload: message.payload });
    if (message.payload?.stage === 'done' || message.payload?.stage === 'partial_failed') {
      bgLog('info', 'sync state summary', {
        stage: message.payload?.stage,
        total: message.payload?.total,
        synced: message.payload?.synced,
        failedMetrics: message.payload?.failedMetrics ?? 0,
        failedContent: message.payload?.failedContent ?? 0,
        failedUpload: message.payload?.failedUpload ?? 0,
        uploadedSnapshots: message.payload?.uploadedSnapshots ?? 0,
        uploadedSnapshotsWithMetrics: message.payload?.uploadedSnapshotsWithMetrics ?? 0,
      });
    }
    return undefined;
  }

  if (message?.type === 'proxy-fetch-json') {
    const payload = message.payload || {};
    const url = payload.url || '';
    if (!isAllowedProxyUrl(url)) {
      safeRespond(sendResponse, { ok: false, error: 'proxy url not allowed' });
      return undefined;
    }

    const requestInit = {
      method: payload.method || 'GET',
      headers: payload.headers || {},
      body: payload.body || undefined,
      credentials: 'omit',
      redirect: 'follow',
    };

    fetch(url, requestInit)
      .then(async (resp) => {
        const text = await resp.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }
        safeRespond(sendResponse, {
          ok: true,
          status: resp.status,
          httpOk: resp.ok,
          body,
        });
      })
      .catch((error) => {
        safeRespond(sendResponse, { ok: false, error: error?.message || 'proxy fetch failed' });
      });
    return true;
  }

  if (message?.type === 'get-state') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      safeRespond(sendResponse, result[STORAGE_KEY] ?? null);
    });
    return true;
  }

  return undefined;
  } catch (error) {
    bgLog('error', 'bg onMessage crash', {
      type: message?.type,
      error: error?.message || String(error),
      stack: error?.stack || '',
    });
    safeRespond(sendResponse, { ok: false, error: error?.message || 'background crashed' });
    return undefined;
  }
});

self.addEventListener('unhandledrejection', (event) => {
  bgLog('error', 'bg unhandledrejection', event?.reason || event);
});

self.addEventListener('error', (event) => {
  bgLog('error', 'bg error', {
    message: event?.message,
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
  });
});
