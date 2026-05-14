// iyf.tv extractor
// Handles https://www.iyf.tv/play/<videoId>[?mid=<episodeId>]

// ─── Compact MD5 (RFC 1321) ───────────────────────────────────────────────────
// Matches Python's hashlib.md5 output — used for signing API requests.
function _md5(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff);
  }
  function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

  function cycle(s, k) {
    let [a, b, c, d] = s;
    a=ff(a,b,c,d,k[0],7,-680876936);  d=ff(d,a,b,c,k[1],12,-389564586);
    c=ff(c,d,a,b,k[2],17,606105819);  b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);  d=ff(d,a,b,c,k[5],12,1200080426);
    c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);  d=ff(d,a,b,c,k[9],12,-1958414417);
    c=ff(c,d,a,b,k[10],17,-42063);    b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682); d=ff(d,a,b,c,k[13],12,-40341101);
    c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);  d=gg(d,a,b,c,k[6],9,-1069501632);
    c=gg(c,d,a,b,k[11],14,643717713); b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);  d=gg(d,a,b,c,k[10],9,38016083);
    c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);   d=gg(d,a,b,c,k[14],9,-1019803690);
    c=gg(c,d,a,b,k[3],14,-187363961); b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);
    c=gg(c,d,a,b,k[7],14,1735328473); b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);     d=hh(d,a,b,c,k[8],11,-2022574463);
    c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060); d=hh(d,a,b,c,k[4],11,1272893353);
    c=hh(c,d,a,b,k[7],16,-155497632); b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);  d=hh(d,a,b,c,k[0],11,-358537222);
    c=hh(c,d,a,b,k[3],16,-722521979); b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);  d=hh(d,a,b,c,k[12],11,-421815835);
    c=hh(c,d,a,b,k[15],16,530742520); b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);  d=ii(d,a,b,c,k[7],10,1126891415);
    c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571); d=ii(d,a,b,c,k[3],10,-1894986606);
    c=ii(c,d,a,b,k[10],15,-1051523);  b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);  d=ii(d,a,b,c,k[15],10,-30611744);
    c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);  d=ii(d,a,b,c,k[11],10,-1120210379);
    c=ii(c,d,a,b,k[2],15,718787259);  b=ii(b,c,d,a,k[9],21,-343485551);
    s[0]=safeAdd(a,s[0]); s[1]=safeAdd(b,s[1]);
    s[2]=safeAdd(c,s[2]); s[3]=safeAdd(d,s[3]);
  }

  // Pre-allocate the full padded message (all 512-bit blocks) so the length
  // field lands in the correct block regardless of message length.
  function str2blks(s) {
    const n = s.length;
    const nblks = ((n + 8) >> 6) + 1;        // number of 16-word blocks needed
    const b = new Array(nblks * 16).fill(0);
    for (let i = 0; i < n; i++)
      b[i >> 2] |= (s.charCodeAt(i) & 0xff) << ((i & 3) * 8);
    b[n >> 2] |= 0x80 << ((n & 3) * 8);      // append bit '1'
    b[nblks * 16 - 2] = n * 8;               // length in bits (low 32 bits)
    return b;
  }

  function bin2hex(b) {
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < b.length * 4; i++)
      s += h[(b[i>>2] >> ((i%4)*8+4)) & 0xf] + h[(b[i>>2] >> ((i%4)*8)) & 0xf];
    return s;
  }

  const m = str2blks(str);
  const state = [1732584193, -271733879, -1732584194, 271733878];
  for (let i = 0; i < m.length; i += 16) cycle(state, m.slice(i, i + 16));
  return bin2hex(state);
}

// ─── Signing ──────────────────────────────────────────────────────────────────

const IYF_API_HOST = 'm10.iyf.tv';

function _buildSignedUrl(path, params, publicKey, privateKey) {
  // Must match iyf.py: md5(publicKey + '&' + plainQs.lower() + '&' + privateKey)
  const plainQs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const vv = _md5(`${publicKey}&${plainQs.toLowerCase()}&${privateKey}`);
  const urlQs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `https://${IYF_API_HOST}/${path}?${urlQs}&vv=${vv}&pub=${publicKey}`;
}

