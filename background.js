// Background — runs as a service worker (Chrome) or persistent scripts (Firefox).
// Extractors are loaded via manifest background.scripts; no importScripts needed.

const api = typeof browser !== 'undefined' ? browser : chrome;
const NATIVE_HOST = 'com.ytdl_queue.host';
const DEFAULT_QUEUE_DIR = '~/.local/share/ytdl-queue-ext/queue';
const DEBUG_LOG = '~/.local/share/ytdl-queue-ext/debug.log';

function dbgLog(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.log(line);
  // fire-and-forget — don't await, don't block callers
  nativeSend({ action: 'append', path: DEBUG_LOG, line }).catch(() => {});
}

// ─── Message routing ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'PAGE_DETECTED':
      dbgLog('router: PAGE_DETECTED from tab=%s url=%s injectJson=%s',
        sender.tab?.id, msg.url, msg.injectJson ? 'present' : 'null');
      handlePageDetected(sender.tab.id, msg.url, msg.injectJson).then(sendResponse);
      return true;

    case 'GET_PAGE_STATE':
      getPageState(msg.tabId).then(sendResponse);
      return true;

    case 'FETCH_INFO':
      handleFetchInfo(msg.tabId).then(sendResponse);
      return true;

    case 'FETCH_EPISODE_FORMATS':
      handleFetchEpisodeFormats(msg.tabId, msg.episodeId).then(sendResponse);
      return true;

    case 'QUEUE_BATCH':
      handleQueueBatch(msg).then(sendResponse);
      return true;

    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab?.id });
      return true;

    case 'LOG':
      dbgLog(msg.line);
      break;
  }
});

// Clean up when tab closes
api.tabs.onRemoved.addListener((tabId) => {
  api.storage.local.remove(`tab_${tabId}`);
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handlePageDetected(tabId, url, injectJson) {
  dbgLog('PAGE_DETECTED tabId=%s url=%s injectJsonFromContent=%s', tabId, url, injectJson ? 'YES' : 'NO');

  const extractor = EXTRACTORS.match(url);
  if (!extractor) {
    dbgLog('no extractor matched url=%s', url);
    return { ok: false };
  }
  dbgLog('extractor matched: %s', extractor.name);

  // Firefox sends injectJson via wrappedJSObject in content.js.
  // Chrome doesn't have wrappedJSObject, so fall back to scripting.executeScript.
  if (!injectJson) {
    dbgLog('injectJson not from content, trying scripting.executeScript world:MAIN');
    let results;
    try {
      results = await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => window.injectJson,
      });
    } catch (e) {
      dbgLog('scripting.executeScript failed: %s', e.message);
      return { ok: false, error: e.message };
    }
    injectJson = results?.[0]?.result;
    dbgLog('scripting.executeScript result: %s', injectJson ? 'got object' : 'null/undefined');
  }

  if (!injectJson) {
    dbgLog('injectJson is null after both paths');
    return { ok: false, error: 'window.injectJson not found on page' };
  }

  dbgLog('injectJson top-level keys: %s', Object.keys(injectJson).join(', '));
  const pageState = extractor.processPageData(injectJson, url);
  if (!pageState) {
    dbgLog('processPageData returned null — pConfig keys: %s',
      JSON.stringify(Object.keys(injectJson?.config?.[0]?.pConfig || {})));
    return { ok: false, error: 'Could not extract signing keys' };
  }
  dbgLog('pageState OK: videoId=%s episodeId=%s pubKey=%s',
    pageState.videoId, pageState.episodeId,
    pageState.publicKey ? pageState.publicKey.slice(0, 8) + '…' : 'MISSING');

  await storePageState(tabId, pageState);
  return { ok: true };
}

async function storePageState(tabId, pageState) {
  await api.storage.local.set({ [`tab_${tabId}`]: pageState });
  await api.action.setBadgeText({ text: '▶', tabId });
  await api.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId });
  await api.action.setTitle({
    title: `yt-dlp Queue — ${pageState.extractor}`,
    tabId,
  });
}

async function getPageState(tabId) {
  const data = await api.storage.local.get(`tab_${tabId}`);
  return data[`tab_${tabId}`] || null;
}

