/*
 * SyncWatch — preload da página do streaming (Electron).
 * Este arquivo é juntado com sync-engine.js e stream-sync.js pelo scripts/bundle.js
 * (preloads em sandbox não podem dar require em arquivos locais).
 */
/* global createStreamSync */
(() => {
  'use strict';
  const { ipcRenderer } = require('electron');

  const listeners = {};
  ipcRenderer.on('room:state', (_e, msg) => (listeners['room:state'] || []).forEach((fn) => fn(msg)));
  ipcRenderer.on('room:clock', (_e, msg) => (listeners['room:clock'] || []).forEach((fn) => fn(msg)));

  const bridge = {
    send: (type, data) => ipcRenderer.send(`stream:${type}`, data),
    on: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };

  const start = () => createStreamSync(bridge);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
