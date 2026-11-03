/*
 * Testes do SyncWatch:
 *  1) Simulação: dois players com relógios e atrasos diferentes convergem para o mesmo segundo
 *  2) Servidor real: duas conexões entram na sala, trocam estado, ping/pong e chat
 * Rodar: npm test
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { SyncEngine } = require('../public/sync-engine.js');

// ---------- 1) Simulação com tempo virtual ----------
function simulate({ clockError, startOffset, supportsRate, seekCost, label }) {
  let now = 1_000_000;
  const realDateNow = Date.now;
  Date.now = () => now;

  class FakePlayer {
    constructor(t) { this.t = t; this.paused = true; this.rate = 1; this.pendingSeek = null; }
    step(dt) {
      if (this.pendingSeek && now >= this.pendingSeek.at) { this.t = this.pendingSeek.to; this.pendingSeek = null; }
      if (!this.paused && !this.pendingSeek) this.t += (dt / 1000) * this.rate;
    }
    adapter(engineRef) {
      return {
        ready: () => true,
        time: () => this.t,
        duration: () => 3600,
        paused: () => this.paused,
        buffering: () => !!this.pendingSeek,
        play: () => { this.paused = false; },
        pause: () => { this.paused = true; },
        // o seek "trava" o vídeo por um tempo, como na vida real
        seek: (to) => { this.pendingSeek = { to, at: now + seekCost }; },
        setRate: (r) => { this.rate = supportsRate ? r : (r === 1 ? 1 : 1.25); },
        rate: () => this.rate,
      };
    }
  }

  const serverAt = now;
  const room = { playing: true, position: 120, at: serverAt, seq: 1 };
  const pA = new FakePlayer(120 + startOffset[0]);
  const pB = new FakePlayer(120 + startOffset[1]);
  const eA = new SyncEngine(pA.adapter(), { serverNow: () => now + clockError[0], onLocalChange: () => {} });
  const eB = new SyncEngine(pB.adapter(), { serverNow: () => now + clockError[1], onLocalChange: () => {} });
  pA.paused = false; pB.paused = false;
  eA.applyRemote(room); eB.applyRemote(room);

  const dt = 20;
  let worstAfter10s = 0;
  for (let ms = 0; ms < 30_000; ms += dt) {
    now += dt;
    pA.step(dt); pB.step(dt);
    if (ms % 400 === 0) { eA.correct(); eB.correct(); }
    if (ms > 10_000) worstAfter10s = Math.max(worstAfter10s, Math.abs(pA.t - pB.t));
  }
  Date.now = realDateNow;
  const finalGap = Math.abs(pA.t - pB.t) * 1000;
  console.log(`  ${label}: diferença final ${finalGap.toFixed(0)} ms | pior após 10 s ${(worstAfter10s * 1000).toFixed(0)} ms | modo ${eA.rateMode}`);
  return { finalGap, worst: worstAfter10s * 1000 };
}

console.log('1) Simulação de sincronização');
let r = simulate({ label: 'pequena diferença (0,4 s)', clockError: [8, -12], startOffset: [0, -0.4], supportsRate: true, seekCost: 300 });
assert(r.finalGap < 60 && r.worst < 120, 'deveria convergir com ajuste de velocidade');
r = simulate({ label: 'grande diferença (7 s)', clockError: [15, -15], startOffset: [3, -4], supportsRate: true, seekCost: 600 });
assert(r.finalGap < 60, 'deveria pular e depois ajustar');
r = simulate({ label: 'player sem velocidade fina', clockError: [10, -5], startOffset: [0, -0.8], supportsRate: false, seekCost: 250 });
assert(r.finalGap < 400, 'sem ajuste fino, deve ficar abaixo do limite de pulo');

// ---------- 2) Servidor real ----------
async function serverTest() {
  console.log('2) Servidor de salas');
  const port = 3999;
  const env = { ...process.env, PORT: String(port) };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'pipe' });
  await new Promise((res, rej) => {
    srv.stdout.on('data', (d) => { if (String(d).includes('rodando')) res(); });
    srv.on('exit', (c) => rej(new Error(`servidor saiu com código ${c}`)));
  });

  const WS = globalThis.WebSocket || require('ws');
  const open = (name) => new Promise((res) => {
    const ws = new WS(`ws://localhost:${port}`);
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room: 'Teste-1!', name, client: 'web' })); res(ws); };
  });
  const waitFor = (ws, pred, ms = 2000) => new Promise((res, rej) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const m = ws.inbox.find(pred);
      if (m) { clearInterval(iv); res(m); }
      else if (Date.now() - start > ms) { clearInterval(iv); rej(new Error('tempo esgotado')); }
    }, 10);
  });

  try {
    const a = await open('Ana');
    const joinedA = await waitFor(a, (m) => m.t === 'joined');
    assert.strictEqual(joinedA.room, 'teste-1', 'código da sala deve ser normalizado');
    const b = await open('Beto');
    await waitFor(b, (m) => m.t === 'joined');
    const mem = await waitFor(a, (m) => m.t === 'members' && m.members.length === 2);
    assert.deepStrictEqual(mem.members.map((x) => x.name).sort(), ['Ana', 'Beto']);
    console.log('  ok: duas pessoas na mesma sala');

    a.send(JSON.stringify({ t: 'ping', c: 123 }));
    const pong = await waitFor(a, (m) => m.t === 'pong');
    assert(pong.c === 123 && Math.abs(pong.s - Date.now()) < 1000);
    console.log('  ok: ping/pong do relógio');

    a.send(JSON.stringify({ t: 'state', playing: true, position: 42.5, media: { kind: 'youtube', id: 'dQw4w9WgXcQ' } }));
    const st = await waitFor(b, (m) => m.t === 'state');
    assert(st.state.playing === true && st.state.position === 42.5 && st.state.media.id === 'dQw4w9WgXcQ' && st.state.by === 'Ana');
    const sys = await waitFor(b, (m) => m.t === 'system' && /trocou o vídeo/.test(m.text));
    assert(sys);
    console.log('  ok: estado (play/posição/vídeo) chega ao outro');

    b.send(JSON.stringify({ t: 'state', playing: false, position: 50 }));
    const st2 = await waitFor(a, (m) => m.t === 'state' && m.state.seq === 2);
    assert(st2.state.media && st2.state.media.id === 'dQw4w9WgXcQ', 'vídeo deve ser mantido quando não informado');
    await waitFor(a, (m) => m.t === 'system' && /Beto pausou/.test(m.text));
    console.log('  ok: pausa mantém o vídeo e avisa no chat');

    a.send(JSON.stringify({ t: 'state', playing: true, position: 1, media: { kind: 'youtube', id: 'x"<script>' } }));
    const st3 = await waitFor(b, (m) => m.t === 'state' && m.state.seq === 3);
    assert.strictEqual(st3.state.media.id, 'dQw4w9WgXcQ', 'ID inválido deve ser rejeitado');
    console.log('  ok: rejeita vídeo inválido');

    b.send(JSON.stringify({ t: 'chat', text: 'oi!' }));
    const chat = await waitFor(a, (m) => m.t === 'chat');
    assert(chat.name === 'Beto' && chat.text === 'oi!');
    console.log('  ok: chat');

    b.send(JSON.stringify({ t: 'status', drift: 0.034, buffering: false, rtt: 40 }));
    const mem2 = await waitFor(a, (m) => m.t === 'members' && m.members.some((x) => x.drift === 34));
    assert(mem2);
    console.log('  ok: atraso de cada um aparece para os outros');

    b.close();
    await waitFor(a, (m) => m.t === 'system' && /Beto saiu/.test(m.text));
    console.log('  ok: aviso de saída');
    a.close();
  } finally {
    srv.kill();
  }
}

serverTest()
  .then(() => console.log('\nTodos os testes passaram.'))
  .catch((e) => { console.error('\nFALHOU:', e.message); process.exit(1); });
