// Runs on every page. blur.css blurs all images/videos from the first paint;
// this script sends each one for checking and un-blurs only what is safe.
(() => {
  const root = document.documentElement;
  const MIN_SIDE = 48; // smaller images are icons
  const MAX_INFLIGHT = 4;
  const VIDEO_EVERY_MS = 1000;

  let settings = { enabled: true, mode: 'strict', videos: 'scan', allowSites: [] };
  let active = true;
  let generation = 0; // bumped when settings change, so stale answers are ignored
  const verdicts = new Map(); // url -> 'safe' | 'blocked'
  const waiting = [];
  let inflight = 0;
  const videos = new Set();
  let lastContextTarget = null;

  // ---------- helpers ----------
  const siteHost = () => {
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) return new URL(a[a.length - 1]).hostname;
    } catch {}
    return location.hostname;
  };

  function siteAllowed() {
    const host = siteHost();
    return settings.allowSites.some((s) => host === s || host.endsWith('.' + s));
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res || { verdict: 'error', noAnswer: true });
        });
      } catch {
        resolve({ verdict: 'error' }); // extension reloaded
      }
    });
  }

  // The scanner page may not be running yet; ask the service worker to start it once.
  let scannerReady = null;
  async function scan(msg) {
    if (!scannerReady) scannerReady = send({ type: 'ensure' });
    await scannerReady;
    let res = await send({ type: 'scan', ...msg });
    if (res.noAnswer) {
      scannerReady = send({ type: 'ensure' });
      await scannerReady;
      res = await send({ type: 'scan', ...msg });
    }
    return res;
  }

  let countTimer = null;
  function reportCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      if (window !== window.top) return;
      const n = document.querySelectorAll('[data-mb="blocked"],[data-mb-bg="blocked"]').length;
      send({ type: 'count', blocked: n });
    }, 500);
  }

  // Shrinks a same-origin image/frame to a JPEG data URL. Returns null when the
  // canvas is tainted (cross-origin); the offscreen page then fetches the URL itself.
  function snapshot(source, w, h) {
    try {
      const scale = Math.min(1, 640 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } catch {
      return null;
    }
  }

  function schedule(job) {
    waiting.push(job);
    drain();
  }

  function drain() {
    while (inflight < MAX_INFLIGHT && waiting.length) {
      const job = waiting.shift();
      inflight++;
      job().finally(() => {
        inflight--;
        drain();
      });
    }
  }

  // ---------- images ----------
  function setMark(el, attr, value) {
    if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
    if (value === 'blocked') reportCount();
  }

  function checkImage(img) {
    if (!active || settings.mode === 'all') return;
    const mark = img.getAttribute('data-mb');
    if (mark === 'revealed' || mark === 'checking') return;

    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', () => checkImage(img), { once: true });
      return;
    }
    const src = img.currentSrc || img.src;
    if (!src) return;
    if (img.naturalWidth < MIN_SIDE || img.naturalHeight < MIN_SIDE) return setMark(img, 'data-mb', 'safe');
    if (verdicts.has(src)) return setMark(img, 'data-mb', verdicts.get(src));

    setMark(img, 'data-mb', 'checking');
    const gen = generation;
    schedule(async () => {
      const data = src.startsWith('data:') ? src : snapshot(img, img.naturalWidth, img.naturalHeight);
      const res = await scan({ url: src.startsWith('data:') ? '' : src, data, mode: settings.mode });
      if (gen !== generation) return;
      // Errors stay blurred: if we could not check it, we do not show it.
      const v = res.verdict === 'safe' ? 'safe' : 'blocked';
      if (src.length < 2048) verdicts.set(src, v);
      if ((img.currentSrc || img.src) === src) {
        setMark(img, 'data-mb', v);
      } else {
        img.removeAttribute('data-mb'); // src changed while we were checking
        checkImage(img);
      }
    });
  }

  // ---------- CSS background images ----------
  const URL_RE = /url\(["']?([^"')]+)["']?\)/;

  function checkBackground(el) {
    if (!active || settings.mode === 'all' || !(el instanceof Element)) return;
    const mark = el.getAttribute('data-mb-bg');
    if (mark === 'revealed' || mark === 'checking') return;
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg !== 'none' && URL_RE.exec(bg);
    if (!m) {
      if (mark) el.removeAttribute('data-mb-bg');
      return;
    }
    const url = new URL(m[1], location.href).href;
    if (verdicts.has(url)) return setMark(el, 'data-mb-bg', verdicts.get(url));

    setMark(el, 'data-mb-bg', 'checking');
    const gen = generation;
    schedule(async () => {
      const isData = url.startsWith('data:');
      const res = await scan({ url: isData ? '' : url, data: isData ? url : null, mode: settings.mode });
      if (gen !== generation) return;
      const v = res.verdict === 'safe' ? 'safe' : 'blocked';
      if (url.length < 2048) verdicts.set(url, v);
      setMark(el, 'data-mb-bg', v);
    });
  }

  // ---------- videos ----------
  function trackVideo(video) {
    if (!active || settings.mode === 'all' || settings.videos === 'block') return;
    videos.add(video);
  }

  async function scanVideo(video) {
    const st = (video._mb ||= { busy: false, streak: 0, lastTime: -1, tainted: false });
    if (st.busy || st.tainted || video.getAttribute('data-mb') === 'revealed') return;
    if (video.readyState < 2 || !video.videoWidth) return;
    if (video.paused && video.currentTime === st.lastTime) return;

    const data = snapshot(video, video.videoWidth, video.videoHeight);
    if (!data) {
      st.tainted = true; // cannot read frames of this video: keep it blurred
      return setMark(video, 'data-mb', 'blocked');
    }
    st.busy = true;
    st.lastTime = video.currentTime;
    const gen = generation;
    const res = await scan({ data, url: '', noCache: true, mode: settings.mode });
    st.busy = false;
    if (gen !== generation || video.getAttribute('data-mb') === 'revealed') return;
    if (res.verdict === 'safe') {
      // Need two clean frames in a row before showing the video.
      if (++st.streak >= 2) setMark(video, 'data-mb', 'safe');
    } else {
      st.streak = 0;
      setMark(video, 'data-mb', 'blocked');
    }
  }

  setInterval(() => {
    if (!active) return;
    for (const v of videos) {
      if (!v.isConnected) videos.delete(v);
      else scanVideo(v);
    }
  }, VIDEO_EVERY_MS);

  // ---------- page watching ----------
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        checkImage(e.target);
      }
    },
    { rootMargin: '1200px' }
  );

  function handleNode(node) {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'IMG') io.observe(node);
    else if (node.tagName === 'VIDEO') trackVideo(node);
    else checkBackground(node);
    if (node.firstElementChild) {
      for (const el of node.getElementsByTagName('*')) {
        if (el.tagName === 'IMG') io.observe(el);
        else if (el.tagName === 'VIDEO') trackVideo(el);
        else checkBackground(el);
      }
    }
  }

  const mo = new MutationObserver((records) => {
    if (!active) return;
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(handleNode);
      else if (r.target.tagName === 'IMG') {
        if (r.target.getAttribute('data-mb') !== 'revealed') r.target.removeAttribute('data-mb');
        io.observe(r.target);
      } else if (r.target.tagName === 'VIDEO') {
        if (r.target._mb) r.target._mb.streak = 0;
        if (r.target.getAttribute('data-mb') === 'safe') r.target.removeAttribute('data-mb');
      } else if (r.attributeName === 'style') {
        if (r.target.getAttribute('data-mb-bg') !== 'revealed') r.target.removeAttribute('data-mb-bg');
        checkBackground(r.target);
      }
    }
  });

  function scanAll() {
    if (!document.documentElement) return;
    handleNode(document.documentElement);
  }

  function apply() {
    generation++;
    active = settings.enabled && !siteAllowed();
    if (!active) {
      root.setAttribute('data-mb-off', '');
      return;
    }
    root.removeAttribute('data-mb-off');
    verdicts.clear();
    waiting.length = 0;
    for (const el of document.querySelectorAll('[data-mb]:not([data-mb="revealed"])')) el.removeAttribute('data-mb');
    for (const el of document.querySelectorAll('[data-mb-bg]:not([data-mb-bg="revealed"])')) el.removeAttribute('data-mb-bg');
    for (const v of videos) if (v._mb) v._mb = null;
    scanAll();
    reportCount();
  }

  // ---------- right-click "show this one" ----------
  document.addEventListener('contextmenu', (e) => (lastContextTarget = e.target), true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'reveal') return;
    let el = lastContextTarget;
    if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) {
      el = [...document.querySelectorAll('img,video')].find((x) => (x.currentSrc || x.src) === msg.srcUrl) || el?.closest?.('[data-mb-bg]');
    }
    if (!el) return;
    if (el.hasAttribute('data-mb-bg') && !(el instanceof HTMLImageElement)) el.setAttribute('data-mb-bg', 'revealed');
    else el.setAttribute('data-mb', 'revealed');
    reportCount();
  });

  // ---------- start ----------
  chrome.storage.sync.get(null, (s) => {
    settings = { ...settings, ...s };
    mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style'] });
    apply();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanAll, { once: true });
    window.addEventListener('load', scanAll, { once: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) settings[k] = changes[k].newValue;
    apply();
  });
})();
