(function setupHttpConfig(global) {
  const isDebug = false;
  const DEBUG_BASE_URL = 'http://127.0.0.1:8081';
  const RELEASE_BASE_URL = 'https://api-gzh.niumatech.com';
  const DEBUG_WEB_BASE_URL = 'http://localhost:5173';
  const RELEASE_WEB_BASE_URL = 'https://gzh.niumatech.com';
  const enablePluginLog = false;
  const logPrefix = '[tfling]';
  const contextInvalidatedRe = /extension context invalidated|invalidated|receiving end does not exist/i;
  const stageLabels = Object.freeze({
    need_login_web: '未登录',
    ready: '已登录 · 待同步',
    fetch_list: '同步中',
    fetch_detail: '同步中',
    upload: '同步中',
    done: '同步完成',
    login_expired: '登录过期',
    partial_failed: '部分失败',
    error: '失败',
    idle: '待同步',
  });
  const runningStages = Object.freeze(['fetch_list', 'fetch_detail', 'upload']);

  function getBaseUrl() {
    return isDebug ? DEBUG_BASE_URL : RELEASE_BASE_URL;
  }

  function getDefaultWebBase() {
    return isDebug ? DEBUG_WEB_BASE_URL : RELEASE_WEB_BASE_URL;
  }

  function isContextInvalidatedError(errorOrMessage) {
    const msg = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : String(errorOrMessage?.message || errorOrMessage || '');
    return contextInvalidatedRe.test(msg);
  }

  global.GzhHttpConfig = {
    isDebug,
    getBaseUrl,
    getDefaultWebBase,
    enablePluginLog,
    logPrefix,
    isContextInvalidatedError,
    stageLabels,
    runningStages,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
