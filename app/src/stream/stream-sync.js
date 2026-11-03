/*
 * SyncWatch — sincronização dentro da página do streaming.
 * Independente do Electron: recebe uma "ponte" para conversar com o app.
 *   bridge.send(tipo, dados)   tipos: 'hello', 'local', 'status'
 *   bridge.on(tipo, fn)        tipos: 'room:state', 'room:clock'
 * Depende de SyncEngine (sync-engine.js).
 */
/* global SyncEngine */
function createStreamSync(bridge) {
  'use strict';

  const isNetflix = /(^|\.)netflix\.com$/.test(location.hostname);
  let video = null;
  let offset = 0;
  let said = false;     // já avisou o app que esta página tem vídeo
  let sameMedia = true;
  let roomState = null;

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
      if (!sameMedia) return;
      bridge.send('local', { playing, position });
    },
  });

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
  const EVENTS = ['play', 'pause', 'seeked'];

  function bind(v) {
    if (video === v) return;
    if (video) EVENTS.forEach((ev) => video.removeEventListener(ev, onUserEvent));
    video = v;
    if (!video) return;
    EVENTS.forEach((ev) => video.addEventListener(ev, onUserEvent));
    engine.state = null;
    if (roomState && sameMedia) engine.applyRemote(roomState);
    if (!said) { said = true; bridge.send('hello', {}); }
  }

  bridge.on('room:clock', (o) => { if (typeof o === 'number') offset = o; });

  bridge.on('room:state', (msg) => {
    if (!msg) return;
    if (typeof msg.offset === 'number') offset = msg.offset;
    const wasSame = sameMedia;
    sameMedia = msg.sameMedia !== false;

    if (!msg.state) { // saiu da sala
      roomState = null;
      engine.state = null;
      engine.enabled = false;
      if (video) { try { video.playbackRate = 1; } catch (_) { /* ignora */ } }
      return;
    }

    if (!sameMedia) {
      engine.enabled = false;
      if (wasSame && video) {
        const who = msg.state.by ? `${msg.state.by} está` : 'A sala está';
        toast(`${who} em outro vídeo — use "Ir para o vídeo da sala" ao lado`, 6000);
      }
      roomState = msg.state;
      return;
    }

    engine.enabled = true;
    if (!wasSame && video) toast('Mesmo vídeo da sala — sincronizando', 2500);
    // novo vídeo na mesma aba (ex.: próximo episódio): recomeça do zero
    if (!wasSame || (roomState && msg.state.seq < roomState.seq)) engine.state = null;
    roomState = msg.state;
    engine.applyRemote(msg.state);
  });

  setInterval(() => {
    const v = findVideo();
    if (v !== video && (v || (video && !video.isConnected))) bind(v);
  }, 1000);

  setInterval(() => {
    if (video && sameMedia) engine.correct();
  }, 400);

  setInterval(() => {
    if (!video || !said) return;
    bridge.send('status', {
      drift: sameMedia && engine.enabled ? engine.lastDiff : null,
      buffering: adapter.ready() && adapter.buffering(),
    });
  }, 2000);

  // ---------- Aviso na tela (funciona também em tela cheia) ----------
  let toastEl = null;
  let toastTimer = null;
  function toast(text, ms) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', background: 'rgba(14,15,19,.92)', color: '#fff',
        font: '600 14px/1.4 system-ui, "Segoe UI", sans-serif', padding: '10px 18px', borderRadius: '10px',
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

  return { engine, get video() { return video; } };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createStreamSync };
