/*
 * SyncWatch — service worker da extensão.
 * Mantém a conexão com o servidor de salas e faz a ponte com a aba sincronizada.
 */
'use strict';

importScripts('sync-engine.js'); // usa o ClockSync

let cfg = null;          // { server, room, name }
let active = false;      // usuário quer estar conectado
let ws = null;
let connected = false;
let myId = null;
let roomState = null;
let members = [];
let chat = [];
let syncedTabId = null;
let lastError = null;
let reconnectTimer = null;
let pingTimer = null;
let clock = new ClockSync();
const ports = new Map(); // portId -> { port, tabId }
let portSeq = 0;

// ---------- Inicialização (o service worker pode reiniciar a qualquer momento) ----------
const ready = chrome.storage.local.get(['cfg', 'active', 'syncedTabId']).then((s) => {
  cfg = s.cfg || null;
  active = !!s.active;
  syncedTabId = s.syncedTabId ?? null;
  if (active && cfg) connect();
});

function save() {
  chrome.storage.local.set({ cfg, active, syncedTabId });
}

// ---------- Conexão ----------
function toWsUrl(server) {
  let s = String(server || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s.replace(/^https/i, 'wss');
  if (/^http:\/\//i.test(s)) return s.replace(/^http/i, 'ws');
  if (/^wss?:\/\//i.test(s)) return s;
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(s);
  return `${local ? 'ws' : 'wss'}://${s}`;
}

function connect() {
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.onclose = null; ws.close(); } catch (_) { /* ignora */ } }
  const url = toWsUrl(cfg && cfg.server);
  if (!url) { lastError = 'Endereço do servidor inválido'; return; }
  lastError = null;
  clock = new ClockSync();

  try { ws = new WebSocket(url); } catch (e) { lastError = 'Endereço do servidor inválido'; return; }

  ws.onopen = () => {
    connected = true;
    ws.send(JSON.stringify({ t: 'join', room: cfg.room, name: cfg.name, client: 'ext' }));
    for (let i = 0; i < 6; i++) setTimeout(ping, i * 150);
    clearInterval(pingTimer);
    // ping a cada 3 s: sincroniza o relógio e mantém o service worker acordado
    pingTimer = setInterval(ping, 3000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handle(msg);
  };

  ws.onerror = () => { lastError = 'Não consegui conectar ao servidor'; };

  ws.onclose = () => {
    connected = false;
    myId = null;
    clearInterval(pingTimer);
    if (active) reconnectTimer = setTimeout(connect, 2000);
  };
}

function disconnect() {
  active = false;
  save();
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (ws) { ws.onclose = null; try { ws.close(); } catch (_) { /* ignora */ } }
  ws = null;
  connected = false;
  myId = null;
  roomState = null;
  members = [];
  chat = [];
  stopPorts(null);
}

function sendWs(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function ping() { sendWs({ t: 'ping', c: Date.now() }); }

function handle(msg) {
  switch (msg.t) {
    case 'pong':
      clock.add(msg.c, msg.s, Date.now());
      broadcastToTab({ t: 'clock', offset: clock.offset, rtt: clock.rtt });
      break;
    case 'joined':
      myId = msg.id;
      members = msg.members;
      lastError = null;
      if (msg.state) setRoomState(msg.state);
      break;
    case 'state':
      setRoomState(msg.state);
      break;
    case 'members':
      members = msg.members;
      break;
    case 'chat':
      pushChat({ name: msg.name, text: msg.text, id: msg.id });
      break;
    case 'system':
      pushChat({ sys: true, text: msg.text });
      break;
    case 'error':
      lastError = msg.message;
      break;
    default:
      break;
  }
}

function pushChat(m) {
  chat.push(m);
  if (chat.length > 50) chat.shift();
}

async function setRoomState(state) {
  roomState = state;
  await forwardState();
}

/** Compara links ignorando parâmetros de rastreio (ex.: Netflix /watch/123?trackId=...) */
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./, '');
    if (host.endsWith('youtube.com') && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
    return `${host}${url.pathname.replace(/\/+$/, '')}`;
  } catch (_) {
    return u;
  }
}

async function tabInfo() {
  if (syncedTabId === null) return null;
  try { return await chrome.tabs.get(syncedTabId); } catch (_) { return null; }
}

async function forwardState() {
  if (!roomState) return;
  const tab = await tabInfo();
  let sameMedia = true;
  if (roomState.media && roomState.media.kind === 'url' && tab && tab.url) {
    sameMedia = normalizeUrl(tab.url) === normalizeUrl(roomState.media.url);
  } else if (roomState.media && roomState.media.kind === 'youtube') {
    sameMedia = !!(tab && normalizeUrl(tab.url) === `youtube:${roomState.media.id}`);
  }
  broadcastToTab({ t: 'state', state: roomState, sameMedia, offset: clock.offset });
}

// ---------- Aba sincronizada ----------
function broadcastToTab(msg) {
  for (const { port, tabId } of ports.values()) {
    if (tabId === syncedTabId) {
      try { port.postMessage(msg); } catch (_) { /* porta fechada */ }
    }
  }
}

/** Desliga a sincronização em todas as abas, menos (opcionalmente) uma. */
function stopPorts(exceptTabId) {
  for (const { port, tabId } of ports.values()) {
    if (tabId !== exceptTabId) {
      try { port.postMessage({ t: 'stop' }); } catch (_) { /* porta fechada */ }
    }
  }
}

async function injectInto(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Essa aba não pode ser sincronizada');
  if (/netflix\.com/.test(tab.url)) {
    // A Netflix não aceita pular o tempo pelo <video>: usa a API interna do player
    await chrome.scripting.executeScript({
      target: { tabId }, files: ['netflix-bridge.js'], world: 'MAIN',
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, files: ['sync-engine.js', 'content.js'],
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'syncwatch-tab' || !port.sender || !port.sender.tab) return;
  const id = ++portSeq;
  const tabId = port.sender.tab.id;
  ports.set(id, { port, tabId });
  port.onDisconnect.addListener(() => ports.delete(id));

  if (tabId !== syncedTabId || !active) {
    port.postMessage({ t: 'stop' });
    return;
  }
  port.postMessage({ t: 'clock', offset: clock.offset, rtt: clock.rtt });
  forwardState();

  port.onMessage.addListener(async (msg) => {
    if (tabId !== syncedTabId) return;
    if (msg.t === 'local') {
      const tab = await tabInfo();
      sendWs({
        t: 'state',
        playing: msg.playing,
        position: msg.position,
        media: tab && tab.url ? mediaFor(tab) : undefined,
      });
    } else if (msg.t === 'status') {
      sendWs({ t: 'status', drift: msg.drift, buffering: msg.buffering, rtt: clock.rtt });
    }
  });
});

function mediaFor(tab) {
  try {
    const url = new URL(tab.url);
    if (url.hostname.replace(/^www\./, '') === 'youtube.com' && url.searchParams.get('v')) {
      return { kind: 'youtube', id: url.searchParams.get('v') };
    }
  } catch (_) { /* ignora */ }
  return { kind: 'url', url: tab.url, title: (tab.title || '').slice(0, 200) };
}

// Recarregou a página ou trocou de episódio: injeta de novo
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === syncedTabId && active && info.status === 'complete') {
    injectInto(tabId).catch(() => {});
    setTimeout(forwardState, 1500);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === syncedTabId) { syncedTabId = null; save(); }
});

