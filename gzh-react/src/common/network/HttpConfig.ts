const isDebug = false;
const DEBUG_BASE_URL = 'http://127.0.0.1:8081';
const RELEASE_BASE_URL = 'https://api-gzh.niumatech.com';

function getBaseUrl() {
  return isDebug ? DEBUG_BASE_URL : RELEASE_BASE_URL;
}

export const HttpConfig = {
  getBaseUrl,
};
