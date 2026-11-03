/*
 * SyncWatch — app de desktop.
 * Janela com a interface (abas de serviços + barra lateral da sala) e,
 * dentro dela, um navegador próprio (WebContentsView) onde rodam Netflix, Prime etc.
 *
 * Usa o Electron da castlabs, que inclui o Widevine (necessário para streamings pagos).
 */
'use strict';

const {
  app, BrowserWindow, WebContentsView, ipcMain, session, clipboard, shell,
  components, // só existe no Electron da castlabs (download/atualização do Widevine)
} = require('electron');
const path = require('path');
const fs = require('fs');

const PARTITION = 'persist:streaming'; // logins ficam salvos aqui
const PROTOCOL = 'syncwatch';

let win = null;
let view = null;        // navegador do streaming
let viewAttached = false;
let layout = { x: 0, y: 56, width: 800, height: 600 };
let fullscreen = false;
let lastRoom = { state: null, offset: 0 }; // último estado da sala vindo da interface
const frames = new Map(); // frames da página que têm vídeo

// ---------- Instância única + links syncwatch:// ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    handleDeepLink(argv.find((a) => a.startsWith(`${PROTOCOL}://`)));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

let pendingDeepLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) || null;
app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); }); // macOS

function handleDeepLink(link) {
  if (!link) return;
  try {
    const u = new URL(link);
    const server = u.searchParams.get('servidor') || u.searchParams.get('server');
    const room = u.searchParams.get('sala') || u.searchParams.get('room');
    if (!server || !room) return;
    if (win && !win.webContents.isLoading()) win.webContents.send('deeplink', { server, room });
    else pendingDeepLink = link;
  } catch (_) { /* link inválido */ }
}

// ---------- User agent sem "Electron" (alguns streamings recusam navegadores desconhecidos) ----------
function cleanUserAgent(ua) {
  return ua.replace(/\s(Electron|syncwatch|SyncWatch)\/\S+/g, '');
}

// ---------- Configuração salva ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) { return {}; }
}
function writeConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch (_) { /* ignora */ }
}

// ---------- Janela ----------
async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e0f13',
    title: 'SyncWatch',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'ui', 'ui-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) { const l = pendingDeepLink; pendingDeepLink = null; handleDeepLink(l); }
  });
  // A interface nunca navega para fora
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  createStreamView();

  win.on('resize', applyBounds);
  win.on('leave-full-screen', () => { if (fullscreen) setFullscreen(false); });
  win.on('closed', () => { win = null; view = null; });
}

function createStreamView() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'build', 'stream-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true, // roda o preload também em iframes (players embutidos)
    },
  });
  view.setBackgroundColor('#000000');
  const wc = view.webContents;

  // Pop-ups (login com Google/Apple etc.) abrem numa janela com a mesma sessão
  wc.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 520, height: 720, autoHideMenuBar: true, parent: win,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
    },
  }));

  const onNav = () => {
    sendNavState();
    injectNetflixBridge();
    broadcastRoom(); // a página mudou: recalcula se é o mesmo vídeo da sala
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('did-finish-load', injectNetflixBridge);
  wc.on('page-title-updated', sendNavState);
  wc.on('did-start-loading', () => send('stream:loading', true));
  wc.on('did-stop-loading', () => send('stream:loading', false));

  wc.on('enter-html-full-screen', () => setFullscreen(true));
  wc.on('leave-html-full-screen', () => setFullscreen(false));

  wc.on('render-process-gone', () => send('stream:crashed'));
}

function attachView() {
  if (viewAttached || !win || !view) return;
  win.contentView.addChildView(view);
  viewAttached = true;
  applyBounds();
}

function applyBounds() {
  if (!win || !view || !viewAttached) return;
  if (fullscreen) {
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width: w, height: h });
  } else {
    view.setBounds(layout);
  }
}

function setFullscreen(on) {
  if (!win) return;
  fullscreen = on;
  win.setFullScreen(on);
  send('fullscreen', on);
  // espera a janela terminar de redimensionar
  setTimeout(applyBounds, 50);
  setTimeout(applyBounds, 400);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendNavState() {
  if (!view) return;
  const wc = view.webContents;
  send('stream:nav', {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  });
}

// ---------- Netflix: pular tempo pela API interna do player ----------
const NETFLIX_BRIDGE = fs.readFileSync(path.join(__dirname, 'src', 'stream', 'netflix-bridge.js'), 'utf8');
function injectNetflixBridge() {
  if (!view) return;
  const url = view.webContents.getURL();
  if (/^https:\/\/(www\.)?netflix\.com\//.test(url)) {
    view.webContents.executeJavaScript(NETFLIX_BRIDGE).catch(() => {});
  }
}

// ---------- Mídia atual x mídia da sala ----------
function mediaFromUrl(url, title) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v')) return { kind: 'youtube', id: u.searchParams.get('v') };
    if (host === 'youtu.be') return { kind: 'youtube', id: u.pathname.slice(1, 12) };
  } catch (_) { /* ignora */ }
  return { kind: 'url', url, title: (title || '').slice(0, 200) };
}