// ---------- Mensagens do popup ----------
chrome.runtime.onMessage.addListener((req, _sender, reply) => {
  (async () => {
    await ready;
    switch (req.cmd) {
      case 'status': {
        const tab = await tabInfo();
        let partnerMedia = null;
        if (roomState && roomState.media) {
          partnerMedia = roomState.media.kind === 'youtube'
            ? { url: `https://www.youtube.com/watch?v=${roomState.media.id}`, title: 'Vídeo do YouTube' }
            : { url: roomState.media.url, title: roomState.media.title };
          partnerMedia.by = roomState.by;
          partnerMedia.same = !!(tab && tab.url && normalizeUrl(tab.url) === normalizeUrl(partnerMedia.url));
        }
        reply({
          cfg, active, connected, myId, members, chat, lastError,
          rtt: clock.rtt,
          syncedTab: tab ? { id: tab.id, title: tab.title, url: tab.url } : null,
          playing: roomState ? roomState.playing : null,
          partnerMedia,
        });
        break;
      }
      case 'connect':
        cfg = req.cfg;
        active = true;
        save();
        connect();
        reply({ ok: true });
        break;
      case 'disconnect':
        disconnect();
        reply({ ok: true });
        break;
      case 'syncTab':
        try {
          syncedTabId = req.tabId;
          save();
          stopPorts(req.tabId); // desliga a aba antiga, se houver
          await injectInto(req.tabId);
          reply({ ok: true });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
        break;
      case 'openPartner':
        if (roomState && roomState.media) {
          const url = roomState.media.kind === 'youtube'
            ? `https://www.youtube.com/watch?v=${roomState.media.id}`
            : roomState.media.url;
          if (syncedTabId !== null) await chrome.tabs.update(syncedTabId, { url, active: true });
          else {
            const tab = await chrome.tabs.create({ url });
            syncedTabId = tab.id;
            save();
          }
        }
        reply({ ok: true });
        break;
      case 'chat':
        sendWs({ t: 'chat', text: String(req.text || '').slice(0, 500) });
        reply({ ok: true });
        break;
      default:
        reply({ ok: false });
    }
  })();
  return true; // resposta assíncrona
});
