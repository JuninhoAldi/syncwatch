/*
 * SyncWatch — ponte para o player da Netflix (roda no contexto da própria página).
 * A Netflix dá erro se o tempo do <video> for alterado direto,
 * então o pulo de tempo é feito pela API interna do player dela.
 */
(() => {
  'use strict';
  if (window.__syncWatchNetflixBridge) return;
  window.__syncWatchNetflixBridge = true;

  function netflixPlayer() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds();
      const id = ids.find((s) => s.startsWith('watch')) || ids[0];
      return id ? vp.getVideoPlayerBySessionId(id) : null;
    } catch (_) {
      return null;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__syncwatch !== 'seek') return;
    const time = Number(e.data.time);
    if (!isFinite(time) || time < 0) return;
    const p = netflixPlayer();
    if (p) {
      p.seek(Math.round(time * 1000));
    } else {
      const v = document.querySelector('video');
      if (v) v.currentTime = time;
    }
  });
})();
