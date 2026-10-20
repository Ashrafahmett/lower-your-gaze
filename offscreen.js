// Offscreen document: loads images, runs Detector one at a time, caches results.

/* global Detector */
const cache = new Map(); // key -> result
const MAX_CACHE = 3000;
const queue = [];
let busy = false;

Detector.init('');

async function loadBitmap(msg) {
  const res = await fetch(msg.data || msg.url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  if (blob.type.includes('svg')) return null; // vector graphics: icons, logos
  return createImageBitmap(blob);
}

async function run(msg) {
  const key = msg.mode + '|' + (msg.url || '');
  if (!msg.noCache && msg.url && cache.has(key)) return cache.get(key);
  await Detector.init('');
  const bitmap = await loadBitmap(msg);
  if (!bitmap) return { verdict: 'safe', reason: 'svg' };
  if (bitmap.width < 48 || bitmap.height < 48) {
    bitmap.close();
    return { verdict: 'safe', reason: 'tiny' };
  }
  const result = await Detector.classify(bitmap, msg.mode);
  bitmap.close();
  if (!msg.noCache && msg.url) {
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, result);
  }
  return result;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const { msg, resolve } = queue.shift();
    try {
      resolve(await run(msg));
    } catch (e) {
      resolve({ verdict: 'error', error: String(e) });
    }
  }
  busy = false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'scan') return false;
  queue.push({ msg, resolve: sendResponse });
  pump();
  return true;
});