async function _apiGet(path, params, publicKey, privateKey, cookieStr, apiFetch) {
  const url = _buildSignedUrl(path, params, publicKey, privateKey);
  const headers = { Referer: 'https://www.iyf.tv/', Cookie: cookieStr };

  let status, text;
  if (apiFetch) {
    ({ status, text } = await apiFetch(url, headers));
  } else {
    const res = await fetch(url, { headers });
    status = res.status;
    text = await res.text();
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`API returned non-JSON (HTTP ${status}): ${text.slice(0, 300)}`);
  }
  const code = json?.data?.code;
  const msg  = json?.data?.msg || '';
  const info = json?.data?.info;
  if (code !== 0 || !info || !info[0]) throw new Error(`API error: ${msg} (code ${code})`);
  return info[0];
}

function _extractFormats(play) {
  const formats = [];

  for (const c of (play.clarity || [])) {
    const path = c.path;
    if (!path?.result) continue;
    formats.push({
      format_id: `hls-${c.title || 'unknown'}`,
      display_name: c.title || c.description || 'Unknown',
      url: path.result,
      tbr: c.bitrate ? parseInt(c.bitrate) / 1000 : null,
      is_hls: path.isHls !== false,
      ext: 'mp4',
    });
  }

  // Fallback to flvPathList
  if (!formats.length) {
    for (const e of (play.flvPathList || [])) {
      if (e.type !== 0 || !e.result) continue;
      formats.push({
        format_id: `stream-${formats.length}`,
        display_name: `Stream ${formats.length + 1}`,
        url: e.result,
        tbr: null,
        is_hls: e.isHls !== false,
        ext: 'mp4',
      });
    }
  }

  return formats;
}

