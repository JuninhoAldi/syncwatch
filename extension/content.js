/*
 * SyncWatch — roda dentro da página do streaming.
 * Encontra o <video>, aplica o estado da sala e avisa quando o usuário mexe no player.
 */
(() => {
  'use strict';
  if (window.__syncWatchActive) return;
  window.__syncWatchActive = true;

  const isNetflix = /netflix\.com$/.test(location.hostname.replace(/^www\./, ''));
  let video = null;
  let port = null;
  let offset = 0;
  let stopped = false;
  let sameMedia = true;
  let pendingState = null;
  const timers = [];

  // ---------- Adapter do <video> HTML5 ----------
  const adapter = {
    ready: () => !!video && video.isConnected && video.readyState >= 1 && video.duration > 0,
    time: () => video.currentTime,
    duration: () => video.duration,
    paused: () => video.paused,
    buffering: () => !video.paused && video.readyState < 3,
    play: () => {
      const p = video.play();
      if (p && p.catch) p.catch(() => toast('Clique no vídeo uma vez para liberar a sincronização', 5000));
    },
    pause: () => video.pause(),
    seek: (t) => {
      if (isNetflix) window.postMessage({ __syncwatch: 'seek', time: t }, '*');
      else video.currentTime = t;
    },
    setRate: (r) => { video.playbackRate = r; },
    rate: () => video.playbackRate,
  };

  const engine = new SyncEngine(adapter, {
    serverNow: () => Date.now() + offset,
    onLocalChange: ({ playing, position }) => {
      if (!sameMedia) return; // não sobrescreve a sala enquanto estiver em outro vídeo
      post({ t: 'local', playing, position });
    },
  });

  // ---------- Encontrar o vídeo principal ----------
  function findVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && area > 200 * 120) { best = v; bestArea = area; }
    }
    return best;
  }

  const onUserEvent = () => engine.localEvent();

  function bind(v) {
    if (video === v) return;
    if (video) {
      for (const ev of ['play', 'pause', 'seeked']) video.removeEventListener(ev, onUserEvent);
    }
    video = v;
    if (!video) return;
    for (const ev of ['play', 'pause', 'seeked']) video.addEventListener(ev, onUserEvent);
    engine.state = null;
    if (pendingState) engine.applyRemote(pendingState);
    ensurePort();
  }

  // ---------- Conexão com a extensão ----------
  function ensurePort() {
    if (port || stopped) return;
    try {
      port = chrome.runtime.connect({ name: 'syncwatch-tab' });
    } catch (_) {
      shutdown(); // extensão foi recarregada/removida
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      // service worker reiniciou: reconecta
      if (!stopped) setTimeout(ensurePort, 1000);
    });
    toast('SyncWatch ativo nesta aba', 2500);
  }

  function post(msg) {
    if (port) { try { port.postMessage(msg); } catch (_) { /* ignora */ } }
  }

  function onMessage(msg) {
    switch (msg.t) {
      case 'clock':
        offset = msg.offset || 0;
        break;
      case 'state':
        if (typeof msg.offset === 'number') offset = msg.offset;
        pendingState = msg.state;
        if (msg.sameMedia === false) {
          if (sameMedia) {
            const by = msg.state.by ? `${msg.state.by} está` : 'Seu amigo está';
            toast(`${by} em outro vídeo — abra pelo ícone do SyncWatch`, 6000);
          }
          sameMedia = false;
          engine.enabled = false;
          return;
        }
        if (!sameMedia) toast('Mesmo vídeo — sincronizando', 2500);
        sameMedia = true;
        engine.enabled = true;
        engine.applyRemote(msg.state);
        break;
      case 'stop':
        shutdown();
        break;
      default:
        break;
    }
  }

  function shutdown() {
    stopped = true;
    timers.forEach(clearInterval);
    if (video) {
      for (const ev of ['play', 'pause', 'seeked']) video.removeEventListener(ev, onUserEvent);
      try { video.playbackRate = 1; } catch (_) { /* ignora */ }
    }
    if (port) { try { port.disconnect(); } catch (_) { /* ignora */ } }
    port = null;
    video = null;
    window.__syncWatchActive = false; // permite ativar de novo depois
  }

  // ---------- Loops ----------
  timers.push(setInterval(() => {
    const v = findVideo();
    if (v !== video && (v || (video && !video.isConnected))) bind(v);
  }, 1000));

  timers.push(setInterval(() => {
    if (!video || !sameMedia) return;
    engine.correct();
  }, 400));

  timers.push(setInterval(() => {
    if (!video || !port) return;
    post({ t: 'status', drift: sameMedia ? engine.lastDiff : null, buffering: adapter.ready() && adapter.buffering() });
  }, 2000));

  bind(findVideo());

  // ---------- Aviso na tela ----------
  let toastEl = null;
  let toastTimer = null;
  function toast(text, ms) {
    if (window !== window.top && !video) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 2147483647, background: 'rgba(14,15,19,.92)', color: '#fff',
        font: '600 14px/1.4 system-ui, sans-serif', padding: '10px 18px', borderRadius: '10px',
        borderLeft: '4px solid #ff5a36', boxShadow: '0 8px 30px rgba(0,0,0,.5)',
        pointerEvents: 'none', transition: 'opacity .2s',
      });
    }
    toastEl.textContent = text;
    (document.fullscreenElement || document.body).appendChild(toastEl);
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms || 3000);
  }
})();
