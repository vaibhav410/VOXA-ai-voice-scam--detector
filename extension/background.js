// VOXA media check: right-click media, the browser downloads it, your local VOXA server analyzes it.
// Nothing is sent anywhere except http://127.0.0.1:5174 (VOXA), which forwards to the providers you configured.
const SERVER = 'http://127.0.0.1:5174';
const LIMIT_MB = { image: 10, voice: 20, video: 32 };
const KIND = { image: 'image', audio: 'voice', video: 'video' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'voxa-check', title: 'Check with VOXA', contexts: ['image', 'video', 'audio'] });
});

function summarize(a) {
  if (!a || a.status !== 'ok') return { label: 'Unavailable', detail: a?.message || 'The detector returned no result.' };
  if (a.code === 'AI_GENERATED') return { label: 'AI-generated', detail: 'Signs of AI generation. Check the source before sharing.' };
  if (a.code === 'SUSPICIOUS') return { label: 'Uncertain', detail: 'No confident conclusion. Use your judgement.' };
  return { label: 'Authentic', detail: 'No signs of AI generation detected. This does not prove the content is trustworthy.' };
}

async function voxaCheck(srcUrl, kind) {
  const r = await fetch(srcUrl);
  if (!r.ok) throw new Error('Could not download the media (HTTP ' + r.status + ').');
  const blob = await r.blob();
  if (blob.size > LIMIT_MB[kind] * 1048576) throw new Error('This ' + kind + ' file is larger than ' + LIMIT_MB[kind] + ' MB.');
  const mime = (blob.type || '').split(';')[0];
  let res;
  try {
    res = await fetch(`${SERVER}/api/analyze?modality=${kind}&provider=auto&extract=0`, { method: 'POST', headers: { 'Content-Type': mime, 'X-Voxa-Request': '1' }, body: blob });
  } catch { throw new Error('VOXA is not running. Start it with start-voxa.cmd and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error('VOXA rejected this extension. Add its ID as VOXA_EXTENSION_ID in .env.local and restart VOXA.');
  if (!res.ok) throw new Error(data.error || 'VOXA could not analyze this file (HTTP ' + res.status + ').');
  return { ...summarize(data.authenticity), provider: data.authenticity?.provider || null };
}
self.voxaCheck = voxaCheck;

async function remember(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  await chrome.storage.local.set({ history: [entry, ...history].slice(0, 20) });
}
function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', title, message: message.slice(0, 250) });
}
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'voxa-check' || !info.srcUrl) return;
  const kind = KIND[info.mediaType] || 'image';
  let host = 'media'; try { host = new URL(info.srcUrl).hostname; } catch {}
  notify('VOXA', 'Checking ' + kind + ' from ' + host + '…');
  try {
    const r = await voxaCheck(info.srcUrl, kind);
    await remember({ at: Date.now(), kind, host, label: r.label, provider: r.provider });
    notify('VOXA: ' + r.label, r.detail);
  } catch (e) {
    await remember({ at: Date.now(), kind, host, label: 'Failed', error: e.message });
    notify('VOXA: check failed', e.message);
  }
});
