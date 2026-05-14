const api = typeof browser !== 'undefined' ? browser : chrome;
// EXT_DEFAULTS is loaded via <script src="../config.js"> in options.html.

(async () => {
  const data = await api.storage.sync.get(EXT_DEFAULTS);
  document.getElementById('queueDir').value = data.queueDir;
  document.getElementById('sleepMin').value = data.sleepMin;
  document.getElementById('sleepMax').value = data.sleepMax;
})();

document.getElementById('save').addEventListener('click', async () => {
  const dir      = document.getElementById('queueDir').value.trim() || EXT_DEFAULTS.queueDir;
  const sleepMin = Math.max(0, Number(document.getElementById('sleepMin').value) || 0);
  const sleepMax = Math.max(sleepMin, Number(document.getElementById('sleepMax').value) || 0);
  await api.storage.sync.set({ queueDir: dir, sleepMin, sleepMax });
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});
