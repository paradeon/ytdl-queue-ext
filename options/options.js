const api = typeof browser !== 'undefined' ? browser : chrome;
const DEFAULTS = { queueDir: '~/.local/share/ytdl-queue-ext/queue', sleepMin: 3, sleepMax: 8 };

(async () => {
  const data = await api.storage.sync.get(DEFAULTS);
  document.getElementById('queueDir').value = data.queueDir;
  document.getElementById('sleepMin').value = data.sleepMin;
  document.getElementById('sleepMax').value = data.sleepMax;
})();

document.getElementById('save').addEventListener('click', async () => {
  const dir      = document.getElementById('queueDir').value.trim() || DEFAULTS.queueDir;
  const sleepMin = Math.max(0, Number(document.getElementById('sleepMin').value) || 0);
  const sleepMax = Math.max(sleepMin, Number(document.getElementById('sleepMax').value) || 0);
  await api.storage.sync.set({ queueDir: dir, sleepMin, sleepMax });
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});
