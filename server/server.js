/*
 * SyncWatch — servidor de salas.
 * Serve o site (pasta public) e cuida das salas via WebSocket.
 * O vídeo NÃO passa por aqui: só os comandos (play, pause, posição) e o chat.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// ---------- Site estático ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let file = decodeURIComponent(url.pathname);
  if (file === '/' || !path.extname(file)) file = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- Salas ----------
/** @type {Map<string, {code:string, state:object|null, seq:number, members:Map<any,object>, dirty:boolean}>} */
const rooms = new Map();
let nextId = 1;

const cleanRoom = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
const cleanText = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, n);

function getRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = { code, state: null, seq: 0, members: new Map(), dirty: false };
    rooms.set(code, room);
  }
  return room;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const ws of room.members.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
  }
}

function memberList(room) {
  return [...room.members.values()].map((m) => ({
    id: m.id, name: m.name, client: m.client,
    drift: m.drift, buffering: m.buffering, rtt: m.rtt,
  }));
}

function validMedia(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.kind === 'youtube' && /^[\w-]{11}$/.test(m.id)) return { kind: 'youtube', id: m.id };
  if (m.kind === 'url' && typeof m.url === 'string' && /^https?:\/\//.test(m.url)) {
    return { kind: 'url', url: m.url.slice(0, 2000), title: cleanText(m.title, 200) };
  }
  return null;
}

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null;
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // Sincronização de relógio: responde na hora com a hora do servidor
    if (msg.t === 'ping') {
      send(ws, { t: 'pong', c: msg.c, s: Date.now() });
      return;
    }

    if (msg.t === 'join') {
      const code = cleanRoom(msg.room);
      const name = cleanName(msg.name) || 'Anônimo';
      if (!code) { send(ws, { t: 'error', message: 'Código de sala inválido.' }); return; }
      if (room) { room.members.delete(ws); room.dirty = true; }
      room = getRoom(code);
      me = {
        id: nextId++, name,
        client: ['ext', 'app'].includes(msg.client) ? msg.client : 'web',
        drift: null, buffering: false, rtt: null,
      };
      room.members.set(ws, me);
      send(ws, { t: 'joined', id: me.id, room: code, state: room.state, members: memberList(room) });
      broadcast(room, { t: 'members', members: memberList(room) }, ws);
      broadcast(room, { t: 'system', text: `${name} entrou na sala` }, ws);
      return;
    }

    if (!room || !me) return;

    switch (msg.t) {
      case 'state': {
        const position = Number(msg.position);
        if (!isFinite(position) || position < 0 || typeof msg.playing !== 'boolean') return;
        const media = validMedia(msg.media) || (room.state && room.state.media) || null;
        const prev = room.state;
        room.seq += 1;
        room.state = {
          playing: msg.playing,
          position,
          at: Date.now(),
          seq: room.seq,
          media,
          by: me.name,
          byId: me.id,
        };
        broadcast(room, { t: 'state', state: room.state });

        // Mensagem no chat descrevendo a ação
        let text = null;
        const mediaChanged = media && (!prev || JSON.stringify(prev.media) !== JSON.stringify(media));
        if (mediaChanged) text = `${me.name} trocou o vídeo`;
        else if (prev && prev.playing !== msg.playing) text = `${me.name} ${msg.playing ? 'deu play' : 'pausou'}`;
        else if (prev) text = `${me.name} pulou para ${fmtTime(position)}`;
        if (text) broadcast(room, { t: 'system', text });
        break;
      }
      case 'status': {
        me.drift = typeof msg.drift === 'number' && isFinite(msg.drift) ? Math.round(msg.drift * 1000) : null;
        me.buffering = !!msg.buffering;
        me.rtt = typeof msg.rtt === 'number' && isFinite(msg.rtt) ? Math.round(msg.rtt) : null;
        room.dirty = true;
        break;
      }
      case 'chat': {
        const text = cleanText(msg.text, 500).trim();
        if (!text) return;
        const now = Date.now();
        me.chatTimes = (me.chatTimes || []).filter((t) => now - t < 5000);
        if (me.chatTimes.length >= 8) return; // anti-flood
        me.chatTimes.push(now);
        broadcast(room, { t: 'chat', id: me.id, name: me.name, text, ts: now });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.members.delete(ws);
    if (room.members.size === 0) {
      // Mantém a sala por 10 min caso alguém recarregue a página
      const code = room.code;
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.members.size === 0) rooms.delete(code);
      }, 10 * 60 * 1000);
    } else {
      broadcast(room, { t: 'members', members: memberList(room) });
      broadcast(room, { t: 'system', text: `${me.name} saiu da sala` });
    }
  });
});

function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Envia lista de membros (com o atraso de cada um) quando mudar
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.dirty && room.members.size) {
      room.dirty = false;
      broadcast(room, { t: 'members', members: memberList(room) });
    }
  }
}, 1000);

// Derruba conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log('');
  console.log('  SyncWatch rodando!');
  console.log(`  Abra no navegador: http://localhost:${PORT}`);
  console.log('  Para seu amigo entrar de outra casa, rode também o iniciar-tunel.bat');
  console.log('');
});
