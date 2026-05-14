// Content script — runs at document_idle.
// window.injectJson is reset to {} by Nuxt hydration before document_idle fires.
// Instead we read the original data from the <script> tag's raw text (same as
// yt-dlp's _search_json on the raw HTML) using a brace-matching extractor.

const api = typeof browser !== 'undefined' ? browser : chrome;

function relay(msg) {
  api.runtime.sendMessage({ type: 'LOG', line: '[content] ' + msg }).catch(() => {});
}

// ─── Page-data extraction ─────────────────────────────────────────────────────

function extractJsonObject(text, from) {
  let i = from;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (esc)                 { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"')           { inStr = !inStr; continue; }
    if (inStr)               continue;
    if (c === '{')           depth++;
    else if (c === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}

function findInjectJson() {
  const scripts = document.querySelectorAll('script:not([src])');
  relay('scanning ' + scripts.length + ' inline script tags');
  for (const script of scripts) {
    const text = script.textContent;
    const idx = text.search(/injectJson\s*=/);
    if (idx === -1) continue;
    relay('found "injectJson =" in script of length ' + text.length);
    const eqIdx = text.indexOf('=', idx) + 1;
    const jsonStr = extractJsonObject(text, eqIdx);
    if (!jsonStr) { relay('brace extraction failed'); continue; }
    relay('extracted JSON length=' + jsonStr.length + ' first200=' + jsonStr.slice(0, 200));
    try { return JSON.parse(jsonStr); }
    catch (e) { relay('JSON.parse failed: ' + e.message + ' — skipping'); }
  }
  relay('no script tag with injectJson found');
  return null;
}

// ─── API fetch proxy + progress receiver ─────────────────────────────────────
// Must be at file level (not inside an async IIFE) so the listener is always active.

let _progressUpdate = null; // set by loadPanel while FETCH_INFO is in flight

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_PROGRESS') {
    _progressUpdate?.(msg.label);
    return false;
  }
  if (msg.type !== 'FETCH_API') return false;
  relay('fetching ' + msg.url.slice(0, 100));
  fetch(msg.url, { headers: msg.headers, credentials: 'include' })
    .then(async (res) => {
      const text = await res.text();
      relay('status=' + res.status + ' len=' + text.length + ' first80=' + text.slice(0, 80));
      sendResponse({ status: res.status, text });
    })
    .catch((e) => {
      relay('fetch error: ' + e.message);
      sendResponse({ error: e.message });
    });
  return true;
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const injectJson = findInjectJson();
  relay('result: ' + (injectJson
    ? 'present, keys=' + Object.keys(injectJson).join(', ')
    : 'null'));

  const detected = await api.runtime.sendMessage({
    type: 'PAGE_DETECTED', url: location.href, injectJson,
  });

  if (!detected?.ok) { relay('page not supported, no bubble'); return; }

  const { tabId } = await api.runtime.sendMessage({ type: 'GET_TAB_ID' });
  relay('page supported, tabId=' + tabId + ', injecting bubble');
  injectBubble(tabId);
})();

// ─── Bubble UI ────────────────────────────────────────────────────────────────

