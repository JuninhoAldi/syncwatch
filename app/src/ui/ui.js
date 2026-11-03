/* SyncWatch — interface do app (abas, sala, membros, chat) */
/* global ClockSync */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sw = window.sw;

  const SERVICES = [
    { name: 'YouTube', url: 'https://www.youtube.com', color: '#ff3b30', host: 'youtube.com' },
    { name: 'Netflix', url: 'https://www.netflix.com/browse', color: '#e50914', host: 'netflix.com' },
    { name: 'Prime Video', url: 'https://www.primevideo.com', color: '#1fa1ff', host: 'primevideo.com' },
    { name: 'Disney+', url: 'https://www.disneyplus.com', color: '#3a6df0', host: 'disneyplus.com' },
    { name: 'HBO Max', url: 'https://play.hbomax.com', color: '#8b5cf6', host: 'hbomax.com' },
    { name: 'Globoplay', url: 'https://globoplay.globo.com', color: '#ff6b2b', host: 'globo.com' },
    { name: 'Crunchyroll', url: 'https://www.crunchyroll.com', color: '#f78b24', host: 'crunchyroll.com' },
  ];

  // ---------- Estado ----------
  let cfg = {};
  let ws = null;
  let wantConnected = false;
  let reconnectDelay = 1000;
  let pingTimer = null;
  let clock = new ClockSync();
  let myId = null;
  let roomState = null;
  let navState = { url: '', title: '' };
  let myDrift = null;
  let myBuffering = false;
  let sameMedia = true;

  // ---------- Serviços ----------
  function renderServices() {
    const bar = $('services');
    const tiles = $('tiles');
    for (const s of SERVICES) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.style.setProperty('--chip', s.color);
      chip.dataset.host = s.host;
      const dot = document.createElement('span');
      dot.className = 'dot-svc';
      chip.append(dot, document.createTextNode(s.name));
      chip.onclick = () => go(s.url);
      bar.appendChild(chip);

      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.style.setProperty('--chip', s.color);
      tile.textContent = s.name;
      tile.onclick = () => go(s.url);
      tiles.appendChild(tile);
    }
  }

  function go(url) {
    $('crashed').hidden = true;
    sw.navigate(url);
  }

  $('backBtn').onclick = () => sw.back();
  $('fwdBtn').onclick = () => sw.forward();
  $('reloadBtn').onclick = () => sw.reload();
  $('crashReload').onclick = () => { $('crashed').hidden = true; sw.reload(); };

  $('addrForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('addr').value.trim();
    if (v) go(v);
    $('addr').blur();
  };

  sw.onStreamNav((n) => {
    navState = n;
    if (document.activeElement !== $('addr')) $('addr').value = n.url;
    $('backBtn').disabled = !n.canGoBack;
    $('fwdBtn').disabled = !n.canGoForward;
    let host = '';
    try { host = new URL(n.url).hostname; } catch (_) { /* ignora */ }
    for (const chip of document.querySelectorAll('.chip')) {
      chip.classList.toggle('active', host === chip.dataset.host || host.endsWith(`.${chip.dataset.host}`));
    }
    updateSyncLabel();
  });
  sw.onStreamLoading((on) => { $('loadingDot').hidden = !on; });
  sw.onStreamCrashed(() => { $('crashed').hidden = false; });

  // ---------- Posição do navegador do streaming ----------
  function pushLayout() {
    const r = $('stage').getBoundingClientRect();
    sw.setLayout({ x: r.left, y: r.top, width: r.width, height: r.height });
  }
  new ResizeObserver(pushLayout).observe($('stage'));
  window.addEventListener('resize', pushLayout);

  $('toggleSide').onclick = () => {
    document.body.classList.toggle('side-hidden');
    pushLayout();
  };

  sw.onFullscreen(() => setTimeout(pushLayout, 50));

  // ---------- Entrar na sala ----------
  function randomRoom() {
    const words = ['pipoca', 'sofa', 'sessao', 'cinema', 'maratona', 'estreia', 'filme', 'serie'];
    return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  $('randomRoom').onclick = () => { $('roomInput').value = randomRoom(); };

  const cleanRoom = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);

  /** Aceita "abc.onrender.com", "https://abc...", "localhost:3000" etc. */
  function serverUrls(input) {
    let s = String(input || '').trim().replace(/\/+$/, '');
    if (!s) return null;
    if (/^wss?:\/\//i.test(s)) s = s.replace(/^ws/i, 'http');
    if (!/^https?:\/\//i.test(s)) {
      const local = /^(localhost|127\.|192\.168\.|10\.)/.test(s);
      s = `${local ? 'http' : 'https'}://${s}`;
    }
    try {
      const u = new URL(s);
      const http = `${u.protocol}//${u.host}`;
      return { http, ws: http.replace(/^http/, 'ws') };
    } catch (_) {
      return null;
    }
  }

  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    join($('nameInput').value, $('serverInput').value, $('roomInput').value);
  };

  function join(name, server, room) {
    name = String(name || '').trim().slice(0, 24) || 'Anônimo';
    room = cleanRoom(room);
    const urls = serverUrls(server);
    if (!urls) return showJoinError('Endereço do servidor inválido.');
    if (!room) return showJoinError('Código de sala inválido.');
    $('joinError').hidden = true;
    cfg = { ...cfg, name, server: urls.http, room };
    sw.setConfig(cfg);
    $('roomLabel').textContent = room;
    $('joinView').hidden = true;
    $('roomView').hidden = false;
    $('chat').textContent = '';
    wantConnected = true;
    connect();
    return true;
  }

  function showJoinError(text) {
    $('joinError').textContent = text;
    $('joinError').hidden = false;
    return false;
  }

  $('leaveBtn').onclick = leave;

  function leave() {
    wantConnected = false;
    clearInterval(pingTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_) { /* ignora */ } }
    ws = null;
    myId = null;
    roomState = null;
    sw.sendRoomState(null, 0);
    $('roomView').hidden = true;
    $('joinView').hidden = false;
    $('followCard').hidden = true;
  }

  $('inviteBtn').onclick = async () => {
    const link = `${cfg.server}/?sala=${cfg.room}`;
    await sw.copy(link);
    toast('Convite copiado! Quem tiver o app entra com um clique.');
  };

  // Convite aberto (syncwatch://entrar?servidor=...&sala=...)
  sw.onDeepLink(({ server, room }) => {
    if (wantConnected) leave();
    $('serverInput').value = server;
    $('roomInput').value = cleanRoom(room);
    document.body.classList.remove('side-hidden');
    pushLayout();
    if ($('nameInput').value.trim()) join($('nameInput').value, server, room);
    else { $('nameInput').focus(); toast('Coloque seu nome e clique em Entrar'); }
  });

  // ---------- Conexão ----------
  function connect() {
    clearTimeout(connect.timer);
    setConn('wait', 'Conectando…');
    const urls = serverUrls(cfg.server);
    clock = new ClockSync();
    try { ws = new WebSocket(urls.ws); } catch (_) { setConn('bad', 'Servidor inválido'); return; }

    ws.onopen = () => {
      reconnectDelay = 1000;
      send({ t: 'join', room: cfg.room, name: cfg.name, client: 'app' });
      for (let i = 0; i < 6; i++) setTimeout(ping, i * 150);
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, 3000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handle(msg);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      myId = null;
      if (!wantConnected) return;
      setConn('bad', 'Reconectando…');
      connect.timer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  function ping() { send({ t: 'ping', c: Date.now() }); }

  function handle(msg) {
    switch (msg.t) {
      case 'pong':
        clock.add(msg.c, msg.s, Date.now());
        sw.sendClock(clock.offset);
        $('pingLabel').textContent = `${clock.rtt} ms`;
        break;
      case 'joined':
        myId = msg.id;
        setConn('ok', 'Conectado');
        renderMembers(msg.members);
        if (msg.state) setRoomState(msg.state);
        break;
      case 'state':
        setRoomState(msg.state);
        break;
      case 'members':
        renderMembers(msg.members);
        break;
      case 'chat':
        addChat(msg.name, msg.text, msg.id);
        break;
      case 'system':
        addSystem(msg.text);
        break;
      case 'error':
        toast(msg.message);
        break;
      default:
        break;
    }
  }

  function setRoomState(state) {
    roomState = state;
    sw.sendRoomState(state, clock.offset);
    updateFollow();
    updateSyncLabel();
  }

  function setConn(kind, label) {
    $('conn').className = `conn ${kind}`;
    $('connLabel').textContent = label;
  }

  // ---------- Ponte com a página do streaming ----------
  sw.onStreamLocal(({ playing, position, media }) => {
    if (!myId) return;
    send({ t: 'state', playing, position, media });
  });

  sw.onStreamStatus(({ drift, buffering }) => {
    myDrift = drift;
    myBuffering = buffering;
    send({ t: 'status', drift, buffering, rtt: clock.rtt });
    updateSyncLabel();
  });

  sw.onStreamSame((same) => {
    sameMedia = same;
    updateFollow();
    updateSyncLabel();
  });

  $('followBtn').onclick = () => { $('crashed').hidden = true; sw.goToRoomMedia(); };

  function updateFollow() {
    const m = roomState && roomState.media;
    const show = !!(m && !sameMedia && myId);
    $('followCard').hidden = !show;
    if (show) {
      const title = m.kind === 'youtube' ? 'Vídeo do YouTube' : (m.title || m.url);
      $('followTitle').textContent = roomState.by ? `${title} · ${roomState.by}` : title;
    }
  }

  function updateSyncLabel() {
    const el = $('syncLabel');
    el.className = 'sync-label';
    if (!roomState || !roomState.media) {
      el.textContent = 'Abra um vídeo e dê play para começar';
    } else if (!sameMedia) {
      el.textContent = 'Você está em outro vídeo';
      el.classList.add('mid');
    } else if (!roomState.playing) {
      el.textContent = 'Pausado';
    } else if (myBuffering) {
      el.textContent = 'Carregando…';
      el.classList.add('mid');
    } else if (myDrift === null || myDrift === undefined) {
      el.textContent = 'Procurando o vídeo na página…';
    } else {
      const ms = Math.round(Math.abs(myDrift) * 1000);
      if (ms <= 80) { el.textContent = `Sincronizado · ±${ms} ms`; el.classList.add('good'); }
      else { el.textContent = `Ajustando… ${ms} ms`; el.classList.add('mid'); }
    }
  }

  // ---------- Membros ----------
  const color = (id) => `hsl(${[12, 200, 140, 280, 45, 330, 100, 230][id % 8]} 70% 50%)`;

  function renderMembers(members) {
    const ul = $('members');
    ul.textContent = '';
    for (const m of members) {
      const li = document.createElement('li');
      const av = document.createElement('span');
      av.className = 'avatar';
      av.style.background = color(m.id);
      av.textContent = (m.name[0] || '?').toUpperCase();
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name;
      if (m.id === myId) {
        const you = document.createElement('span');
        you.className = 'you';
        you.textContent = ' (você)';
        name.appendChild(you);
      }
      const badge = document.createElement('span');
      badge.className = 'badge';
      if (m.buffering) badge.textContent = 'carregando';
      else if (m.drift !== null && m.drift !== undefined) {
        badge.textContent = `${Math.abs(m.drift)} ms`;
        if (Math.abs(m.drift) <= 80) badge.classList.add('good');
      } else badge.textContent = m.client === 'web' ? 'site' : '';
      li.append(av, name, badge);
      ul.appendChild(li);
    }
  }

  // ---------- Chat ----------
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    send({ t: 'chat', text });
    $('chatInput').value = '';
  };

  function addChat(name, text, id) {
    const div = document.createElement('div');
    div.className = 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = color(id);
    who.textContent = name;
    div.append(who, document.createTextNode(text));
    pushChat(div);
  }

  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg sys';
    div.textContent = text;
    pushChat(div);
  }

  function pushChat(el) {
    const chat = $('chat');
    const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
    chat.appendChild(el);
    while (chat.children.length > 200) chat.firstChild.remove();
    if (atBottom) chat.scrollTop = chat.scrollHeight;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ---------- Início ----------
  renderServices();
  pushLayout();

  sw.info().then((info) => {
    if (!info) return;
    $('drmInfo').textContent = info.widevine === 'pronto'
      ? 'Proteção de vídeo (Widevine) pronta para Netflix, Prime, Disney+ e outros.'
      : 'Widevine indisponível: só YouTube e vídeos sem proteção vão tocar. Veja o LEIA-ME.';
  });

  sw.getConfig().then((saved) => {
    cfg = saved || {};
    $('nameInput').value = cfg.name || '';
    $('serverInput').value = cfg.server || '';
    $('roomInput').value = cfg.room || randomRoom();
  });
})();
