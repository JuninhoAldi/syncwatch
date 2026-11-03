/* SyncWatch — ponte segura entre a interface e o processo principal */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('sw', {
  // navegação no streaming
  navigate: (url) => ipcRenderer.invoke('nav', { action: 'load', url }),
  back: () => ipcRenderer.invoke('nav', { action: 'back' }),
  forward: () => ipcRenderer.invoke('nav', { action: 'forward' }),
  reload: () => ipcRenderer.invoke('nav', { action: 'reload' }),
  goToRoomMedia: () => ipcRenderer.invoke('nav', { action: 'roomMedia' }),
  setLayout: (rect) => ipcRenderer.send('ui:layout', rect),

  // sala
  sendRoomState: (state, offset) => ipcRenderer.send('room:state', { state, offset }),
  sendClock: (offset) => ipcRenderer.send('room:clock', offset),

  // utilidades
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  info: () => ipcRenderer.invoke('app:info'),

  // eventos
  onStreamNav: on('stream:nav'),
  onStreamLoading: on('stream:loading'),
  onStreamLocal: on('stream:local'),
  onStreamStatus: on('stream:status'),
  onStreamSame: on('stream:same'),
  onStreamCrashed: on('stream:crashed'),
  onDeepLink: on('deeplink'),
  onFullscreen: on('fullscreen'),
});