function injectBubble(tabId) {
  let panelOpen   = false;
  let panelLoaded = false;
  let seriesInfo  = null;
  let currentFormats     = [];
  let selectedEpisodeIds = new Set();
  let savedPath          = null;

  // Host lives outside the Shadow DOM so click-outside detection works
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    #toggle {
      width: 44px; height: 44px; border-radius: 50%;
      background: #e74c3c; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: background 0.15s; flex-shrink: 0;
    }
    #toggle:hover { background: #c0392b; }
    #toggle svg { width: 22px; height: 22px; fill: #fff; }

    #panel {
      width: 380px; max-height: 560px;
      background: #1a1a1a; color: #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      margin-bottom: 8px;
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
      overflow: hidden; display: flex; flex-direction: column;
    }
    #panel.hidden { display: none !important; }

    .hidden { display: none !important; }
    .muted  { color: #888; }
    .small  { font-size: 11px; }
    .state  { padding: 16px; text-align: center; }

    .spinner {
      width: 24px; height: 24px;
      border: 3px solid #444; border-top-color: #e74c3c;
      border-radius: 50%; animation: spin 0.7s linear infinite;
      margin: 0 auto 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-msg { color: #e74c3c; line-height: 1.4; }

    #series-header {
      display: flex; gap: 10px;
      padding: 12px 12px 8px;
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }
    #series-thumb { width: 64px; height: 42px; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
    #series-meta  { display: flex; flex-direction: column; justify-content: center; gap: 3px; }
    #series-title { font-weight: 600; font-size: 14px; line-height: 1.3; }
    #series-count { font-size: 11px; color: #888; }

    .section-label {
      font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #666; padding: 8px 12px 4px;
    }
    .section-header {
      display: flex; align-items: center;
      justify-content: space-between; padding-right: 8px;
      flex-shrink: 0;
    }
    .ep-controls { display: flex; gap: 2px; }
    .link-btn {
      background: none; border: none; color: #888;
      font-size: 11px; cursor: pointer;
      padding: 4px 6px; border-radius: 3px;
    }
    .link-btn:hover { color: #ccc; background: #2a2a2a; }

    #episode-list { max-height: 160px; overflow-y: auto; border-bottom: 1px solid #2a2a2a; }
    #episode-list::-webkit-scrollbar       { width: 4px; }
    #episode-list::-webkit-scrollbar-track { background: #222; }
    #episode-list::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }

    .ep-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; cursor: pointer;
      line-height: 1.3; transition: background 0.1s; user-select: none;
    }
    .ep-item:hover { background: #242424; }
    .ep-item input[type=checkbox] { accent-color: #e74c3c; flex-shrink: 0; }
    .ep-item.checked { color: #fff; }
    .ep-item.ep-active  { background: #242424; }
    .ep-item.ep-queued  { color: #2ecc71; }
    .ep-item.ep-queued  input[type=checkbox] { accent-color: #2ecc71; }
    .ep-item.ep-failed  { color: #e74c3c; }

    #formats-section { padding-bottom: 4px; flex-shrink: 0; }
    .fmt-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; cursor: pointer;
      border-radius: 4px; margin: 1px 8px; transition: background 0.1s;
    }
    .fmt-item:hover { background: #242424; }
    .fmt-item input[type=radio] { accent-color: #e74c3c; flex-shrink: 0; }
    .fmt-name { font-weight: 500; }
    .fmt-meta { color: #888; font-size: 11px; margin-left: auto; }

    #btn-queue {
      display: block; width: calc(100% - 24px);
      margin: 10px 12px; padding: 8px;
      background: #e74c3c; color: #fff;
      border: none; border-radius: 5px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background 0.15s; flex-shrink: 0;
    }
    #btn-queue:hover:not(:disabled) { background: #c0392b; }
    #btn-queue:disabled { background: #444; color: #888; cursor: default; }

    #action-row {
      display: none;
      gap: 8px;
      margin: -4px 12px 10px;
      flex-shrink: 0;
    }
    #action-row.visible { display: flex; }
    #btn-stop, #btn-cancel {
      flex: 1; padding: 5px;
      background: transparent;
      border: 1px solid #333; border-radius: 5px;
      font-size: 11px; cursor: pointer; color: #666;
      transition: color 0.15s, border-color 0.15s;
    }
    #btn-stop:hover   { color: #2ecc71; border-color: #2ecc71; }
    #btn-cancel:hover { color: #e74c3c; border-color: #e74c3c; }

    #post-queue-row {
      display: none;
      gap: 8px;
      margin: -4px 12px 10px;
      flex-shrink: 0;
    }
    #post-queue-row.visible { display: flex; }
    #btn-copy, #btn-reset {
      flex: 1; padding: 5px;
      background: transparent;
      border: 1px solid #2a2a2a; border-radius: 5px;
      font-size: 11px; cursor: pointer; color: #555;
      transition: color 0.15s, border-color 0.15s;
    }
    #btn-copy:hover  { color: #ccc; border-color: #555; }
    #btn-reset:hover { color: #ccc; border-color: #555; }

    #queue-result {
      padding: 6px 12px 8px; font-size: 11px;
      line-height: 1.5; word-break: break-all;
      white-space: pre-wrap;
      border-top: 1px solid #222; flex-shrink: 0;
    }
    #queue-result.hidden  { display: none !important; }
    #queue-result.success { color: #2ecc71; }
    #queue-result.error   { color: #e74c3c; }
  `;
  shadow.appendChild(style);

  // ── Panel markup ─────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'panel';
  panel.className = 'hidden';
  panel.innerHTML = `
    <div id="state-loading" class="state">
      <div class="spinner"></div>
      <div class="muted small" id="loading-label">Loading…</div>
    </div>
    <div id="state-error" class="state hidden">
      <div class="error-msg" id="error-text"></div>
    </div>
    <div id="state-loaded" class="hidden">
      <div id="series-header">
        <img id="series-thumb" hidden>
        <div id="series-meta">
          <div id="series-title"></div>
          <div id="series-count"></div>
        </div>
      </div>
      <div id="episodes-section">
        <div class="section-header">
          <div class="section-label">Episodes</div>
          <div class="ep-controls">
            <button class="link-btn" id="btn-ep-all">All</button>
            <button class="link-btn" id="btn-ep-none">None</button>
          </div>
        </div>
        <div id="episode-list"></div>
      </div>
      <div id="formats-section">
        <div class="section-label">Format</div>
        <div id="format-list"></div>
      </div>
      <button id="btn-queue" disabled>Queue Download</button>
      <div id="action-row">
        <button id="btn-stop">Stop &amp; Save</button>
        <button id="btn-cancel">Cancel</button>
      </div>
      <div id="post-queue-row">
        <button id="btn-copy">Copy Command</button>
        <button id="btn-reset">Reset</button>
      </div>
      <div id="queue-result" class="hidden"></div>
    </div>
  `;
  shadow.appendChild(panel);

  // ── Toggle button ────────────────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.id = 'toggle';
  toggle.title = 'yt-dlp Queue';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panelOpen = !panelOpen;
    panel.classList.toggle('hidden', !panelOpen);
    if (panelOpen && !panelLoaded) loadPanel();
  });
  shadow.appendChild(toggle);

  // Close when clicking outside the host element
  document.addEventListener('click', (e) => {
    if (panelOpen && !e.composedPath().includes(host)) {
      panelOpen = false;
      panel.classList.add('hidden');
    }
  });

  // ── Panel helpers ────────────────────────────────────────────────────────────

  const $ = (id) => shadow.getElementById(id);

  function showState(state) {
    ['loading', 'error', 'loaded'].forEach(s =>
      $(`state-${s}`).classList.toggle('hidden', s !== state));
  }

  function showError(msg) {
    $('error-text').textContent = msg;
    showState('error');
  }

  // ── Load panel content (first open only) ─────────────────────────────────────

  async function loadPanel() {
    panelLoaded = true;
    showState('loading');
    _progressUpdate = (label) => { $('loading-label').textContent = label; };

    const result = await api.runtime.sendMessage({ type: 'FETCH_INFO', tabId });
    _progressUpdate = null;
    if (result.error) { showError(result.error); return; }

    seriesInfo = result.info;
    currentFormats = seriesInfo.formats;
    selectedEpisodeIds = new Set([seriesInfo.currentEpisodeId]);

    renderSeries();
    renderEpisodes();
    renderFormats(currentFormats);
    showState('loaded');

    $('btn-ep-all').addEventListener('click', () => {
      selectedEpisodeIds = new Set(seriesInfo.episodes.map(e => e.id));
      shadow.querySelectorAll('#episode-list .ep-item').forEach(label => {
        label.classList.add('checked');
        label.querySelector('input').checked = true;
      });
      updateQueueButton();
    });

    $('btn-ep-none').addEventListener('click', () => {
      selectedEpisodeIds.clear();
      shadow.querySelectorAll('#episode-list .ep-item').forEach(label => {
        label.classList.remove('checked');
        label.querySelector('input').checked = false;
      });
      updateQueueButton();
    });

    $('btn-queue').addEventListener('click', handleQueue);

    $('btn-copy').addEventListener('click', async () => {
      if (!savedPath) return;
      await navigator.clipboard.writeText(savedPath);
      const btn = $('btn-copy');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });

    $('btn-reset').addEventListener('click', () => {
      shadow.querySelectorAll('#episode-list .ep-item').forEach(row =>
        row.classList.remove('ep-active', 'ep-queued', 'ep-failed'));
      setCheckboxesDisabled(false);
      $('queue-result').className = 'hidden';
      $('post-queue-row').classList.remove('visible');
      savedPath = null;
      updateQueueButton();
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderSeries() {
    const s = seriesInfo.series;
    $('series-title').textContent = s.title;
    $('series-count').textContent = s.episodeCount > 1 ? `${s.episodeCount} episodes` : '';
    const thumb = $('series-thumb');
    if (s.thumbnail) { thumb.src = s.thumbnail; thumb.hidden = false; }
  }

  function renderEpisodes() {
    const list = seriesInfo.episodes;
    const section = $('episodes-section');
    const container = $('episode-list');

    if (!list.length) { section.hidden = true; return; }
    section.hidden = false;
    container.innerHTML = '';

    for (const ep of list) {
      const label = document.createElement('label');
      label.className = 'ep-item' + (selectedEpisodeIds.has(ep.id) ? ' checked' : '');
      label.dataset.epId = ep.id;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedEpisodeIds.has(ep.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedEpisodeIds.add(ep.id);
        else selectedEpisodeIds.delete(ep.id);
        label.classList.toggle('checked', cb.checked);
        updateQueueButton();
      });

      const title = document.createElement('span');
      title.textContent = ep.title;

      label.append(cb, title);
      container.appendChild(label);
    }

    container.querySelector('.ep-item.checked')?.scrollIntoView({ block: 'nearest' });
    updateQueueButton();
  }

  function renderFormats(formats) {
    const container = $('format-list');
    container.innerHTML = '';

    if (!formats.length) {
      container.innerHTML = '<div class="muted small" style="padding:6px 12px">No formats found.</div>';
      updateQueueButton();
      return;
    }

    const sorted = [...formats].sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    for (const [i, fmt] of sorted.entries()) {
      const label = document.createElement('label');
      label.className = 'fmt-item';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'format';
      radio.value = fmt.format_id;
      if (i === 0) radio.checked = true;
      radio.addEventListener('change', updateQueueButton);

      const name = document.createElement('span');
      name.className = 'fmt-name';
      name.textContent = fmt.display_name;

      const meta = document.createElement('span');
      meta.className = 'fmt-meta';
      const parts = [];
      if (fmt.tbr)    parts.push(`${fmt.tbr.toFixed(0)} kbps`);
      if (fmt.is_hls) parts.push('HLS');
      meta.textContent = parts.join(' · ');

      label.append(radio, name, meta);
      container.appendChild(label);
    }

    updateQueueButton();
  }

  function updateQueueButton() {
    const btn = $('btn-queue');
    const hasFormat = !!shadow.querySelector('input[name=format]:checked');
    const n = selectedEpisodeIds.size;
    const hasSomething = seriesInfo?.episodes.length ? n > 0 : true;

    btn.disabled = !hasFormat || !currentFormats.length || !hasSomething;
    btn.textContent = n > 1 ? `Queue ${n} Episodes` : 'Queue Download';
  }

  // ── Episode row state ────────────────────────────────────────────────────────

  function setEpState(epId, state) {
    const row = shadow.querySelector(`[data-ep-id="${epId}"]`);
    if (!row) return;
    row.classList.remove('ep-active', 'ep-queued', 'ep-failed');
    if (state) row.classList.add(`ep-${state}`);
  }

  function setCheckboxesDisabled(disabled) {
    shadow.querySelectorAll('#episode-list input[type=checkbox]')
      .forEach(cb => { cb.disabled = disabled; });
  }

  // ── Queue ────────────────────────────────────────────────────────────────────

  async function handleQueue() {
    const selected = shadow.querySelector('input[name=format]:checked');
    if (!selected) return;

    const btn          = $('btn-queue');
    const actionRow    = $('action-row');
    const postQueueRow = $('post-queue-row');
    const resultEl     = $('queue-result');

    btn.disabled = true;
    resultEl.className = 'hidden';
    postQueueRow.classList.remove('visible');
    savedPath = null;

    let stopRequested   = false;
    let cancelRequested = false;
    let sleepResolve    = null;
    const abortSleep    = () => sleepResolve?.();

    setCheckboxesDisabled(true);
    actionRow.classList.add('visible');
    $('btn-stop').onclick   = () => { stopRequested   = true; abortSleep(); };
    $('btn-cancel').onclick = () => { cancelRequested = true; abortSleep(); };

    const settings = await api.storage.sync.get({ sleepMin: 3, sleepMax: 8 });
    const { sleepMin, sleepMax } = settings;

    const episodes = seriesInfo.episodes.length
      ? [...selectedEpisodeIds]
      : [seriesInfo.currentEpisodeId];

    const collected  = [];
    const greenedIds = [];
    let fetchFailed  = 0;

    for (let i = 0; i < episodes.length; i++) {
      if (stopRequested || cancelRequested) break;

      const epId = episodes[i];
      setEpState(epId, 'active');

      if (i > 0 && sleepMax > 0) {
        const ms = (sleepMin + Math.random() * (sleepMax - sleepMin)) * 1000;
        const deadline = Date.now() + ms;
        await new Promise(resolve => {
          sleepResolve = resolve;
          const tick = () => {
            if (stopRequested || cancelRequested) { resolve(); return; }
            const left = Math.ceil((deadline - Date.now()) / 1000);
            btn.textContent = `Sleeping ${left}s…`;
            if (left <= 0) { resolve(); return; }
            setTimeout(tick, 500);
          };
          tick();
        });
        sleepResolve = null;
      }

      if (stopRequested || cancelRequested) { setEpState(epId, null); break; }

      btn.textContent = episodes.length > 1
        ? `Fetching ${i + 1} / ${episodes.length}…`
        : 'Fetching…';

      let formats;
      if (episodes.length === 1 && currentFormats.length) {
        formats = currentFormats;
      } else {
        const fmtResult = await api.runtime.sendMessage({
          type: 'FETCH_EPISODE_FORMATS', tabId, episodeId: epId,
        });
        if (fmtResult.error) {
          setEpState(epId, 'failed');
          fetchFailed++;
          continue;
        }
        formats = fmtResult.formats;
      }

      collected.push({ episodeId: epId, formats });
      greenedIds.push(epId);
      setEpState(epId, 'queued');
    }

    actionRow.classList.remove('visible');
    $('btn-stop').onclick   = null;
    $('btn-cancel').onclick = null;
    setCheckboxesDisabled(false);

    // Cancel: revert all visual changes and silently return
    if (cancelRequested) {
      greenedIds.forEach(id => setEpState(id, null));
      updateQueueButton();
      return;
    }

    // Nothing to save
    if (collected.length === 0) {
      resultEl.className = 'error';
      resultEl.textContent = stopRequested
        ? 'Stopped — nothing saved'
        : `✗ All ${fetchFailed} failed`;
      postQueueRow.classList.add('visible');
      updateQueueButton();
      return;
    }

    // Save batch
    btn.textContent = 'Saving…';
    const result = await api.runtime.sendMessage({
      type: 'QUEUE_BATCH', tabId, formatId: selected.value, episodes: collected,
    });

    postQueueRow.classList.add('visible');

    if (result.ok) {
      savedPath = `yt-dlp --load-info-json ${result.path} --cookies ${result.cookiesPath}`;
      const n = collected.length;
      const parts = [];
      if (stopRequested) parts.push('Stopped —');
      parts.push(`✓ Saved ${n} episode${n !== 1 ? 's' : ''}`);
      if (fetchFailed) parts.push(`✗ ${fetchFailed} failed`);
      resultEl.className = fetchFailed ? 'error' : 'success';
      resultEl.textContent = parts.join('  ') + '\n' + savedPath;
      btn.textContent = `Saved ${n} ✓`;
    } else {
      resultEl.className = 'error';
      resultEl.textContent = `✗ ${result.error}`;
      updateQueueButton();
    }
  }
}
