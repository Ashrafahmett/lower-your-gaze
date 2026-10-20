// Service worker: owns the offscreen document (where the AI models run),
// forwards scan requests to it, and handles the right-click "show" menu.

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER'],
        justification: 'Runs the local image classifier on page images.',
      })
      .catch((e) => {
        if (!String(e).includes('Only a single offscreen')) throw e;
      })
      .finally(() => (creating = null));
  }
  await creating;
}

// Pages send 'scan' straight to the offscreen page (it answers them itself, so a
// sleeping service worker cannot drop answers). They ask us to 'ensure' it exists first.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ensure') {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'count' && sender.tab?.id != null) {
    const n = msg.blocked || 0;
    chrome.action.setBadgeBackgroundColor({ color: '#2f6f4f', tabId: sender.tab.id });
    chrome.action.setBadgeText({ text: n ? String(n) : '', tabId: sender.tab.id });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({
    enabled: cur.enabled ?? true,
    mode: cur.mode ?? 'strict',
    videos: cur.videos ?? 'scan',
    allowSites: cur.allowSites ?? [],
    shorts: cur.shorts ?? true,
    ytRecs: cur.ytRecs ?? false,
    igReels: cur.igReels ?? true,
    fbReels: cur.fbReels ?? true,
    tiktok: cur.tiktok ?? true,
    xFeed: cur.xFeed ?? true,
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'mb-reveal',
      title: 'Modest Blur: show this one',
      contexts: ['image', 'video'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mb-reveal' && tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'reveal', srcUrl: info.srcUrl }, { frameId: info.frameId });
  }
});
