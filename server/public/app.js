/* SyncWatch — site (YouTube sincronizado, membros e chat) */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- Estado ----------
  let ws = null;
  let myId = null;
  let roomCode = null;
  let myName = null;
  let reconnectDelay = 1000;
  let pingTimer = null;
  const clock = new ClockSync();

  let player = null;
  let playerReady = false;
  let loadedId = null;     // vídeo carregado no player
  let roomState = null;

  // ---------- Lobby ----------
  const params = new URLSearchParams(location.search);
  $('nameInput').value = localStorage.getItem('sw:name') || '';
  $('roomInput').value = params.get('sala') || '';
  if (!$('roomInput').value) $('roomInput').value = randomRoom();

  $('randomRoom').onclick = () => { $('roomInput').value = randomRoom(); updateAppLink(); };

  // Link para abrir a mesma sala no app de desktop
  function updateAppLink() {
    const room = $('roomInput').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    $('openApp').href = `syncwatch://entrar?servidor=${encodeURIComponent(location.origin)}&sala=${encodeURIComponent(room)}`;
  }
  $('roomInput').addEventListener('input', updateAppLink);
  updateAppLink();

  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    myName = $('nameInput').value.trim().slice(0, 24) || 'Anônimo';
    roomCode = $('roomInput').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    if (!roomCode) { toast('Código de sala inválido'); return; }
    localStorage.setItem('sw:name', myName);
    history.replaceState(null, '', `?sala=${roomCode}`);
    $('roomName').textContent = roomCode;
    $('lobby').hidden = true;
    $('app').hidden = false;
    loadYouTubeApi();
    connect();
  };

  function randomRoom() {
    const words = ['pipoca', 'sofa', 'sessao', 'cinema', 'maratona', 'estreia', 'filme', 'serie'];
    return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  $('copyInvite').onclick = async () => {
    const link = `${location.origin}/?sala=${roomCode}`;
    try { await navigator.clipboard.writeText(link); toast('Convite copiado! Mande para seu amigo.'); }
    catch (_) { prompt('Copie o convite:', link); }
  };

  // ---------- WebSocket ----------
  function connect() {
    setConn('wait', 'Conectando…');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      reconnectDelay = 1000;
      send({ t: 'join', room: roomCode, name: myName, client: 'web' });
      // rajada inicial para sincronizar o relógio rápido
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
      setConn('bad', 'Reconectando…');
      setTimeout(connect, reconnectDelay);
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
        $('pingLabel').textContent = `${clock.rtt} ms`;
        break;
      case 'joined':
        myId = msg.id;
        setConn('ok', 'Conectado');
        renderMembers(msg.members);
        if (msg.state) applyState(msg.state, true);
        break;
      case 'state':
        applyState(msg.state);
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

  function setConn(kind, label) {
    const el = $('connStatus');
    el.className = `conn ${kind}`;
    el.querySelector('.label').textContent = label;
  }

  // ---------- YouTube ----------
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) { createPlayer(); return; }
    window.onYouTubeIframeAPIReady = createPlayer;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function createPlayer() {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => {
          playerReady = true;
          if (roomState) applyState(roomState, true);
        },
        onStateChange: (e) => {
          // 1 = tocando, 2 = pausado
          if (e.data === 1 || e.data === 2) engine.localEvent();
          if (e.data === 1) $('unblock').hidden = true;
        },
      },
    });
  }

  const ytAdapter = {
    ready() {
      if (!playerReady || !loadedId || !roomState || !roomState.media) return false;
      if (roomState.media.kind !== 'youtube' || roomState.media.id !== loadedId) return false;
      const st = player.getPlayerState();
      return st !== -1 && player.getDuration() > 0;
    },
    time: () => player.getCurrentTime(),
    duration: () => player.getDuration(),
    paused() {
      const st = player.getPlayerState();
      return st === 2 || st === 5 || st === 0 || st === -1;
    },
    buffering: () => player.getPlayerState() === 3,
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (t) => player.seekTo(t, true),
    setRate: (r) => player.setPlaybackRate(r),
    rate: () => player.getPlaybackRate(),
  };

  const engine = new SyncEngine(ytAdapter, {
    serverNow: () => clock.now(),
    onLocalChange: ({ playing, position }) => {
      if (!roomState || !roomState.media) return;
      send({ t: 'state', playing, position, media: roomState.media });
    },
  });

  function applyState(state, force) {
    if (!force && roomState && state.seq <= roomState.seq) return;
    roomState = state;
    const media = state.media;

    $('emptyState').hidden = !!media;
    $('externalState').hidden = !(media && media.kind === 'url');
    if (media && media.kind === 'url') {
      $('externalTitle').textContent = media.title || media.url;
    }

    if (media && media.kind === 'youtube' && playerReady && loadedId !== media.id) {
      loadedId = media.id;
      engine.state = null; // reaplica depois que o vídeo carregar
      engine.mute(5000);
      const start = Math.max(0, expectedPos(state));
      if (state.playing) player.loadVideoById({ videoId: media.id, startSeconds: start });
      else player.cueVideoById({ videoId: media.id, startSeconds: start });
    }

    if (force) engine.state = null;
    engine.applyRemote(state);
  }

  function expectedPos(s) {
    return s.position + (s.playing ? Math.max(0, (clock.now() - s.at) / 1000) : 0);
  }

  // Detecta pulos no tempo feitos pelo usuário (a API do YouTube não tem evento de "seek")
  let lastT = null;
  let lastWall = performance.now();
  setInterval(() => {
    if (!ytAdapter.ready()) { lastT = null; return; }
    const t = player.getCurrentTime();
    const now = performance.now();
    if (lastT !== null) {
      const paused = ytAdapter.paused();
      const predicted = paused ? lastT : lastT + ((now - lastWall) / 1000) * (player.getPlaybackRate() || 1);
      if (Math.abs(t - predicted) > (paused ? 0.5 : 1.2)) engine.localEvent();
    }
    lastT = t;
    lastWall = now;
  }, 250);

  // Loop de correção
  let blockedSince = null;
  setInterval(() => {
    if (!engine.state && roomState && ytAdapter.ready()) engine.applyRemote(roomState);
    const diff = engine.correct();
    updateSyncLabel(diff);

    // Navegador bloqueou o autoplay? mostra botão
    if (roomState && roomState.playing && ytAdapter.ready() && ytAdapter.paused()) {
      blockedSince = blockedSince || Date.now();
      if (Date.now() - blockedSince > 2500) $('unblock').hidden = false;
    } else {
      blockedSince = null;
      $('unblock').hidden = true;
    }
  }, 400);

  $('unblock').onclick = () => {
    $('unblock').hidden = true;
    engine.mute(2000);
    if (roomState) player.seekTo(expectedPos(roomState), true);
    player.playVideo();
  };

  function updateSyncLabel(diff) {
    const el = $('syncLabel');
    el.className = '';
    if (!roomState || !roomState.media) { el.textContent = 'Aguardando vídeo'; return; }
    if (roomState.media.kind !== 'youtube') { el.textContent = 'Sincronizando pelo app'; return; }
    if (!roomState.playing) { el.textContent = 'Pausado'; return; }
    if (diff === null || diff === undefined) { el.textContent = 'Carregando…'; return; }
    const ms = Math.round(Math.abs(diff) * 1000);
    if (ms <= 80) { el.textContent = `Sincronizado (±${ms} ms)`; el.className = 'sync-good'; }
    else { el.textContent = `Ajustando… ${ms} ms`; el.className = 'sync-mid'; }
  }

  // Envia o próprio status para os outros verem
  setInterval(() => {
    if (!myId) return;
    send({
      t: 'status',
      drift: engine.lastDiff,
      buffering: playerReady && player.getPlayerState && player.getPlayerState() === 3,
      rtt: clock.rtt,
    });
  }, 2000);

  // ---------- Carregar vídeo ----------
  $('loadForm').onsubmit = (e) => {
    e.preventDefault();
    const parsed = parseYouTube($('urlInput').value.trim());
    if (!parsed) { toast('Não reconheci esse link do YouTube'); return; }
    $('urlInput').value = '';
    send({ t: 'state', playing: true, position: parsed.start, media: { kind: 'youtube', id: parsed.id } });
  };

  function parseYouTube(input) {
    if (/^[\w-]{11}$/.test(input)) return { id: input, start: 0 };
    let url;
    try { url = new URL(input.startsWith('http') ? input : `https://${input}`); } catch (_) { return null; }
    const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1, 12);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = url.searchParams.get('v');
      const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (!id && m) id = m[2];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    let start = 0;
    const t = url.searchParams.get('t') || url.searchParams.get('start');
    if (t) {
      const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (m) start = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }
    return { id, start };
  }

  // ---------- Membros ----------
  function color(id) {
    const hues = [12, 200, 140, 280, 45, 330, 100, 230];
    return `hsl(${hues[id % hues.length]} 70% 50%)`;
  }

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
      const parts = [];
      if (m.client === 'ext') parts.push('extensão');
      if (m.client === 'app') parts.push('app');
      if (m.buffering) parts.push('carregando');
      else if (m.drift !== null && m.drift !== undefined) parts.push(`${Math.abs(m.drift)} ms`);
      badge.textContent = parts.join(' · ');
      if (m.drift !== null && Math.abs(m.drift) <= 80) badge.classList.add('sync-good');
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
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }
})();
