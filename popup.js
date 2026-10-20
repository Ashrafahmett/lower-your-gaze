const $ = (id) => document.getElementById(id);
const HINTS = {
  strict: 'Blurs any face that might be a woman, plus revealing images.',
  normal: 'Blurs faces the AI is fairly sure are women, plus clearly revealing images.',
  all: 'No AI: every image and video stays blurred.',
};

const FEED_DEFAULTS = { shorts: true, ytRecs: false, igReels: true, fbReels: true, tiktok: true, xFeed: true };
let host = '';

for (const box of document.querySelectorAll('[data-key]')) {
  box.onchange = () => chrome.storage.sync.set({ [box.dataset.key]: box.checked });
}

async function render() {
  const s = await chrome.storage.sync.get(null);
  $('enabled').checked = s.enabled !== false;
  $('mode').value = s.mode || 'strict';
  $('videos').value = s.videos || 'scan';
  $('modeHint').textContent = HINTS[$('mode').value];
  for (const box of document.querySelectorAll('[data-key]')) {
    box.checked = s[box.dataset.key] ?? FEED_DEFAULTS[box.dataset.key];
  }
  const allowed = (s.allowSites || []).includes(host);
  $('site').textContent = !host ? 'Not available on this page' : allowed ? `Turn back on for ${host}` : `Turn off for ${host}`;
  $('site').disabled = !host;
  $('site').classList.toggle('on', allowed);
}

$('enabled').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
$('mode').onchange = (e) => chrome.storage.sync.set({ mode: e.target.value }).then(render);
$('videos').onchange = (e) => chrome.storage.sync.set({ videos: e.target.value });
$('site').onclick = async () => {
  const { allowSites = [] } = await chrome.storage.sync.get('allowSites');
  const next = allowSites.includes(host) ? allowSites.filter((h) => h !== host) : [...allowSites, host];
  await chrome.storage.sync.set({ allowSites: next });
  render();
};

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  try {
    const u = new URL(tab.url);
    if (u.protocol.startsWith('http')) host = u.hostname.replace(/^www\./, '');
  } catch {}
  render();
});
