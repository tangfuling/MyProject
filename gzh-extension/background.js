const STORAGE_KEY = 'gzh_extension_state';

function setState(state) {
  chrome.storage.local.set({ [STORAGE_KEY]: state });
}

chrome.runtime.onInstalled.addListener(() => {
  setState({ stage: 'idle', message: '等待同步', progress: 0, synced: 0, total: 0 });
  chrome.storage.local.set({ gzhApiBase: 'http://127.0.0.1:8081' });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'trigger-sync') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'no-active-tab' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'start-sync' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, response });
      });
    });
    return true;
  }

  if (message?.type === 'sync-state') {
    setState(message.payload);
    chrome.runtime.sendMessage({ type: 'sync-state-broadcast', payload: message.payload });
  }

  if (message?.type === 'get-state') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      sendResponse(result[STORAGE_KEY] ?? null);
    });
    return true;
  }

  return undefined;
});