function mediaKey(media) {
  if (!media) return null;
  if (media.kind === 'youtube') return `youtube:${media.id}`;
  try {
    const u = new URL(media.url);
    const m = mediaFromUrl(media.url);
    if (m.kind === 'youtube') return `youtube:${m.id}`;
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch (_) {
    return media.url;
  }
}

function currentMedia() {
  if (!view) return null;
  const url = view.webContents.getURL();
  if (!/^https?:/.test(url)) return null;
  return mediaFromUrl(url, view.webContents.getTitle());
}

function isSameMedia(state) {
  if (!state || !state.media) return true;
  const cur = currentMedia();
  return !!cur && mediaKey(cur) === mediaKey(state.media);
}

// ---------- Frames do streaming ----------
function frameKey(frame) { return `${frame.processId}-${frame.routingId}`; }

function sendToFrames(channel, payload) {
  for (const [key, frame] of frames) {
    try {
      if (frame.detached || (frame.isDestroyed && frame.isDestroyed())) { frames.delete(key); continue; }
      frame.send(channel, payload);
    } catch (_) {
      frames.delete(key);
    }
  }
}

function broadcastRoom() {
  sendToFrames('room:state', {
    state: lastRoom.state,
    offset: lastRoom.offset,
    sameMedia: isSameMedia(lastRoom.state),
  });
  send('stream:same', isSameMedia(lastRoom.state));
}

const fromStream = (e) => view && e.sender === view.webContents;

ipcMain.on('stream:hello', (e) => {
  if (!fromStream(e) || !e.senderFrame) return;
  frames.set(frameKey(e.senderFrame), e.senderFrame);
  e.senderFrame.send('room:state', {
    state: lastRoom.state, offset: lastRoom.offset, sameMedia: isSameMedia(lastRoom.state),
  });
});

ipcMain.on('stream:local', (e, msg) => {
  if (!fromStream(e) || !msg) return;
  if (typeof msg.playing !== 'boolean' || !isFinite(msg.position)) return;
  const media = currentMedia();
  if (!media) return;
  send('stream:local', { playing: msg.playing, position: msg.position, media });
});

ipcMain.on('stream:status', (e, msg) => {
  if (!fromStream(e) || !msg) return;
  send('stream:status', { drift: msg.drift, buffering: !!msg.buffering });
});

// ---------- Mensagens da interface ----------
const fromUi = (e) => win && e.sender === win.webContents;

ipcMain.on('room:state', (e, msg) => {
  if (!fromUi(e)) return;
  lastRoom = { state: msg && msg.state ? msg.state : null, offset: (msg && msg.offset) || 0 };
  broadcastRoom();
});

ipcMain.on('room:clock', (e, offset) => {
  if (!fromUi(e) || typeof offset !== 'number') return;
  lastRoom.offset = offset;
  sendToFrames('room:clock', offset);
});

ipcMain.on('ui:layout', (e, rect) => {
  if (!fromUi(e) || !rect) return;
  layout = {
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)),
  };
  applyBounds();
});

ipcMain.handle('nav', async (e, req) => {
  if (!fromUi(e) || !view || !req) return false;
  const wc = view.webContents;
  switch (req.action) {
    case 'load': {
      let url = String(req.url || '').trim();
      if (!url) return false;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try { new URL(url); } catch (_) { return false; }
      attachView();
      await wc.loadURL(url).catch(() => {});
      return true;
    }
    case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true;
    case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true;
    case 'reload': wc.reload(); return true;
    case 'roomMedia': {
      const m = lastRoom.state && lastRoom.state.media;
      if (!m) return false;
      const url = m.kind === 'youtube' ? `https://www.youtube.com/watch?v=${m.id}` : m.url;
      attachView();
      await wc.loadURL(url).catch(() => {});
      return true;
    }
    default: return false;
  }
});

ipcMain.handle('config:get', (e) => (fromUi(e) ? readConfig() : {}));
ipcMain.handle('config:set', (e, cfg) => {
  if (!fromUi(e) || !cfg || typeof cfg !== 'object') return false;
  writeConfig({ ...readConfig(), ...cfg });
  return true;
});
ipcMain.handle('clipboard:write', (e, text) => {
  if (!fromUi(e)) return false;
  clipboard.writeText(String(text).slice(0, 2000));
  return true;
});
ipcMain.handle('app:info', (e) => {
  if (!fromUi(e)) return null;
  return { widevine: widevineStatus, version: app.getVersion() };
});

// ---------- Inicialização ----------
let widevineStatus = 'indisponível';

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    try {
      await components.whenReady();
      widevineStatus = 'pronto';
    } catch (err) {
      widevineStatus = 'falhou';
      console.error('Widevine não carregou:', err);
    }
  }
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
