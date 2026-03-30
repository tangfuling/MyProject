(() => {
  const STATE = {
    syncing: false,
  };

  const BTN_ID = 'gzh-sync-floating-btn';

  function notifyState(payload) {
    chrome.runtime.sendMessage({
      type: 'sync-state',
      payload: {
        stage: payload.stage,
        message: payload.message,
        progress: payload.progress ?? 0,
        synced: payload.synced ?? 0,
        total: payload.total ?? 0,
        newArticles: payload.newArticles ?? 0,
        updatedArticles: payload.updatedArticles ?? 0,
        failedMetrics: payload.failedMetrics ?? 0,
        failedContent: payload.failedContent ?? 0,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  function createButton() {
    if (document.getElementById(BTN_ID)) {
      return;
    }
    const button = document.createElement('button');
    button.id = BTN_ID;
    button.textContent = '📊 同步到运营助手';
    button.style.position = 'fixed';
    button.style.right = '20px';
    button.style.bottom = '20px';
    button.style.zIndex = '999999';
    button.style.border = 'none';
    button.style.background = '#0f766e';
    button.style.color = '#fff';
    button.style.padding = '10px 14px';
    button.style.borderRadius = '999px';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 8px 18px rgba(0,0,0,0.2)';
    button.addEventListener('click', () => {
      void startSync();
    });
    document.body.appendChild(button);
  }

  async function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result));
    });
  }

  async function setStorage(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, () => resolve());
    });
  }

  function parseTokenFromUrl() {
    const match = window.location.href.match(/[?&]token=(\d+)/);
    return match ? match[1] : '';
  }

  async function startSync() {
    if (STATE.syncing) {
      return;
    }
    STATE.syncing = true;
    try {
      const token = parseTokenFromUrl();
      if (!token) {
        notifyState({
          stage: 'login_expired',
          message: '微信后台登录已过期，请刷新页面重新登录微信公众平台后再同步',
          progress: 0,
        });
        return;
      }

      const storage = await getStorage(['gzhAuthToken', 'gzhApiBase', 'gzhSyncedArticleIds']);
      const authToken = storage.gzhAuthToken;
      const apiBase = storage.gzhApiBase || 'http://127.0.0.1:8081';
      const syncedArticleIds = storage.gzhSyncedArticleIds || {};

      if (!authToken) {
        notifyState({
          stage: 'need_login_web',
          message: '请先前往运营助手登录，才能同步数据',
          progress: 0,
        });
        return;
      }

      notifyState({ stage: 'fetch_list', message: '正在读取文章列表...', progress: 5 });
      const articles = await fetchAllArticles(token);

      if (articles.length === 0) {
        const lastSync = {
          updatedAt: new Date().toISOString(),
          total: 0,
          synced: 0,
          newArticles: 0,
          updatedArticles: 0,
          failedMetrics: 0,
          failedContent: 0,
        };
        await setStorage({ gzhLastSync: lastSync });
        notifyState({ stage: 'done', message: '没有读取到可同步文章', progress: 100, total: 0, synced: 0 });
        return;
      }

      const snapshots = [];
      const syncArticles = [];
      const mergedIds = { ...syncedArticleIds };
      let failedMetrics = 0;
      let failedContent = 0;

      for (let index = 0; index < articles.length; index += 1) {
        const article = articles[index];
        const isNew = !mergedIds[article.wxArticleId];

        notifyState({
          stage: 'fetch_detail',
          message: `${isNew ? '新文章' : '旧文章'}：${index + 1}/${articles.length}`,
          progress: Math.round(((index + 1) / articles.length) * 70) + 10,
          total: articles.length,
          synced: index,
        });

        const metrics = await fetchArticleMetrics(token, article).catch(() => {
          failedMetrics += 1;
          return {};
        });

        if (isNew) {
          const content = await fetchArticleContent(article.contentUrl).catch(() => {
            failedContent += 1;
            return '';
          });
          syncArticles.push({
            wxArticleId: article.wxArticleId,
            title: article.title,
            content,
            wordCount: content.length,
            publishTime: article.publishTime,
          });
        }

        snapshots.push({
          wxArticleId: article.wxArticleId,
          readCount: metrics.readCount || 0,
          shareCount: metrics.shareCount || 0,
          likeCount: metrics.likeCount || 0,
          wowCount: metrics.wowCount || 0,
          commentCount: metrics.commentCount || 0,
          saveCount: metrics.saveCount || 0,
          completionRate: metrics.completionRate || 0,
          trafficSources: metrics.trafficSources || {},
          newFollowers: metrics.newFollowers || 0,
        });

        mergedIds[article.wxArticleId] = true;
      }

      notifyState({ stage: 'upload', message: '正在上传到后端...', progress: 92, total: articles.length, synced: articles.length });

      const response = await fetch(`${apiBase}/sync/articles`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ articles: syncArticles, snapshots }),
      });

      const json = await response.json();
      if (!response.ok || json.code !== 0) {
        throw new Error(json.message || '同步上传失败');
      }

      const newArticles = json.data?.newArticles ?? 0;
      const updatedArticles = json.data?.updatedArticles ?? 0;
      const lastSync = {
        updatedAt: new Date().toISOString(),
        total: articles.length,
        synced: articles.length,
        newArticles,
        updatedArticles,
        failedMetrics,
        failedContent,
      };

      await setStorage({ gzhSyncedArticleIds: mergedIds, gzhLastSync: lastSync });

      const failedCount = failedMetrics + failedContent;
      if (failedCount > 0) {
        notifyState({
          stage: 'partial_failed',
          message: `同步部分完成：新增 ${newArticles}，更新 ${updatedArticles}，失败 ${failedCount}`,
          progress: 100,
          total: articles.length,
          synced: articles.length,
          newArticles,
          updatedArticles,
          failedMetrics,
          failedContent,
        });
        return;
      }

      notifyState({
        stage: 'done',
        message: `同步完成：新增 ${newArticles}，更新 ${updatedArticles}`,
        progress: 100,
        total: articles.length,
        synced: articles.length,
        newArticles,
        updatedArticles,
      });
    } catch (error) {
      notifyState({ stage: 'error', message: error.message || '同步失败', progress: 0 });
    } finally {
      STATE.syncing = false;
    }
  }

  async function fetchAllArticles(token) {
    const all = [];
    let begin = 0;
    const pageSize = 10;

    while (begin < 1000) {
      const url = `/cgi-bin/appmsgpublish?sub=list&begin=${begin}&count=${pageSize}&token=${token}&lang=zh_CN&f=json&ajax=1`;
      const response = await fetch(url, { credentials: 'include' });
      const json = await response.json();
      const publishPage = parseMaybeJson(json.publish_page) || {};
      const publishList = publishPage.publish_list || [];
      if (publishList.length === 0) {
        break;
      }

      const parsed = publishList.flatMap((item) => {
        const info = parseMaybeJson(item.publish_info) || {};
        const appmsgList = info.appmsgex || [];
        return appmsgList.map((article) => {
          const articleUrl = article.link || article.content_url || '';
          const wxArticleId = article.aid || article.appmsgid || articleUrl || `${article.title}-${article.create_time}`;
          const publishTs = article.create_time || item.publish_time || Math.floor(Date.now() / 1000);
          return {
            wxArticleId: String(wxArticleId),
            title: article.title || '未命名文章',
            contentUrl: articleUrl,
            publishTime: new Date(publishTs * 1000).toISOString(),
          };
        });
      });

      all.push(...parsed);
      begin += pageSize;
      if (publishList.length < pageSize) {
        break;
      }
    }

    return dedupeById(all);
  }

  async function fetchArticleMetrics(token, article) {
    const msgId = String(article.wxArticleId).split('_')[0];
    const publishDate = article.publishTime.slice(0, 10).replace(/-/g, '');
    const url = `/misc/appmsganalysis?action=detailpage&msgid=${msgId}_1&publish_date=${publishDate}&token=${token}&lang=zh_CN&f=json&ajax=1`;
    const response = await fetch(url, { credentials: 'include' });
    const json = await response.json();

    return {
      readCount: Number(json.int_page_read_user || json.read_num || 0),
      shareCount: Number(json.share_user || json.share_count || 0),
      likeCount: Number(json.like_num || 0),
      wowCount: Number(json.old_like_num || json.wow_num || 0),
      commentCount: Number(json.comment_id_count || 0),
      saveCount: Number(json.fav_num || json.save_count || 0),
      completionRate: Number(json.complete_read_rate || 0),
      trafficSources: {
        '公众号消息': Number(json.frommsg || 0),
        '朋友圈': Number(json.fromfeed || 0),
        '搜一搜': Number(json.fromsogou || 0),
        '推荐': Number(json.fromrecommend || 0),
      },
      newFollowers: Number(json.new_fans || 0),
    };
  }

  async function fetchArticleContent(url) {
    if (!url) {
      return '';
    }
    const response = await fetch(url, { credentials: 'include' });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return (doc.body?.innerText || '').trim().slice(0, 20000);
  }

  function parseMaybeJson(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function dedupeById(items) {
    const map = new Map();
    items.forEach((item) => {
      map.set(item.wxArticleId, item);
    });
    return Array.from(map.values());
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'start-sync') {
      void startSync();
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });

  createButton();
})();
