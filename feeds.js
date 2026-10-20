// Removes endless short-video feeds: YouTube Shorts, Instagram Reels/Explore,
// Facebook Reels/Watch, X home feed/Explore/trends, and blocks TikTok. Each part has a switch in the popup.
(() => {
  const host = location.hostname;
  const site = /(^|\.)youtube\.com$/.test(host) ? 'yt'
    : /(^|\.)instagram\.com$/.test(host) ? 'ig'
    : /(^|\.)facebook\.com$/.test(host) ? 'fb'
    : /(^|\.)tiktok\.com$/.test(host) ? 'tt'
    : /(^|\.)(x|twitter)\.com$/.test(host) ? 'x'
    : null;
  if (!site) return;

  const DEFAULTS = { shorts: true, ytRecs: false, igReels: true, fbReels: true, tiktok: true, xFeed: true };
  let s = { ...DEFAULTS };

  const HIDE = '{display:none !important}';
  const CSS = {
    shorts: `
      ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytm-reel-shelf-renderer,
      ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
      ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model),
      ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model-v2),
      grid-shelf-view-model:has(ytm-shorts-lockup-view-model),
      grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2),
      ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2,
      ytd-rich-item-renderer:has(a[href^="/shorts/"]),
      ytd-video-renderer:has(a[href^="/shorts/"]),
      ytd-grid-video-renderer:has(a[href^="/shorts/"]),
      ytd-compact-video-renderer:has(a[href^="/shorts/"]),
      yt-lockup-view-model:has(a[href^="/shorts/"]),
      ytd-notification-renderer:has(a[href^="/shorts/"]),
      ytd-guide-entry-renderer:has(a[title="Shorts"]),
      ytd-mini-guide-entry-renderer[aria-label="Shorts"],
      ytm-pivot-bar-item-renderer:has(.pivot-shorts),
      yt-tab-shape[tab-title="Shorts"],
      [data-mb-shorts] ${HIDE}`,
    ytRecs: `
      ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
      ytd-browse[page-subtype="home"] #chips-wrapper,
      ytd-watch-flexy #related, ytd-watch-next-secondary-results-renderer,
      .ytp-endscreen-content, .ytp-ce-element, .ytp-autonav-endscreen-countdown-overlay ${HIDE}
      ytd-browse[page-subtype="home"]::before {
        content: "Home feed hidden by Modest Blur. Use search or your subscriptions.";
        display: block; padding: 48px 24px; text-align: center; font-size: 16px; color: #888;
      }`,
    igReels: `
      a[href="/reels/"], a[href="/explore/"], a[href^="/reels/"],
      article:has(a[href^="/reel/"]) ${HIDE}`,
    fbReels: `
      a[href*="/reel/"], a[href^="/reels"], a[href^="/watch"],
      a[href*="facebook.com/reel"], a[href*="facebook.com/watch"],
      div[aria-label="Reels"], div[aria-label="Reels and short videos"] ${HIDE}`,
    xFeed: `
      div[aria-label="Timeline: Your Home Timeline"],
      div[aria-label^="Timeline: Trending"], div[aria-label^="Timeline: Explore"],
      [data-testid="sidebarColumn"] section:has(div[aria-label^="Timeline: Trending"]),
      [data-testid="sidebarColumn"] div:has(> div > [data-testid="trend"]),
      [data-testid="sidebarColumn"] aside[aria-label="Who to follow"],
      [data-testid="sidebarColumn"] div:has(> aside[aria-label="Who to follow"]),
      [data-testid="trend"],
      a[data-testid="AppTabBar_Explore_Link"], a[href="/explore"] ${HIDE}
      [data-testid="primaryColumn"]:has(div[aria-label="Home timeline"])::after {
        content: "Home feed hidden by Modest Blur. Use search, profiles or notifications.";
        display: block; padding: 48px 24px; text-align: center; font-size: 15px; color: #888;
      }`,
  };

  const style = document.createElement('style');
  style.id = 'mb-feeds';
  (document.head || document.documentElement).appendChild(style);

  function applyCss() {
    style.textContent = Object.keys(CSS).filter((k) => s[k]).map((k) => CSS[k]).join('\n');
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  function redirect() {
    const p = location.pathname;
    if (site === 'yt' && s.shorts && p.startsWith('/shorts/')) {
      const id = p.split('/')[2];
      location.replace(id ? '/watch?v=' + id : '/');
    } else if (site === 'ig' && s.igReels && /^\/(reels?|explore)(\/|$)/.test(p)) {
      location.replace('/');
    } else if (site === 'fb' && s.fbReels && /^\/(reels?|watch)(\/|$)/.test(p)) {
      location.replace('/');
    } else if (site === 'x' && s.xFeed && /^\/(explore|i\/trends)(\/|$)/.test(p)) {
      location.replace('/home');
    } else if (site === 'tt' && s.tiktok) {
      location.replace(chrome.runtime.getURL('blocked.html'));
    }
  }

  // Text-only items CSS cannot target (e.g. the "Shorts" filter chip).
  function hideByText() {
    if (site !== 'yt' || !s.shorts) return;
    for (const el of document.querySelectorAll('yt-chip-cloud-chip-renderer, chip-shape, ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, yt-tab-shape')) {
      if (!el.hasAttribute('data-mb-shorts') && el.textContent.trim() === 'Shorts') el.setAttribute('data-mb-shorts', '');
    }
  }

  // Single-page sites change URL without reloading, so watch for that.
  let lastUrl = '';
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      redirect();
    }
    hideByText();
  }, 400);

  chrome.storage.sync.get(DEFAULTS, (v) => {
    s = { ...DEFAULTS, ...v };
    applyCss();
    redirect();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) if (k in DEFAULTS) s[k] = changes[k].newValue;
    applyCss();
    lastUrl = '';
  });

  applyCss(); // defaults immediately, before settings load
})();
