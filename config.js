// Extension-wide defaults.
// This file is the single source of truth for all default settings.
// It is loaded before background.js via manifest.json background.scripts
// and before options.js via a <script> tag in options/options.html.
const EXT_DEFAULTS = {
  queueDir: '~/.local/share/ytdl-queue/queue',
  debugLog:  '~/.local/share/ytdl-queue/debug.log',
  sleepMin:  3,
  sleepMax:  8,
};
