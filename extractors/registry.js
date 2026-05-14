// Extractor registry — loaded by both content script and background service worker.
// Each extractor self-registers via EXTRACTORS.register().

const EXTRACTORS = {
  _map: {},

  register(name, extractor) {
    this._map[name] = { name, ...extractor };
  },

  // Returns the extractor whose urlPattern matches url, or null.
  match(url) {
    for (const ext of Object.values(this._map)) {
      if (ext.urlPattern.test(url)) return ext;
    }
    return null;
  },

  get(name) {
    return this._map[name] || null;
  },
};