async function handleFetchInfo(tabId) {
  dbgLog('FETCH_INFO tabId=%s', tabId);
  try {
    const pageState = await getPageState(tabId);
    if (!pageState) {
      dbgLog('FETCH_INFO: no pageState for tab %s', tabId);
      return { error: 'No page data. Reload the page and try again.' };
    }
    dbgLog('FETCH_INFO: pageState extractor=%s videoId=%s', pageState.extractor, pageState.videoId);

    const extractor = EXTRACTORS.get(pageState.extractor);
    if (!extractor) return { error: `Unknown extractor: ${pageState.extractor}` };

    const cookieStr = await getCookieStr(pageState.cookieDomain);
    const cookieNames = cookieStr.split('; ').map(c => c.split('=')[0]).filter(Boolean);
    dbgLog('FETCH_INFO: iyf.tv cookie names: %s', cookieNames.join(', '));
    const m10Cookies = await api.cookies.getAll({ domain: 'm10.iyf.tv' });
    dbgLog('FETCH_INFO: m10.iyf.tv cookies: %s', m10Cookies.length ? m10Cookies.map(c => c.name).join(', ') : '(none)');
    const apiFetch = (url, headers) => fetchViaTab(tabId, url, headers);
    const onProgress = (label) => {
      api.tabs.sendMessage(tabId, { type: 'FETCH_PROGRESS', label }).catch(() => {});
    };
    const info = await extractor.fetchInfo(pageState, cookieStr, apiFetch, onProgress);

    // Cache the full info alongside page state for buildQueueEntry later
    await api.storage.local.set({
      [`info_${tabId}`]: { info, pageState, cookieStr },
    });

    return { ok: true, info };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleFetchEpisodeFormats(tabId, episodeId) {
  try {
    const cached = await api.storage.local.get(`info_${tabId}`);
    const entry = cached[`info_${tabId}`];
    if (!entry) return { error: 'Fetch series info first.' };

    const { pageState, cookieStr } = entry;
    const extractor = EXTRACTORS.get(pageState.extractor);
    const apiFetch = (url, headers) => fetchViaTab(tabId, url, headers);
    const formats = await extractor.fetchEpisodeFormats(pageState, episodeId, cookieStr, apiFetch);

    // Update cached formats for the new episode
    entry.info.currentEpisodeId = episodeId;
    entry.info.formats = formats;
    await api.storage.local.set({ [`info_${tabId}`]: entry });

    return { ok: true, formats };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleQueueBatch(msg) {
  try {
    const { tabId, formatId, episodes } = msg; // episodes: [{episodeId, formats}]

    const cached = await api.storage.local.get(`info_${tabId}`);
    const entry = cached[`info_${tabId}`];
    if (!entry) return { error: 'Fetch series info first.' };

    const { info, pageState, cookieStr } = entry;
    const extractor = EXTRACTORS.get(pageState.extractor);
    const { seriesId, entries, cookiesText, queueMeta } = extractor.buildBatchQueueEntry(info, pageState, cookieStr, episodes, formatId);

    const settings = await api.storage.sync.get({ queueDir: DEFAULT_QUEUE_DIR });
    const base          = sanitize(pageState.extractor) + '_' + sanitize(seriesId);
    const infoFilename  = base + '.info.json';
    const cookFilename  = base + '.cookies.txt';
    const queueFilename = base + '.queue.json';

    // Embed the absolute paths into the queue manifest now that we know queueDir
    queueMeta.files = {
      info_json: settings.queueDir + '/' + infoFilename,
      cookies:   settings.queueDir + '/' + cookFilename,
    };

    dbgLog('QUEUE_BATCH dir=%s files=%s cookiesTextLen=%s',
      settings.queueDir, [infoFilename, cookFilename, queueFilename].join(', '),
      cookiesText?.length ?? 'UNDEFINED');

    const writeResult = await nativeSend({
      action: 'write',
      dir:    settings.queueDir,
      files: [
        { filename: infoFilename,  content: JSON.stringify(entries,   null, 2) },
        { filename: cookFilename,  content: cookiesText },
        { filename: queueFilename, content: JSON.stringify(queueMeta, null, 2) },
      ],
    });

    dbgLog('QUEUE_BATCH write result=%s', JSON.stringify(writeResult));

    return {
      ok: true,
      filename:    infoFilename,
      path:        settings.queueDir + '/' + infoFilename,
      cookiesPath: settings.queueDir + '/' + cookFilename,
      queuePath:   settings.queueDir + '/' + queueFilename,
    };
  } catch (e) {
    dbgLog('QUEUE_BATCH error=%s', e.message);
    return { error: e.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Proxy the API fetch through the content script running in the tab.
// Content scripts run in the browser's content process — same TLS fingerprint
// as real page fetches — and their cross-origin requests to hosts covered by
// host_permissions bypass CORS. Falls back to background fetch if the tab
// has no content script (e.g., not yet loaded).
async function fetchViaTab(tabId, url, headers) {
  try {
    dbgLog('fetchViaTab (content proxy) url=%s', url.slice(0, 100));
    const result = await new Promise((resolve, reject) => {
      api.tabs.sendMessage(tabId, { type: 'FETCH_API', url, headers }, (response) => {
        const err = api.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!response) return reject(new Error('null response from content script'));
        if (response.error) return reject(new Error(response.error));
        resolve(response);
      });
    });
    dbgLog('content fetch status=%s len=%s first80=%s',
      result.status, result.text.length, result.text.slice(0, 80));
    return result;
  } catch (e) {
    dbgLog('content fetch failed (%s), falling back to background fetch', e.message);
    const res = await fetch(url, { headers });
    const text = await res.text();
    dbgLog('bgFetch status=%s len=%s first80=%s', res.status, text.length, text.slice(0, 80));
    return { status: res.status, text };
  }
}

async function getCookieStr(domain) {
  const cookies = await api.cookies.getAll({ domain });
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function nativeSend(payload) {
  return new Promise((resolve, reject) => {
    api.runtime.sendNativeMessage(NATIVE_HOST, payload, (response) => {
      const err = api.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

function sanitize(str) {
  return str.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}