// ─── Netscape cookies.txt ────────────────────────────────────────────────────
// Converts a Cookie header string to Netscape format for --cookies flag.
// Fields: domain  includeSubdomains  path  https-only  expiry  name  value
function _netscapeCookies(cookieStr, domain) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const pair of cookieStr.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name  = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    // cf_clearance is HTTPS-only; everything else we mark non-secure for safety
    const secure = name === 'cf_clearance' ? 'TRUE' : 'FALSE';
    // Session expiry (0) — yt-dlp treats these as valid for the current run
    lines.push([`.${domain}`, 'TRUE', '/', secure, '0', name, value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

// ─── Extractor registration ───────────────────────────────────────────────────

EXTRACTORS.register('iyf', {
  urlPattern: /^https?:\/\/(?:www\.)?iyf\.tv\/play\/([A-Za-z0-9]+)/,
  cookieDomain: 'iyf.tv',

  // ── Page data extraction (background context, receives live JS object) ────
  // injectJson is obtained via scripting.executeScript world:'MAIN' so it is
  // the real evaluated object — no text parsing, no format ambiguity.
  processPageData(injectJson, url) {
    const m = this.urlPattern.exec(url);
    if (!m) return null;
    const videoId  = m[1];
    const episodeId = new URL(url).searchParams.get('mid') || null;

    const pConfig    = injectJson?.config?.[0]?.pConfig || {};
    const publicKey  = pConfig.publicKey  || '';
    const privateKey = (pConfig.privateKey || [])[0] || '';
    if (!publicKey || !privateKey) return null;

    return { extractor: 'iyf', cookieDomain: 'iyf.tv', videoId, episodeId, publicKey, privateKey, pageUrl: url };
  },

  // ── API calls (background context) ──────────────────────────────────────
  async fetchInfo(pageState, cookieStr, apiFetch, onProgress) {
    const { publicKey, privateKey, videoId, episodeId } = pageState;

    onProgress?.('Fetching series info…');
    const detail = await _apiGet('v3/video/detail', {
      cinema: '1', device: '1', player: 'CkPlayer', tech: 'HLS',
      country: 'HU', lang: 'cns', v: '1', id: videoId, region: 'GL.',
    }, publicKey, privateKey, cookieStr, apiFetch);

    const serialCount = parseInt(detail.serialCount) || 0;
    const cid = detail.cid || '';

    let episodes = [];
    if (serialCount > 1) {
      onProgress?.(`Fetching episode list (${serialCount} episodes)…`);
      const playlist = await _apiGet('v3/video/languagesplaylist', {
        cinema: '1', vid: videoId, lsk: '1', taxis: '0', cid,
      }, publicKey, privateKey, cookieStr, apiFetch);
      episodes = (playlist.playList || []).map((ep, i) => ({
        id:     String(ep.id),
        title:  ep.name || `Episode ${i + 1}`,
        number: i + 1,
      }));
    }

    const targetEpisodeId = episodeId || episodes[0]?.id || null;
    onProgress?.('Fetching stream URLs…');
    const formats = await this.fetchEpisodeFormats(pageState, targetEpisodeId, cookieStr, apiFetch);

    return {
      series: {
        id: videoId, cid,
        title:       detail.title    || videoId,
        description: detail.contxt   || '',
        thumbnail:   detail.imgPath  || '',
        episodeCount: serialCount,
      },
      episodes,
      currentEpisodeId: targetEpisodeId,
      formats,
    };
  },

  async fetchEpisodeFormats(pageState, episodeId, cookieStr, apiFetch) {
    const { publicKey, privateKey, videoId } = pageState;
    const params = {
      cinema: '1', id: videoId,
      ...(episodeId ? { mid: episodeId } : {}),
      a: '1', lang: 'zh-CN', usersign: '1', region: 'GL.',
      device: '1', isMasterSupport: '1',
    };
    const play = await _apiGet('v3/video/play', params, publicKey, privateKey, cookieStr, apiFetch);
    return _extractFormats(play);
  },

  // ── Batch queue entry builder ────────────────────────────────────────────
  // Returns { seriesId, entries } where entries is a JSON array of yt-dlp
  // video info dicts.  The caller writes entries (not a wrapper object) as
  // the file content so that yt-dlp's download_with_info_file reads them via
  // variadic() as independent video dicts — avoiding the sanitize_info() bug
  // that strips 'entries' from playlist objects (clean_infojson=True default).
  // selectedEpisodes: [{ episodeId, formats }]
  buildBatchQueueEntry(info, pageState, cookieStr, selectedEpisodes, formatId) {
    const { series, episodes } = info;

    const httpHeaders = { Referer: 'https://www.iyf.tv/' };
    const extractorState = {
      public_key:  pageState.publicKey,
      private_key: pageState.privateKey,
      video_id:    series.id,
      cid:         series.cid,
      api_host:    IYF_API_HOST,
    };
    const meta = {
      schema:    'ytdlp-queue/1',
      extractor: 'iyf',
      queued_at: new Date().toISOString(),
    };

    const entries = selectedEpisodes.map(({ episodeId, formats }) => {
      const episode = episodes.find(e => e.id === episodeId) || { id: episodeId };
      return {
        _type:          'video',
        id:             episode.id ? `${series.id}_ep${episode.id}` : series.id,
        title:          [series.title, episode.title].filter(Boolean).join(' '),
        description:    series.description,
        thumbnail:      series.thumbnail,
        webpage_url:    `https://www.iyf.tv/play/${series.id}` + (episode.id ? `?mid=${episode.id}` : ''),
        extractor:      'iyf',
        extractor_key:  'Iyf',
        http_headers:   httpHeaders,
        series:         series.title,
        series_id:      series.id,
        episode:        episode.title  || null,
        episode_id:     episode.id     || null,
        episode_number: episode.number || null,
        formats: formats.map(f => ({
          format_id:    f.format_id,
          display_name: f.display_name,
          url:          f.url,
          ext:          f.ext || 'mp4',
          tbr:          f.tbr || null,
          protocol:     f.is_hls ? 'm3u8_native' : 'https',
          http_headers: httpHeaders,
        })),
        // Non-standard — ignored by yt-dlp, useful for daemon / re-extraction
        _meta:             meta,
        _extractor_state:  extractorState,
      };
    });

    const cookiesText = _netscapeCookies(cookieStr, 'iyf.tv');

    const selectedEpisodeMeta = selectedEpisodes.map(({ episodeId }) => {
      const ep = episodes.find(e => e.id === episodeId) || { id: episodeId };
      return { id: ep.id, title: ep.title || null, number: ep.number || null };
    });

    const queueMeta = {
      schema:     'ytdlp-queue/1',
      extractor:  'iyf',
      queued_at:  new Date().toISOString(),

      id:          series.id,
      title:       series.title,
      description: series.description,
      thumbnail:   series.thumbnail,
      page_url:    pageState.pageUrl || `https://www.iyf.tv/play/${series.id}`,

      series: {
        id:            series.id,
        title:         series.title,
        episode_count: series.episodeCount,
      },

      selected_format_id: formatId,
      selected_episodes:  selectedEpisodeMeta,
      all_episodes:       episodes,

      files: {
        info_json:  `${series.id}.info.json`,
        cookies:    `${series.id}.cookies.txt`,
      },

      _extractor_state: extractorState,
    };

    return { seriesId: series.id, entries, cookiesText, queueMeta };
  },
});
