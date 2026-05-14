const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── State ────────────────────────────────────────────────────────────────────

let tabId = null;
let seriesInfo = null;
let currentEpisodeId = null;
let currentFormats = [];
let selectedEpisodeIds = new Set();  // episodes checked for queuing

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  show('loading');

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;

  const pageState = await send({ type: 'GET_PAGE_STATE', tabId });
  if (!pageState) { show('unsupported'); return; }

  const result = await send({ type: 'FETCH_INFO', tabId });
  if (result.error) { showError(result.error); return; }

  seriesInfo = result.info;
  currentEpisodeId = seriesInfo.currentEpisodeId;
  currentFormats = seriesInfo.formats;

  // Pre-select the initially loaded episode (or null for single videos)
  selectedEpisodeIds.add(currentEpisodeId);

  renderSeries();
  renderEpisodes();
  renderFormats(currentFormats);
  show('loaded');
})();

// ─── Render ───────────────────────────────────────────────────────────────────

function renderSeries() {
  const s = seriesInfo.series;
  document.getElementById('series-title').textContent = s.title;
  document.getElementById('series-count').textContent =
    s.episodeCount > 1 ? `${s.episodeCount} episodes` : '';

  const thumb = document.getElementById('series-thumb');
  if (s.thumbnail) {
    thumb.src = s.thumbnail;
    thumb.hidden = false;
  }
}

function renderEpisodes() {
  const list = seriesInfo.episodes;
  const container = document.getElementById('episode-list');
  const section = document.getElementById('episodes-section');

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

  // Scroll to first checked episode
  container.querySelector('.ep-item.checked')?.scrollIntoView({ block: 'nearest' });
  updateQueueButton();
}

function renderFormats(formats) {
  const container = document.getElementById('format-list');
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
    if (fmt.tbr)   parts.push(`${fmt.tbr.toFixed(0)} kbps`);
    if (fmt.is_hls) parts.push('HLS');
    meta.textContent = parts.join(' · ');

    label.append(radio, name, meta);
    container.appendChild(label);
  }

  updateQueueButton();
}

function updateQueueButton() {
  const btn = document.getElementById('btn-queue');
  const hasFormat = !!document.querySelector('input[name=format]:checked');
  const n = selectedEpisodeIds.size;
  const hasSomething = seriesInfo?.episodes.length ? n > 0 : true; // single video always ok

  btn.disabled = !hasFormat || !currentFormats.length || !hasSomething;

  if (n > 1) {
    btn.textContent = `Queue ${n} Episodes`;
  } else {
    btn.textContent = 'Queue Download';
  }
}

// ─── Episode controls ─────────────────────────────────────────────────────────

document.getElementById('btn-ep-all').addEventListener('click', () => {
  selectedEpisodeIds = new Set(seriesInfo.episodes.map(e => e.id));
  document.querySelectorAll('#episode-list .ep-item').forEach(label => {
    label.classList.add('checked');
    label.querySelector('input').checked = true;
  });
  updateQueueButton();
});

document.getElementById('btn-ep-none').addEventListener('click', () => {
  selectedEpisodeIds.clear();
  document.querySelectorAll('#episode-list .ep-item').forEach(label => {
    label.classList.remove('checked');
    label.querySelector('input').checked = false;
  });
  updateQueueButton();
});

// ─── Queue ────────────────────────────────────────────────────────────────────

document.getElementById('btn-queue').addEventListener('click', async () => {
  const selected = document.querySelector('input[name=format]:checked');
  if (!selected) return;

  const btn = document.getElementById('btn-queue');
  const resultEl = document.getElementById('queue-result');
  btn.disabled = true;
  resultEl.className = 'hidden';

  const settings = await api.storage.sync.get({ sleepMin: 3, sleepMax: 8 });
  const { sleepMin, sleepMax } = settings;

  // For single videos (no episode list) use currentEpisodeId
  const episodes = seriesInfo.episodes.length
    ? [...selectedEpisodeIds]
    : [currentEpisodeId];

  let succeeded = 0;
  const failures = [];

  for (let i = 0; i < episodes.length; i++) {
    const epId = episodes[i];

    // Sleep between episodes (not before the first)
    if (i > 0 && sleepMax > 0) {
      const secs = sleepMin + Math.random() * (sleepMax - sleepMin);
      btn.textContent = `Sleeping ${secs.toFixed(0)}s…`;
      await new Promise(r => setTimeout(r, secs * 1000));
    }

    btn.textContent = episodes.length > 1
      ? `Queuing ${i + 1} / ${episodes.length}…`
      : 'Queuing…';

    // Fetch fresh stream URLs for each episode
    if (episodes.length > 1 || !currentFormats.length) {
      const fmtResult = await send({ type: 'FETCH_EPISODE_FORMATS', tabId, episodeId: epId });
      if (fmtResult.error) {
        failures.push(`ep ${epId}: ${fmtResult.error}`);
        continue;
      }
    }

    const result = await send({
      type: 'QUEUE_DOWNLOAD',
      tabId,
      episodeId: epId,
      formatId: selected.value,
    });

    if (result.ok) {
      succeeded++;
      if (episodes.length === 1) {
        // show filename for single-episode case
        resultEl.classList.remove('hidden');
        resultEl.className = 'success';
        resultEl.textContent = `✓ Queued: ${result.filename}`;
      }
    } else {
      failures.push(result.error || 'unknown error');
    }
  }

  if (episodes.length > 1) {
    resultEl.classList.remove('hidden');
    if (!failures.length) {
      resultEl.className = 'success';
      resultEl.textContent = `✓ Queued ${succeeded} episode${succeeded !== 1 ? 's' : ''}`;
    } else if (succeeded === 0) {
      resultEl.className = 'error';
      resultEl.textContent = `✗ All ${failures.length} failed`;
    } else {
      resultEl.className = 'error';
      resultEl.textContent = `✓ ${succeeded} queued  ✗ ${failures.length} failed`;
    }
  }

  if (failures.length === 0) {
    btn.textContent = episodes.length > 1 ? `Queued ${succeeded} ✓` : 'Queued ✓';
  } else {
    btn.disabled = false;
    btn.textContent = episodes.length > 1 ? `Queue ${selectedEpisodeIds.size} Episodes` : 'Queue Download';
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function show(state) {
  ['unsupported', 'loading', 'error', 'loaded'].forEach(s => {
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== state);
  });
}

function showError(msg) {
  document.getElementById('error-text').textContent = msg;
  show('error');
}

function send(msg) {
  return api.runtime.sendMessage(msg);
}
